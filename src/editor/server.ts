// TYKERF, the page editor in TYDAL ecosystem.
//
// The server serves each page exactly as it renders, plus one script. That script builds all of
// its UI inside a shadow root, so the site's CSS and the editor's CSS never touch each other. The
// browser never edits the tree; it asks for named, validated operations (author "user"). The tree,
// moves, box code and history are the core library (src/), shared with the MCP server, so people
// and the AI work on the same tree and the same history.
//
// A folder is either one page (it has a layout.slice), served at "/", or a site: a folder of pages
// (site.ts), each served at "/<page>/". A new or empty folder is a new site: "/" then shows the
// start screen, where the first page gets its layout and theme. page.ts serves each page.
//
//   npm start -- <folder> [--port 4400] [--host <addr>] [--layout <name> [--theme <name>]]

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, watch, writeFileSync } from 'node:fs';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { isIP } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME_PAGE, type PublishSettings, addSitePage, pageMoves, emptyTrash, lastSiteHeadChange, newPageLike, newSitePage, pageLinks, pageNameError, pageTitle, pageWorkspace, readSite, duplicatePage, removePage, renamePage, setHome, setPublish, setSiteIcon, siteIcon, setSiteCode, setSiteHead, setTitle, shareTheme, siteCode, siteHead, siteIndex, siteKind, siteLink, siteMap, siteOf, sitePages, trashedPages, undoSiteHead, blockUsers, identicalBoxes, shareIdentical } from '../site.js';
import { FolderStore, MemoryStore } from '../store.js';
import { KIT_LOADER, type KitKind, kitList, kitRead, kitWrite, lastKitChange, undoKit } from '../kit.js';
import { DEFAULT_THEME, EMPTY_LAYOUT, createPage, hasTheme, pageLayouts, libraryAsset, theme, themes } from '../library.js';
import { Workspace } from '../workspace.js';
import { AI, type Runner, SITE_CHAT } from './ai.js';
import { kaityRuns } from './kaity-log.js';
import { type DesignZip, designContext, designNote, readDesignZip } from './design-zip.js';
import { createAuth, loginPage } from './auth.js';
import { ASSET_TYPES } from '../assets.js';
import { type PageHost, body, createPageHost, json } from './page.js';
import { runnerFromEnv } from './runners/index.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * TYKERF's own server code, as it is on disk: its .ts files' count, sizes and latest change. The browser
 * part (public/) is read fresh on every request, but this process keeps the code it started with, so a
 * change to it needs a restart: /_tykerf/version tells the editor, which says so.
 */
function codeStamp(): string {
  let n = 0, bytes = 0, latest = 0;
  const walk = (d: string) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      if (f.isDirectory()) f.name !== 'public' && walk(join(d, f.name));
      else if (f.name.endsWith('.ts')) {
        const st = statSync(join(d, f.name));
        n++, (bytes += st.size), (latest = Math.max(latest, st.mtimeMs));
      }
    }
  };
  try {
    walk(process.env.TYKERF_CODE_DIR ?? dirname(here)); // tests point it at a folder of their own
  } catch {
    return 'unknown';
  }
  return `${n}:${bytes}:${Math.round(latest)}`;
}
const STARTED_CODE = codeStamp();
/**
 * TYKERF's browser part as it is on disk now (public/: its files' count, sizes and latest change). A page keeps
 * the script it loaded, so when this changes (an update, then a restart) the page says to reload (tykerf.js).
 */
function pageStamp(): string {
  let n = 0, bytes = 0, latest = 0;
  const walk = (d: string) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      if (f.isDirectory()) walk(join(d, f.name));
      else if (/\.(js|css|html|json)$/.test(f.name)) {
        const st = statSync(join(d, f.name));
        n++, (bytes += st.size), (latest = Math.max(latest, st.mtimeMs));
      }
    }
  };
  try {
    walk(process.env.TYKERF_PAGE_DIR ?? join(here, 'public')); // tests point it at a folder of their own
  } catch {
    return 'unknown';
  }
  return `${n}:${bytes}:${Math.round(latest)}`;
}
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? String(args[i + 1]) : undefined;
};
const given = resolve(args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? '.');
// TYKERF edits sites: started on a page of a site, it opens the site
const dir = siteOf(given) ? dirname(given) : given;
const PORT = Number(flag('--port') ?? 4400);
// the API edits the pages and runs Claude Code on the user's account, so by default only this machine can reach it
const HOST = flag('--host') ?? '127.0.0.1';
const layout = flag('--layout');

// settings and keys for the AI (TYKERF_RUNNER, TYKERF_MODEL, API keys: see .env.example), from .env in
// the folder TYKERF was started from, then the page or site folder; never sent to the browser
// (TYKERF_DOTENV=off skips them: the tests set it, so a developer's own .env doesn't change what they check)
if (process.env.TYKERF_DOTENV !== 'off') for (const env of new Set([resolve('.env'), join(dir, '.env')])) if (existsSync(env)) process.loadEnvFile(env);
let runner: Runner;
try {
  runner = runnerFromEnv();
  void runner.warm?.(); // find out early, in the background, whether it can run
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
const themeName = flag('--theme');
/** With --layout, the name of the page it makes: a new site's first page (`home` without it), or one more page of a site. */
const pageName = flag('--name');

// ---------- the site: a folder of pages (a new or empty folder is a new site) ----------

try {
  // a page folder on its own (siteKind throws for a folder of other things)
  if (siteKind(dir) === 'page') throw new Error(`${dir} is a page on its own; TYKERF edits sites, folders of pages. Put the page in a site and start TYKERF there:\n  mkdir my-site && mv ${dir} my-site/${HOME_PAGE}\n  npm start -- my-site`);
  if (dir !== given) console.log(`${given} is a page of the site ${dir}: opening the site (the page is at /${basename(given)}/)`);
  if (layout && sitePages(dir).length) {
    // --layout on a site adds the page --name names, once: the same command run again just starts
    const name = pageName?.trim();
    if (!name) throw new Error(`${dir} is a site of pages; to add one from the "${layout}" layout, name it with --name (or use "New page…" in the editor)`);
    if (sitePages(dir).includes(name)) console.log(`(${dir} already has a page "${name}"; --layout is only used for a new page)`);
    else {
      const err = pageNameError(dir, name);
      if (err) throw new Error(`${err} (--name)`);
      const { ownValues } = addSitePage(dir, name, layout, themeName);
      console.warn(`added the page "${name}" to the site ${dir} from the "${layout}" layout: http://localhost:${PORT}/${name}/`);
      if (ownValues) console.warn(`the site's pages share one theme: the "${themeName}" theme is "${name}"'s own values over it, so the other pages keep their look`);
    }
  } else if (layout) {
    // --layout on a new folder makes the site's home page, named `home` or --name
    const name = pageName?.trim() || HOME_PAGE;
    const err = pageNameError(dir, name);
    if (err) throw new Error(`${err} (--name)`);
    newSitePage(dir, name, layout, themeName ?? DEFAULT_THEME);
    console.log(`started a new site in ${dir} with its home page "${name}" from the "${layout}" layout${themeName ? ` with the "${themeName}" theme` : ''}`);
  } else if (pageName) console.log('(--name names the first page made with --layout; on the start screen, the page\'s name is its first step)');
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

/** The site manager's own address (public/start.html): the site's pages, its trash, and the ways to make a page. */
const MANAGER = '/_tykerf/site/';
/** The site's public address, for its sitemap.xml (TYKERF_PUBLIC_URL in .env). */
const PUBLIC_URL = process.env.TYKERF_PUBLIC_URL?.trim().replace(/\/+$/, '') || null;
/** With TYKERF_ADMIN_PASSWORD, visitors see the pages and only the signed-in admin edits (auth.ts). */
const auth = createAuth(process.env.TYKERF_ADMIN_PASSWORD, { secure: !!PUBLIC_URL?.startsWith('https:'), keep: { read: () => new FolderStore(dir).read('.tykerf/sessions.json'), write: (text) => new FolderStore(dir).write('.tykerf/sessions.json', text) } });
/**
 * What a page shows a visitor whose browser signed in here before (the login page leaves tykerf.admin in its
 * storage): Edit with TYKERF, to sign in and come back to this page. Other visitors see nothing of TYKERF.
 */
const EDIT_BUTTON = `<script>try{if(localStorage.getItem('tykerf.admin')==='true'){const a=document.createElement('a');a.href='/_tykerf/login?next='+encodeURIComponent(location.pathname+location.search);a.textContent='Edit with TYKERF';a.dataset.tykerfEdit='';a.setAttribute('style','position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:10px 16px;border-radius:999px;background:#0A5475;color:#fff;font:600 14px/1.2 system-ui,sans-serif;text-decoration:none;box-shadow:0 4px 16px rgb(0 0 0 / .2)');document.body.append(a)}}catch{}</script>`;

const hosts = new Map<string, PageHost>();

// Kaity for the whole site, in the site manager: one conversation kept in the site folder, her steps
// streamed to the manager; she lists, opens and makes the pages herself (MCP with the site as home)
const siteClients = new Set<ServerResponse>();
const siteAI = new AI(new Workspace(dir, { site: siteLink(dir) }), (event, data) => {
  for (const c of siteClients) c.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  if ((data as { role?: string }).role === 'end') followMoves(); // in case the folder watcher missed one
}, runner, { site: dir });
/** What Kaity is doing now: the whole site, and the block she works on in each page. */
const kaityNow = () => ({ site: !!siteAI.running(), pages: [...hosts].flatMap(([page, h]) => { const r = h.ai.running(); return r ? [{ page, block: r.id }] : []; }) });
/** A Kaity run on one page, if any: the site's run waits for it (and it for the site's). */
const pageRun = () => [...hosts].find(([, h]) => h.ai.running())?.[0] ?? null;

/** What the AI is told when it builds a new page from the user's words and pictures. */
const BUILD_BRIEF = [
  'This page was just made for this request: it holds only two empty boxes, header and main, on the theme\'s background. Build the whole page the request describes (and the attached pictures show).',
  'When the request asks for a page like another page of the site (its layout, its look), start with use_page from that page instead of a layout, and rewrite its text. Otherwise, first pick the page layout that fits the request best (list_layouts, then use_layout, which replaces the page with that layout\'s blocks); only when none fits, build the sections in header and main yourself (split, use_component). A layout is a start, not the goal: drop the sections the request doesn\'t need, add the ones it does.',
  'Plan the sections. Start with the navigation bar: its brand name and links for the sections you plan (#ids you then give those sections), so the page is the user\'s from the first moment. Link only to pages the site has; when the request names pages that don\'t exist yet, ask in your answer whether they will be made, instead of making up their addresses. Then add boxes for the sections (split, add_leaf), start each from a ready-made component (list_components, use_component) or write its code, and rename boxes after what they hold.',
  'Components come with placeholder text for a product site (Site name, Page one, Section one, Your headline, Product, Pricing, Get started...): replace all of it with the request\'s content as soon as you place each one (set_content or edit_content), and drop the parts the page doesn\'t need. Before you finish, run check_page and fix what it lists: no placeholder text, placeholder picture or link without a target may be left.',
  'Alternate the sections with the band tones: tag a section #tone-alt or #tone-soft, and the footer #tone-dark.',
  'When the pictures show a design, follow its layout, spacing and mood with the theme\'s variables.',
  'Look at the page at 1440 and 375 px before you finish, fix what looks wrong, then say in two or three sentences what you built.',
].join('\n');

/** Whether the site's pages share one theme (the site's head.html has it). */
const sharedTheme = () => hasTheme(siteHead(dir));
/** After a change every open page must show: the site's theme, or links rewritten in other pages. */
const refreshAll = () => {
  for (const h of hosts.values()) h.refresh();
};
// the site kit changes every page: a shared block edited on one page, Kaity's site run, a text editor;
// and pages move. A new site's folder is made with its first page, so it is watched from then on.
let kitTimer: NodeJS.Timeout | undefined;
let watching = false;
function watchSite() {
  if (watching || !existsSync(dir)) return;
  try {
    watch(dir, { recursive: true }, (_e, f) => {
      if (f && String(f).replace(/\\/g, '/') === '.tykerf/moves.jsonl') return followMoves();
      if (!f || String(f).split(/[\\/]/)[0] !== 'kit') return;
      clearTimeout(kitTimer);
      kitTimer = setTimeout(refreshAll, 120);
    });
    watching = true;
  } catch {}
}
watchSite();

// pages another process renamed or removed (Kaity's site run, through MCP): their open tabs follow them
let movesSeen = pageMoves(dir).length;
function followMoves() {
  const moves = pageMoves(dir);
  if (moves.length === movesSeen) return;
  for (const m of moves.slice(movesSeen)) {
    const h = hosts.get(m.from);
    hosts.delete(m.from);
    h?.close(m.to ? `/${m.to}/` : MANAGER);
  }
  movesSeen = moves.length;
  refreshAll(); // the other pages' lists of pages, and their links
}

/** The host of a page of the site (made on first use), or null when there is no such page. */
function hostOf(name: string): PageHost | null {
  if (!sitePages(dir).includes(name)) return null;
  watchSite();
  let h = hosts.get(name);
  if (!h) hosts.set(name, (h = createPageHost(pageWorkspace(dir, name), { name, runner, admin: auth.admin, visitorEnd: EDIT_BUTTON, title: () => pageTitle(dir, name), site: () => ({ pages: sitePages(dir), current: name, sharedTheme: sharedTheme() }) })));
  return h;
}

// ---------- the editor's own files ----------

const STATIC: Record<string, string> = {
  '/_tykerf/tykerf.js': 'text/javascript', '/_tykerf/inline.js': 'text/javascript', '/_tykerf/chooser.js': 'text/javascript', '/_tykerf/markdown.js': 'text/javascript',
  '/_tykerf/tykerf.css': 'text/css', '/_tykerf/chooser.css': 'text/css',
  '/_tykerf/favicon.svg': 'image/svg+xml', // TYKERF's mark: the tab icon of its own screens and of pages being edited
};

/** TYKERF's own scripts, styles, fonts and translations (also under a page's address, where its script asks for them). */
function serveStatic(req: IncomingMessage, res: ServerResponse, p: string): boolean {
  if (req.method !== 'GET') return false;
  if (p in STATIC) {
    res.writeHead(200, { 'content-type': STATIC[p], 'cache-control': 'no-store' });
    res.end(readFileSync(join(here, 'public', p.slice('/_tykerf/'.length))));
    return true;
  }
  // bundled IBM Plex (public/fonts, SIL OFL): served by TYKERF so editing a page never calls a font CDN
  const font = /^\/_tykerf\/fonts\/([A-Za-z0-9-]+\.woff2)$/.exec(p);
  if (font) {
    const f = join(here, 'public', 'fonts', font[1]);
    if (!existsSync(f)) res.writeHead(404).end('not found');
    else res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'max-age=31536000, immutable' }).end(readFileSync(f));
    return true;
  }
  // UI translations (public/i18n/<lang>.json, English text as the key); a language without a catalog gets {}
  const lang = /^\/_tykerf\/i18n\/([a-z]{2})\.json$/.exec(p);
  if (lang) {
    const f = join(here, 'public', 'i18n', `${lang[1]}.json`);
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(existsSync(f) ? readFileSync(f) : '{}');
    return true;
  }
  return false;
}

// ---------- layouts, themes and the site ----------

/** The answers that don't belong to one page: the chooser (layouts, themes), its previews and the site's pages. */
/** The last publish (in the site's .tykerf/), for the site manager: when, which commit, where. */
const PUBLISHED = '.tykerf/published.json';
let publishing = false;
const lastPublish = () => {
  try { return JSON.parse(readFileSync(join(dir, PUBLISHED), 'utf8')); } catch { return null; }
};
const writeData = (file: string, data: unknown) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), `${JSON.stringify(data, null, 2)}\n`);
};

/** What an export takes: the whole page or site, or with ?page=<name> one page of the site (null when there is no such page). */
function exportDir(url: URL): string | null {
  const page = url.searchParams.get('page');
  if (!page) return dir;
  return sitePages(dir).includes(page) ? join(dir, page) : null;
}

async function serveGlobal(req: IncomingMessage, res: ServerResponse, p: string, url: URL): Promise<boolean> {
  if (req.method === 'GET' && p === '/_tykerf/library') {
    json(res, 200, { layouts: pageLayouts().map(({ name, label, description }) => ({ name, label, description })), themes: themes(), theme: theme() });
    return true;
  }
  // a layout with a theme, rendered in memory: the chooser shows it in a sandboxed frame
  const pv = req.method === 'GET' ? /^\/_tykerf\/preview\/([a-z0-9-]+)\/([a-z0-9-]+)\/(.*)$/.exec(p) : null;
  if (pv) {
    const [, tpl, th, rest] = pv;
    if (rest === '') {
      // theme "site": the layout with the site's shared theme, as a new page of this site would look
      const shared = th === 'site' && sharedTheme();
      const ws = new Workspace(new MemoryStore('memory:preview'), { site: shared ? siteLink(dir) : null });
      createPage(ws, tpl, shared ? DEFAULT_THEME : th, { ownTheme: !shared });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "sandbox; script-src 'none'" });
      res.end(ws.page({ title: tpl }));
    } else {
      const file = /^assets\/(.+)$/.exec(rest)?.[1];
      const bytes = file ? libraryAsset(file) : null;
      if (!bytes) res.writeHead(404).end('not found');
      // the preview frame is sandboxed (an opaque origin), so its fonts are fetched cross-origin
      else res.writeHead(200, { 'content-type': ASSET_TYPES[file!.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox', ...(file!.endsWith('.woff2') ? { 'access-control-allow-origin': '*' } : {}) }).end(bytes);
    }
    return true;
  }
  if (req.method === 'GET' && p === '/_tykerf/site') {
    const pages = sitePages(dir), settings = readSite(dir);
    json(res, 200, { pages, sharedTheme: sharedTheme(), home: settings.home ?? null, titles: Object.fromEntries(pages.map((pg) => [pg, pageTitle(dir, pg, settings)])), ownTitles: settings.titles, signin: auth.on, kaity: kaityNow() });
    return true;
  }
  // a copy of a page, next to it
  if (req.method === 'POST' && p === '/_tykerf/site/duplicate') {
    const a = await body(req);
    const name = String(a.name ?? '');
    if (!sitePages(dir).includes(name)) return json(res, 422, { ok: false, error: `there is no page "${name}" in the site` }), true;
    // Kaity writes the page from another process: a copy taken meanwhile could hold half a change
    if (siteAI.running() || hosts.get(name)?.ai.running()) return json(res, 409, { ok: false, error: `Kaity is working on "${name}"; wait for her to finish before you duplicate it` }), true;
    try {
      const to = duplicatePage(dir, name, a.to ? String(a.to) : undefined);
      return json(res, 200, { ok: true, name: to, url: `/${to}/` }), true;
    } catch (e) {
      return json(res, 422, { ok: false, error: (e as Error).message }), true;
    }
  }
  // the site's settings: its home page, and a page's title set by hand
  if (req.method === 'POST' && (p === '/_tykerf/site/home' || p === '/_tykerf/site/title')) {
    const a = await body(req);
    if (p === '/_tykerf/site/home') setHome(dir, a.name ? String(a.name) : null);
    else setTitle(dir, String(a.name ?? ''), String(a.title ?? ''));
    for (const h of hosts.values()) h.refresh();
    return json(res, 200, { ok: true }), true;
  }
  if (req.method === 'POST' && p === '/_tykerf/site/new') {
    const a = await body(req);
    const name = String(a.name ?? '').trim();
    if (a.url) {
      // "A copy of a website": the page is made at once (empty) and opens with the copy's progress;
      // the copy runs in the background and then replaces it (see importer.ts)
      const err = pageNameError(dir, name);
      if (err) throw new Error(err);
      const { importPage, importURL, writeWorkspace } = await import('../importer.js');
      const from = importURL(String(a.url));
      newSitePage(dir, name, 'blank');
      const host = hostOf(name)!;
      const stop = new AbortController();
      host.job.start('copy', { site: new URL(from).host, stop: () => stop.abort() });
      refreshAll();
      (async () => {
        try {
          const r = await importPage(from, { structureOnly: !!a.structureOnly, onStep: (text, vars) => host.job.step(text, vars), signal: stop.signal });
          if (stop.signal.aborted) throw new Error('stopped');
          host.job.step('Writing the page');
          // the copy replaces the empty page: its tree, its boxes and its head
          const store = new FolderStore(join(dir, name));
          for (const f of store.list('boxes')) store.remove(`boxes/${f}`);
          for (const f of ['layout.slice', 'head.html', '.history.jsonl', '.redo.jsonl']) store.remove(f);
          writeWorkspace(join(dir, name), r, from);
          host.job.end('done');
        } catch (e) {
          if (!stop.signal.aborted) return host.job.end('failed', { error: (e as Error).message });
          // stopped: the unfinished page goes (to .trash/, like a removed page), and its tabs go elsewhere
          host.job.end('stopped');
          hosts.delete(name);
          removePage(dir, name);
          const next = sitePages(dir)[0];
          host.close(next ? `/${next}/` : '/');
          refreshAll();
        }
      })();
      json(res, 200, { ok: true, url: `/${name}/` });
      return true;
    }
    // "Show or describe it": a nearly empty page, then the AI builds it from the words and pictures
    if (a.prompt || (Array.isArray(a.images) && a.images.length) || a.zip) {
      if (siteAI.running()) return json(res, 409, { ok: false, error: 'Kaity is working on the whole site; wait for her to finish' }), true;
      const st = runner.status?.() ?? { ready: true, note: '' };
      if (!st.ready) return json(res, 422, { ok: false, error: `Kaity is not ready: ${st.note}` }), true;
      const images = Array.isArray(a.images) ? a.images.slice(0, 3) : [];
      // a design export: its pictures join the user's (5 at most in all), its text goes along as reference
      let design: { name: string; zip: DesignZip } | null = null;
      if (a.zip) {
        const zipName = String(a.zip.name ?? 'design.zip').replace(/[^\w .()-]/g, '').slice(0, 80) || 'design.zip';
        try {
          design = { name: zipName, zip: readDesignZip(new Uint8Array(Buffer.from(String(a.zip.data ?? ''), 'base64')), 5 - images.length) };
        } catch (e) {
          return json(res, 422, { ok: false, error: `${zipName}: ${(e as Error).message}` }), true;
        }
        if (!design.zip.images.length && !design.zip.texts.length) return json(res, 422, { ok: false, error: `${zipName} has no pictures or text files Kaity can use` }), true;
        images.push(...design.zip.images.map(({ mediaType, data }) => ({ mediaType, data })));
      }
      // the theme: the site's shared one (when other pages use it), the one the user chose, or Kaity's choice
      const shared = sitePages(dir).length > 0 && hasTheme(siteHead(dir));
      const chosen = a.theme ? String(a.theme) : null;
      const themeBrief = shared ? 'The page uses the theme the site\'s pages share: keep it unless the request asks for other colours or fonts.'
        : chosen ? `The user chose the ${chosen} theme: keep it unless the request asks for other colours or fonts.`
        : 'The user left the theme to you: pick the preset that fits the request best (list_themes, use_theme), or give the theme the design\'s own colours and fonts (set_theme), before you write the sections.';
      newSitePage(dir, name, EMPTY_LAYOUT, chosen ?? DEFAULT_THEME);
      const host = hostOf(name)!;
      const root = pageWorkspace(dir, name).load().root.id;
      const asked = String(a.prompt ?? '').trim() || (design ? 'Make this page from the attached design.' : 'Make this page look like the attached picture.');
      const prompt = design ? `${asked}\n\n${designNote(design.name, design.zip)}` : asked;
      host.job.start('ai', { select: root, stop: () => host.ai.cancel() });
      host.ai.ask(root, prompt, undefined, images, `${BUILD_BRIEF}\n${themeBrief}`, design ? designContext(design.name, design.zip) : undefined);
      refreshAll();
      json(res, 200, { ok: true, url: `/${name}/`, select: root });
      return true;
    }
    // "Like this page": its header, footer and theme, with an empty section between
    if (a.like) newPageLike(dir, name, String(a.like));
    else newSitePage(dir, name, String(a.layout ?? 'blank'), String(a.theme ?? DEFAULT_THEME));
    refreshAll(); // the other pages' lists of pages
    json(res, 200, { ok: true, url: `/${name}/` });
    return true;
  }
  // the site's shared head: its theme for every page (the Page tab edits it when a page uses it)
  // whether this process still runs the code on disk (see codeStamp)
  if (req.method === 'GET' && p === '/_tykerf/version') return json(res, 200, { ok: true, outdated: codeStamp() !== STARTED_CODE, page: pageStamp() }), true;
  // the code every page gets from the site head (styles, scripts), apart from the theme
  if (req.method === 'GET' && p === '/_tykerf/site/code') return json(res, 200, { ok: true, code: siteCode(dir), last: lastSiteHeadChange(dir) }), true;
  if (req.method === 'POST' && p === '/_tykerf/site/code') {
    setSiteCode(dir, String((await body(req)).code ?? ''));
    refreshAll();
    return json(res, 200, { ok: true, last: lastSiteHeadChange(dir) }), true;
  }
  // Publish: the site's export committed to a GitHub repository (src/publish.ts); the token is TYKERF_GITHUB_TOKEN in .env
  if (req.method === 'GET' && p === '/_tykerf/site/publish') {
    return json(res, 200, { ok: true, site: true, settings: readSite(dir).publish ?? null, token: !!process.env.TYKERF_GITHUB_TOKEN, last: lastPublish(), running: publishing }), true;
  }
  if (req.method === 'POST' && (p === '/_tykerf/site/publish/settings' || p === '/_tykerf/site/publish')) {
    const a = await body(req);
    if (p === '/_tykerf/site/publish/settings') {
      setPublish(dir, a.settings === null ? null : a.settings as PublishSettings); // throws on settings it can't use: a 422 that says why
      return json(res, 200, { ok: true, settings: readSite(dir).publish ?? null }), true;
    }
    const settings = readSite(dir).publish;
    const token = process.env.TYKERF_GITHUB_TOKEN;
    if (!settings) return json(res, 422, { ok: false, error: 'say where to publish first: the repository, its branch and folder' }), true;
    if (!token) return json(res, 422, { ok: false, error: 'TYKERF needs a GitHub token to publish: add TYKERF_GITHUB_TOKEN to .env, then restart it' }), true;
    if (publishing) return json(res, 409, { ok: false, error: 'the site is being published already' }), true;
    const busy = siteAI.running() ? 'the whole site' : pageRun();
    if (busy) return json(res, 409, { ok: false, error: `Kaity is working on ${busy === 'the whole site' ? busy : `the page ${busy}`}; publish when she's done, so half a change doesn't go live` }), true;
    publishing = true;
    try {
      const { publishToGitHub } = await import('../publish.js');
      const result = await publishToGitHub(dir, settings, token, { api: process.env.TYKERF_GITHUB_API });
      if (result.commit) writeData(PUBLISHED, { at: new Date().toISOString(), commit: result.commit, repo: settings.repo, branch: settings.branch, url: settings.url ?? null });
      return json(res, 200, { ok: true, result, last: lastPublish() }), true;
    } catch (e) {
      return json(res, 502, { ok: false, error: e instanceof Error ? e.message : String(e) }), true;
    } finally {
      publishing = false;
    }
  }
  if (req.method === 'GET' && p === '/_tykerf/site/head') {
    json(res, 200, { ok: true, html: siteHead(dir), last: lastSiteHeadChange(dir) });
    return true;
  }
  if (req.method === 'POST' && (p === '/_tykerf/site/head' || p === '/_tykerf/site/head/undo' || p === '/_tykerf/site/theme/share')) {
    const a = await body(req);
    let result: unknown = null;
    if (p === '/_tykerf/site/head') setSiteHead(dir, String(a.html ?? ''));
    if (p === '/_tykerf/site/head/undo') result = undoSiteHead(dir);
    if (p === '/_tykerf/site/theme/share') {
      if (!sitePages(dir).includes(String(a.page))) return json(res, 422, { ok: false, error: `there is no page "${a.page}" in the site` }), true;
      result = shareTheme(dir, String(a.page));
    }
    refreshAll();
    json(res, 200, { ok: true, result });
    return true;
  }
  // the site's icon, at /favicon.<ext> like an export has it (site.ts siteIcon); /favicon.ico answers too when
  // the icon is another file, for browsers that ask for it without reading the page
  if (req.method === 'GET' && /^\/favicon\.(svg|png|ico)$/.test(p)) {
    const icon = siteIcon(dir);
    if (p !== `/${icon.file}` && p !== '/favicon.ico') return res.writeHead(404).end('not found'), true;
    res.writeHead(200, { 'content-type': icon.type, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox' });
    res.end(icon.bytes);
    return true;
  }
  if (req.method === 'GET' && p === '/_tykerf/site/icon') {
    const icon = siteIcon(dir);
    return json(res, 200, { ok: true, own: icon.own, file: icon.file }), true;
  }
  if (req.method === 'POST' && p === '/_tykerf/site/icon') {
    const a = await body(req);
    try {
      setSiteIcon(dir, a.data ? { type: String(a.type ?? ''), bytes: new Uint8Array(Buffer.from(String(a.data), 'base64')) } : null);
    } catch (e) {
      return json(res, 422, { ok: false, error: (e as Error).message }), true;
    }
    refreshAll(); // the pages link to the new file
    return json(res, 200, { ok: true, own: siteIcon(dir).own, file: siteIcon(dir).file }), true;
  }
  // the site kit's behaviours and their loader (src/kit.ts), which every page of the site loads from /kit/
  if (req.method === 'GET' && p.startsWith('/kit/')) {
    const m = /^\/kit\/(?:loader|scripts\/([a-z0-9][a-z0-9-]{0,40}))\.js$/.exec(p);
    const code = !m ? null : m[1] ? kitRead(dir, 'scripts', m[1]) : KIT_LOADER;
    if (code === null) return res.writeHead(404).end('not found'), true;
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
    return res.end(code), true;
  }
  // the site kit in the manager: its files by kind, the boxes already the same on several pages, undo
  if (p.startsWith('/_tykerf/site/kit')) {
    if (req.method === 'GET' && p === '/_tykerf/site/kit') {
      const files = kitList(dir);
      return json(res, 200, { ok: true, files, last: lastKitChange(dir), identical: identicalBoxes(dir), users: Object.fromEntries(files.blocks.map((b) => [b, Object.keys(blockUsers(dir, b))])) }), true;
    }
    if (req.method === 'GET' && p === '/_tykerf/site/kit/file') {
      const kitKind = String(url.searchParams.get('kind')) as KitKind;
      return json(res, 200, { ok: true, text: kitRead(dir, kitKind, url.searchParams.get('name') ?? 'tags') }), true;
    }
    if (req.method === 'POST') {
      const a = await body(req);
      let result: unknown = null;
      if (p === '/_tykerf/site/kit/file') kitWrite(dir, a.kind as KitKind, String(a.name ?? 'tags'), typeof a.text === 'string' ? a.text : null);
      else if (p === '/_tykerf/site/kit/undo') result = undoKit(dir);
      else if (p === '/_tykerf/site/kit/share') result = shareIdentical(dir, String(a.box ?? ''));
      else return res.writeHead(404).end('not found'), true;
      refreshAll();
      return json(res, 200, { ok: true, result, last: lastKitChange(dir) }), true;
    }
  }
  // the site's own files (the shared theme's fonts), at /assets/ like an export has them
  if (req.method === 'GET' && p.startsWith('/assets/')) {
    const f = decodeURIComponent(p.slice('/assets/'.length));
    const store = new FolderStore(dir);
    const bytes = /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(f) ? store.readBytes(`assets/${f}`) : null;
    if (!bytes) return res.writeHead(404).end('not found'), true;
    // fonts are also fetched by the sandboxed layout previews (an opaque origin)
    res.writeHead(200, { 'content-type': ASSET_TYPES[f.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox', ...(f.endsWith('.woff2') ? { 'access-control-allow-origin': '*' } : {}) });
    res.end(bytes);
    return true;
  }
  // rename or remove a page: its folder moves, so its open tabs follow it; links to it in other pages follow a rename
  // Kaity for the whole site
  if (req.method === 'GET' && p === '/_tykerf/site/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(': connected\n\n');
    siteClients.add(res);
    req.on('close', () => siteClients.delete(res));
    return true;
  }
  // Kaity's work across the site: every run on any page or on the whole site, the ones going on now first (kaity-log.ts)
  if (req.method === 'GET' && p === '/_tykerf/site/kaity') {
    const live = new Map([siteAI.progress(), ...[...hosts.values()].map((h) => h.ai.progress())].filter((r) => !!r).map((r) => [r.run, r]));
    const runs = kaityRuns(dir, live);
    return json(res, 200, { ok: true, runs: [...runs.filter((r) => r.state === 'working'), ...runs.filter((r) => r.state !== 'working')] }), true;
  }
  if (req.method === 'GET' && p === '/_tykerf/site/chat') return json(res, 200, { ok: true, ...siteAI.chat(SITE_CHAT), running: !!siteAI.running() }), true;
  if (req.method === 'POST' && (p === '/_tykerf/site/ask' || p === '/_tykerf/site/ask/cancel' || p === '/_tykerf/site/chat/reset')) {
    const a = await body(req);
    if (p === '/_tykerf/site/ask/cancel') return json(res, 200, { ok: siteAI.cancel() }), true;
    if (p === '/_tykerf/site/chat/reset') return json(res, 200, { ok: siteAI.reset(SITE_CHAT) }), true;
    const busy = pageRun();
    if (busy) return json(res, 409, { ok: false, error: `Kaity is working on the page "${busy}"; wait for her to finish` }), true;
    siteAI.ask(SITE_CHAT, String(a.prompt ?? ''), undefined, Array.isArray(a.images) ? a.images : []);
    return json(res, 200, { ok: true }), true;
  }
  // the pages removed into the site's .trash, and emptying it for good
  if (req.method === 'GET' && p === '/_tykerf/site/trash') return json(res, 200, { pages: trashedPages(dir) }), true;
  if (req.method === 'POST' && p === '/_tykerf/site/trash/empty') {
    await body(req);
    return json(res, 200, { ok: true, deleted: emptyTrash(dir) }), true;
  }
  if (req.method === 'POST' && (p === '/_tykerf/site/rename' || p === '/_tykerf/site/remove')) {
    const a = await body(req);
    const name = String(a.name ?? a.from ?? '');
    if (!sitePages(dir).includes(name)) return json(res, 422, { ok: false, error: `there is no page "${name}" in the site` }), true;
    // Kaity writes her page from another process: it can't move under her, and a rename can't rewrite links
    // in it while she works (a box she saves later would bring the old address back). Other pages are free.
    const rename = p === '/_tykerf/site/rename';
    if (siteAI.running()) return json(res, 409, { ok: false, error: `Kaity is working on the whole site; wait for her to finish before you ${rename ? 'rename' : 'remove'} a page` }), true;
    for (const [page, h] of hosts) {
      if (!h.ai.running()) continue;
      if (page === name) return json(res, 409, { ok: false, error: `Kaity is working on "${page}"; wait for her to finish before you ${rename ? 'rename' : 'remove'} it` }), true;
      if (rename && pageLinks(dir).some((l) => l.page === page && l.to === name))
        return json(res, 409, { ok: false, error: `Kaity is working on "${page}", which links to "${name}"; wait for her to finish, so those links can follow the new name` }), true;
    }
    if (rename) {
      const to = String(a.to ?? '').trim();
      const err = to === name ? null : pageNameError(dir, to);
      if (err) return json(res, 422, { ok: false, error: err }), true;
      const h = hosts.get(name);
      hosts.delete(name);
      const r = renamePage(dir, name, to);
      followMoves(); // its own move: the host is closed below
      h?.close(`/${to}/`);
      for (const other of hosts.values()) other.refresh();
      json(res, 200, { ok: true, url: `/${to}/`, links: r.links });
    } else {
      const h = hosts.get(name);
      hosts.delete(name);
      const r = removePage(dir, name);
      followMoves();
      // open tabs of the page go to the site's home, where all its pages are
      h?.close(MANAGER);
      json(res, 200, { ok: true, url: MANAGER, trash: r.trash, broken: r.broken });
    }
    return true;
  }
  // the page or the whole site as plain files in a .zip (export.ts), with a short report in a header
  if (req.method === 'GET' && p === '/_tykerf/export.zip') {
    const from = exportDir(url);
    if (!from) return json(res, 404, { ok: false, error: 'no such page in this site' }), true;
    const { exportZip } = await import('../export.js');
    const { bytes, report } = exportZip(from, { files: url.searchParams.get('links') === 'files', publicUrl: PUBLIC_URL });
    const name = `${basename(from).replace(/[^A-Za-z0-9._-]+/g, '-') || 'site'}-${new Date().toISOString().slice(0, 10)}.zip`;
    const summary = { pages: report.pages.length, files: report.files, bytes: report.bytes, broken: report.broken.length, remote: report.remote.length };
    res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store', 'x-tykerf-report': JSON.stringify(summary) });
    res.end(bytes);
    return true;
  }
  // what an export will hold, before downloading it: its pages and what to check
  if (req.method === 'GET' && p === '/_tykerf/export/report') {
    const from = exportDir(url);
    if (!from) return json(res, 404, { ok: false, error: 'no such page in this site' }), true;
    const { exportFiles } = await import('../export.js');
    json(res, 200, { ok: true, report: exportFiles(from, { publicUrl: PUBLIC_URL }).report });
    return true;
  }
  // the AI: which runner and model answer, whether it can run, and what is running now (never a key)
  if (req.method === 'GET' && p === '/_tykerf/ai/status') {
    // the runner's own check may be slow (Claude Code starts its whole CLI): wait for it a little, never long
    if (runner.warm) await Promise.race([runner.warm(), new Promise((ok) => setTimeout(ok, 1500))]);
    const running = [...hosts].flatMap(([page, h]) => [h.ai.running()].filter(Boolean).map((r) => ({ page, id: r!.id })));
    json(res, 200, { ok: true, runner: runner.name ?? 'custom', model: runner.model ?? null, ...(runner.status?.() ?? { ready: true, note: '' }), testable: !!runner.check, running });
    return true;
  }
  // one tiny real request, so a wrong key, address or model shows up before a real request fails
  if (req.method === 'POST' && p === '/_tykerf/ai/test') {
    if (!runner.check) return json(res, 422, { ok: false, error: 'this runner has no test' }), true;
    const started = Date.now();
    try {
      const answer = await runner.check();
      json(res, 200, { ok: true, answer: answer.slice(0, 200), ms: Date.now() - started });
    } catch (e) {
      json(res, 200, { ok: false, error: (e as Error).message, ms: Date.now() - started });
    }
    return true;
  }
  if (req.method === 'GET' && p === '/_tykerf/site/links') {
    json(res, 200, { links: pageLinks(dir) });
    return true;
  }
  return false;
}

// ---------- http ----------

const SHARED = !['127.0.0.1', 'localhost', '::1'].includes(HOST);
const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`, `${HOST}:${PORT}`]);
// the site's public address (behind a proxy that passes its Host on) is one of them
let PUBLIC_ORIGIN: string | null = null;
if (PUBLIC_URL) {
  try {
    HOSTS.add(new URL(PUBLIC_URL).host);
    PUBLIC_ORIGIN = new URL(PUBLIC_URL).origin;
  } catch {
    console.error(`TYKERF_PUBLIC_URL is not an address: ${PUBLIC_URL}`);
    process.exit(1);
  }
}

/**
 * What a visitor may load when TYKERF serves the site: pages as they are, their images and files, the
 * list of pages and the sitemap. Nothing of the editor: no /_tykerf/ address but sign-in and its fonts.
 */
function visitorMay(req: IncomingMessage, p: string): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (p.startsWith('/_tykerf/fonts/') || p === '/_tykerf/login' || p === '/_tykerf/favicon.svg') return true;
  if (p.startsWith('/_tykerf/')) return false;
  // anything else under a page is either the page, its files, or not there (a 404 page, not a refusal)
  const rel = /^\/[^/]+(\/.*)?$/.exec(p)?.[1];
  return rel === undefined || !rel.startsWith('/_tykerf/');
}

/** An address under a page that is neither the page, its files nor the editor's (/rome/asdf). */
const notThere = (req: IncomingMessage, rel: string) => req.method === 'GET' && rel !== '/' && !rel.startsWith('/assets/') && !rel.startsWith('/_tykerf/');

/** Nothing here: the admin gets the editor's page (with the site's pages), a visitor a plain one. */
const notFound = (res: ServerResponse, admin: boolean) =>
  res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(admin ? readFileSync(join(here, 'public', 'missing.html')) : NOT_FOUND);

const NOT_FOUND = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found</title><p style="font:16px/1.5 system-ui;margin:48px 20px">This page isn\'t here. <a href="/pages/">The site\'s pages</a></p>';

const hostname = (host: string) => {
  try { return new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, ''); } catch { return ''; }
};

/** Refuses requests that don't come from the editor itself: other Host names (DNS rebinding) and, for changes,
 *  other origins or non-JSON bodies (a foreign page can't send JSON cross-origin without a preflight we never answer). */
function foreign(req: IncomingMessage): string | null {
  const host = req.headers.host ?? '';
  // with --host the editor is reached by the machine's IP address; IP literals can't be used for DNS rebinding
  if (!HOSTS.has(host) && !(SHARED && isIP(hostname(host)))) return `unexpected host ${host}`;
  if (req.method === 'GET' || req.method === 'HEAD') return null;
  const origin = req.headers.origin;
  // behind an HTTPS proxy the browser's origin is the public address (https://…), not this server's http://
  if (origin && origin !== `http://${host}` && origin !== PUBLIC_ORIGIN) return `unexpected origin ${origin}`;
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return 'expected a JSON body';
  return null;
}

const redirect = (res: ServerResponse, to: string) => res.writeHead(302, { location: to, 'cache-control': 'no-store' }).end();

createServer(async (req, res) => {
  // the request's address is a path: parsed on its own, "//x" would name another server (and "//" throws),
  // so it goes after this server's address; a bad one is refused instead of stopping the server
  let url: URL;
  try {
    const raw = req.url ?? '/';
    url = new URL(`http://localhost:${PORT}${raw.startsWith('/') ? raw : `/${raw}`}`);
  } catch {
    return res.writeHead(400, { 'content-type': 'text/plain' }).end('TYKERF: that is not an address');
  }
  const p = url.pathname;
  const refused = foreign(req);
  if (refused) return res.writeHead(403, { 'content-type': 'text/plain' }).end(`TYKERF: ${refused}`);
  // doubled slashes (//, /rome//) go to the clean address
  if (p.includes('//')) return redirect(res, `${p.replace(/\/{2,}/g, '/')}${url.search}`);
  try {
    // signing in and out, and what visitors may see when TYKERF serves the site (auth.ts)
    // signed in already: the sign-in page goes straight on
    if (p === '/_tykerf/login' && req.method === 'GET' && auth.on && auth.admin(req)) return redirect(res, /^\/(?!\/)[^\s"<>]*$/.test(url.searchParams.get('next') ?? '') ? url.searchParams.get('next')! : MANAGER);
    if (p === '/_tykerf/login' && req.method === 'GET') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(loginPage(url.searchParams.get('next') ?? MANAGER)), undefined;
    if (p === '/_tykerf/login' && req.method === 'POST') {
      const r = await auth.login(req, res, String((await body(req)).password ?? ''));
      return json(res, r === 'ok' ? 200 : r === 'locked' ? 429 : 401, { ok: r === 'ok' });
    }
    if (p === '/_tykerf/logout' && req.method === 'POST') return auth.logout(req, res), json(res, 200, { ok: true });
    const admin = auth.admin(req);
    if (!admin && !visitorMay(req, p)) {
      // the manager, and any editor address opened in the browser (the handbook, say), lead to sign-in and back;
      // the editor's own requests just refuse
      if (req.method === 'GET' && (p === MANAGER || /\btext\/html\b/.test(req.headers.accept ?? ''))) return redirect(res, `/_tykerf/login?next=${encodeURIComponent(p + url.search)}`);
      return json(res, 401, { ok: false, error: 'sign in to edit this site' });
    }
    // a visitor at a site without a home page gets the list of its pages, not the manager
    if (!admin && p === '/' && !readSite(dir).home) return redirect(res, '/pages/');
    // TYKERF's own address on its own (typed by hand, or signed in from it) is the site manager
    if (req.method === 'GET' && (p === '/_tykerf' || p === '/_tykerf/')) return redirect(res, MANAGER);
    if (serveStatic(req, res, p) || (await serveGlobal(req, res, p, url))) return;
    // the list of the site's pages, and its sitemap when its public address is known
    if (p === '/pages') return redirect(res, '/pages/');
    // under the list: the way in for the admin (sign-in for a visitor, the manager once in)
    const way = admin ? { href: MANAGER, text: 'Site manager' } : { href: `/_tykerf/login?next=${encodeURIComponent(MANAGER)}`, text: 'Sign in to edit' };
    if (p === '/pages/') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(siteIndex(dir, way)), undefined;
    if (p === '/sitemap.xml' && PUBLIC_URL) return res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' }).end(siteMap(dir, PUBLIC_URL)), undefined;
    // a site: "/" opens its home page when it has one; otherwise it is the manager, as /_tykerf/site/ always is
    if (p === '/' && readSite(dir).home) return redirect(res, `/${readSite(dir).home}/`);
    if (p === '/' || p === MANAGER) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(readFileSync(join(here, 'public', 'start.html')));
    }
    const m = /^\/([^/]+)(\/.*)?$/.exec(p);
    const host = m && hostOf(decodeURIComponent(m[1]));
    // a page that isn't in the site (renamed or removed, often in another tab): say so and list the pages there are
    if (!m || !host) return notFound(res, admin);
    // relative addresses in the page (assets/…, _tykerf/…) need the trailing slash
    if (!m[2]) return redirect(res, `/${m[1]}/${url.search}`);
    if (serveStatic(req, res, m[2])) return;
    if (notThere(req, m[2])) return notFound(res, admin);
    if (req.method === 'POST' && (m[2] === '/_tykerf/ask' || m[2] === '/_tykerf/tasks/ask') && siteAI.running()) return json(res, 409, { ok: false, error: 'Kaity is working on the whole site; wait for her to finish' });
    await host.handle(req, res, m[2], url);
  } catch (e) {
    json(res, 422, { ok: false, error: (e as Error).message });
  }
}).listen(PORT, HOST, () => {
  console.log(`TYKERF: http://localhost:${PORT}  (site ${dir}, ${sitePages(dir).length} pages; AI: ${runner.name}${runner.model ? `, ${runner.model}` : ''})`);
  if (auth.on) console.log(`Visitors see the pages; sign in to edit at http://localhost:${PORT}/_tykerf/login (TYKERF_ADMIN_PASSWORD)`);
});
