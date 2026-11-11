// A site in a store of its own, not a folder (new Site(store)): a MemoryStore here, as tests and previews use,
// and later a remote store. Everything a page needs of its site works on it; moving page folders doesn't.

import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { kitRead, kitWrite } from '../src/kit.js';
import { Site, duplicatePage, emptyTrash, linkBlock, newSitePage, pageTitle, readSite, removePage, renamePage, setLang, setSiteIcon, setTitle, siteHead, siteIcon, siteKind, siteOf, sitePages, trashedPages } from '../src/site.js';
import { exportFiles } from '../src/export.js';
import { MemoryStore } from '../src/store.js';

describe('a site in memory', () => {
  it('makes, renders and changes its pages, its kit and its settings, with one history, and nothing on disk', () => {
    const store = new MemoryStore('memory:shop');
    const site = new Site(store);
    expect(site.dir).toBe('memory:shop');
    newSitePage(site.dir, 'home', 'launch', 'studio');
    newSitePage(site.dir, 'about', 'company', 'studio');
    expect(sitePages(site.dir)).toEqual(['about', 'home']);
    expect(store.exists('home/layout.slice') && store.exists('head.html')).toBe(true);

    // the shared theme, the shared navigation and footer, the library's behaviours: all in the store
    expect(siteHead(site.dir)).toContain('data-tykerf-preset="studio"');
    expect(kitRead(site.dir, 'blocks', 'footer')).not.toBeNull();
    expect(kitRead(site.dir, 'scripts', 'accordion')).not.toBeNull();
    const home = site.page('home');
    expect(home.sharedBlock('nav')).toBe('nav');
    const html = home.page();
    expect(html).toContain('data-tykerf-theme');
    expect(html).not.toContain('/kit/site.css'); // no kit styles yet
    expect(html).toContain('<script type="module" src="/kit/loader.js"></script>');

    // a change to the shared footer reaches the other page; the page's undo takes it back
    home.setContent('footer', '<footer>© Shop</footer>', 'user');
    expect(site.page('about').content('footer')).toBe('<footer>© Shop</footer>');
    expect(home.undo()).toBe('edit the shared block footer');
    expect(site.page('about').content('footer')).not.toBe('<footer>© Shop</footer>');

    // slots of a shared block, filled per page
    kitWrite(site.dir, 'blocks', 'banner', '<h1 data-slot="title">Title</h1>');
    linkBlock(site.dir, site.page('about'), 'intro', 'banner');
    site.page('about').setSlots('intro', { title: 'About the shop' }, 'user');
    expect(site.page('about').page()).toContain('<h1 data-slot="title">About the shop</h1>');

    // settings, the icon and the language, each a step of the site's history
    setTitle(site.dir, 'about', 'About us');
    expect(pageTitle(site.dir, 'about')).toBe('About us');
    setLang(site.dir, 'es');
    expect(site.page('home').page()).toMatch(/<html lang="es">/);
    setSiteIcon(site.dir, { type: 'image/svg+xml', bytes: new TextEncoder().encode('<svg viewBox="0 0 1 1"></svg>') });
    expect(siteIcon(site.dir)).toMatchObject({ file: 'favicon.svg', own: true });
    expect(site.undo()).toBe('the site\'s icon');
    expect(site.undo()).toBe('the site\'s language: es');
    expect(readSite(site.dir).lang).toBe('en');

    // a page's folder can't move: that is a folder's
    expect(() => renamePage(site.dir, 'about', 'team')).toThrow(/renaming a page needs a site in a folder/);
    // and nothing went to disk under its name
    expect(existsSync('memory:shop')).toBe(false);
  });

  it('answers every question a folder would, from its store; what needs a folder says so, and nothing touches the disk', () => {
    const store = new MemoryStore('memory:probe');
    const site = new Site(store);
    expect(siteKind(site.dir)).toBe('site'); // empty: a new site
    newSitePage(site.dir, 'home', 'blank', 'studio');
    expect(siteKind(site.dir)).toBe('site');
    expect(siteKind(`${site.dir}/home`)).toBe('page');
    expect(siteOf(`${site.dir}/home`)?.dir).toBe('memory:probe');
    // what isn't a site, in a store as in a folder: a folder of other things beside a page
    store.write('Documents/notes.txt', 'x');
    expect(() => siteKind(site.dir)).toThrow(/holds other folders besides its pages/);
    store.remove('Documents/notes.txt');
    // no trash: removing a page needs a folder
    expect(trashedPages(site.dir)).toEqual([]);
    expect(emptyTrash(site.dir)).toBe(0);
    expect(() => removePage(site.dir, 'home')).toThrow(/removing a page needs a site in a folder/);
    expect(() => duplicatePage(site.dir, 'home')).toThrow(/duplicating a page needs a site in a folder/);
    // an export reads it as a folder's
    const { files, report } = exportFiles(site.dir);
    expect(report.pages).toEqual(['home']);
    expect(files.map((f) => f.path)).toContain('home/index.html');
    expect(existsSync('memory:probe')).toBe(false);
  });
});
