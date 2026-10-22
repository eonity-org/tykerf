// Images people add to a page (the editor's image tool): checked by their bytes, named by their
// content, and kept in the page's assets/ folder.
//
// Only raster images are accepted. SVG and HTML are refused: both can carry scripts, and the
// editor serves assets from its own origin. A file is never overwritten (the name is a hash of the
// bytes), so the box change that points to it is the only thing undo needs to revert.

import { createHash } from 'node:crypto';
import type { Workspace } from './workspace.js';

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const ascii = (b: Uint8Array, at: number, s: string) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));

/** The file extension of an image's format, from its first bytes; null when it isn't one we accept. */
export function imageType(b: Uint8Array): 'png' | 'jpg' | 'gif' | 'webp' | 'avif' | null {
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 'PNG\r\n\x1a\n')) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 6 && (ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a'))) return 'gif';
  if (b.length >= 12 && ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return 'webp';
  if (b.length >= 12 && ascii(b, 4, 'ftyp') && (ascii(b, 8, 'avif') || ascii(b, 8, 'avis'))) return 'avif';
  return null;
}

/** Keep an image in the page's assets/; returns its path as boxes refer to it ("assets/img-<hash>.<ext>"). */
export function saveImage(ws: Workspace, bytes: Uint8Array): string {
  if (!bytes.length) throw new Error('the image is empty');
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`the image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
  const ext = imageType(bytes);
  if (!ext) throw new Error('only PNG, JPEG, GIF, WebP and AVIF images can be added');
  const path = `assets/img-${createHash('sha1').update(bytes).digest('hex').slice(0, 12)}.${ext}`;
  if (!ws.store.exists(path)) ws.store.write(path, bytes);
  return path;
}

// ---- where an edited image came from, so a crop can be undone later (also after other changes) ----

/** How an image was made from an original in assets/: the crop (in the original's pixels, after turning), the quarter turns and the size limit. */
export interface ImageEdit {
  from: string;
  crop: { x: number; y: number; w: number; h: number };
  quarter: number;
  max: number;
}

const EDITS = '.images.json'; // page data next to the history: derived image -> its edit

const readEdits = (ws: Workspace): Record<string, ImageEdit> => JSON.parse(ws.store.read(EDITS) ?? '{}');
const isAsset = (p: string) => /^assets\/[A-Za-z0-9._-]+$/.test(p);

/** Remember that `path` was made from another image of the page (refused when the edit doesn't make sense). */
export function recordEdit(ws: Workspace, path: string, edit: ImageEdit) {
  const { from, crop, quarter, max } = edit;
  const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (!isAsset(from) || !ws.store.exists(from)) throw new Error(`"${from}" is not an image of this page`);
  if (!crop || ![crop.x, crop.y, crop.w, crop.h].every(n) || !(crop.w > 0 && crop.h > 0)) throw new Error('bad crop');
  if (![0, 1, 2, 3].includes(quarter) || !n(max)) throw new Error('bad image edit');
  const all = readEdits(ws);
  all[path] = { from, crop: { x: crop.x, y: crop.y, w: crop.w, h: crop.h }, quarter, max };
  ws.store.write(EDITS, JSON.stringify(all, null, 1) + '\n');
}

/** How an image of the page was made, when it was made by the image tool and its original is still there. */
export function imageOrigin(ws: Workspace, src: string): ImageEdit | null {
  const all = readEdits(ws);
  const e = Object.hasOwn(all, src) ? all[src] : null;
  return e && ws.store.exists(e.from) ? e : null;
}

/** Download an image (for "Copy into the page": a page that loads images from elsewhere stops doing so). */
export async function fetchImage(url: string): Promise<Uint8Array> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`"${url}" is not an address`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('only http and https images can be copied');
  const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`the image could not be downloaded (HTTP ${r.status})`);
  if (Number(r.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) throw new Error(`the image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`the image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
  return bytes;
}

/** The images in a page's assets/ folder, as boxes refer to them. */
export function pageImages(ws: Workspace): string[] {
  return ws.assets().filter((f) => /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(f)).map((f) => `assets/${f}`);
}

// ---- files nothing uses any more (crops leave the earlier version behind, removed boxes their pictures) ----

/** Everything that may still point at a file of assets/: the code, the head, undo and redo, the paste buffer. */
function references(ws: Workspace): string {
  return [
    ...Object.values(ws.contents()),
    ws.head(),
    ws.store.read('.history.jsonl') ?? '',
    ws.store.read('.redo.jsonl') ?? '',
    ws.store.read('.tykerf/buffer.json') ?? '',
  ].join('\n');
}

/** The files in assets/ that nothing refers to, not even a step undo can bring back. An edited image keeps its original. */
export function unusedAssets(ws: Workspace): { file: string; bytes: number }[] {
  const refs = references(ws);
  const files = ws.assets();
  const used = new Set(files.filter((f) => refs.includes(f)));
  // the original of an image that is used stays, so the image tool can reopen the crop
  const edits = readEdits(ws);
  for (let grew = true; grew;) {
    grew = false;
    for (const f of [...used]) {
      const from = edits[`assets/${f}`]?.from.slice('assets/'.length);
      if (from && !used.has(from)) used.add(from), (grew = true);
    }
  }
  return files.filter((f) => !used.has(f)).map((file) => ({ file, bytes: ws.store.readBytes(`assets/${file}`)?.length ?? 0 }));
}

/** Move the unused files to .trash/ (nothing is deleted). Returns where they went and how many moved. */
export function trashUnusedAssets(ws: Workspace): { trash: string; files: number; bytes: number } {
  return ws.transaction(() => {
    const unused = unusedAssets(ws);
    const trash = `.trash/assets-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    for (const { file } of unused) {
      ws.store.write(`${trash}/${file}`, ws.store.readBytes(`assets/${file}`)!);
      ws.store.remove(`assets/${file}`);
    }
    const edits = readEdits(ws);
    const gone = unused.filter(({ file }) => Object.hasOwn(edits, `assets/${file}`));
    if (gone.length) {
      for (const { file } of gone) delete edits[`assets/${file}`];
      ws.store.write(EDITS, JSON.stringify(edits, null, 1) + '\n');
    }
    return { trash, files: unused.length, bytes: unused.reduce((n, f) => n + f.bytes, 0) };
  });
}
