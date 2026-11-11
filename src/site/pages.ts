// The pages of a site: what a site folder is, its pages' names, new pages (from a layout, like another
// page, with another page's blocks), the list of pages and the sitemap, links between pages, renames,
// duplicates, removals and the trash.

import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { type Layout, type Node, find, isOp, walk } from '../model.js';
import * as M from '../moves.js';
import { serializeSlice } from '../notation.js';
import { FolderStore } from '../store.js';
import { DEFAULT_THEME, componentCode, createPage, hasTheme, pageLayouts, readTheme, themes, withFonts, withOverrides } from '../library.js';
import { Workspace } from '../workspace.js';
import { kitList, kitRead, kitWrite } from '../kit.js';
import { readSite, writeSite, setHome, pageTitle } from './settings.js';
import { SiteHistory } from './history.js';
import { copyPageFiles, fileHash, siteFilesByHash } from './media.js';
import { mapPageFiles } from '../assets.js';
import { iconLink } from './icon.js';
import { SITE_HEAD, siteHead, startSiteTheme } from './head.js';
import { pageWorkspace } from './index.js';
import { startBlock } from './blocks.js';

/** The name of a new site's first page, which becomes its home page. */
export const HOME_PAGE = 'home';
/** Page names: they are folder names and the first part of the page's address in the editor. */
export const PAGE_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** Names the editor uses at the top of its addresses. */
export const RESERVED = new Set(['_tykerf', 'assets', 'out', 'pages', 'sitemap.xml', 'kit']);

const isPage = (dir: string) => existsSync(join(dir, 'layout.slice'));
const entries = (dir: string) => (existsSync(dir) ? readdirSync(dir) : []);

/**
 * Whether a folder is a site: empty or new, or a folder of pages. Besides its pages it may hold files (head.html,
 * site.json, a README) and folders that are TYKERF's own (assets/, out/) or empty. Any other folder means it holds
 * other things that happen to include a page, such as a home folder with Desktop and Documents: not a site.
 */
export function isSite(dir: string): boolean {
  let pages = 0;
  for (const f of entries(dir).filter((f) => !f.startsWith('.'))) {
    const path = join(dir, f);
    if (!statSync(path).isDirectory()) continue;
    if (isPage(path)) pages++;
    else if (!RESERVED.has(f) && entries(path).some((g) => !g.startsWith('.'))) return false;
  }
  return pages > 0 || !entries(dir).some((f) => !f.startsWith('.'));
}

/**
 * What a folder is: a page (it has a layout.slice), a site (see isSite), or neither: then it holds other
 * files and TYKERF won't write into it.
 */
export function siteKind(dir: string): 'page' | 'site' {
  if (isPage(dir)) return 'page';
  if (isSite(dir)) return 'site';
  if (sitePages(dir).length) throw new Error(`${dir} holds other folders besides its pages, so it isn't a site, and TYKERF won't start a page or a site there; open one of its pages, or a folder of pages only`);
  throw new Error(`${dir} holds other files and no pages, so TYKERF won't start a page or a site there`);
}

/** The pages of a site: its subfolders that hold a page, sorted by name. */
export function sitePages(dir: string): string[] {
  return entries(dir)
    .filter((f) => PAGE_NAME.test(f) && !RESERVED.has(f) && statSync(join(dir, f)).isDirectory() && isPage(join(dir, f)))
    .sort();
}

/** Why a name can't be a new page of the site, or null when it can. */
export function pageNameError(dir: string, name: string): string | null {
  if (!PAGE_NAME.test(name)) return `"${name}" can't be a page name: use lowercase letters, digits and -, starting with a letter or digit`;
  if (RESERVED.has(name)) return `"${name}" is used by TYKERF itself; choose another name`;
  if (existsSync(join(dir, name))) return `there is already a "${name}" in the site`;
  return null;
}

/**
 * Add a page to a site, from a layout and a theme preset. Returns the page's workspace.
 * In a site that shares one theme the page uses it (the preset is not used); a new, empty site starts
 * sharing the preset's theme with this first page; an older site whose pages each have their own
 * theme gets one more page with its own. The site's first page becomes its home page.
 */
export function newSitePage(dir: string, name: string, layout = 'blank', themeName = DEFAULT_THEME, opts: { shared?: boolean } = {}): Workspace {
  const err = pageNameError(dir, name);
  if (err) throw new Error(err);
  const first = !sitePages(dir).length;
  const fresh = first && !existsSync(join(dir, SITE_HEAD));
  const ws = pageWorkspace(dir, name);
  const shared = hasTheme(siteHead(dir)) || fresh;
  createPage(ws, layout, themeName, { ownTheme: !shared });
  if (fresh) startSiteTheme(dir, themeName);
  // a site's first page is its home: the site's address opens it
  if (first && !readSite(dir).home) setHome(dir, name);
  if (opts.shared !== false) linkSharedBoxes(dir, ws, layout);
  return ws;
}

/**
 * Link a new page's boxes to the site's shared blocks: a box named like one (its navigation, its footer) shows
 * it, and a box its layout declares shared (layouts.json `shared`) becomes one when the site has none yet, so a
 * site's first page starts its navigation and footer. The box keeps no copy of the code (the block is the code).
 * Written as the page's starting point: a new page starts with nothing to undo. Returns the blocks linked.
 */
function linkSharedBoxes(dir: string, ws: Workspace, layout: string): string[] {
  const declared = new Set(pageLayouts().find((p) => p.name === layout)?.shared ?? []);
  const blocks = new Set(kitList(dir).blocks);
  const start = ws.load();
  let l = start;
  const linked: string[] = [];
  walk(start.root, (n) => {
    if (n.type !== 'leaf' || n.use || !(blocks.has(n.id) || declared.has(n.id))) return;
    if (!blocks.has(n.id)) startBlock(dir, ws, n.id);
    l = M.setLeaf(l, n.id, { use: n.id });
    ws.store.remove(`boxes/${n.id}.html`);
    ws.store.remove(`boxes/${n.id}.css`);
    linked.push(n.id);
  });
  if (l !== start) ws.store.write('layout.slice', serializeSlice(l));
  return linked;
}

/** A name for a new page of the site: `wish` when it's free, else `wish-2`, `wish-3`… */
export function freePageName(dir: string, wish: string): string {
  const base = wish.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56) || 'page';
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${base}-${i}`;
    if (!pageNameError(dir, name)) return name;
  }
}

/**
 * Add a page to a site with an explicit theme (the CLI's `new` on a site): as `newSitePage`, but in a
 * site that shares one theme, a preset asked for by name becomes this page's own values over the shared
 * theme (only those that differ), so the page looks as asked and the other pages don't change.
 * `ownValues` says whether that happened.
 */
export function addSitePage(dir: string, name: string, layout: string, themeName?: string): { ws: Workspace; ownValues: boolean } {
  const ws = newSitePage(dir, name, layout, themeName ?? DEFAULT_THEME);
  const wanted = themeName ? themes().find((t) => t.name === themeName) : undefined;
  if (!wanted || hasTheme(ws.head())) return { ws, ownValues: false };
  const shared = readTheme(siteHead(dir));
  const differ = Object.fromEntries(Object.entries(wanted.values).filter(([k, v]) => k in shared && shared[k].trim() !== String(v).trim()));
  if (!Object.keys(differ).length) return { ws, ownValues: false };
  ws.store.write('head.html', withFonts(ws, withOverrides(ws.head(), differ)));
  return { ws, ownValues: true };
}

const escHTML = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * The list of the site's pages, as a page of its own (/pages/ and pages/index.html in an export): each
 * page's title linked, the home page first. It takes the site's shared head, so it follows the theme.
 * `footer` is a link under the list (the editor's sign-in or its manager; none in an export). `heading`
 * replaces "Pages" (an export's 404.html says the page isn't there).
 */
export function siteIndex(dir: string, footer?: { href: string; text: string }, heading = 'Pages'): string {
  const s = readSite(dir);
  const pages = sitePages(dir).sort((a, b) => Number(b === s.home) - Number(a === s.home));
  const items = pages.map((p) => `<li><a href="/${p}/"><span class="title">${escHTML(pageTitle(dir, p, s))}</span>` +
    `<span class="route">/${p}/${p === s.home ? ' <b>home</b>' : ''}</span></a></li>`).join('\n    ');
  return `<!doctype html>
<html lang="${s.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHTML(heading)}</title>
${iconLink(dir)}${siteHead(dir)}
<style>
  body { margin: 0; background: var(--color-bg, #fff); color: var(--color-text, #111); font-family: var(--font-body, system-ui, sans-serif); line-height: 1.5; }
  main { max-width: min(var(--max-width, 760px), 760px); margin: 0 auto; padding: 56px 20px; }
  h1 { font-family: var(--font-heading, inherit); font-size: var(--text-title, 2rem); margin: 0 0 24px; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  li a { display: grid; gap: 2px; padding: 10px 0; border-bottom: 1px solid var(--color-border, #ddd); color: var(--color-accent, #0A5475); text-decoration: none; }
  .title { font-size: 1.15rem; }
  .route { font-size: .85rem; color: var(--color-muted, #666); font-family: var(--font-mono, ui-monospace, monospace); }
  .route b { font-family: var(--font-body, system-ui, sans-serif); font-weight: 600; font-size: .75rem; text-transform: uppercase; letter-spacing: .06em; margin-left: 6px; }
  li a:hover .title, li a:focus-visible .title { text-decoration: underline; }
  footer { display: flex; align-items: center; gap: 8px; margin-top: 32px; font-size: .9rem; color: var(--color-muted, #666); }
  footer svg { width: 16px; height: 16px; fill: #0A5475; }
  footer svg .focus { fill: #EA9A27; }
  footer a { color: inherit; }
</style>
</head>
<body>
<main>
  <h1>${escHTML(heading)}</h1>
  <ul>
    ${items}
  </ul>${footer ? `\n  <footer>${MARK}<span>TYKERF ·</span><a href="${escHTML(footer.href)}" rel="nofollow">${escHTML(footer.text)}</a></footer>` : ''}
</main>
</body>
</html>
`;
}

/** Where TYKERF lives: the generated pages and the published pages' credit link there. */
export const TYKERF_REPO = 'https://github.com/eonity-org/tykerf';

/**
 * "Made with TYKERF" at the bottom of a published page: the mark and a link to TYKERF's repository. Its
 * styles are inline, in the theme's variables (with plain fallbacks), so no rule of the page reaches it.
 */
export const CREDIT = `<footer class="tykerf-credit" style="display:flex;justify-content:center;padding:14px 16px;background:var(--color-bg,transparent);font:12px/1.4 var(--font-body,system-ui,sans-serif)">` +
  `<a href="${TYKERF_REPO}" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;color:var(--color-muted,#666);text-decoration:none">` +
  `<svg viewBox="0 0 64 64" width="14" height="14" aria-hidden="true" fill="#0A5475"><rect width="64" height="20" rx="6"/><rect y="27" width="28.5" height="37" rx="6"/><rect fill="#EA9A27" x="35.5" y="27" width="28.5" height="12" rx="3"/><rect x="35.5" y="45" width="11.25" height="19" rx="3"/><rect x="52.75" y="45" width="11.25" height="19" rx="3"/></svg>` +
  `<span>Made with TYKERF</span></a></footer>`;

/** A page with the credit at the end of its body. */
export const withCredit = (html: string) => {
  const end = html.toLowerCase().lastIndexOf('</body>');
  return end < 0 ? html + CREDIT : html.slice(0, end) + CREDIT + html.slice(end);
};

/** The TYKERF mark (small drawing), for the footer of the generated page list. */
const MARK = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="20" rx="6"/><rect y="27" width="28.5" height="37" rx="6"/><rect class="focus" x="35.5" y="27" width="28.5" height="12" rx="3"/><rect x="35.5" y="45" width="11.25" height="19" rx="3"/><rect x="52.75" y="45" width="11.25" height="19" rx="3"/></svg>';

/** sitemap.xml for search engines: every page at the site's public address (base, without a trailing /). */
export function siteMap(dir: string, base: string): string {
  const root = base.replace(/\/+$/, '');
  const s = readSite(dir);
  const urls = [...(s.home ? [`${root}/`] : []), ...sitePages(dir).map((p) => `${root}/${p}/`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${escHTML(u)}</loc></url>`).join('\n')}\n</urlset>\n`;
}

// ---------- a new page like an existing one ----------

const marks = (n: Node) => [n.id, n.type === 'leaf' ? n.role ?? '' : '', ...(isOp(n) ? n.tags : n.type === 'leaf' ? n.tags : [])].join(' ').toLowerCase();

/**
 * A new page that keeps another page's header and footer (the first and last blocks of its top
 * column, when they are a header or navigation and a footer) and its head, with one text section in
 * between. A page without that shape is copied whole. Box code, box types and the images they use
 * come along; the history and the AI conversations don't.
 */
export function newPageLike(dir: string, name: string, from: string): Workspace {
  const err = pageNameError(dir, name);
  if (err) throw new Error(err);
  if (!sitePages(dir).includes(from)) throw new Error(`there is no page "${from}" in the site`);
  const src = pageWorkspace(dir, from);
  let l: Layout = src.load();
  const root = l.root;
  const extra: Record<string, string> = {};
  if (isOp(root) && root.kind === 'H' && root.children.length >= 2) {
    const top = root.children[0], bottom = root.children.at(-1)!;
    if (/header|nav/.test(marks(top)) && /footer/.test(marks(bottom))) {
      for (const c of root.children.slice(1, -1)) l = M.remove(l, c.id);
      const main = ['main', 'content', 'section'].find((n) => !find(l.root, n)) ?? `main-${Date.now()}`;
      l = M.insertNext(l, top.id, 'H', main);
      l = M.setLeaf(l, main, { role: 'main' });
      extra[main] = componentCode('text');
    }
  }
  const ws = pageWorkspace(dir, name);
  // the page's own files the copy uses, not those the site has (the same bytes): those it takes from the site
  const { code } = copyPageFiles(src, ws, { ...ownCode(src, l), ...extra, [HEAD_KEY]: src.head() }, dir);
  const { [HEAD_KEY]: head, ...boxes } = code;
  ws.create(l, boxes);
  if (head) ws.store.write('head.html', head);
  for (const f of src.store.list('types')) ws.store.write(`types/${f}`, src.store.readBytes(`types/${f}`)!);
  return ws;
}

/** The head's place among the code copyPageFiles goes through (no box can have this name). */
const HEAD_KEY = ' head';

/**
 * The code a copy of a page takes for each box and overlay of a layout: the box's own. A box that shows a
 * shared block keeps showing it (its use= comes along with the layout), so it takes only its own file, if it
 * has one, never the block's code: a copy of that would be the block as it was, which unlinking would bring back.
 */
function ownCode(src: Workspace, l: Layout): Record<string, string> {
  const out: Record<string, string> = {};
  const ids = new Set<string>(l.overlays.map((o) => o.id));
  walk(l.root, (n) => n.type === 'leaf' && ids.add(n.id));
  for (const id of ids) {
    const html = src.ownContent(id);
    if (html !== null) out[id] = html;
  }
  return out;
}

/**
 * Give a page the blocks of another page of its site: its tree and rules, its box code, its box types and
 * the images that code uses, in one undo step. The top block keeps its name (the block the user, and
 * Kaity's scope, know the page by). The page keeps its own head unless `theme`: then the other page's
 * head (its theme and fonts) comes too.
 */
export function usePage(ws: Workspace, dir: string, from: string, opts: { theme?: boolean; author?: string } = {}): { copied: string[]; site: string[] } {
  const author = opts.author ?? 'user';
  const pages = sitePages(dir);
  if (!pages.includes(from)) throw new Error(`there is no page "${from}" in the site (pages: ${pages.join(', ') || 'none'})`);
  if (ws.store instanceof FolderStore && ws.dir === join(dir, from)) throw new Error(`this is the page "${from}" itself`);
  const src = pageWorkspace(dir, from);
  const next = src.load();
  // the page's own files it uses are copied, but not those the site has (the same bytes): it takes the site's
  const files = copyPageFiles(src, ws, { ...ownCode(src, next), ...(opts.theme ? { [HEAD_KEY]: src.head() } : {}) }, dir);
  const { [HEAD_KEY]: head, ...code } = files.code;
  ws.group(`use page ${from}`, author, () => {
    // types first, so the blocks that use them are checked against them
    for (const f of src.store.list('types')) if (!ws.store.exists(`types/${f}`)) ws.store.write(`types/${f}`, src.store.readBytes(`types/${f}`)!);
    for (const id of ws.boxIds()) if (!(id in code)) ws.setContent(id, null, author);
    const top = ws.load().root.id;
    if (isOp(next.root) && top !== next.root.id && !find(next.root, top)) Object.assign(next.root, { id: top, named: true });
    ws.save(next, `use page ${from}`, author);
    // the box's own code: on a box that shows a shared block, the block stays the site's
    for (const [id, html] of Object.entries(code)) ws.setContent(id, html, author, { own: true });
    if (opts.theme) ws.setHead(head ?? '', author);
  });
  return { copied: files.copied, site: files.site };
}

// ---------- links between pages, renames and removals ----------
// A link from one page of the site to another is written root-absolute: href="/about/" (optionally
// with #anchor or ?query). The editor serves the site at "/", so it works as written, and the
// exporter (export.ts) makes it relative. Renaming a page rewrites those links in every page.

const HREF = /(\bhref\s*=\s*)(["'])(.*?)\2/gi;

/** The page an address points at, when it is a link between pages (/<page>, /<page>/…, /<page>#…). */
export function linkedPage(href: string): string | null {
  const m = /^\/([a-z0-9][a-z0-9-]*)(?=$|[/#?])/.exec(href.trim());
  return m ? m[1] : null;
}

/** Every href in some HTML, with a function that gives the HTML with one target replaced. */
function rewriteHrefs(html: string, fn: (href: string) => string): string {
  return html.replace(HREF, (all, pre, q, href) => {
    const next = fn(href);
    return next === href ? all : `${pre}${q}${next}${q}`;
  });
}

/**
 * Rewrite links to page `from` so they point at `to`, in every box and head of the site, and in its shared
 * blocks (once each, a step of the site's history). Returns how many changed.
 */
export function rewriteLinks(dir: string, from: string, to: string): number {
  let n = 0;
  const swap = (href: string) => {
    if (linkedPage(href) !== from) return href;
    n++;
    return `/${to}${href.trim().slice(from.length + 1)}`;
  };
  for (const block of kitList(dir).blocks) {
    const html = kitRead(dir, 'blocks', block);
    const next = html === null ? html : rewriteHrefs(html, swap);
    if (next !== null && next !== html) kitWrite(dir, 'blocks', block, next, `links follow page ${from} → ${to} in the shared block ${block}`);
  }
  // each page's own code (a box that shows a shared block keeps its own file for when it's unlinked: it follows too)
  for (const page of sitePages(dir)) {
    const ws = new Workspace(join(dir, page));
    ws.transaction(() => ws.group(`links follow page ${from} → ${to}`, 'user', () => {
      for (const id of ws.boxIds()) {
        const html = ws.content(id);
        if (html === null) continue;
        const next = rewriteHrefs(html, swap);
        if (next !== html) ws.setContent(id, next, 'user');
      }
      const head = ws.head();
      const next = rewriteHrefs(head, swap);
      if (next !== head) ws.setHead(next, 'user', `links follow page ${from} → ${to}`);
    }));
  }
  return n;
}

export interface PageLink {
  page: string; // the page the link is on
  box: string | null; // its box, or null for the page head
  href: string;
  to: string; // the page it points at
  broken: boolean;
}

/** Every link between pages of the site, marked broken when it points at no page. */
export function pageLinks(dir: string): PageLink[] {
  const pages = sitePages(dir);
  const out: PageLink[] = [];
  const scan = (page: string, box: string | null, html: string) => {
    for (const m of html.matchAll(HREF)) {
      const to = linkedPage(m[3]);
      if (to && !RESERVED.has(to)) out.push({ page, box, href: m[3], to, broken: !pages.includes(to) });
    }
  };
  for (const page of pages) {
    // as visitors see the page: a box that shows a shared block has the block's links
    const ws = pageWorkspace(dir, page);
    const l = ws.load();
    const ids = new Set(ws.boxIds());
    walk(l.root, (n) => { if (n.type === 'leaf' && n.use) ids.add(n.id); });
    for (const id of ids) scan(page, id, ws.content(id) ?? '');
    scan(page, null, ws.head());
  }
  return out;
}

/** Rename a page: its folder (with its history, AI conversations and images) and every link to it. */
/** Where pages went: one line per rename or removal, so an editor whose pages another process moved (Kaity's
 *  site run, through MCP) sends their open tabs after them. */
const MOVES = '.tykerf/moves.jsonl';
export interface PageMove { from: string; to: string | null; at: string }

function logMove(dir: string, from: string, to: string | null) {
  new FolderStore(dir).append(MOVES, `${JSON.stringify({ from, to, at: new Date().toISOString() })}\n`);
}

/** Every page move the site recorded, oldest first. */
export function pageMoves(dir: string): PageMove[] {
  const raw = new FolderStore(dir).read(MOVES) ?? '';
  return raw.split('\n').flatMap((l) => { try { return l ? [JSON.parse(l) as PageMove] : []; } catch { return []; } });
}

/** site.json as written, with a page's name changed in its home and titles (text that isn't JSON stays as it is). */
function renamedInSettings(text: string, from: string, to: string): string {
  try {
    const s = JSON.parse(text) as { home?: string; titles?: Record<string, string> };
    if (s.home !== from && !(s.titles && from in s.titles)) return text;
    if (s.home === from) s.home = to;
    if (s.titles && from in s.titles) s.titles = Object.fromEntries(Object.entries(s.titles).map(([k, v]) => [k === from ? to : k, v]));
    return `${JSON.stringify(s, null, 2)}\n`;
  } catch {
    return text;
  }
}

export function renamePage(dir: string, from: string, to: string): { links: number } {
  if (!sitePages(dir).includes(from)) throw new Error(`there is no page "${from}" in the site`);
  if (from === to) return { links: 0 };
  const err = pageNameError(dir, to);
  if (err) throw new Error(err);
  // the site's settings follow the new name (read first: once the folder moves, the old name is gone from them)
  const s = readSite(dir);
  renameSync(join(dir, from), join(dir, to));
  if (s.home === from || from in s.titles) {
    if (s.home === from) s.home = to;
    if (from in s.titles) (s.titles[to] = s.titles[from]), delete s.titles[from];
    writeSite(dir, s, null); // follows the rename, which has no undo
  }
  // undo and redo of earlier settings steps name the page as it is now
  new SiteHistory(dir).rewrite('settings', (text) => renamedInSettings(text, from, to));
  logMove(dir, from, to);
  return { links: rewriteLinks(dir, from, to) };
}

/**
 * Duplicate a page: its blocks, box code, head, box types and images, under a new name (`<name>-copy` when
 * none is given). Its history and Kaity's conversations stay with the original. A title of its own gets "(copy)".
 */
export function duplicatePage(dir: string, from: string, to?: string): string {
  if (!sitePages(dir).includes(from)) throw new Error(`there is no page "${from}" in the site`);
  let name = to?.trim() || `${from}-copy`.slice(0, 60);
  if (!to?.trim()) for (let i = 2; existsSync(join(dir, name)); i++) name = `${from}-copy-${i}`;
  const err = pageNameError(dir, name);
  if (err) throw new Error(err);
  const LEFT = new Set(['.history.jsonl', '.tykerf', 'out', '.DS_Store', '.scope']);
  cpSync(join(dir, from), join(dir, name), { recursive: true, filter: (src) => !LEFT.has(basename(src)) });
  // the copy's files the site already has (the same bytes) are the site's: its code points there, and they go
  const copy = new Workspace(join(dir, name));
  const site = siteFilesByHash(dir);
  const theirs = new Map<string, string>();
  for (const f of copy.assets()) {
    const h = fileHash(copy.store, `assets/${f}`);
    if (h && site.has(h)) theirs.set(f, `/assets/${site.get(h)}`);
  }
  if (theirs.size) {
    for (const id of copy.boxIds()) {
      const own = copy.ownContent(id);
      const next = own === null ? own : mapPageFiles(own, (f) => theirs.get(f) ?? null);
      if (next !== own) copy.setContent(id, next, 'user', { own: true });
    }
    if (copy.head()) copy.setHead(mapPageFiles(copy.head(), (f) => theirs.get(f) ?? null), 'user');
    for (const f of theirs.keys()) copy.store.remove(`assets/${f}`);
    copy.store.remove('.history.jsonl'); // a copy starts with nothing to undo
  }
  const s = readSite(dir);
  if (from in s.titles) {
    s.titles[name] = `${s.titles[from]} (copy)`;
    writeSite(dir, s, { label: `title of ${name}: ${s.titles[name]}` });
  }
  return name;
}

/** A removed page in the site's .trash: its folder, the page's name and when it was removed. */
export interface TrashedPage {
  folder: string;
  page: string;
  removed: string | null; // ISO time, from the folder's name
}

/** The pages in the site's .trash (removePage), the latest removed first. */
export function trashedPages(dir: string): TrashedPage[] {
  const trash = join(dir, '.trash');
  if (!existsSync(trash)) return [];
  return readdirSync(trash).filter((f) => !f.startsWith('.') && statSync(join(trash, f)).isDirectory()).map((folder) => {
    const m = /^(.+)-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(folder);
    return { folder, page: m ? m[1] : folder, removed: m ? `${m[2]}T${m[3]}:${m[4]}:${m[5]}.${m[6]}Z` : null };
  }).sort((a, b) => (b.removed ?? '').localeCompare(a.removed ?? ''));
}

/** Delete the removed pages for good: the site's .trash folder goes. Returns how many pages were in it. */
export function emptyTrash(dir: string): number {
  const n = trashedPages(dir).length;
  rmSync(join(dir, '.trash'), { recursive: true, force: true });
  return n;
}

/** Remove a page from the site. Nothing is deleted: the folder goes to .trash/. Returns the links that now point nowhere. */
export function removePage(dir: string, name: string): { trash: string; broken: number } {
  if (!sitePages(dir).includes(name)) throw new Error(`there is no page "${name}" in the site`);
  const s = readSite(dir);
  if (s.home === name || name in s.titles) {
    if (s.home === name) delete s.home;
    delete s.titles[name];
    writeSite(dir, s, null); // follows the removal, which has no undo
  }
  const trash = join('.trash', `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(join(dir, '.trash'), { recursive: true });
  renameSync(join(dir, name), join(dir, trash));
  logMove(dir, name, null);
  return { trash, broken: pageLinks(dir).filter((l) => l.to === name).length };
}
