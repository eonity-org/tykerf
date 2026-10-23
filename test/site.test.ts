import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { iconLink, madeIcon, setSiteIcon, siteIcon, lastSiteHeadChange, linkedPage, newPageLike, newSitePage, pageLinks, pageNameError, pageWorkspace, removePage, renamePage, setSiteHead, emptyTrash, pageTitle, readSite, setHome, setSiteCode, setTitle, shareTheme, siteCode, siteHead, siteKind, sitePages, trashedPages, undoSiteHead, usePage } from '../src/site.js';
import { NO_SITE_HEAD, Workspace } from '../src/workspace.js';
import { createPage, readTheme, themes } from '../src/library.js';

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

  it('make a new page like another: its header, footer and theme, one section between', () => {
    const dir = tmp();
    const home = newSitePage(dir, 'home', 'launch', 'studio');
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
    let set = await tools.call('set_theme', { values: { '--font-heading': '"Playfair Display", Georgia, serif' } });
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
    set = await tools.call('set_theme', { values: { '--color-accent': '#ff0000', '--color-text': '#0b0e16' } });
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
    expect(readSite(dir)).toEqual({ version: 1, titles: {} });
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
    expect(readSite(dir)).toEqual({ version: 1, home: 'muenchen', titles: { muenchen: 'Munich in autumn' } });
    removePage(dir, 'muenchen');
    expect(readSite(dir)).toEqual({ version: 1, titles: {} });
    setTitle(dir, 'rome', '');
    expect(pageTitle(dir, 'rome')).toBe('Rome, the eternal city');
    // the site's own addresses can't be page names
    expect(pageNameError(dir, 'pages')).toMatch(/used by TYKERF itself/);
  });
});

describe("the site's styles and scripts", () => {
  it('are the site head without its theme, which they never change', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tykerf-code-'));
    newSitePage(dir, 'home', 'blank', 'warm'); // the first page starts the site's shared theme
    const theme = siteHead(dir);
    expect(siteCode(dir)).toBe('');
    setSiteCode(dir, '<style>.t-note { color: red }</style>\n<script src="/assets/menu.js" defer></script>');
    expect(siteCode(dir)).toBe('<style>.t-note { color: red }</style>\n<script src="/assets/menu.js" defer></script>');
    expect(siteHead(dir)).toContain('data-tykerf-preset="warm"');
    expect(siteHead(dir).startsWith(theme.trim())).toBe(true);
    expect(() => setSiteCode(dir, '<style data-tykerf-theme>:root{}</style>')).toThrow(/changed in the Page tab/);
    expect(undoSiteHead(dir)).toBe('edit the styles and scripts of every page');
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
