// The site's settings, site.json: its home page, its pages' titles, its language, where it's published.

import { walk } from '../model.js';
import { Workspace } from '../workspace.js';
import { sitePages } from './pages.js';
import { SiteHistory, siteStore } from './history.js';
import { pageStore } from './index.js';

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
  /** The site's language, BCP 47 ("en", "es", "pt-BR"): every page's <html lang>. "en" when site.json has none. */
  lang: string;
}

/** A language tag a site can have: BCP 47's language, then subtags ("es", "pt-BR", "sr-Latn-RS"). */
export const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** A language tag as web pages write it (<html lang="ES_es">) made one a site can have ("es-es"), or null. */
export function langTag(raw: string | null | undefined): string | null {
  const l = String(raw ?? '').trim().replace(/_/g, '-').replace(/^[A-Za-z]+/, (m) => m.toLowerCase());
  return LANG.test(l) ? l : null;
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
    raw = JSON.parse(siteStore(dir).read(SITE_FILE) ?? '{}');
  } catch {}
  const pages = new Set(sitePages(dir));
  const titles = Object.fromEntries(Object.entries(raw.titles ?? {}).filter(([p, t]) => pages.has(p) && typeof t === 'string' && t.trim()));
  const publish = raw.publish && !publishSettingsError(raw.publish) ? raw.publish : undefined;
  const lang = typeof raw.lang === 'string' && LANG.test(raw.lang) ? raw.lang : 'en';
  return { version: 1, ...(raw.home && pages.has(raw.home) ? { home: raw.home } : {}), titles, ...(publish ? { publish } : {}), lang };
}

/**
 * Write site.json whole (FolderStore.write: a process reading it meanwhile never gets it half written, and so
 * never saves its next change over settings it couldn't read). The default language isn't written. With a
 * `step` it is a step of the site's history; without, it only follows a change made elsewhere (a page renamed
 * or removed), which has no undo.
 */
export function writeSite(dir: string, s: SiteSettings, step: { label: string; author?: string } | null) {
  const { lang, ...rest } = s;
  const text = `${JSON.stringify(lang === 'en' ? rest : { ...rest, lang }, null, 2)}\n`;
  if (step) new SiteHistory(dir).change('settings', SITE_FILE, text, step.label, step.author);
  else siteStore(dir).write(SITE_FILE, text);
}

/** Read, change and write the settings as one step of the site's history, under the site's lock. */
function changeSite(dir: string, label: string, author: string, fn: (s: SiteSettings) => void) {
  siteStore(dir).lock(() => {
    const s = readSite(dir);
    fn(s);
    writeSite(dir, s, { label, author });
  });
}

/** Set the site's language (BCP 47: "es", "pt-BR"); "" goes back to English. Every page's <html lang> follows it. */
export function setLang(dir: string, lang: string, author = 'user') {
  const l = lang.trim() || 'en';
  if (!LANG.test(l)) throw new Error(`"${lang}" is not a language tag: two or three lowercase letters, then subtags if any, such as es, pt-BR or sr-Latn`);
  if (readSite(dir).lang === l) return;
  changeSite(dir, `the site's language: ${l}`, author, (s) => (s.lang = l));
}

/** Make a page the site's home (null: no home page, the site's address shows the manager). */
export function setHome(dir: string, page: string | null, author = 'user') {
  if (page !== null && !sitePages(dir).includes(page)) throw new Error(`there is no page "${page}" in the site`);
  changeSite(dir, page === null ? 'no home page' : `make ${page} the home page`, author, (s) => {
    if (page === null) delete s.home;
    else s.home = page;
  });
}

/** Give a page a title by hand ('' goes back to the title from its first <h1>). */
export function setTitle(dir: string, page: string, title: string, author = 'user') {
  if (!sitePages(dir).includes(page)) throw new Error(`there is no page "${page}" in the site`);
  const t = title.replace(/\s+/g, ' ').trim();
  if (t.length > 120) throw new Error('a title can be 120 characters at most');
  changeSite(dir, t ? `title of ${page}: ${t}` : `title of ${page} from its first heading`, author, (s) => {
    if (t) s.titles[page] = t;
    else delete s.titles[page];
  });
}

/** Where Publish sends the site (null: nowhere yet). Throws on settings that can't be used. */
export function setPublish(dir: string, p: PublishSettings | null, author = 'user') {
  siteStore(dir).lock(() => setPublishNow(dir, p, author));
}

function setPublishNow(dir: string, p: PublishSettings | null, author: string) {
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
  writeSite(dir, s, { label: p === null ? 'no publishing' : `publish to ${s.publish!.repo}`, author });
}

/** A page's title: set by hand, else the text of its first <h1>, else its name (derivedTitle). */
export function pageTitle(dir: string, page: string, settings = readSite(dir)): string {
  return settings.titles[page] || derivedTitle(dir, page);
}

/**
 * A page's title from its own boxes: the text of the first <h1> in tree order, else the page's name. Boxes that
 * show a shared block are skipped: a banner shared by every page would give them all its heading.
 * (When shared blocks get slots, docs/plans/site-sharing-2.md phase 2, a slot this page fills can count again.)
 */
export function derivedTitle(dir: string, page: string): string {
  const ws = new Workspace(pageStore(dir, page));
  const l = ws.load();
  const order: string[] = [];
  walk(l.root, (n) => n.type === 'leaf' && !n.use && order.push(n.id));
  for (const id of order) {
    const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(ws.ownContent(id) ?? '')?.[1];
    const text = h1?.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    if (text) return text.length > 120 ? `${text.slice(0, 117)}…` : text;
  }
  return page;
}
