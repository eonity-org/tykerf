// What a request to Kaity brings besides its words: files the person attached with the composer's Attach (or
// dropped, or pasted). Pictures and PDFs go to the model as they are (every runner takes both); a design
// exported as a ZIP file gives its pictures and its text files as reference (design-zip.ts). Nothing else is
// taken, and nothing in a file runs.

import { imageType } from '../assets.js';
import type { Attachment } from './ai.js';
import { MAX_ZIP, designContext, designNote, readDesignZip } from './design-zip.js';

export const PDF = 'application/pdf';
export const PICTURES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
/** What one request may carry: pictures and PDFs together, a design ZIP's pictures included. */
export const MAX_FILES = 5;
export const MAX_PICTURE = 5 * 1024 * 1024;
export const MAX_PDF = 10 * 1024 * 1024;

/** One file as the editor sends it: its name, its type, and its bytes in base64. */
export interface SentFile {
  name?: string;
  type?: string;
  mediaType?: string;
  data?: string;
}

export interface Attached {
  /** For the model, and kept with the conversation (AI.keepFile). */
  files: Attachment[];
  /** Reference material that goes after the request (a design ZIP's text files). */
  context: string;
  /** What the conversation says about a ZIP file ("(Attached: design.zip: …)"); '' without one. */
  note: string;
}

const isZip = (f: SentFile, bytes: Uint8Array) => /\.zip$/i.test(f.name ?? '') || /zip/.test(f.type ?? '') || (bytes[0] === 0x50 && bytes[1] === 0x4b);
const isPdf = (bytes: Uint8Array) => Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-';

/**
 * The files of a request (`files`: SentFile[]; `images`: the older pictures-only list), checked by their bytes.
 * Throws with a sentence for the person when one can't go to Kaity.
 */
export function readAttachments(files: unknown, images?: unknown): Attached {
  const out: Attached = { files: [], context: '', note: '' };
  const list = [...(Array.isArray(images) ? images : []), ...(Array.isArray(files) ? files : [])] as SentFile[];
  for (const f of list) {
    const name = String(f?.name ?? '').replace(/[^\w .()-]/g, '').slice(0, 80) || 'file';
    const bytes = new Uint8Array(Buffer.from(String(f?.data ?? ''), 'base64'));
    if (!bytes.length) throw new Error(`${name} is empty`);
    if (isPdf(bytes)) {
      if (bytes.length > MAX_PDF) throw new Error(`${name} is larger than ${MAX_PDF / 1024 / 1024} MB`);
      out.files.push({ mediaType: PDF, data: Buffer.from(bytes).toString('base64'), name });
    } else if (imageType(bytes) && PICTURES.includes(`image/${imageType(bytes) === 'jpg' ? 'jpeg' : imageType(bytes)}`)) {
      if (bytes.length > MAX_PICTURE) throw new Error(`${name} is larger than ${MAX_PICTURE / 1024 / 1024} MB`);
      const ext = imageType(bytes)!;
      out.files.push({ mediaType: `image/${ext === 'jpg' ? 'jpeg' : ext}`, data: Buffer.from(bytes).toString('base64'), name });
    } else if (isZip(f, bytes)) {
      if (bytes.length > MAX_ZIP) throw new Error(`${name} is larger than ${MAX_ZIP / 1024 / 1024} MB`);
      let zip;
      try {
        zip = readDesignZip(bytes, Math.max(0, MAX_FILES - out.files.length));
      } catch (e) {
        throw new Error(`${name}: ${(e as Error).message}`);
      }
      if (!zip.images.length && !zip.texts.length) throw new Error(`${name} has no pictures or text files Kaity can use`);
      out.files.push(...zip.images.map(({ mediaType, data, path }) => ({ mediaType, data, name: path })));
      out.context = [out.context, designContext(name, zip)].filter(Boolean).join('\n\n');
      out.note = [out.note, designNote(name, zip)].filter(Boolean).join(' ');
    } else throw new Error(`${name}: Kaity reads PDFs, pictures (PNG, JPEG, GIF, WebP) and a design as a ZIP file`);
    if (out.files.length > MAX_FILES) throw new Error(`at most ${MAX_FILES} files (pictures and PDFs) per request`);
  }
  return out;
}
