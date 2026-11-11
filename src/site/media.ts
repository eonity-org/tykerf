// The files of a site and its pages (each folder's assets/): which file is which by its bytes, so a copy of a
// page never duplicates a file the site already has, and the site manager's Media can tell who uses what.

import { createHash } from 'node:crypto';
import type { Store } from '../store.js';
import { FolderStore } from '../store.js';
import type { Workspace } from '../workspace.js';
import { mapPageFiles, pageFileRefs } from '../assets.js';
import { SiteHistory, siteStore } from './history.js';
import { sitePages } from './pages.js';
import { pageWorkspace } from './index.js';

// a file's hash, kept while its time and size stay the same (FolderStore.stamp): read once, not on every copy
const hashes = new Map<string, { stamp: string; hash: string }>();

/** A hash of a file's bytes (cached by its time and size in a folder store), or null when it isn't there. */
export function fileHash(store: Store, path: string): string | null {
  const stamp = store instanceof FolderStore ? store.stamp(path) : null;
  const key = `${store.location}\0${path}`;
  if (stamp) {
    const known = hashes.get(key);
    if (known?.stamp === stamp) return known.hash;
  }
  const bytes = store.readBytes(path);
  if (!bytes) return null;
  const hash = createHash('sha1').update(bytes).digest('hex');
  if (stamp) hashes.set(key, { stamp, hash });
  return hash;
}

/** The site's files by the hash of their bytes: { <hash>: <name in assets/> }. */
export function siteFilesByHash(dir: string): Map<string, string> {
  const store = siteStore(dir);
  const out = new Map<string, string>();
  for (const f of store.list('assets')) {
    const h = fileHash(store, `assets/${f}`);
    if (h && !out.has(h)) out.set(h, f);
  }
  return out;
}

/**
 * The page files a copy of a page needs (`code`: the boxes and head it takes), copied from `src` to `dst`: only
 * the files the code names as the page's own (assets/<file>), and none the site already has, the same bytes under
 * any name: the code points at the site's instead (/assets/<name>). Returns the code as the copy has it, and what
 * was copied and what was the site's.
 */
export function copyPageFiles(src: Workspace, dst: Workspace, code: Record<string, string>, siteDir: string | null): { code: Record<string, string>; copied: string[]; site: string[] } {
  const site = siteDir ? siteFilesByHash(siteDir) : new Map<string, string>();
  const copied: string[] = [], theSites: string[] = [];
  const to = new Map<string, string | null>(); // page file → the site's address, or null (copied, as it is)
  for (const f of new Set(Object.values(code).flatMap((c) => pageFileRefs(c)))) {
    const h = fileHash(src.store, `assets/${f}`);
    if (!h) continue; // a file the page doesn't have: the copy reports it as the page does
    const theirs = site.get(h);
    if (theirs) {
      to.set(f, `/assets/${theirs}`);
      theSites.push(f);
      continue;
    }
    to.set(f, null);
    if (!dst.store.exists(`assets/${f}`)) dst.store.write(`assets/${f}`, src.store.readBytes(`assets/${f}`)!);
    copied.push(f);
  }
  const out = Object.fromEntries(Object.entries(code).map(([k, c]) => [k, theSites.length ? mapPageFiles(c, (f) => to.get(f) ?? null) : c]));
  return { code: out, copied, site: theSites };
}

// ---------- Media: every file of the site and its pages, who uses it, and what to do with it ----------

export interface MediaFile {
  /** 'site' (the site's assets/, written /assets/<file>) or a page's name (its assets/, written assets/<file>). */
  where: string;
  file: string;
  bytes: number;
  kind: 'image' | 'font' | 'pdf' | 'css' | 'js' | 'video' | 'other';
  /** Where it is used: a page's box or head, or the site's head or kit (page null). */
  used: { page: string | null; box: string }[];
  /** Named only by an undo or redo step or the paste buffer: not used, but not unused either (undo needs it). */
  held: boolean;
}

const KINDS: [RegExp, MediaFile['kind']][] = [
  [/\.(png|jpe?g|gif|webp|avif|svg|ico)$/i, 'image'], [/\.(woff2?|ttf|otf)$/i, 'font'], [/\.pdf$/i, 'pdf'],
  [/\.css$/i, 'css'], [/\.m?js$/i, 'js'], [/\.(mp4|webm)$/i, 'video'],
];
const kindOf = (f: string) => KINDS.find(([re]) => re.test(f))?.[1] ?? 'other';

/** The site's files some code names (/assets/<file>), by name. */
export function siteFileRefs(code: string): string[] {
  return [...new Set([...code.matchAll(/(?:^|[\s"'(,=])\/assets\/([A-Za-z0-9][A-Za-z0-9._-]*)/g)].map((m) => m[1]))];
}

/** What a page holds that names files: its boxes' own code (by box), its head, and what undo, redo and the buffer keep. */
function pageCode(dir: string, page: string): { boxes: Record<string, string>; head: string; held: string } {
  const ws = pageWorkspace(dir, page);
  const boxes: Record<string, string> = {};
  for (const id of ws.boxIds()) boxes[id] = ws.ownContent(id) ?? '';
  return { boxes, head: ws.head(), held: ['.history.jsonl', '.redo.jsonl', '.tykerf/buffer.json'].map((f) => ws.store.read(f) ?? '').join('\n') };
}

// the listing, kept while no file it was made from changed (their times and sizes)
const listings = new Map<string, { stamp: string; files: MediaFile[] }>();

/** What the listing depends on: every file that names files, and every file listed, by time and size. */
function mediaStamp(dir: string): string {
  const site = siteStore(dir);
  const parts: string[] = [];
  const add = (s: FolderStore, path: string) => parts.push(`${s.root}/${path}=${s.stamp(path)}`);
  for (const f of ['head.html', '.tykerf/site.jsonl', '.tykerf/site-redo.jsonl']) add(site, f);
  for (const kind of ['styles', 'blocks']) for (const f of site.list(`kit/${kind}`)) add(site, `kit/${kind}/${f}`);
  add(site, 'kit/fonts.json');
  for (const f of site.list('assets')) add(site, `assets/${f}`);
  for (const p of sitePages(dir)) {
    const s = new FolderStore(`${dir}/${p}`);
    for (const f of ['layout.slice', 'head.html', 'contents.json', '.history.jsonl', '.redo.jsonl', '.tykerf/buffer.json', '.images.json']) add(s, f);
    for (const f of s.list('boxes')) add(s, `boxes/${f}`);
    for (const f of s.list('assets')) add(s, `assets/${f}`);
  }
  return parts.join('\n');
}

/** Every file of the site and of its pages, with who uses it, newest knowledge (cached while nothing changed). */
export function siteMedia(dir: string): MediaFile[] {
  const stamp = mediaStamp(dir);
  const root = siteStore(dir).root;
  const known = listings.get(root);
  if (known?.stamp === stamp) return known.files;
  const site = siteStore(dir);
  const files: MediaFile[] = [];
  const entry = (where: string, s: { list(d: string): string[]; readBytes(p: string): Uint8Array | null }) =>
    s.list('assets').map((file) => ({ where, file, bytes: s.readBytes(`assets/${file}`)?.length ?? 0, kind: kindOf(file), used: [], held: false }) as MediaFile);
  const siteFiles = new Map(entry('site', site).map((f) => [f.file, f]));
  const useSite = (code: string, page: string | null, box: string) => {
    for (const f of siteFileRefs(code)) siteFiles.get(f)?.used.push({ page, box });
  };
  // the site's own code: its head (the theme's fonts), its kit's styles and shared blocks, its fonts
  useSite(site.read('head.html') ?? '', null, 'head');
  for (const kind of ['styles', 'blocks']) for (const f of site.list(`kit/${kind}`)) useSite(site.read(`kit/${kind}/${f}`) ?? '', null, 'kit');
  for (const f of Object.values(JSON.parse(site.read('kit/fonts.json') ?? '{}') as Record<string, { files?: { file: string }[] }>).flatMap((x) => x.files ?? [])) siteFiles.get(f.file)?.used.push({ page: null, box: 'kit' });
  const siteHeld = ['.tykerf/site.jsonl', '.tykerf/site-redo.jsonl'].map((f) => site.read(f) ?? '').join('\n');
  for (const page of sitePages(dir)) {
    const ws = pageWorkspace(dir, page);
    const mine = new Map(entry(page, ws.store).map((f) => [f.file, f]));
    const { boxes, head, held } = pageCode(dir, page);
    for (const [box, code] of [...Object.entries(boxes), ['head', head] as [string, string]]) {
      for (const f of pageFileRefs(code)) mine.get(f)?.used.push({ page, box });
      useSite(code, page, box);
    }
    for (const f of mine.values()) if (!f.used.length && held.includes(`assets/${f.file}`)) f.held = true;
    // an edited picture keeps its original (the image tool reopens the crop): the original counts as used by it
    const edits = JSON.parse(ws.store.read('.images.json') ?? '{}') as Record<string, { from: string }>;
    for (const [derived, e] of Object.entries(edits)) {
      const original = mine.get(e.from.replace(/^assets\//, ''));
      if (original && mine.get(derived.replace(/^assets\//, ''))?.used.length && !original.used.length) original.held = true;
    }
    files.push(...mine.values());
  }
  for (const f of siteFiles.values()) if (!f.used.length && siteHeld.includes(`/assets/${f.file}`)) f.held = true;
  const out = [...siteFiles.values(), ...files];
  listings.set(root, { stamp, files: out });
  return out;
}

/** Take a file out of the site or a page (into .tykerf/trash/, a step undo takes back). */
export function removeMediaFile(dir: string, where: string, file: string, author = 'user') {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file)) throw new Error(`"${file}" is not a file name`);
  if (where === 'site') {
    if (!new SiteHistory(dir).removeFile(`assets/${file}`, `remove the file /assets/${file}`, author)) throw new Error(`the site has no file "${file}"`);
    return;
  }
  if (!sitePages(dir).includes(where)) throw new Error(`there is no page "${where}" in the site`);
  const ws = pageWorkspace(dir, where);
  if (!ws.store.exists(`assets/${file}`)) throw new Error(`the page ${where} has no file "${file}"`);
  ws.removeAsset(file, author);
}

/** Point a page's own code at the site's file instead of its own (assets/<file> → /assets/<to>), and take its file away: one page step. */
function pageFileToSite(dir: string, page: string, file: string, to: string, author: string) {
  const ws = pageWorkspace(dir, page);
  ws.group(`use the site's file /assets/${to} instead of assets/${file}`, author, () => {
    const swap = (code: string) => mapPageFiles(code, (f) => (f === file ? `/assets/${to}` : null));
    for (const id of ws.boxIds()) {
      const own = ws.ownContent(id);
      if (own !== null && swap(own) !== own) ws.setContent(id, swap(own), author, { own: true });
    }
    if (swap(ws.head()) !== ws.head()) ws.setHead(swap(ws.head()), author);
    ws.removeAsset(file, author);
  });
}

/**
 * Move a page's file to the site: the site gets it (or has it already, the same bytes), and every page that has a
 * file with those bytes uses the site's instead. Returns the site's name for it and the pages that changed.
 */
export function moveToSite(dir: string, page: string, file: string, author = 'user'): { file: string; pages: string[] } {
  if (!sitePages(dir).includes(page)) throw new Error(`there is no page "${page}" in the site`);
  const src = pageWorkspace(dir, page);
  const bytes = src.store.readBytes(`assets/${file}`);
  if (!bytes) throw new Error(`the page ${page} has no file "${file}"`);
  const hash = fileHash(src.store, `assets/${file}`)!;
  const history = new SiteHistory(dir);
  let to = siteFilesByHash(dir).get(hash);
  if (!to) {
    to = siteStore(dir).exists(`assets/${file}`) ? `${file.replace(/(\.[^.]+)$/, '')}-${hash.slice(0, 12)}${/\.[^.]+$/.exec(file)?.[0] ?? ''}` : file;
    history.addFile(`assets/${to}`, bytes, `move ${page}'s file assets/${file} to the site as /assets/${to}`, author, hash);
  }
  const pages: string[] = [];
  for (const p of sitePages(dir)) {
    const ws = pageWorkspace(dir, p);
    for (const f of ws.assets()) if (fileHash(ws.store, `assets/${f}`) === hash) pageFileToSite(dir, p, f, to, author), pages.push(p);
  }
  return { file: to, pages: [...new Set(pages)] };
}

/** Every page file the site already has (the same bytes): its page uses the site's instead. Returns how many. */
export function moveSiteDuplicates(dir: string, author = 'user'): number {
  const site = siteFilesByHash(dir);
  let n = 0;
  for (const p of sitePages(dir)) {
    const ws = pageWorkspace(dir, p);
    for (const f of ws.assets()) {
      const to = site.get(fileHash(ws.store, `assets/${f}`) ?? '');
      if (to) pageFileToSite(dir, p, f, to, author), n++;
    }
  }
  return n;
}

/** Take every unused file out (into .tykerf/trash/, each a step undo takes back). Returns how many, and their bytes. */
export function pruneMedia(dir: string, author = 'user'): { files: number; bytes: number } {
  const unused = siteMedia(dir).filter((f) => !f.used.length && !f.held);
  for (const f of unused) removeMediaFile(dir, f.where, f.file, author);
  return { files: unused.length, bytes: unused.reduce((n, f) => n + f.bytes, 0) };
}
