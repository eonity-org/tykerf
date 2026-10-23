// A site: a folder whose subfolders are pages (my-site/home, my-site/about), each a workspace of its
// own. The editor serves each page at its own address (/home/, /about/) and can add pages to the
// site. A folder that is a page itself (it has a layout.slice) is edited on its own, as before.
//
// This is the local shape of what Tydal will hold later: a site is a Vault, each page a resource.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { type Layout, type Node, find, isOp, walk } from './model.js';
import * as M from './moves.js';
import { FolderStore } from './store.js';
import { DEFAULT_THEME, componentCode, createPage, hasTheme, readTheme, theme, themes, withFonts, withPresetName, withThemeValues } from './library.js';
import { NO_SITE_HEAD, type SiteLink, Workspace } from './workspace.js';

/** Page names: they are folder names and the first part of the page's address in the editor. */
export const PAGE_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** Names the editor uses at the top of its addresses. */
const RESERVED = new Set(['_tykerf', 'assets', 'out', 'pages', 'sitemap.xml']);

const isPage = (dir: string) => existsSync(join(dir, 'layout.slice'));
const entries = (dir: string) => (existsSync(dir) ? readdirSync(dir) : []);

/**
 * What a folder is: a page (it has a layout.slice), a site (it is empty or new, or its subfolders
 * are pages), or neither: then it holds other files and TYKERF won't write into it.
 */
export function siteKind(dir: string): 'page' | 'site' {
  if (isPage(dir)) return 'page';
  const files = entries(dir).filter((f) => !f.startsWith('.'));
  if (!files.length || sitePages(dir).length) return 'site';
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
 * theme gets one more page with its own.
 */
export function newSitePage(dir: string, name: string, layout = 'blank', themeName = DEFAULT_THEME): Workspace {
  const err = pageNameError(dir, name);
  if (err) throw new Error(err);
  const fresh = !sitePages(dir).length && !existsSync(join(dir, SITE_HEAD));
  const ws = pageWorkspace(dir, name);
  const shared = hasTheme(siteHead(dir)) || fresh;
  createPage(ws, layout, themeName, { ownTheme: !shared });
  if (fresh) startSiteTheme(dir, themeName);
  return ws;
}

// ---------- the site's settings (site.json): its home page, its pages' titles, where it's published ----------
// Written on the first change, so a site without one needs nothing. Pages that are gone are left out
// on every read, so the file can never point at a page the site doesn't have.

const SITE_FILE = 'site.json';

export interface SiteSettings {
  version: 1;
  /** The page visitors get at the site's address. */
  home?: string;
  /** Titles set by hand; a page without one is titled by its first <h1>. */
  titles: Record<string, string>;
  /** Where Publish sends the site (src/publish.ts). The token is never here: it's TYKERF_GITHUB_TOKEN in .env. */
  publish?: PublishSettings;
}

/** A GitHub repository ("owner/name"), the branch and folder the site goes to, and its public address. */
export interface PublishSettings {
  repo: string;
  branch: string;
  /** '' = the branch's root; else a folder such as "docs". */
  folder: string;
  /** The published site's address (https://…): for its sitemap.xml and the link after publishing. */
  url?: string;
  /** false: no "Made with TYKERF" line at the bottom of the published pages (it's there by default). */
  credit?: boolean;
}

/** Why these publish settings can't be used, or null. */
export function publishSettingsError(p: Partial<PublishSettings>): string | null {
  if (typeof p.repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(p.repo)) return 'the repository is written owner/name, as in github.com/owner/name';
  if (typeof p.branch !== 'string' || !/^(?!\/|.*(?:\.\.|\/\/|\.lock$|\/$))[\w./-]+$/.test(p.branch)) return 'that is not a branch name';
  if (typeof p.folder !== 'string' || (p.folder && !/^(?!\.)[\w-]+(?:\/(?!\.)[\w-]+)*$/.test(p.folder))) return 'the folder is a path inside the repository, such as docs (empty: the top of the branch)';
  if (p.url !== undefined && p.url !== '' && !/^https?:\/\/[^\s/]+(\/\S*)?$/.test(String(p.url))) return "the site's address starts with https://";
  if (p.credit !== undefined && typeof p.credit !== 'boolean') return 'credit is true or false';
  return null;
}

export function readSite(dir: string): SiteSettings {
  let raw: Partial<SiteSettings> = {};
  try {
    raw = JSON.parse(readFileSync(join(dir, SITE_FILE), 'utf8'));
  } catch {}
  const pages = new Set(sitePages(dir));
  const titles = Object.fromEntries(Object.entries(raw.titles ?? {}).filter(([p, t]) => pages.has(p) && typeof t === 'string' && t.trim()));
  const publish = raw.publish && !publishSettingsError(raw.publish) ? raw.publish : undefined;
  return { version: 1, ...(raw.home && pages.has(raw.home) ? { home: raw.home } : {}), titles, ...(publish ? { publish } : {}) };
}

// written whole (FolderStore.write): a process reading it meanwhile never gets it half written, and so never
// saves its next change over settings it couldn't read
function writeSite(dir: string, s: SiteSettings) {
  new FolderStore(dir).write(SITE_FILE, `${JSON.stringify(s, null, 2)}\n`);
}

/** Make a page the site's home (null: no home page, the site's address shows the manager). */
export function setHome(dir: string, page: string | null) {
  if (page !== null && !sitePages(dir).includes(page)) throw new Error(`there is no page "${page}" in the site`);
  const s = readSite(dir);
  if (page === null) delete s.home;
  else s.home = page;
  writeSite(dir, s);
}

/** Give a page a title by hand ('' goes back to the title from its first <h1>). */
export function setTitle(dir: string, page: string, title: string) {
  if (!sitePages(dir).includes(page)) throw new Error(`there is no page "${page}" in the site`);
  const t = title.replace(/\s+/g, ' ').trim();
  if (t.length > 120) throw new Error('a title can be 120 characters at most');
  const s = readSite(dir);
  if (t) s.titles[page] = t;
  else delete s.titles[page];
  writeSite(dir, s);
}

/** Where Publish sends the site (null: nowhere yet). Throws on settings that can't be used. */
export function setPublish(dir: string, p: PublishSettings | null) {
  const s = readSite(dir);
  if (p === null) delete s.publish;
  else {
    const clean = (x: unknown) => String(x ?? '').trim();
    const url = clean(p.url).replace(/\/+$/, '');
    const next: PublishSettings = { repo: clean(p.repo), branch: clean(p.branch), folder: clean(p.folder).replace(/^\/+|\/+$/g, ''), ...(url ? { url } : {}), ...(p.credit === false ? { credit: false } : {}) };
    const e = publishSettingsError(next);
    if (e) throw new Error(e);
    s.publish = next;
  }
  writeSite(dir, s);
}

/** A page's title: set by hand, else the text of its first <h1>, else its name. */
export function pageTitle(dir: string, page: string, settings = readSite(dir)): string {
  if (settings.titles[page]) return settings.titles[page];
  const ws = new Workspace(join(dir, page));
  const order: string[] = [];
  walk(ws.load().root, (n) => n.type === 'leaf' && order.push(n.id));
  for (const id of order) {
    const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(ws.content(id) ?? '')?.[1];
    const text = h1?.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    if (text) return text.length > 120 ? `${text.slice(0, 117)}…` : text;
  }
  return page;
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
<html lang="en">
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

// ---------- the site's icon (favicon) ----------
// A site's icon is its own file at the site's root (favicon.svg, .png or .ico: uploaded in the site manager),
// or else one made from it: the home page's first letter on the theme's accent colour. It's served and
// exported at /favicon.<ext>, and every page links to it. TYKERF's own screens use TYKERF's mark instead.

const ICON_TYPES: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon' };
const OWN_ICONS = Object.keys(ICON_TYPES).map((ext) => `favicon.${ext}`);

/** Why an SVG can't be used as it is (scripts, event attributes, files from elsewhere), or null. */
export function unsafeSVG(code: string): string | null {
  if (!/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg\b[\s\S]*<\/svg>\s*$/i.test(code.trim())) return 'it is not SVG code, from <svg> to </svg>';
  if (/<script\b|<foreignObject\b|\son\w+\s*=|javascript:|\b(?:href|src)\s*=\s*["']\s*(?:[a-z]+:)?\/\//i.test(code))
    return 'it has scripts, event attributes, foreignObject or links to other files';
  return null;
}

/** A plain colour an SVG can use (the theme's may be var() or color-mix()), else the fallback. */
const plainColor = (v: string | undefined, fallback: string) => (v && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i.test(v.trim()) ? v.trim() : fallback);

/** The icon made from the site: its home page's first letter (else its first page's) on the theme's accent. */
export function madeIcon(dir: string): string {
  const s = readSite(dir);
  const pages = sitePages(dir);
  const page = s.home ?? pages[0];
  const letter = ((page ?? basename(dir)).match(/[a-z0-9]/i)?.[0] ?? 'T').toUpperCase();
  // the theme: the site's shared one, else the home page's own
  const theme = { ...(page ? readTheme(new Workspace(join(dir, page)).head()) : {}), ...readTheme(siteHead(dir)) };
  const bg = plainColor(theme['--color-accent'], '#0A5475');
  const fg = plainColor(theme['--color-on-accent'], '#ffffff');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${bg}"/>` +
    `<text x="32" y="45" text-anchor="middle" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-size="38" font-weight="700" fill="${fg}">${letter}</text></svg>\n`;
}

/** The site's icon: its own file, or the one made from it. */
export function siteIcon(dir: string): { file: string; type: string; bytes: Uint8Array; own: boolean } {
  for (const file of OWN_ICONS) {
    const p = join(dir, file);
    if (existsSync(p)) return { file, type: ICON_TYPES[file.split('.').pop()!], bytes: readFileSync(p), own: true };
  }
  return { file: 'favicon.svg', type: ICON_TYPES.svg, bytes: new TextEncoder().encode(madeIcon(dir)), own: false };
}

/** The link every page of the site gets to its icon (root-absolute: an export makes it relative). */
export function iconLink(dir: string): string {
  const { file, type } = siteIcon(dir);
  return `<link rel="icon" href="/${file}" type="${type}">\n`;
}

/** Give the site an icon of its own (SVG, PNG or ICO, up to 512 KB), or go back to the made one (null). */
export function setSiteIcon(dir: string, icon: { type: string; bytes: Uint8Array } | null) {
  if (icon) {
    const ext = Object.keys(ICON_TYPES).find((e) => ICON_TYPES[e] === icon.type || (e === 'ico' && icon.type === 'image/vnd.microsoft.icon'));
    if (!ext) throw new Error('the icon must be SVG, PNG or ICO');
    if (icon.bytes.length > 512 * 1024) throw new Error('the icon is larger than 512 KB');
    const b = icon.bytes;
    if (ext === 'png' && !(b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)) throw new Error('this file is not a PNG');
    if (ext === 'ico' && !(b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0)) throw new Error('this file is not an ICO');
    if (ext === 'svg') {
      const why = unsafeSVG(new TextDecoder().decode(b));
      if (why) throw new Error(`this SVG can't be the site's icon: ${why}`);
    }
    for (const f of OWN_ICONS) rmSync(join(dir, f), { force: true });
    writeFileSync(join(dir, `favicon.${ext}`), b);
  } else for (const f of OWN_ICONS) rmSync(join(dir, f), { force: true });
}

// ---------- the site's shared head: one theme for every page ----------
// <site>/head.html comes before each page's own head.html, so a page can still add or override
// styles. Its fonts live in the site's assets/, which the editor and an export serve at /assets/.
// Changes keep their previous version in .tykerf/site-head.jsonl, for Undo in the editor.

const SITE_HEAD = 'head.html';
const SITE_HISTORY = '.tykerf/site-head.jsonl';
const siteStore = (dir: string) => new FolderStore(dir);

/** The head every page of the site shares ('' when the site has none). */
export function siteHead(dir: string): string {
  return siteStore(dir).read(SITE_HEAD) ?? '';
}

/** What a page of this site needs to render with the site's shared head. */
export const siteLink = (dir: string): SiteLink => ({ head: () => siteHead(dir), pages: () => sitePages(dir).length, pageNames: () => sitePages(dir), files: () => (existsSync(join(dir, 'assets')) ? readdirSync(join(dir, 'assets')) : []), asset: (f) => siteStore(dir).readBytes(`assets/${f}`), icon: () => iconLink(dir), setHead: (html, label) => setSiteHead(dir, html, label) });

/** A page of the site, with the site's shared head. */
export const pageWorkspace = (dir: string, name: string) => new Workspace(join(dir, name), { site: siteLink(dir) });

/** The site a page folder belongs to (its parent folder, when that is a site and lists it), or null. */
export function siteOf(pageDir: string): SiteLink | null {
  const parent = dirname(pageDir);
  try {
    return sitePages(parent).includes(basename(pageDir)) ? siteLink(parent) : null;
  } catch {
    return null;
  }
}

/** Replace the site's shared head (its fonts come along). The previous version is kept for undoSiteHead. */
export function setSiteHead(dir: string, html: string, label = 'edit the site theme') {
  const store = siteStore(dir);
  store.lock(() => {
    const prev = store.read(SITE_HEAD);
    const next = withFonts(store, html, '/assets/');
    if (prev === next) return;
    store.append(SITE_HISTORY, JSON.stringify({ label, at: new Date().toISOString(), prev }) + '\n');
    store.write(SITE_HEAD, next);
  });
}

/** The last change to the site's head, or null. */
export function lastSiteHeadChange(dir: string): { label: string; at: string } | null {
  const lines = (siteStore(dir).read(SITE_HISTORY) ?? '').split('\n').filter(Boolean);
  if (!lines.length) return null;
  const { label, at } = JSON.parse(lines.at(-1)!);
  return { label, at };
}

// The site head's own code: what the person writes for every page (styles, scripts, meta tags), apart from
// the theme and fonts blocks TYKERF keeps (they change in the Page tab, through the theme).
const KEPT = /(?:<!-- TYKERF theme:[\s\S]*?-->|<style\b[^>]*\bdata-tykerf-(?:theme|fonts)\b[^>]*>[\s\S]*?<\/style>)\s*/gi;

/** The site head without its theme and fonts blocks. */
export function siteCode(dir: string): string {
  return siteHead(dir).replace(KEPT, '').trim();
}

/** Replace the site head's own code, keeping its theme and fonts blocks; one step of the site head's undo. */
export function setSiteCode(dir: string, code: string) {
  if (new RegExp(KEPT.source, 'i').test(code)) throw new Error('the theme and its fonts are changed in the Page tab, not here; leave them out of this code');
  const kept = (siteHead(dir).match(KEPT) ?? []).map((b) => b.trim()).join('\n');
  setSiteHead(dir, [kept, code.trim()].filter(Boolean).join('\n') + '\n', 'edit the styles and scripts of every page');
}

/** Undo the last change to the site's head. Returns its label. */
export function undoSiteHead(dir: string): string {
  const store = siteStore(dir);
  return store.lock(() => {
    const lines = (store.read(SITE_HISTORY) ?? '').split('\n').filter(Boolean);
    if (!lines.length) throw new Error('there is no change to the site theme to undo');
    const last = JSON.parse(lines.pop()!);
    if (last.prev === null) store.remove(SITE_HEAD);
    else store.write(SITE_HEAD, last.prev);
    if (lines.length) store.write(SITE_HISTORY, lines.join('\n') + '\n');
    else store.remove(SITE_HISTORY);
    return last.label as string;
  });
}

/** A new site's theme: the full theme with a preset's values, shared by every page. */
function startSiteTheme(dir: string, themeName: string) {
  const p = themes().find((t) => t.name === themeName) ?? themes()[0];
  setSiteHead(dir, withPresetName(withThemeValues(theme(), p.values).head, p.name), `site theme ${p.name}`);
}

const THEME_PARTS = /<!-- TYKERF theme[^>]*-->\n?|<style[^>]*\bdata-tykerf-(?:theme|fonts)\b[^>]*>[\s\S]*?<\/style>\n?/g;

/**
 * Make one page's theme the theme of every page: it becomes the site's shared head, and the pages'
 * own theme blocks are removed (each one undo step in that page). Pages that keep their own look
 * (imported copies) are left alone. Returns the pages that changed.
 */
export function shareTheme(dir: string, from: string): string[] {
  const src = pageWorkspace(dir, from);
  const blocks = src.head().match(THEME_PARTS)?.filter((b) => !b.includes('data-tykerf-fonts')) ?? [];
  if (!blocks.some((b) => b.includes('data-tykerf-theme'))) throw new Error(`the page "${from}" has no theme of its own to share`);
  setSiteHead(dir, blocks.join(''), `use the theme of ${from} for every page`);
  const changed: string[] = [];
  for (const page of sitePages(dir)) {
    const ws = pageWorkspace(dir, page);
    const head = ws.head();
    if (head.includes(NO_SITE_HEAD) || !hasTheme(head)) continue;
    ws.transaction(() => ws.setHead(head.replace(THEME_PARTS, ''), 'user', 'the theme is now the site\'s'));
    changed.push(page);
  }
  return changed;
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
  const boxes: Record<string, string> = { ...extra };
  const ids = new Set<string>(l.overlays.map((o) => o.id));
  walk(l.root, (n) => n.type === 'leaf' && ids.add(n.id));
  for (const id of ids) if (!(id in boxes)) {
    const html = src.content(id);
    if (html !== null) boxes[id] = html;
  }
  const ws = pageWorkspace(dir, name);
  ws.create(l, boxes);
  if (src.head()) ws.store.write('head.html', src.head());
  for (const f of src.store.list('types')) ws.store.write(`types/${f}`, src.store.readBytes(`types/${f}`)!);
  const used = Object.values(boxes).join('\n') + src.head();
  for (const f of src.assets()) if (used.includes(`assets/${f}`)) ws.store.write(`assets/${f}`, src.store.readBytes(`assets/${f}`)!);
  return ws;
}

/**
 * Give a page the blocks of another page of its site: its tree and rules, its box code, its box types and
 * the images that code uses, in one undo step. The top block keeps its name (the block the user, and
 * Kaity's scope, know the page by). The page keeps its own head unless `theme`: then the other page's
 * head (its theme and fonts) comes too.
 */
export function usePage(ws: Workspace, dir: string, from: string, opts: { theme?: boolean; author?: string } = {}) {
  const author = opts.author ?? 'user';
  const pages = sitePages(dir);
  if (!pages.includes(from)) throw new Error(`there is no page "${from}" in the site (pages: ${pages.join(', ') || 'none'})`);
  if (ws.store instanceof FolderStore && ws.dir === join(dir, from)) throw new Error(`this is the page "${from}" itself`);
  const src = pageWorkspace(dir, from);
  const next = src.load();
  const code = src.contents();
  ws.group(`use page ${from}`, author, () => {
    // types first, so the blocks that use them are checked against them
    for (const f of src.store.list('types')) if (!ws.store.exists(`types/${f}`)) ws.store.write(`types/${f}`, src.store.readBytes(`types/${f}`)!);
    for (const id of ws.boxIds()) if (!(id in code)) ws.setContent(id, null, author);
    const top = ws.load().root.id;
    if (isOp(next.root) && top !== next.root.id && !find(next.root, top)) Object.assign(next.root, { id: top, named: true });
    ws.save(next, `use page ${from}`, author);
    for (const [id, html] of Object.entries(code)) ws.setContent(id, html, author);
    if (opts.theme) ws.setHead(src.head(), author);
    const used = Object.values(code).join('\n') + (opts.theme ? src.head() : '');
    for (const f of src.assets()) if (used.includes(`assets/${f}`) && !ws.store.exists(`assets/${f}`)) ws.store.write(`assets/${f}`, src.store.readBytes(`assets/${f}`)!);
  });
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

/** Rewrite links to page `from` so they point at `to`, in every box and head of the site. Returns how many changed. */
export function rewriteLinks(dir: string, from: string, to: string): number {
  let n = 0;
  const swap = (href: string) => {
    if (linkedPage(href) !== from) return href;
    n++;
    return `/${to}${href.trim().slice(from.length + 1)}`;
  };
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
    const ws = new Workspace(join(dir, page));
    for (const id of ws.boxIds()) scan(page, id, ws.content(id) ?? '');
    scan(page, null, ws.head());
  }
  return out;
}

/** Rename a page: its folder (with its history, AI conversations and images) and every link to it. */
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
    writeSite(dir, s);
  }
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
  const s = readSite(dir);
  if (from in s.titles) {
    s.titles[name] = `${s.titles[from]} (copy)`;
    writeSite(dir, s);
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
    writeSite(dir, s);
  }
  const trash = join('.trash', `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(join(dir, '.trash'), { recursive: true });
  renameSync(join(dir, name), join(dir, trash));
  return { trash, broken: pageLinks(dir).filter((l) => l.to === name).length };
}
