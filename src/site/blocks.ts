// The site kit's shared blocks: sharing a box, linking and unlinking it, and finding boxes already the same on several pages.

import { type Layout, find, walk } from '../model.js';
import * as M from '../moves.js';
import { Workspace } from '../workspace.js';
import { kitBlock, kitList, kitWrite, unmarkCurrentPage } from '../kit.js';
import { hashedName, mapPageFiles } from '../assets.js';
import { sitePages } from './pages.js';
import { pageWorkspace } from './index.js';
import { siteStore } from './history.js';

// ---------- the site kit's shared blocks (src/kit.ts) ----------
// A box with use=<name> shows kit/blocks/<name>.html on every page that links it. Sharing a box makes
// the block from its code and links it; making a page's own copy puts the block's code back in the box.

/** The pages whose boxes show a shared block, with the box names: { home: ['nav'], about: ['nav'] }. */
export function blockUsers(dir: string, name: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const p of sitePages(dir)) {
    const boxes: string[] = [];
    try {
      walk(pageWorkspace(dir, p).load().root, (n) => { if (n.type === 'leaf' && n.use === name) boxes.push(n.id); });
    } catch {}
    if (boxes.length) out[p] = boxes;
  }
  return out;
}

/** A free name for a new shared block, from a wish (the box's name, usually). */
function freeBlockName(dir: string, wish: string): string {
  const taken = new Set(kitList(dir).blocks);
  const base = wish.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'block';
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${base}-${i}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * A box's code made to work on every page of the site. The page's own files it uses (assets/<file>, which
 * under another page's address would be that page's) are copied to the site's assets/, and the code points
 * at them there (/assets/<file>). A site file of the same name with other bytes stays as it is: the copy's
 * name gets a hash of its bytes. Files the page doesn't have are left alone (check_page reports them).
 * Returns the code and the files copied.
 */
export function siteFiles(dir: string, ws: Workspace, code: string): { code: string; files: string[] } {
  const site = siteStore(dir); // the site's one store: its lock is reentrant inside a site group
  const files: string[] = [];
  const done = new Map<string, string | null>();
  const out = site.lock(() => mapPageFiles(code, (file) => {
    if (done.has(file)) return done.get(file)!;
    const bytes = ws.store.readBytes(`assets/${file}`);
    let to: string | null = null;
    if (bytes) {
      // the site's files are served by plain names (/assets/<name>), without folders
      let name = file.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '') || 'file';
      const there = site.readBytes(`assets/${name}`);
      if (there && !Buffer.from(there).equals(bytes)) name = hashedName(name, bytes);
      if (!site.exists(`assets/${name}`)) {
        site.write(`assets/${name}`, bytes);
        files.push(name);
      }
      to = `/assets/${name}`;
    }
    done.set(file, to);
    return to;
  }));
  return { code: out, files };
}

/**
 * Share a box with every page: its code becomes a shared block, and this box shows it. The page's own files
 * it uses go to the site's assets/ (siteFiles). Returns the block's name and the files that moved to the site.
 */
export function shareBlock(dir: string, ws: Workspace, box: string, wish = box, author = 'user'): { name: string; files: string[] } {
  const l = ws.load();
  const n = find(l.root, box)?.node;
  if (n?.type !== 'leaf') throw new Error(`"${box}" is not a box`);
  if (n.use) throw new Error(`"${box}" already shows the shared block "${n.use}"`);
  const name = freeBlockName(dir, wish);
  // without current-page marks: each page's are put back when it renders (markCurrentPage)
  const { code, files } = siteFiles(dir, ws, unmarkCurrentPage(ws.content(box) ?? ''));
  kitWrite(dir, 'blocks', name, code, `share ${box} as the shared block ${name}`, author);
  ws.save(M.setLeaf(l, box, { use: name }), `share ${box} with every page as ${name}`, author);
  return { name, files };
}

/**
 * Start a shared block from a new page's box (its layout declares it shared, and the site has none of that
 * name): the block is the box's code, with its files at the site (siteFiles) and no current-page marks. A step of
 * the site's history; the page itself only links it (see newSitePage). Returns the files that moved to the site.
 */
export function startBlock(dir: string, ws: Workspace, box: string, author = 'user'): string[] {
  const { code, files } = siteFiles(dir, ws, unmarkCurrentPage(ws.ownContent(box) ?? ''));
  kitWrite(dir, 'blocks', box, code, `share ${box} with every page`, author);
  return files;
}

/** The files sharing a block took to the site, for a reply: "" or "; its file went to the site's assets/, for every page: logo.png". */
export const movedFiles = (files: string[]) => (files.length ? `; ${files.length === 1 ? 'its file' : 'its files'} went to the site's assets/, for every page: ${files.join(', ')}` : '');

/** Make a box show a shared block of the site (its own code stays, for when it's unlinked). */
export function linkBlock(dir: string, ws: Workspace, box: string, name: string, author = 'user') {
  if (kitBlock(dir, name) === null) throw new Error(`the site has no shared block "${name}"`);
  const l = ws.load();
  if (find(l.root, box)?.node.type !== 'leaf') throw new Error(`"${box}" is not a box`);
  ws.save(M.setLeaf(l, box, { use: name }), `use the shared block ${name} in ${box}`, author);
}

/** Make a box this page's own again: it gets the shared block's code as it is now, and stops following it. One undo step. */
export function unlinkBlock(ws: Workspace, box: string, author = 'user') {
  const l = ws.load();
  const n = find(l.root, box)?.node;
  if (n?.type !== 'leaf' || !n.use) throw new Error(`"${box}" doesn't show a shared block`);
  const code = ws.content(box);
  ws.group(`make ${box} this page's own copy of ${n.use}`, author, () => {
    ws.save(M.setLeaf(ws.load(), box, { use: null }), `unlink ${box} from ${n.use}`, author);
    if (code !== null) ws.setContent(box, code, author);
  });
}

/** A box's code as identicalBoxes compares it: without current-page marks, whitespace runs as one space, trimmed. */
const sameness = (code: string) => unmarkCurrentPage(code).replace(/\s+/g, ' ').trim();

/**
 * Boxes that are already the same on several pages and not shared yet (a navigation, a footer): the box name
 * and the pages. Copies that differ only in which link is marked current (aria-current) or in white space count
 * as the same; such a group says `normalized: true`.
 */
export function identicalBoxes(dir: string): { box: string; pages: string[]; normalized?: true }[] {
  const seen = new Map<string, Map<string, { pages: string[]; codes: Set<string> }>>(); // box name → compared code → pages
  for (const p of sitePages(dir)) {
    const ws = pageWorkspace(dir, p);
    let l: Layout;
    try { l = ws.load(); } catch { continue; }
    walk(l.root, (n) => {
      if (n.type !== 'leaf' || n.use) return;
      const code = ws.ownContent(n.id);
      if (!code?.trim()) return;
      const byCode = seen.get(n.id) ?? new Map<string, { pages: string[]; codes: Set<string> }>();
      const key = sameness(code);
      const g = byCode.get(key) ?? { pages: [], codes: new Set<string>() };
      g.pages.push(p);
      g.codes.add(code);
      byCode.set(key, g);
      seen.set(n.id, byCode);
    });
  }
  const out: { box: string; pages: string[]; normalized?: true }[] = [];
  for (const [box, byCode] of seen) for (const { pages, codes } of byCode.values()) if (pages.length > 1) out.push({ box, pages, ...(codes.size > 1 ? { normalized: true as const } : {}) });
  return out.sort((a, b) => b.pages.length - a.pages.length || a.box.localeCompare(b.box));
}

/** Share a box that is the same on several pages: one shared block from it (the first page's code, without current-page marks), linked on each of those pages. */
export function shareIdentical(dir: string, box: string, author = 'user'): { name: string; pages: string[]; files: string[] } {
  const group = identicalBoxes(dir).find((g) => g.box === box);
  if (!group) throw new Error(`no box "${box}" is the same on several pages`);
  const [first, ...rest] = group.pages;
  const { name, files } = shareBlock(dir, pageWorkspace(dir, first), box, box, author);
  for (const p of rest) linkBlock(dir, pageWorkspace(dir, p), box, name, author);
  return { name, pages: group.pages, files };
}
