import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { leftovers, say } from '../src/check.js';
import { kitRead, kitWrite, lastKitChange } from '../src/kit.js';
import { headStyles, migrateHeadStyles, Site, blockUsers, duplicatePage, freePageName, linkBlock, shareBlock, unlinkBlock, iconLink, madeIcon, setSiteIcon, siteIcon, lastSiteHeadChange, linkedPage, newPageLike, newSitePage, pageLinks, pageNameError, pageWorkspace, removePage, renamePage, setSiteHead, emptyTrash, langTag, pageTitle, readSite, setHome, setLang, siteIndex, setSiteCode, setTitle, shareTheme, siteCode, siteHead, siteKind, siteOf, sitePages, trashedPages, undoSiteHead, usePage } from '../src/site.js';
import { NO_SITE_HEAD, Workspace } from '../src/workspace.js';
import * as M from '../src/moves.js';
import { componentCode, createPage, readOverrides, readTheme, themes } from '../src/library.js';
import { pageFileRefs } from '../src/assets.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'tykerf-site-'));

describe('sites', () => {
  it('tell a page from a site, and refuse folders that are neither', () => {
    const dir = tmp();
    expect(siteKind(join(dir, 'new'))).toBe('site'); // a folder that doesn't exist yet
    expect(siteKind(dir)).toBe('site'); // empty
    writeFileSync(join(dir, '.DS_Store'), '');
    expect(siteKind(dir)).toBe('site'); // hidden files don't count
    newSitePage(dir, 'home', 'launch', 'dark');
    expect(siteKind(dir)).toBe('site');
    expect(siteKind(join(dir, 'home'))).toBe('page');
    const other = tmp();
    writeFileSync(join(other, 'notes.txt'), 'hello');
    expect(() => siteKind(other)).toThrow(/holds other files/);
  });

  it('keep a page in a folder of other things, such as a home folder, on its own', () => {
    // a site may hold, besides its pages, files and TYKERF's own folders, and empty ones
    const site = tmp();
    newSitePage(site, 'home', 'blank', 'studio');
    for (const d of ['out', 'empty']) mkdirSync(join(site, d));
    writeFileSync(join(site, 'README.md'), '# Our site');
    expect(siteKind(site)).toBe('site');
    expect(new Workspace(join(site, 'home'), { site: siteOf(join(site, 'home')) }).site).not.toBeNull();

    // a home folder: two pages next to Desktop and Documents
    const home = tmp();
    for (const p of ['bakery', 'florist']) createPage(new Workspace(join(home, p)), 'blank');
    for (const d of ['Desktop', 'Documents']) {
      mkdirSync(join(home, d));
      writeFileSync(join(home, d, 'notes.txt'), 'mine');
    }
    expect(() => siteKind(home)).toThrow(/holds other folders besides its pages, so it isn't a site/);
    expect(siteOf(join(home, 'bakery'))).toBeNull();
    expect(siteKind(join(home, 'bakery'))).toBe('page');
  });

  it("list their pages and add new ones from a layout; the first page's theme is shared by all", () => {
    const dir = tmp();
    const home = newSitePage(dir, 'home', 'launch', 'ivory');
    const about = newSitePage(dir, 'about', 'article', 'product'); // the site already has its theme
    mkdirSync(join(dir, 'drafts')); // a folder that isn't a page
    expect(sitePages(dir)).toEqual(['about', 'home']);
    expect(readTheme(siteHead(dir))).toEqual(themes().find((t) => t.name === 'ivory')!.values);
    for (const ws of [home, about]) {
      expect(ws.head()).toBe('');
      expect(ws.page()).toContain('--color-accent: #a64a28'); // the site's theme is in every page
    }
    expect(existsSync(join(dir, 'assets', 'dm-sans-latin-wght-normal.woff2'))).toBe(true); // its fonts, at the site
    expect(siteHead(dir)).toContain('url("/assets/dm-sans-latin-wght-normal.woff2")');
    // the first page is the site's home page; a later one isn't, until someone makes it so
    expect(readSite(dir).home).toBe('home');
    setHome(dir, null);
    newSitePage(dir, 'blog');
    expect(readSite(dir).home).toBeUndefined();
  });

  it("keep the site theme in its own history, and share one page's theme in an older site", () => {
    const dir = tmp();
    // an older site: each page has its own theme
    for (const [n, th] of [['home', 'studio'], ['about', 'ivory']]) createPage(new Workspace(join(dir, n)), 'blank', th);
    const copy = new Workspace(join(dir, 'copy'));
    copy.create('a b H', { a: '<p>x</p>' });
    copy.setHead(`${NO_SITE_HEAD}\n<style>body{color:red}</style>`, 'user');
    expect(siteHead(dir)).toBe('');
    expect(shareTheme(dir, 'home')).toEqual(['about', 'home']);
    expect(readTheme(siteHead(dir))['--color-accent']).toBe(themes().find((t) => t.name === 'studio')!.values['--color-accent']);
    expect(pageWorkspace(dir, 'about').head()).toBe('');
    expect(pageWorkspace(dir, 'about').page()).toContain('--color-accent: #0066cc');
    // an imported copy keeps its own look
    expect(pageWorkspace(dir, 'copy').page()).not.toContain('data-tykerf-theme');
    // the about page can undo it, and the site head has its own undo
    expect(pageWorkspace(dir, 'about').history(1)[0].label).toBe("the theme is now the site's");
    setSiteHead(dir, siteHead(dir).replace('#0066cc', '#ff0000'));
    expect(lastSiteHeadChange(dir)!.label).toBe('edit the site theme');
    expect(undoSiteHead(dir)).toBe('edit the site theme');
    expect(siteHead(dir)).toContain('#0066cc');
    expect(undoSiteHead(dir)).toBe('use the theme of home for every page');
    expect(siteHead(dir)).toBe('');
    expect(() => undoSiteHead(dir)).toThrow(/no change/);
    expect(() => shareTheme(dir, 'copy')).toThrow(/no theme of its own/);
  });

  it('let Kaity make one page\'s theme the site\'s (share_theme), when every page has its own', async () => {
    const dir = tmp();
    for (const [n, th] of [['home', 'studio'], ['about', 'ivory']]) createPage(new Workspace(join(dir, n)), 'blank', th);
    const { openTools } = await import('../src/editor/tools-client.js');
    // a page's run reads its theme and hears that the pages share none
    const page = await openTools(pageWorkspace(dir, 'about'), '');
    expect((await page.call('get_theme', {})).text).toMatch(/^\(each page of this site has a theme of its own \(about, home\); they share none, so set_theme here changes this page only\. share_theme, on a run over the whole site, makes one page's theme every page's: ask for the whole site to use it\)\n--/);
    expect((await page.call('share_theme', { page: 'home' })).text).toMatch(/not found|unknown tool|error/i); // only on a run over the site
    await page.close();

    const site = await openTools(pageWorkspace(dir, 'home'), '', dir);
    expect((await site.call('get_theme', {})).text).toMatch(/makes one page's theme every page's\)\n/);
    expect((await site.call('share_theme', { page: 'home' })).text).toBe('ok: the site has one theme now, "home"\'s, and every page uses it; these pages gave up their own: about, home (each can undo it). Copies of websites keep their own look.');
    expect(readTheme(siteHead(dir))['--color-accent']).toBe(themes().find((t) => t.name === 'studio')!.values['--color-accent']);
    for (const p of ['home', 'about']) {
      const ws = pageWorkspace(dir, p);
      expect(ws.head()).not.toContain('data-tykerf-theme');
      expect(ws.history()).toHaveLength(1);
      expect(ws.history(1)[0]).toMatchObject({ label: "the theme is now the site's", author: 'ai' });
    }
    expect((await site.call('get_theme', {})).text).not.toMatch(/share none/);
    // the site shares one now: a page without its own can't be shared; one with its own still can
    expect((await site.call('share_theme', { page: 'about' })).text).toMatch(/refused: the site already shares one theme, and "about" has none of its own: it uses the site's\. Every page follows it already/);
    createPage(new Workspace(join(dir, 'shop')), 'blank', 'warm');
    expect((await site.call('share_theme', { page: 'about' })).text).toMatch(/Pages with a theme of their own: shop; share_theme one of them/);
    expect((await site.call('share_theme', { page: 'paris' })).text).toMatch(/no page "paris"/);
    expect((await site.call('share_theme', { page: 'shop' })).text).toMatch(/^ok: the site has one theme now, "shop"'s/);
    await site.close();
  });

  it('start a new site with its navigation and footer shared, and link them on every new page', async () => {
    const dir = tmp();
    const home = newSitePage(dir, 'home', 'launch', 'studio');
    // the library's navigation and footer, with their pictures at the site's assets/
    expect(kitRead(dir, 'blocks', 'nav')).toContain(componentCode('nav').match(/class="[^"]+"/)![0]);
    expect(kitRead(dir, 'blocks', 'footer')!.length).toBeGreaterThan(100);
    for (const b of ['nav', 'footer']) expect(pageFileRefs(kitRead(dir, 'blocks', b)!), b).toEqual([]);
    expect([home.sharedBlock('nav'), home.sharedBlock('footer'), home.sharedBlock('hero')]).toEqual(['nav', 'footer', null]);
    expect(existsSync(join(dir, 'home', 'boxes', 'nav.html'))).toBe(false); // no copy of the code: the block is the code
    expect(home.history()).toEqual([]); // a new page starts with nothing to undo
    expect(home.contents().footer).toBe(kitRead(dir, 'blocks', 'footer'));
    const about = newSitePage(dir, 'about', 'company', 'studio');
    expect([about.sharedBlock('nav'), about.sharedBlock('footer')]).toEqual(['nav', 'footer']);
    expect(blockUsers(dir, 'nav')).toEqual({ about: ['nav'], home: ['nav'] });
    // a change reaches both
    kitWrite(dir, 'blocks', 'footer', '<footer>© Bakery</footer>');
    expect(pageWorkspace(dir, 'about').page()).toContain('© Bakery');
    // shared: false gives the page copies of its own
    const own = newSitePage(dir, 'own', 'company', 'studio', { shared: false });
    expect([own.sharedBlock('nav'), own.sharedBlock('footer')]).toEqual([null, null]);
    expect(own.ownContent('footer')).toBe(componentCode('footer'));
    expect(own.page()).not.toContain('© Bakery');

    // Kaity's new_page says which blocks the page shows; shared: false, none
    const { openTools } = await import('../src/editor/tools-client.js');
    const run = await openTools(home, '', dir);
    expect((await run.call('new_page', { name: 'shop', layout: 'catalogue' })).text).toMatch(/^ok: new page "shop" from the catalogue layout, it uses the theme the site's pages share; it shows the site's shared blocks nav, footer, the same on every page/);
    expect((await run.call('new_page', { name: 'shop2', layout: 'catalogue', shared: false })).text).not.toMatch(/shared block/);
    // use_layout on a page of the site: its navigation and footer show the site's blocks, in the same undo step
    await run.call('open_page', { name: 'own' });
    expect((await run.call('use_layout', { name: 'launch' })).text).toMatch(/^ok: the page now follows the launch layout; nav, footer show the site's shared blocks of that name/);
    expect([pageWorkspace(dir, 'own').sharedBlock('nav'), pageWorkspace(dir, 'own').sharedBlock('footer')]).toEqual(['nav', 'footer']);
    expect(pageWorkspace(dir, 'own').history(1)[0].label).toBe('use layout launch');
    await run.close();
  });

  it('copy a page with its shared blocks as links, never as copies of the blocks\' code', async () => {
    const dir = tmp();
    const home = newSitePage(dir, 'home', 'launch', 'studio', { shared: false }); // an older site: shared by hand below
    const mine = home.ownContent('nav')!;
    shareBlock(dir, home, 'nav');
    kitWrite(dir, 'blocks', 'nav', '<nav>shared, second version</nav>');
    // a page that shows the block with no code of its own
    const about = newSitePage(dir, 'about', 'blank', 'studio');
    about.save(M.setLeaf(about.load(), 'text', { use: 'nav' }), 'link', 'user');
    expect(about.ownContent('text')).not.toBeNull();
    about.store.remove('boxes/text.html');

    const { openTools } = await import('../src/editor/tools-client.js');
    const run = await openTools(home, '', dir);
    expect((await run.call('new_page', { name: 'copied', copy: 'home' })).text).toMatch(/^ok: new page "copied", a copy of "home"/);
    await run.close();
    const used = newSitePage(dir, 'used', 'blank', 'studio');
    usePage(used, dir, 'home');
    newPageLike(dir, 'like', 'home');
    duplicatePage(dir, 'home', 'twin');
    newPageLike(dir, 'like-about', 'about');
    const kitStep = lastKitChange(dir)!.at;

    for (const p of ['copied', 'used', 'like', 'twin']) {
      const ws = pageWorkspace(dir, p);
      expect(ws.sharedBlock('nav'), p).toBe('nav');
      expect(ws.ownContent('nav'), p).toBe(mine); // the source's own file, not the block as it was
    }
    expect(pageWorkspace(dir, 'like-about').sharedBlock('text')).toBe('nav');
    expect(existsSync(join(dir, 'like-about', 'boxes', 'text.html'))).toBe(false);
    expect(lastKitChange(dir)!.at).toBe(kitStep); // copying wrote nothing into the block

    // a later change to the shared block shows on every copy, and unlinking takes it as it is now
    kitWrite(dir, 'blocks', 'nav', '<nav>shared, third version</nav>');
    for (const p of ['copied', 'used', 'like', 'twin']) expect(pageWorkspace(dir, p).page(), p).toContain('shared, third version');
    unlinkBlock(pageWorkspace(dir, 'like'), 'nav');
    expect(pageWorkspace(dir, 'like').ownContent('nav')?.trim()).toBe('<nav>shared, third version</nav>');
    expect(kitRead(dir, 'blocks', 'nav')).toBe('<nav>shared, third version</nav>');
  });

  it('make a new page like another: its header, footer and theme, one section between', () => {
    const dir = tmp();
    const home = newSitePage(dir, 'home', 'launch', 'studio', { shared: false }); // its own navigation, with its own logo
    home.store.write('assets/logo.png', new Uint8Array([1, 2, 3]));
    home.setContent('nav', home.content('nav')!.replace('Site name', '<img src="assets/logo.png" alt="">Bakery'), 'user');
    const about = newPageLike(dir, 'about', 'home');
    const l = about.load();
    expect((l.root as any).children.map((c: any) => c.id)).toEqual(['nav', 'main', 'footer']);
    expect(about.content('nav')).toContain('Bakery');
    expect(about.content('footer')).toBe(home.content('footer'));
    expect(about.content('main')).toContain('A section title');
    expect(about.store.exists('assets/logo.png')).toBe(true);
    expect(about.store.exists('.history.jsonl')).toBe(false);
    expect(about.page()).toContain('data-tykerf-theme'); // the site's theme
    // a page without a header and a footer is copied whole
    const odd = new Workspace(join(dir, 'odd'));
    odd.create('a b V', { a: '<p>A</p>' });
    expect(newPageLike(dir, 'odd2', 'odd').content('a')).toContain('A');
    expect(() => newPageLike(dir, 'home', 'odd')).toThrow(/already/);
  });

  it('refuse page names that are bad, reserved or taken', () => {
    const dir = tmp();
    newSitePage(dir, 'home');
    expect(pageNameError(dir, 'about-us')).toBeNull();
    for (const bad of ['About', '-x', 'a b', '../x', '', 'x'.repeat(64)]) expect(pageNameError(dir, bad), bad).toMatch(/can't be a page name/);
    for (const tykerf of ['_tykerf', 'assets', 'out']) expect(pageNameError(dir, tykerf), tykerf).toMatch(/can't be a page name|used by TYKERF/);
    expect(pageNameError(dir, 'home')).toMatch(/already/);
    expect(() => newSitePage(dir, 'home')).toThrow(/already/);
    expect(() => newSitePage(dir, 'x', 'nope')).toThrow(/unknown layout/);
    expect(sitePages(dir)).toEqual(['home']);
  });

  it('tell links between pages from other addresses', () => {
    expect(linkedPage('/about')).toBe('about');
    expect(linkedPage('/about/')).toBe('about');
    expect(linkedPage('/about/team#x')).toBe('about');
    expect(linkedPage('/about#x')).toBe('about');
    expect(linkedPage('/about?q=1')).toBe('about');
    for (const other of ['about/', 'https://x.com/about/', '#about', '//cdn.example/x', '/About/', '/aboutx.html']) expect(linkedPage(other), other).not.toBe('about');
  });

  it('rename a page, and links to it in every page follow, as one undo step per page', () => {
    const dir = tmp();
    const home = newSitePage(dir, 'home');
    newSitePage(dir, 'about');
    newSitePage(dir, 'aboutx');
    const box = home.boxIds()[0] ?? home.load().root.id;
    home.setContent(box, '<a href="/about/">a</a> <a href=\'/about#team\'>b</a> <a href="/aboutx/">c</a> <a href="/about/x">d</a>', 'user');
    home.setHead(home.head() + '<link rel="next" href="/about/">\n', 'user');
    expect(renamePage(dir, 'about', 'company')).toEqual({ links: 4 });
    expect(sitePages(dir)).toEqual(['aboutx', 'company', 'home']);
    expect(home.content(box)!.trim()).toBe('<a href="/company/">a</a> <a href=\'/company#team\'>b</a> <a href="/aboutx/">c</a> <a href="/company/x">d</a>');
    expect(home.head()).toContain('href="/company/"');
    expect(home.history(1)[0].label).toBe('links follow page about → company');
    home.undo();
    expect(home.content(box)).toContain('href="/about/"');
    expect(home.head()).toContain('href="/about/"');
    expect(() => renamePage(dir, 'company', 'home')).toThrow(/already/);
    expect(() => renamePage(dir, 'company', 'Bad')).toThrow(/can't be a page name/);
    expect(() => renamePage(dir, 'nope', 'x')).toThrow(/no page "nope"/);
  });

  it('remove a page into .trash and list the links that now point nowhere', () => {
    const dir = tmp();
    const home = newSitePage(dir, 'home');
    newSitePage(dir, 'about');
    const box = home.boxIds()[0] ?? home.load().root.id;
    home.setContent(box, '<a href="/about/">a</a> <a href="/home/">b</a>', 'user');
    expect(pageLinks(dir).map((l) => [l.page, l.to, l.broken])).toEqual([['home', 'about', false], ['home', 'home', false]]);
    const r = removePage(dir, 'about');
    expect(r.broken).toBe(1);
    expect(existsSync(join(dir, 'about'))).toBe(false);
    expect(readdirSync(join(dir, '.trash'))).toHaveLength(1);
    expect(new Workspace(join(dir, r.trash)).exists()).toBe(true);
    expect(sitePages(dir)).toEqual(['home']);
    expect(pageLinks(dir).filter((l) => l.broken).map((l) => l.href)).toEqual(['/about/']);
  });

  it("let the AI of a site's only page change the site theme, and of a page among others only its own values; export it with its fonts", async () => {
    const dir = tmp();
    const home = newSitePage(dir, 'home', 'launch', 'product');
    const { openTools } = await import('../src/editor/tools-client.js');
    let tools = await openTools(home, home.load().root.id);
    expect((await tools.call('get_theme', {})).text).toMatch(/every page of the site shares; this is the site's only page[\s\S]*--color-accent: #2d5bff/);
    // the first page of a new site (Kaity building it from a design): its theme is the site's
    let set = await tools.call('set_theme', { changes: [{ name: '--font-heading', value: '"Playfair Display", Georgia, serif' }] });
    expect(set.text).toMatch(/^site theme changed/);
    expect(siteHead(dir)).toContain('--font-heading: "Playfair Display", Georgia, serif;');
    expect(siteHead(dir)).toContain('url("/assets/playfair-display-latin-wght-normal.woff2")'); // the font comes along
    expect(existsSync(join(dir, 'assets', 'playfair-display-latin-wght-normal.woff2'))).toBe(true);
    expect(home.head()).not.toContain('Playfair');
    // tags as the descriptions write them, with #
    expect((await tools.call('tag', { id: 'faq', tag: '#tone-alt' })).isError).toBeFalsy();
    expect((home.load().root as any).children.find((c: any) => c.id === 'faq')).toMatchObject({ tags: expect.arrayContaining(['tone-alt']) });
    expect((await tools.call('untag', { id: 'faq', tag: '#tone-alt' })).isError).toBeFalsy();
    // split: the names alone say how many blocks; a wrong count says what it needs
    expect((await tools.call('split', { leaf: 'cta', kind: 'column', names: ['cta2', 'cta3'] })).isError).toBeFalsy();
    expect((home.load().root as any).children.some((c: any) => c.children?.map((x: any) => x.id).join() === 'cta,cta2,cta3')).toBe(true);
    const bad = await tools.call('split', { leaf: 'faq', kind: 'column', n: 3, names: ['a', 'b', 'c'] });
    expect(bad.text).toMatch(/split into 3 blocks keeps "faq" as the first and makes 2 new ones, so it needs 2 new names, not 3/);
    await tools.close();

    // with a second page, one page's AI changes only that page
    const about = newSitePage(dir, 'about', 'launch');
    tools = await openTools(about, about.load().root.id);
    set = await tools.call('set_theme', { changes: [{ name: '--color-accent', value: '#ff0000' }, { name: '--color-text', value: '#0b0e16' }] });
    expect(set.text).toMatch(/^this page's own theme values changed/);
    expect(set.text).toContain('--color-accent: #2d5bff -> #ff0000');
    expect(set.text).not.toContain('--color-text'); // already the site's value
    const { readOverrides } = await import('../src/library.js');
    expect(readOverrides(about.head())).toEqual({ '--color-accent': '#ff0000' });
    expect(siteHead(dir)).toContain('--color-accent: #2d5bff');
    expect((await tools.call('undo', {})).text).toMatch(/theme: --color-accent #ff0000/);
    expect(readOverrides(about.head())).toEqual({});
    await tools.close();
    removePage(dir, 'about');
    const { exportFiles } = await import('../src/export.js');
    const { files } = exportFiles(dir);
    expect(files.some((f) => f.path === 'assets/inter-latin-wght-normal.woff2')).toBe(true);
    const html = new TextDecoder().decode(files.find((f) => f.path === 'home/index.html')!.bytes);
    expect(html).toContain('url("../assets/inter-latin-wght-normal.woff2")');
    expect(html).toContain('--color-accent: #2d5bff');
  });

  it("let a page set some theme values for itself over the site theme", async () => {
    const dir = tmp();
    newSitePage(dir, 'home', 'launch', 'studio');
    const about = newSitePage(dir, 'about', 'launch');
    const { readOverrides, withOverrides, themeFonts } = await import('../src/library.js');
    about.setHead(withOverrides(about.head(), { '--color-accent': '#c2185b', '--font-heading': '"Manrope", sans-serif' }), 'user');
    expect(readOverrides(about.head())).toEqual({ '--color-accent': '#c2185b', '--font-heading': '"Manrope", sans-serif' });
    expect(themeFonts(about.head())).toEqual(['Manrope']);
    // the page's own values come after the site's theme, so they win; the other pages keep the site's
    const html = about.page();
    expect(html.indexOf('data-tykerf-override')).toBeGreaterThan(html.indexOf('data-tykerf-theme'));
    expect(pageWorkspace(dir, 'home').page()).not.toContain('#c2185b');
    expect(() => withOverrides('', { '--color-accent': 'url(x)' })).toThrow(/not allowed/);
    expect(withOverrides(about.head(), {})).not.toContain('data-tykerf-override');
    const { openTools } = await import('../src/editor/tools-client.js');
    const tools = await openTools(about, about.load().root.id);
    expect((await tools.call('get_theme', {})).text).toMatch(/this page's own values for --color-accent[\s\S]*--color-accent: #c2185b/);
    await tools.close();
  });

  it("remember the preset a theme was made from", async () => {
    const { themePreset, withPresetName } = await import('../src/library.js');
    const dir = tmp();
    newSitePage(dir, 'home', 'launch', 'gallery');
    expect(themePreset(siteHead(dir))).toBe('gallery');
    const lone = new Workspace(join(tmp(), 'p'));
    createPage(lone, 'blank', 'dark');
    expect(themePreset(lone.head())).toBe('dark');
    createPage(new Workspace(join(dir, 'base')), 'blank'); // the base theme: no preset to remember
    expect(themePreset(new Workspace(join(dir, 'base')).head())).toBeNull();
    expect(themePreset(withPresetName(lone.head(), 'studio'))).toBe('studio');
    expect(themePreset(withPresetName(lone.head(), null))).toBeNull();
  });
});

describe('a page like another page of the site', () => {
  it('takes its blocks, code, types and images in one undo step, and keeps its own theme unless asked', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tykerf-use-page-'));
    const rome = new Workspace(join(dir, 'rome'));
    createPage(rome, 'factual', 'warm');
    rome.setContent('intro', '<h1>Rome</h1><img src="assets/forum.png" alt="The Forum">', 'user');
    rome.store.write('assets/forum.png', new Uint8Array([137, 80, 78, 71]));
    rome.store.write('types/note.json', '{}');
    const munich = new Workspace(join(dir, 'munich'));
    createPage(munich, 'blank', 'studio');
    const head = munich.head();
    const boxes = munich.boxIds().sort();

    usePage(munich, dir, 'rome');
    expect(munich.load().root.id).toBe('page');
    expect(munich.boxIds().sort()).toEqual(rome.boxIds().sort());
    expect(munich.content('intro')).toBe(rome.content('intro'));
    expect(munich.content('intro')).toContain('<h1>Rome</h1>');
    expect(munich.store.exists('assets/forum.png')).toBe(true);
    expect(munich.store.exists('types/note.json')).toBe(true);
    expect(munich.head()).toBe(head); // its own theme stays
    expect(munich.undo()).toBe('use page rome');
    expect(munich.boxIds().sort()).toEqual(boxes);

    usePage(munich, dir, 'rome', { theme: true });
    expect(munich.head()).toContain('data-tykerf-preset="warm"');
    expect(() => usePage(munich, dir, 'munich')).toThrow(/this is the page "munich" itself/);
    expect(() => usePage(munich, dir, 'paris')).toThrow(/no page "paris" in the site \(pages: munich, rome\)/);
  });
});

describe("the site's trash", () => {
  it('lists the removed pages, the latest first, and empties for good', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tykerf-trash-'));
    for (const name of ['rome', 'munich', 'kk']) createPage(new Workspace(join(dir, name)), 'blank');
    expect(trashedPages(dir)).toEqual([]);
    removePage(dir, 'rome');
    removePage(dir, 'kk');
    const listed = trashedPages(dir);
    expect(listed.map((p) => p.page)).toEqual(['kk', 'rome']);
    expect(listed[0].removed).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(existsSync(join(dir, '.trash', listed[0].folder, 'layout.slice'))).toBe(true);
    expect(emptyTrash(dir)).toBe(2);
    expect(existsSync(join(dir, '.trash'))).toBe(false);
    expect(sitePages(dir)).toEqual(['munich']);
  });
});

describe("the site's settings", () => {
  it('keep a home page and titles that follow renames and removals, and never point at a page that is gone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tykerf-settings-'));
    for (const name of ['rome', 'munich']) createPage(new Workspace(join(dir, name)), 'blank');
    expect(readSite(dir)).toEqual({ version: 1, titles: {}, lang: 'en' });
    expect(existsSync(join(dir, 'site.json'))).toBe(false); // nothing written until something is set

    // a title: set by hand, else the page's first heading, else its name
    new Workspace(join(dir, 'rome')).setContent('text', '<h1>Rome, <em>the eternal</em> city</h1>', 'user');
    expect(pageTitle(dir, 'rome')).toBe('Rome, the eternal city');
    expect(pageTitle(dir, 'munich')).toBe('munich');
    setTitle(dir, 'munich', '  Munich  in  autumn ');
    expect(pageTitle(dir, 'munich')).toBe('Munich in autumn');
    expect(() => setTitle(dir, 'paris', 'x')).toThrow(/no page "paris"/);

    setHome(dir, 'munich');
    renamePage(dir, 'munich', 'muenchen');
    expect(readSite(dir)).toEqual({ version: 1, home: 'muenchen', titles: { muenchen: 'Munich in autumn' }, lang: 'en' });
    removePage(dir, 'muenchen');
    expect(readSite(dir)).toEqual({ version: 1, titles: {}, lang: 'en' });
    setTitle(dir, 'rome', '');
    expect(pageTitle(dir, 'rome')).toBe('Rome, the eternal city');
    // the site's own addresses can't be page names
    expect(pageNameError(dir, 'pages')).toMatch(/used by TYKERF itself/);
  });
});

describe("the site's language", () => {
  it('is in site.json, checked, English by default, and every page and the list of pages say it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tykerf-lang-'));
    newSitePage(dir, 'home', 'launch', 'studio');
    expect(readSite(dir).lang).toBe('en');
    expect(pageWorkspace(dir, 'home').page()).toMatch(/^<!doctype html>\n<html lang="en">/);
    setLang(dir, 'es');
    expect(readSite(dir).lang).toBe('es');
    expect(JSON.parse(readFileSync(join(dir, 'site.json'), 'utf8')).lang).toBe('es');
    expect(pageWorkspace(dir, 'home').page()).toMatch(/^<!doctype html>\n<html lang="es">/);
    expect(siteIndex(dir)).toContain('<html lang="es">');
    setLang(dir, 'pt-BR');
    expect(readSite(dir).lang).toBe('pt-BR');
    for (const bad of ['Spanish', 'ES', 'e', 'es_ES', 'es-', 'en"><script>']) expect(() => setLang(dir, bad), bad).toThrow(/not a language tag/);
    expect(readSite(dir).lang).toBe('pt-BR');
    setLang(dir, ''); // back to English, which site.json doesn't write
    expect(readSite(dir).lang).toBe('en');
    expect(JSON.parse(readFileSync(join(dir, 'site.json'), 'utf8'))).not.toHaveProperty('lang');
    // a broken site.json value is English
    writeFileSync(join(dir, 'site.json'), JSON.stringify({ version: 1, titles: {}, lang: '"><b>' }));
    expect(readSite(dir).lang).toBe('en');
    // as web pages write it
    expect([langTag('ES_es'), langTag(' pt-BR '), langTag('English'), langTag('')]).toEqual(['es-es', 'pt-BR', null, null]);
  });

  it('is set by Kaity on a run over the site (set_site), and only there', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tykerf-lang-'));
    newSitePage(dir, 'home', 'launch', 'studio');
    const { openTools } = await import('../src/editor/tools-client.js');
    const site = await openTools(pageWorkspace(dir, 'home'), '', dir);
    expect((await site.call('set_site', { lang: 'es' })).text).toBe('ok: the site\'s lang is "es"; every page follows it');
    expect((await site.call('set_site', { lang: 'Spanish' })).text).toMatch(/not a language tag/);
    expect((await site.call('set_site', {})).text).toMatch(/nothing to change: give lang/);
    await site.close();
    expect(readSite(dir).lang).toBe('es');
    const block = await openTools(pageWorkspace(dir, 'home'), 'hero');
    expect((await block.call('set_site', { lang: 'en' })).text).toMatch(/not found|unknown tool|error/i);
    await block.close();
    expect(readSite(dir).lang).toBe('es');
  });
});

describe("a page's title", () => {
  // three pages under one shared banner with a heading: news, about, and one without a heading of its own
  const site = () => {
    const dir = mkdtempSync(join(tmpdir(), 'tykerf-titles-'));
    const own: Record<string, string> = { news: '<h1>Latest news</h1>', about: '<h1>About <em>us</em></h1>', plain: '<p>No heading here</p>' };
    for (const [name, intro] of Object.entries(own)) new Workspace(join(dir, name)).create('banner intro H', { banner: '<header><h1>News</h1></header>', intro });
    shareBlock(dir, pageWorkspace(dir, 'news'), 'banner');
    for (const p of ['about', 'plain']) linkBlock(dir, pageWorkspace(dir, p), 'banner', 'banner');
    return dir;
  };

  it("comes from the page's own first heading, never from a shared block's", () => {
    const dir = site();
    expect(pageTitle(dir, 'news')).toBe('Latest news');
    expect(pageTitle(dir, 'about')).toBe('About us');
    expect(pageTitle(dir, 'plain')).toBe('plain');
  });

  it('is reported when it is the same as another page\'s, until one is set by hand', () => {
    const dir = site();
    new Workspace(join(dir, 'team')).create('banner intro H', { banner: '', intro: '<h1>About us</h1>' }); // a copy of about
    linkBlock(dir, pageWorkspace(dir, 'team'), 'banner', 'banner');
    const titles = (p: string) => leftovers(pageWorkspace(dir, p)).filter((l) => l.kind === 'title').map(say);
    expect(titles('team')).toEqual(['team: its title "About us" is the same as about\'s; give it a title of its own (set_title)']);
    expect(titles('about')).toEqual(['about: its title "About us" is the same as team\'s; give it a title of its own (set_title)']);
    expect(titles('news')).toEqual([]);
    // only on the whole page, not in one block
    expect(leftovers(pageWorkspace(dir, 'team'), { within: 'intro' }).filter((l) => l.kind === 'title')).toEqual([]);
    setTitle(dir, 'team', 'Our team');
    expect(titles('team')).toEqual([]);
    expect(titles('about')).toEqual([]);
  });

  it('is set by Kaity with set_title, on the open page or another, and not from inside a block', async () => {
    const dir = site();
    const { openTools } = await import('../src/editor/tools-client.js');
    const run = await openTools(pageWorkspace(dir, 'plain'), '');
    expect((await run.call('set_title', { title: 'Plain and simple' })).text).toBe('ok: "plain" is titled "Plain and simple"');
    expect((await run.call('set_title', { page: 'about', title: 'Who we are' })).text).toBe('ok: "about" is titled "Who we are"');
    expect(readSite(dir).titles).toEqual({ plain: 'Plain and simple', about: 'Who we are' });
    expect((await run.call('set_title', { page: 'about', title: '' })).text).toBe('ok: "about" is titled by its first heading again: "About us"');
    expect((await run.call('set_title', { page: 'paris', title: 'x' })).text).toMatch(/no page "paris"/);
    await run.close();

    const scoped = await openTools(pageWorkspace(dir, 'plain'), 'intro');
    expect((await scoped.call('set_title', { title: 'No' })).text).toMatch(/refused: the title is the whole page's, and the scope is "intro"/);
    await scoped.close();
    const root = pageWorkspace(dir, 'plain').load().root.id;
    const whole = await openTools(pageWorkspace(dir, 'plain'), root);
    expect((await whole.call('set_title', { title: 'Plain' })).text).toBe('ok: "plain" is titled "Plain"');
    expect((await whole.call('set_title', { page: 'news', title: 'x' })).text).toMatch(/refused: this run works on the page "plain"/);
    await whole.close();

    // the site's list of pages says where each title comes from
    const site_ = await openTools(pageWorkspace(dir, 'plain'), '', dir);
    expect((await site_.call('list_pages', {})).text.split('\n').slice(1)).toEqual([
      'about: "About us" (from its first heading)', 'news: "Latest news" (from its first heading)', 'plain (open): "Plain" (set by hand)',
    ]);
    await site_.close();
  });
});

describe("the site's one history", () => {
  it('undoes changes to the head, the kit and the settings in the order they came, and redoes them', () => {
    const dir = tmp();
    newSitePage(dir, 'home', 'blank', 'studio');
    newSitePage(dir, 'about', 'blank', 'studio');
    const site = new Site(dir);
    expect(site.steps().map((s) => s.label)).toEqual(['share nav with every page', 'make home the home page', 'site theme studio']);
    setSiteCode(dir, '<meta name="a" content="1">');
    kitWrite(dir, 'styles', 'base', 'h2 { color: red }', undefined, 'ai');
    setTitle(dir, 'about', 'About us');
    setLang(dir, 'es');
    expect(site.steps(4).map((s) => [s.kind, s.label, s.author])).toEqual([
      ['settings', "the site's language: es", 'user'], ['settings', 'title of about: About us', 'user'],
      ['kit', 'add kit/styles/base.css', 'ai'], ['head', 'edit the head code of every page', 'user'],
    ]);
    expect(site.undo()).toBe("the site's language: es");
    expect(readSite(dir).lang).toBe('en');
    expect(site.undo()).toBe('title of about: About us');
    expect(readSite(dir).titles).toEqual({});
    expect(site.undo()).toBe('add kit/styles/base.css');
    expect(existsSync(join(dir, 'kit', 'styles', 'base.css'))).toBe(false);
    expect(site.undo()).toBe('edit the head code of every page');
    expect(siteCode(dir)).toBe('');
    expect(site.history.peekRedo()).toMatchObject({ label: 'edit the head code of every page', kind: 'head' });
    expect(site.redo()).toBe('edit the head code of every page');
    expect(site.redo()).toBe('add kit/styles/base.css');
    expect(kitRead(dir, 'styles', 'base')).toBe('h2 { color: red }');
    // a new change ends what there was to redo
    setHome(dir, 'about');
    expect(site.history.peekRedo()).toBeNull();
    expect(() => site.redo()).toThrow(/no change to the site to redo/);
    // the old names undo the same one history
    expect(undoSiteHead(dir)).toBe('make about the home page');
    expect(readSite(dir).home).toBe('home');
  });

  it('makes several changes one step with a group, undone whole, and rolled back whole when it fails', () => {
    const dir = tmp();
    newSitePage(dir, 'home', 'blank', 'studio');
    const site = new Site(dir);
    const before = site.steps().length;
    site.group('dress the site', 'ai', () => {
      kitWrite(dir, 'styles', 'base', 'h2 { color: red }', undefined, 'ai');
      setTitle(dir, 'home', 'Welcome', 'ai');
      setSiteCode(dir, '<meta name="b" content="2">');
    });
    expect(site.steps()).toHaveLength(before + 1);
    expect(site.history.peekUndo()).toMatchObject({ label: 'dress the site', kind: 'group', author: 'ai', kinds: ['kit', 'settings', 'head'] });
    expect(site.undo()).toBe('dress the site');
    expect([existsSync(join(dir, 'kit', 'styles', 'base.css')), readSite(dir).titles, siteCode(dir)]).toEqual([false, {}, '']);
    expect(site.redo()).toBe('dress the site');
    expect([kitRead(dir, 'styles', 'base'), readSite(dir).titles.home, siteCode(dir)]).toEqual(['h2 { color: red }', 'Welcome', '<meta name="b" content="2">']);

    expect(() => site.group('half done', 'ai', () => {
      kitWrite(dir, 'styles', 'other', '.x{}');
      setLang(dir, 'fr');
      setTitle(dir, 'nowhere', 'x'); // throws: no such page
    })).toThrow(/no page "nowhere"/);
    expect(existsSync(join(dir, 'kit', 'styles', 'other.css'))).toBe(false);
    expect(readSite(dir).lang).toBe('en');
    expect(site.history.peekUndo()?.label).toBe('dress the site');
    expect(site.history.peekRedo()).toBeNull();
  });

  it('folds the two histories of older sites into one, in time order, once', () => {
    const dir = tmp();
    newSitePage(dir, 'home', 'blank', 'studio');
    // an older site: the head's history and the kit's, apart; no site.jsonl yet
    const store = new Site(dir).store;
    store.remove('.tykerf/site.jsonl');
    store.write('kit/styles/base.css', 'h2 { color: blue }');
    store.write('.tykerf/site-head.jsonl', [
      { label: 'site theme studio', at: '2026-01-01T10:00:00.000Z', prev: null },
      { label: 'edit the site theme', at: '2026-01-01T10:02:00.000Z', prev: '<style>old</style>' },
    ].map((e) => JSON.stringify(e) + '\n').join(''));
    store.write('.tykerf/kit.jsonl', [
      { path: 'kit/styles/base.css', prev: null, label: 'add kit/styles/base.css', author: 'ai', at: '2026-01-01T10:01:00.000Z' },
      { path: 'kit/styles/base.css', prev: 'h2 { color: red }', label: 'edit kit/styles/base.css', author: 'user', at: '2026-01-01T10:03:00.000Z' },
    ].map((e) => JSON.stringify(e) + '\n').join(''));
    const site = new Site(dir);
    expect(site.steps().map((s) => [s.kind, s.label, s.author])).toEqual([
      ['kit', 'edit kit/styles/base.css', 'user'], ['head', 'edit the site theme', 'user'],
      ['kit', 'add kit/styles/base.css', 'ai'], ['head', 'site theme studio', 'user'],
    ]);
    expect(existsSync(join(dir, '.tykerf', 'site-head.jsonl')) || existsSync(join(dir, '.tykerf', 'kit.jsonl'))).toBe(false);
    expect(site.undo()).toBe('edit kit/styles/base.css');
    expect(kitRead(dir, 'styles', 'base')).toBe('h2 { color: red }');
    expect(site.undo()).toBe('edit the site theme');
    expect(siteHead(dir)).toBe('<style>old</style>');
  });

  it('keeps undo of the settings right after a page is renamed', () => {
    const dir = tmp();
    newSitePage(dir, 'home', 'blank', 'studio');
    newSitePage(dir, 'about', 'blank', 'studio');
    setTitle(dir, 'about', 'About us');
    setHome(dir, 'about');
    renamePage(dir, 'about', 'team'); // follows in the settings, as no step of its own
    expect(readSite(dir)).toMatchObject({ home: 'team', titles: { team: 'About us' } });
    const site = new Site(dir);
    expect(site.undo()).toBe('make about the home page');
    expect(readSite(dir)).toMatchObject({ home: 'home', titles: { team: 'About us' } });
    expect(site.undo()).toBe('title of about: About us');
    expect(readSite(dir).titles).toEqual({});
    site.redo();
    expect(readSite(dir).titles).toEqual({ team: 'About us' });
  });
});

describe("the site's head code", () => {
  it('refuses a new style, and moves the styles an older site has to the kit, in one step undo takes back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tykerf-head-styles-'));
    newSitePage(dir, 'home', 'blank', 'warm');
    expect(() => setSiteCode(dir, '<style>.a { color: red }</style>')).toThrow(/styles for every page go in the site kit \(kit\/styles\)/);
    setSiteCode(dir, '<link rel="stylesheet" href="/assets/extra.css">'); // a stylesheet link may stay
    // an older site: styles in its head code, written before the rule
    const head = siteHead(dir);
    const old = '<meta name="theme-color" content="#123456">\n<style>.a { color: red }</style>\n<style media="print">nav { display: none }</style>';
    setSiteHead(dir, head.replace('<link rel="stylesheet" href="/assets/extra.css">', old));
    expect(headStyles(dir)).toHaveLength(2);
    setSiteCode(dir, siteCode(dir) + '\n<meta name="b" content="2">'); // keeping its styles is fine
    kitWrite(dir, 'styles', 'head', '.before { margin: 0 }');
    const kitBefore = kitRead(dir, 'styles', 'head'), headBefore = siteHead(dir);

    expect(migrateHeadStyles(dir)).toBe(2);
    expect(siteCode(dir)).toBe('<meta name="theme-color" content="#123456">\n<meta name="b" content="2">');
    expect(kitRead(dir, 'styles', 'head')).toBe(".before { margin: 0 }\n\n/* from the site head's code */\n.a { color: red }\n\n/* from the site head's code: <style media=\"print\"> */\n@media print {\nnav { display: none }\n}\n");
    expect(siteHead(dir)).toContain('data-tykerf-preset="warm"'); // the theme stays
    expect(migrateHeadStyles(dir)).toBe(0);
    // one step back: both files as they were
    expect(new Site(dir).undo()).toBe('move 2 styles from the head code to the kit');
    expect([kitRead(dir, 'styles', 'head'), siteHead(dir)]).toEqual([kitBefore, headBefore]);
  });

  it('is the site head without its theme, which it never changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tykerf-code-'));
    newSitePage(dir, 'home', 'blank', 'warm'); // the first page starts the site's shared theme
    const theme = siteHead(dir);
    expect(siteCode(dir)).toBe('');
    setSiteCode(dir, '<meta name="theme-color" content="#123456">\n<script src="/assets/menu.js" defer></script>');
    expect(siteCode(dir)).toBe('<meta name="theme-color" content="#123456">\n<script src="/assets/menu.js" defer></script>');
    expect(siteHead(dir)).toContain('data-tykerf-preset="warm"');
    expect(siteHead(dir).startsWith(theme.trim())).toBe(true);
    expect(() => setSiteCode(dir, '<style data-tykerf-theme>:root{}</style>')).toThrow(/changed in the Page tab/);
    expect(undoSiteHead(dir)).toBe('edit the head code of every page');
    expect(siteCode(dir)).toBe('');
  });

  it('has an icon: made from the home page and the theme, or a file of its own, checked', () => {
    const dir = tmp();
    newSitePage(dir, 'rome', 'blank');
    newSitePage(dir, 'munich', 'blank');
    setHome(dir, 'munich');
    const accent = readTheme(siteHead(dir))['--color-accent'];
    expect(madeIcon(dir)).toContain(`fill="${/^#/.test(accent) ? accent : '#0A5475'}"`);
    expect(madeIcon(dir)).toMatch(/>M<\/text><\/svg>/);
    expect(iconLink(dir)).toBe('<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n');
    expect(pageWorkspace(dir, 'rome').page()).toContain('<link rel="icon" href="/favicon.svg"');
    // a file of its own
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]);
    setSiteIcon(dir, { type: 'image/png', bytes: png });
    expect(siteIcon(dir)).toMatchObject({ file: 'favicon.png', own: true });
    expect(iconLink(dir)).toBe('<link rel="icon" href="/favicon.png" type="image/png">\n');
    expect(() => setSiteIcon(dir, { type: 'image/png', bytes: new Uint8Array([1, 2, 3, 4]) })).toThrow(/not a PNG/);
    expect(() => setSiteIcon(dir, { type: 'image/svg+xml', bytes: new TextEncoder().encode('<svg onload="x()"></svg>') })).toThrow(/scripts/);
    expect(() => setSiteIcon(dir, { type: 'image/gif', bytes: png })).toThrow(/SVG, PNG or ICO/);
    setSiteIcon(dir, { type: 'image/svg+xml', bytes: new TextEncoder().encode('<svg viewBox="0 0 1 1"></svg>') });
    expect(readdirSync(dir).filter((f) => f.startsWith('favicon'))).toEqual(['favicon.svg']); // one icon at a time
    setSiteIcon(dir, null);
    expect(siteIcon(dir)).toMatchObject({ file: 'favicon.svg', own: false });
    expect(sitePages(dir)).toEqual(['munich', 'rome']); // icon files aren't pages
  });
});

describe('a new page from the command line', () => {
  const cli = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'new', ...args], { encoding: 'utf8', env: { ...process.env, TYKERF_DOTENV: 'off' } });

  it('finds a free name for a page of the site', () => {
    const dir = tmp();
    newSitePage(dir, 'biased', 'blank', 'studio');
    expect(freePageName(dir, 'biased')).toBe('biased-2');
    expect(freePageName(dir, 'Case Study!')).toBe('case-study');
    expect(freePageName(dir, 'assets')).toBe('assets-2'); // TYKERF's own folder names are never pages
  });

  it('adds the page to a site with a warning, instead of refusing or writing over the site', () => {
    const dir = tmp();
    newSitePage(dir, 'home', 'blank', 'warm');
    writeFileSync(join(dir, 'site.json'), '{"version":1,"titles":{}}');
    const r = cli(dir, 'biased', '--theme', 'biased');
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/^warning: .* is a site with 1 pages, so the new page was added to it as "biased"/);
    expect(sitePages(dir)).toEqual(['biased', 'home']);
    expect(siteKind(dir)).toBe('site');
    // the site shares the warm theme: the page gets the biased values as its own, the others keep theirs
    expect(r.stderr).toMatch(/given to "biased" as its own values/);
    expect(readOverrides(new Workspace(join(dir, 'biased')).head())['--color-text']).toBe('#16181d');
    expect(readTheme(siteHead(dir))['--color-text']).toBe(themes().find((t) => t.name === 'warm')!.values['--color-text']);
    // a site of page folders only isn't taken for an empty folder
    const bare = tmp();
    newSitePage(bare, 'home', 'blank', 'studio');
    expect(cli(bare, 'blank', '--name', 'home').stderr).toMatch(/added to it as "home-2" \("home" was taken\)/);
    expect(existsSync(join(bare, 'layout.slice'))).toBe(false);
  });

  it('still refuses a page, or a folder of other things', () => {
    const dir = tmp();
    newSitePage(dir, 'home', 'blank', 'studio');
    const page = cli(join(dir, 'home'), 'biased');
    expect([page.status, page.stderr]).toEqual([1, expect.stringMatching(new RegExp(`is a page; a new page there would replace it. Give its site \\(${dir}\\)`))]);
    const other = tmp();
    writeFileSync(join(other, 'notes.txt'), 'hello');
    const r = cli(other, 'biased');
    expect([r.status, r.stderr]).toEqual([1, expect.stringMatching(/holds other files.*such as .*biased/s)]);
    expect(readdirSync(other)).toEqual(['notes.txt']);
  });

  it('makes a site in an empty or new folder, with the page as its home', () => {
    const dir = join(tmp(), 'new');
    const r = cli(dir, 'biased', '--theme', 'biased');
    expect([r.status, r.stderr]).toEqual([0, '']);
    expect(siteKind(dir)).toBe('site');
    expect(sitePages(dir)).toEqual(['home']);
    expect(readSite(dir).home).toBe('home');
    expect(readTheme(siteHead(dir))['--color-text']).toBe('#16181d'); // the theme asked for is the site's, for its next pages too
    const named = join(tmp(), 'other');
    expect(cli(named, 'blank', '--name', 'welcome').status).toBe(0);
    expect([sitePages(named), readSite(named).home]).toEqual([['welcome'], 'welcome']);
  });
});
