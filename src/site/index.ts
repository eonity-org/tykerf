// A site: a folder whose subfolders are pages (my-site/home, my-site/about), each a workspace of its
// own. The editor serves each page at its own address (/home/, /about/) and can add pages to the
// site. Every page TYKERF makes is in a site: a page in a new or empty folder makes a site with that
// page as its home, which the site's address opens.
//
// This is the local shape of what Tydal will hold later: a site is a Vault, each page a resource.
//
// The site's parts, one file each (docs/developer-guide/en/architecture.md#sites):
//   settings.ts  site.json: the home page, titles, the language, where Publish sends it
//   head.ts      the shared head: the theme every page uses, and the code every page gets
//   icon.ts      the site's icon
//   pages.ts     its pages: new ones, copies, the list and the sitemap, links, renames, the trash
//   blocks.ts    the kit's shared blocks (the rest of the kit is src/kit.ts)
// and here the Site object over them, and what a page needs of its site (SiteLink).

import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { FolderStore } from '../store.js';
import { type SiteLike, Workspace } from '../workspace.js';
import { type KitKind, kitBlock, kitList, kitLoaderTag, kitRead, kitStyles, kitTags, kitTypes, kitWrite, lastKitChange } from '../kit.js';
import type { Registry } from '../types.js';
import { type SiteSettings, readSite } from './settings.js';
import { isSite, sitePages } from './pages.js';
import { iconLink } from './icon.js';
import { setSiteHead, siteHead } from './head.js';
import { SiteHistory, type SiteStep, siteStore } from './history.js';

/**
 * A site, by its folder: its settings, its pages, its shared head and its kit, its one history, and what each
 * page needs of it (SiteLike, which Workspace takes: `site.page(name)` is a page of it).
 */
export class Site implements SiteLike {
  readonly store: FolderStore;
  /** The site's one history: its head, its kit and its settings (history.ts). */
  readonly history: SiteHistory;

  constructor(readonly dir: string) {
    this.store = siteStore(dir);
    this.history = new SiteHistory(dir);
  }

  /** A page of the site, with the site's head, kit and history. */
  page(name: string): Workspace {
    return new Workspace(join(this.dir, name), { site: this, page: name });
  }

  // ---- its history ----

  /** Undo the site's last step (a change to its head, its kit or its settings); returns its label. */
  undo(): string {
    return this.history.undo();
  }

  /** Bring back the last undone step; returns its label. */
  redo(): string {
    return this.history.redo();
  }

  undoAts(): string[] {
    return this.history.undoAts();
  }

  redoAts(): string[] {
    return this.history.redoAts();
  }

  /** The latest steps, newest first. */
  steps(limit = 30): SiteStep[] {
    return this.history.steps(limit);
  }

  /** Several changes to the site as one step (undone whole when `fn` throws). */
  group<T>(label: string, author: string, fn: () => T): T {
    return this.history.group(label, author, fn);
  }

  /** Run a read-modify-write of the site's own files whole (the site folder's lock, reentrant in this process; see Store.lock). */
  transaction<T>(fn: () => T): T {
    return this.store.lock(fn);
  }

  // ---- its settings and pages ----

  /** site.json, as readSite gives it. */
  settings(): SiteSettings {
    return readSite(this.dir);
  }

  /** The page names, sorted. */
  pages(): string[] {
    return sitePages(this.dir);
  }

  pageNames(): string[] {
    return sitePages(this.dir);
  }

  home(): string | undefined {
    return readSite(this.dir).home;
  }

  lang(): string {
    return readSite(this.dir).lang;
  }

  // ---- its head, icon and files ----

  /** The head every page shares ('' without one). */
  head(): string {
    return siteHead(this.dir);
  }

  setHead(html: string, label: string, author?: string) {
    setSiteHead(this.dir, html, label, author);
  }

  icon(): string {
    return iconLink(this.dir);
  }

  files(): string[] {
    return existsSync(join(this.dir, 'assets')) ? readdirSync(join(this.dir, 'assets')) : [];
  }

  asset(file: string): Uint8Array | null {
    return this.store.readBytes(`assets/${file}`);
  }

  // ---- its kit (src/kit.ts) ----

  /** The kit's part of every page's head: its styles and the behaviours' loader. */
  kitHead(): string {
    return kitStyles(this.dir) + kitLoaderTag(this.dir);
  }

  block(name: string): string | null {
    return kitBlock(this.dir, name);
  }

  setBlock(name: string, code: string | null, author: string): string | null {
    return kitWrite(this.dir, 'blocks', name, code, `edit the shared block ${name}`, author);
  }

  types(): Registry {
    return kitTypes(this.dir) as Registry;
  }

  /** The site kit's other files, for this site. */
  readonly kit = {
    list: () => kitList(this.dir),
    read: (kind: KitKind, name?: string) => kitRead(this.dir, kind, name),
    write: (kind: KitKind, name: string, text: string | null, label?: string, author?: string) => kitWrite(this.dir, kind, name, text, label, author),
    tags: () => kitTags(this.dir),
    last: () => lastKitChange(this.dir),
  };

  /** @deprecated the Site is what a page needs of its site (SiteLike): kept for one release. */
  link(): SiteLike {
    return this;
  }
}

/** @deprecated new Site(dir): kept for one release. */
export const siteLink = (dir: string): Site => new Site(dir);

/** A page of the site, with the site's shared head (new Site(dir).page(name)). */
export const pageWorkspace = (dir: string, name: string) => new Site(dir).page(name);

/** The site a page folder belongs to (its parent folder, when that is a site and lists it), or null. */
export function siteOf(pageDir: string): Site | null {
  const parent = dirname(pageDir);
  try {
    // a page in a folder of other things (a home folder) stands on its own
    return sitePages(parent).includes(basename(pageDir)) && isSite(parent) ? new Site(parent) : null;
  } catch {
    return null;
  }
}

export { HOME_PAGE, PAGE_NAME, siteKind, sitePages, pageNameError, newSitePage, freePageName, addSitePage, siteIndex, TYKERF_REPO, CREDIT, withCredit, siteMap, newPageLike, usePage, linkedPage, rewriteLinks, type PageLink, pageLinks, type PageMove, pageMoves, renamePage, duplicatePage, type TrashedPage, trashedPages, emptyTrash, removePage } from './pages.js';
export { type SiteSettings, LANG, langTag, type PublishSettings, publishSettingsError, readSite, setLang, setHome, setTitle, setPublish, pageTitle, derivedTitle } from './settings.js';
export { unsafeSVG, madeIcon, siteIcon, iconLink, setSiteIcon } from './icon.js';
export { siteHead, setSiteHead, lastSiteHeadChange, siteCode, setSiteCode, undoSiteHead, shareTheme, pagesWithOwnTheme } from './head.js';
export { SiteHistory, type SiteStep, type SiteEntry, type SiteChangeKind } from './history.js';
export { blockUsers, siteFiles, shareBlock, movedFiles, linkBlock, unlinkBlock, identicalBoxes, shareIdentical } from './blocks.js';
