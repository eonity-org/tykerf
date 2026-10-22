// A small ZIP reader (PKWARE APPNOTE: the central directory, then each file's local header), the
// counterpart of zip.ts, so reading a design export needs no dependency. It reads stored and deflated
// files only, and it never trusts the archive: names are checked like store paths, sizes are capped
// before and while inflating (a zip bomb stops at the cap), and each file's CRC must match.

import { crc32, inflateRawSync } from 'node:zlib';
import type { ZipFile } from './zip.js';

export interface UnzipLimits {
  maxFiles?: number; // entries in the archive (folders included)
  maxFile?: number; // bytes of one unpacked file
  maxTotal?: number; // bytes of all unpacked files
}

export interface Unzipped {
  files: ZipFile[];
  skipped: string[]; // entries left out, with the reason
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** A path that is safe to name: forward slashes, no absolute path, no "..", no control characters. */
function safePath(name: string): boolean {
  return !!name && !name.startsWith('/') && !/^[a-z]:/i.test(name) && !name.includes('\\') && !/[\0-\x1f]/.test(name) && !name.split('/').includes('..');
}

/** The files in a ZIP archive. Throws when the bytes are not a ZIP archive or break a limit. */
export function unzip(bytes: Uint8Array, { maxFiles = 200, maxFile = 10 * 1024 * 1024, maxTotal = 40 * 1024 * 1024 }: UnzipLimits = {}): Unzipped {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // the end of central directory record: the last 22 bytes, or before a comment of up to 64 KB
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) if (b.readUInt32LE(i) === EOCD) { end = i; break; }
  if (end < 0) throw new Error('this is not a ZIP file');
  const count = b.readUInt16LE(end + 10);
  const size = b.readUInt32LE(end + 12);
  let at = b.readUInt32LE(end + 16);
  if (count === 0xffff || at === 0xffffffff) throw new Error('ZIP64 archives are not supported');
  if (count > maxFiles) throw new Error(`the ZIP file has more than ${maxFiles} files`);
  if (at + size > end) throw new Error('the ZIP file is damaged');

  const files: ZipFile[] = [];
  const skipped: string[] = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || b.readUInt32LE(at) !== CENTRAL) throw new Error('the ZIP file is damaged');
    const flags = b.readUInt16LE(at + 8);
    const method = b.readUInt16LE(at + 10);
    const crc = b.readUInt32LE(at + 16);
    const packed = b.readUInt32LE(at + 20);
    const length = b.readUInt32LE(at + 24);
    const nameLen = b.readUInt16LE(at + 28);
    const local = b.readUInt32LE(at + 42);
    const name = b.toString(flags & 0x0800 ? 'utf8' : 'latin1', at + 46, at + 46 + nameLen);
    at += 46 + nameLen + b.readUInt16LE(at + 30) + b.readUInt16LE(at + 32);

    if (name.endsWith('/')) continue; // a folder
    if (!safePath(name)) { skipped.push(`${name}: not a safe file name`); continue; }
    if (flags & 0x0001) { skipped.push(`${name}: encrypted`); continue; }
    if (method !== 0 && method !== 8) { skipped.push(`${name}: compressed in a way TYKERF doesn't read`); continue; }
    if (length > maxFile) { skipped.push(`${name}: larger than ${Math.round(maxFile / 1024 / 1024)} MB`); continue; }
    if (total + length > maxTotal) throw new Error(`the ZIP file unpacks to more than ${Math.round(maxTotal / 1024 / 1024)} MB`);

    if (local + 30 > b.length || b.readUInt32LE(local) !== LOCAL) throw new Error('the ZIP file is damaged');
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    if (start + packed > b.length) throw new Error('the ZIP file is damaged');
    const data = b.subarray(start, start + packed);
    let out: Buffer;
    try {
      // the cap holds even when the archive lies about the size
      out = method === 0 ? Buffer.from(data) : inflateRawSync(data, { maxOutputLength: Math.max(length, 1) });
    } catch {
      skipped.push(`${name}: damaged or larger than it says`);
      continue;
    }
    if (out.length !== length || crc32(out) !== crc) { skipped.push(`${name}: damaged`); continue; }
    total += out.length;
    files.push({ path: name, bytes: new Uint8Array(out) });
  }
  return { files, skipped };
}
