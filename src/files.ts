// Any web file a page or the site uses (an image, a font, a PDF, a stylesheet, a script), brought in from a local
// path or an http(s) address: read, checked by its bytes, sized, and kept in the page's assets/ or the site's,
// under a free name. A file with the same bytes already there is used as it is (nothing is written twice).
//
// Local paths are read only where the server runs on the person's own computer (the stdio server, the Claude
// plugin: `localFiles`); the editor's in-process AI runs take addresses and attached files only (SECURITY.md).

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { hashedName, imageType } from './assets.js';
import { kitError } from './kit.js';
import type { Store } from './store.js';
import type { Workspace } from './workspace.js';
import { SiteHistory } from './site/history.js';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** What one folder's assets/ (a page's, or the site's) may hold in all. */
export const MAX_FILES_BYTES = 200 * 1024 * 1024;

export type FileKind = 'image' | 'svg' | 'font' | 'pdf' | 'css' | 'js';

/** A file as it came: its bytes, the name it had, what its server said it was, and whether it came from a local path. */
export interface Source {
  bytes: Uint8Array;
  name: string;
  type: string | null;
  local: boolean;
}

/** A path as people write it: ~ is the home folder. */
const pathOf = (p: string) => resolve(p.trim() === '~' || p.trim().startsWith('~/') ? join(homedir(), p.trim().slice(1)) : p.trim());

/** Read a file from an http(s) address, or (with `localFiles`) from a path on this computer. */
export async function readSource(from: string, opts: { localFiles: boolean }): Promise<Source> {
  if (/^https?:\/\//i.test(from.trim())) {
    const u = new URL(from.trim());
    const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`${u.href} could not be downloaded (HTTP ${r.status})`);
    if (Number(r.headers.get('content-length') ?? 0) > MAX_FILE_BYTES) throw new Error(`${u.href} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`${u.href} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
    return { bytes, name: decodeURIComponent(basename(u.pathname)) || 'file', type: r.headers.get('content-type'), local: false };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(from.trim()) && !/^[a-z]:[\\/]/i.test(from.trim())) throw new Error(`"${from}": only http and https addresses, or a path on this computer`);
  if (!opts.localFiles) throw new Error('a path on this computer can\'t be read here: give an http(s) address, or a file the person attached');
  const path = pathOf(from);
  let size: number;
  try {
    const st = statSync(path);
    if (!st.isFile()) throw new Error('not a file');
    size = st.size;
  } catch {
    throw new Error(`${path} is not a file this computer has`);
  }
  if (size > MAX_FILE_BYTES) throw new Error(`${path} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  return { bytes: new Uint8Array(readFileSync(path)), name: basename(path), type: null, local: true };
}

const ascii = (b: Uint8Array, at: number, s: string) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));

/**
 * What a file is, by its bytes: a raster image, an SVG (without scripts), a font, a PDF; a stylesheet or a script
 * only from a local path or when its server says so (text has no magic bytes), CSS checked as the kit's is.
 * Its extension, or an error saying what TYKERF takes.
 */
export function fileKind(src: Source): { kind: FileKind; ext: string } {
  const b = src.bytes;
  if (!b.length) throw new Error(`${src.name} is empty`);
  const raster = imageType(b);
  if (raster) return { kind: 'image', ext: raster };
  if (ascii(b, 0, 'wOF2')) return { kind: 'font', ext: 'woff2' };
  if (ascii(b, 0, 'wOFF')) return { kind: 'font', ext: 'woff' };
  if (ascii(b, 0, 'OTTO')) return { kind: 'font', ext: 'otf' };
  if (b.length > 4 && b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) return { kind: 'font', ext: 'ttf' };
  if (ascii(b, 0, '%PDF')) return { kind: 'pdf', ext: 'pdf' };
  const text = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, 4096)).trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg\b/i.test(text)) {
    const code = new TextDecoder().decode(b);
    if (/<script\b|<foreignObject\b|\son\w+\s*=|javascript:|\b(?:href|src)\s*=\s*["']\s*(?:[a-z]+:)?\/\//i.test(code)) throw new Error(`${src.name}: an SVG with scripts, event attributes, foreignObject or links to other files can't be used`);
    return { kind: 'svg', ext: 'svg' };
  }
  const ext = src.name.split('.').pop()!.toLowerCase();
  const says = (re: RegExp) => !!src.type && re.test(src.type);
  if ((ext === 'css' && src.local) || says(/^text\/css\b/i)) {
    const err = kitError('styles', basename(src.name, '.css').toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'file', new TextDecoder().decode(b));
    if (err) throw new Error(err);
    return { kind: 'css', ext: 'css' };
  }
  if (((ext === 'js' || ext === 'mjs') && src.local) || says(/^(text|application)\/(x-)?javascript\b/i)) return { kind: 'js', ext: 'js' };
  throw new Error(`${src.name} is not a file TYKERF takes: images (PNG, JPEG, GIF, WebP, AVIF, SVG), fonts (WOFF2, WOFF, TTF, OTF), PDF, and from this computer CSS and JS`);
}

/** A file name for the assets/ folder, from a wish and the file's real extension. */
function fileName(wish: string, ext: string): string {
  const base = wish.replace(/\.[A-Za-z0-9]{1,5}$/, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+|[-.]+$/g, '').slice(0, 60) || 'file';
  return `${base}.${ext}`;
}

export const contentHashOf = (b: Uint8Array) => createHash('sha1').update(b).digest('hex');

/**
 * Where these bytes go in a folder's assets/: the file that already has them (deduped), else the wished name when
 * it is free, else that name with a hash of the bytes. Throws when the folder would hold more than MAX_FILES_BYTES.
 */
export function placeFile(store: Store, bytes: Uint8Array, wish: string, ext: string): { file: string; deduped: boolean } {
  const files = store.list('assets');
  let total = 0;
  for (const f of files) {
    const there = store.readBytes(`assets/${f}`);
    if (!there) continue;
    total += there.length;
    if (there.length === bytes.length && Buffer.from(there).equals(bytes)) return { file: f, deduped: true };
  }
  if (total + bytes.length > MAX_FILES_BYTES) throw new Error(`the files would be more than ${MAX_FILES_BYTES / 1024 / 1024} MB in all; remove unused ones first`);
  let file = fileName(wish, ext);
  if (store.exists(`assets/${file}`)) file = hashedName(file, bytes);
  return { file, deduped: false };
}

/** A file added: its name in assets/, the address a box writes, its size and kind, and whether it was there already. */
export interface AddedFile {
  file: string;
  address: string;
  bytes: number;
  kind: FileKind;
  deduped: boolean;
}

/**
 * Add a file a source gave to a page (its assets/, written assets/<file>) or to the site (its assets/, written
 * /assets/<file>), as a step of that history (undo removes it). `name` is the wished name (else the source's).
 */
export function addFile(to: { page: Workspace } | { site: string }, src: Source, opts: { name?: string; from: string; author?: string }): AddedFile {
  const { kind, ext } = fileKind(src);
  const author = opts.author ?? 'user';
  const hash = contentHashOf(src.bytes);
  if ('page' in to) {
    const ws = to.page;
    return ws.transaction(() => {
      const { file, deduped } = placeFile(ws.store, src.bytes, opts.name ?? src.name, ext);
      if (!deduped) ws.addAsset(file, src.bytes, opts.from, author, hash);
      return { file, address: `assets/${file}`, bytes: src.bytes.length, kind, deduped };
    });
  }
  const history = new SiteHistory(to.site);
  return history.store.lock(() => {
    const { file, deduped } = placeFile(history.store, src.bytes, opts.name ?? src.name, ext);
    if (!deduped) history.addFile(`assets/${file}`, src.bytes, `add the file /assets/${file}`, author, hash);
    return { file, address: `/assets/${file}`, bytes: src.bytes.length, kind, deduped };
  });
}
