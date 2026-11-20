// A site in the editor: New page for a new folder, the site's screens beside its sidebar (pages, trash, head code,
// icon, links, media, fonts, Kaity's work, the site's Undo), and the full editor's site features (the page list, the
// Site menu, the Page tab's theme presets, the link picker).

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { logEnd, logStart } from '../src/editor/kaity-log.js';
import { readTheme, themes } from '../src/library.js';
import { removePage, renamePage } from '../src/site.js';
import { kitWrite } from '../src/kit.js';
import { freePort } from './ports.js';

vi.setConfig({ testTimeout: 30_000 });

let browser: Browser;
let server: ChildProcess;
let site: string;
let url: string;
let page: Page;

const values = (name: string) => themes().find((t) => t.name === name)!.values;
const siteTheme = () => readTheme(readFileSync(join(site, 'head.html'), 'utf8'));

beforeAll(async () => {
  site = join(mkdtempSync(join(tmpdir(), 'tykerf-site-editor-')), 'my-site');
  const port = await freePort();
  server = spawn(process.execPath, ['--import', 'tsx', 'src/editor/server.ts', site, '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise<void>((ok, fail) => {
    server.stdout!.on('data', (d) => String(d).includes('TYKERF: http') && ok());
    server.on('exit', (c) => fail(new Error(`editor exited with ${c}`)));
  });
  url = `http://localhost:${port}/`;
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.setDefaultTimeout(10_000); // the site's screens read the whole site: under a full test run that takes a moment
  // the full editor's panel open where these tests use it; the preview frames are sandboxed and may not touch storage
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tykerf.on', 'true');
    } catch {}
  });
}, 60_000);
afterAll(async () => {
  await browser?.close();
  server?.kill();
});


const post = (path: string, data: unknown) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

describe('a new site', () => {
  it('starts on the Overview\'s first run, then New page: a kind of page in a frame, with a theme for the whole site', async () => {
    await page.goto(url);
    await page.waitForURL(`${url}_tykerf/edit/_site/`);
    await page.locator('.ostart[data-start="kind"]').click();
    await page.waitForURL(`${url}_tykerf/edit/_site/new?start=kind`);
    await page.locator('[data-purpose]').first().waitFor(); // the screen asks Kaity's status first, which may take a moment
    expect(await page.locator('[data-purpose]').count()).toBe(8); // the seven purposes, and Just the frame
    expect(await page.locator('[data-frame]').count()).toBe(3);
    expect(await page.locator('[data-theme]').count()).toBe(7); // no site theme yet: the seven offered presets
    await page.locator('[data-purpose="event"]').click();
    await page.locator('[data-theme="dark"]').click();
    expect(await page.locator('.pvframe').getAttribute('src')).toBe('/_tykerf/preview/basic+event/dark/?side=0');
    const preview = await browser.newPage();
    await preview.goto(`${url}_tykerf/preview/basic+event/dark/`);
    expect(await preview.locator('body').evaluate((b) => getComputedStyle(b).backgroundColor)).toBe('rgb(13, 17, 23)'); // #0d1117
    await preview.close();
  });

  it('creates the first page from them; its theme becomes the theme of the whole site', async () => {
    // the layout's navigation and footer become the site's, shared; the first page is the home page
    expect(await page.locator('#np-name2').inputValue()).toBe('home');
    await page.locator('[data-go="layout"]').click();
    await page.waitForURL(`${url}_tykerf/edit/home/`);
    expect(existsSync(join(site, 'kit', 'blocks', 'nav.html')) && existsSync(join(site, 'kit', 'blocks', 'footer.html'))).toBe(true);
    expect(readFileSync(join(site, 'home', 'layout.slice'), 'utf8')).toMatch(/nav\[[^\]]*use=nav/);
    expect(siteTheme()).toEqual(values('dark'));
    expect(existsSync(join(site, 'home', 'head.html'))).toBe(false);
    expect(await page.locator('.bar .crumb b').textContent()).toBe('home');
    await expect.poll(() => page.frameLocator('.frame').locator('body').evaluate((b) => getComputedStyle(b).backgroundColor)).toBe('rgb(13, 17, 23)');
  });

  it('refuses a page name that is taken, then adds a new page in the site theme', async () => {
    await page.goto(`${url}_tykerf/edit/_site/new?start=kind&from=home`);
    await page.locator('.pvframe').waitFor();
    expect(await page.locator('[data-theme="site"]').getAttribute('aria-pressed')).toBe('true'); // the site's theme first
    expect(await page.locator('.pvframe').getAttribute('src')).toBe('/_tykerf/preview/basic/site/?side=0'); // no kind chosen yet: the default frame, never launch
    await page.locator('#np-name2').fill('home');
    await page.locator('[data-go="layout"]').click();
    expect(await page.locator('.np-error').first().textContent()).toMatch(/already a page called home/);
    await page.locator('#np-name2').fill('about');
    await page.locator('[data-purpose="post"]').click();
    await page.locator('[data-go="layout"]').click();
    await page.waitForURL(`${url}_tykerf/edit/about/`);
    expect(existsSync(join(site, 'about', 'layout.slice'))).toBe(true);
    expect(existsSync(join(site, 'about', 'head.html'))).toBe(false);
    expect((await fetch(`${url}_tykerf/site`).then((r) => r.json())).pages).toEqual(['about', 'home']);
  });

  it('makes a new page like another one: same navigation, footer and theme', async () => {
    expect((await post('_tykerf/site/new', { name: 'team', like: 'home' })).ok).toBe(true);
    expect(readFileSync(join(site, 'team', 'layout.slice'), 'utf8')).toMatch(/nav\b.*main\b.*footer\b/s);
    // the site's navigation and footer are shared blocks: the copy shows them too, with no code of its own
    expect(readFileSync(join(site, 'team', 'layout.slice'), 'utf8')).toMatch(/footer\[[^\]]*use=footer/);
    expect(existsSync(join(site, 'team', 'boxes', 'footer.html'))).toBe(false);
  });

  it('shares one theme: a preset in any Page tab restyles every page, with its own undo', async () => {
    await page.goto(`${url}about/?tykerf=full-frame`);
    await page.locator('section.panel').waitFor();
    await page.locator('.work .tabs [data-tab="page"]').click();
    expect(await page.locator('.work .size-sec:not(.title-sec) .size-head').first().textContent()).toMatch(/^Site theme/);
    // the page's title comes first: from its first heading until one is set
    expect(await page.locator('.work .title-sec .size-head').textContent()).toMatch(/^Title \((from its first heading|none yet: its name stands in)\)/);
    await page.locator('.work .page-title').fill('About the studio');
    await page.locator('.work .page-title').press('Enter');
    await expect.poll(() => JSON.parse(readFileSync(join(site, 'site.json'), 'utf8')).titles.about).toBe('About the studio');
    await expect.poll(() => page.locator('.work .title-sec .size-head').textContent()).toBe('Title (set by hand)');
    await page.locator('.presets [data-preset="ivory"]').click();
    await expect.poll(() => siteTheme()).toEqual(values('ivory'));
    expect(existsSync(join(site, 'home', 'head.html'))).toBe(false); // no page changed
    await page.goto(`${url}about/?tykerf=full-frame`);
    await page.locator('.work .tabs [data-tab="page"]').click();
    await page.locator('[data-page="site-undo"]').click();
    await expect.poll(() => siteTheme()).toEqual(values('dark'));
  });

  it('says where the page\'s look comes from, and lets one page set its own values', async () => {
    await page.goto(`${url}about/?tykerf=full-frame`);
    await page.locator('section.panel').waitFor();
    await page.locator('.work .tabs [data-tab="page"]').click();
    expect(await page.locator('.theme-status').textContent()).toMatch(/^Inherited: this page uses the site theme/);
    await page.locator('.theme-scope [data-scope="page"]').click();
    // the tab draws itself again for this page only
    await expect.poll(() => page.locator('.work .size-sec:not(.title-sec) .size-head').first().textContent(), { timeout: 5000 }).toMatch(/^This page's theme/);
    await page.locator('.theme-var .origin').first().waitFor();
    expect(await page.locator('.theme-var .origin.mine').count()).toBe(0);
    // a preset for this page only: its values that differ from the site's become the page's own
    await page.locator('.presets [data-preset="ivory"]').click();
    const aboutHead = () => (existsSync(join(site, 'about', 'head.html')) ? readFileSync(join(site, 'about', 'head.html'), 'utf8') : '');
    await expect.poll(aboutHead, { timeout: 5000 }).toContain('data-tykerf-override');
    expect(siteTheme()).toEqual(values('dark')); // the site theme is untouched
    await page.goto(`${url}about/?tykerf=full-frame`);
    await page.locator('.work .tabs [data-tab="page"]').click();
    await expect.poll(() => page.locator('.theme-status').textContent(), { timeout: 5000 }).toMatch(/^Inherited from the site theme, with \d+ values of its own/);
    expect(await page.locator('.theme-scope [data-scope="page"]').getAttribute('aria-pressed')).toBe('true');
    await expect.poll(() => page.locator('.theme-var.mine').count(), { timeout: 5000 }).toBeGreaterThan(3);
    const bg = await page.locator('body').evaluate((b) => getComputedStyle(b).backgroundColor);
    expect(bg).toBe('rgb(250, 249, 245)'); // ivory's paper, on this page only
    // back to the site theme
    await page.locator('[data-page="reset-own"]').click();
    await expect.poll(aboutHead, { timeout: 5000 }).not.toContain('data-tykerf-override');
  });

  it('repairs a theme damaged by an older editor when a preset is chosen', async () => {
    // an older editor wrote the preset's values into the dark band's rules too
    const headFile = join(site, 'head.html');
    const damaged = readFileSync(headFile, 'utf8').replace('--color-text: var(--color-on-dark);', '--color-text: #141413;');
    writeFileSync(headFile, damaged);
    await page.goto(`${url}about/?tykerf=full-frame`);
    await page.locator('section.panel').waitFor();
    await page.locator('.work .tabs [data-tab="page"]').click();
    await page.locator('.theme-scope [data-scope="site"]').click();
    await page.locator('.presets [data-preset="natural"]').click();
    await expect.poll(() => siteTheme(), { timeout: 5000 }).toEqual(values('natural'));
    expect(readFileSync(headFile, 'utf8')).toContain('--color-text: var(--color-on-dark);');
  });

  it('remembers the preset a theme came from, says when it changed, and resets to it', async () => {
    // the site theme is Gallery now (the previous test chose it)
    await page.goto(`${url}about/?tykerf=full-frame`);
    await page.locator('section.panel').waitFor();
    await page.locator('.work .tabs [data-tab="page"]').click();
    await page.locator('.theme-scope [data-scope="site"]').click();
    await expect.poll(() => page.locator('.presets [data-preset="natural"]').getAttribute('aria-pressed'), { timeout: 5000 }).toBe('true');
    expect(await page.locator('[data-page="reset-preset"]').count()).toBe(0);
    // change one value
    await page.locator('.theme-var input[data-var="--color-accent"]').fill('#ff0000');
    await page.locator('[data-page="theme"]').click();
    await expect.poll(() => siteTheme()['--color-accent'], { timeout: 5000 }).toBe('#ff0000');
    await page.goto(`${url}about/?tykerf=full-frame`);
    await page.locator('.work .tabs [data-tab="page"]').click();
    await expect.poll(() => page.locator('.presets [data-preset="natural"] .changed').count(), { timeout: 5000 }).toBe(1);
    await page.locator('[data-page="reset-preset"]').click();
    await expect.poll(() => siteTheme(), { timeout: 5000 }).toEqual(values('natural'));
  });

  it('links to another page with the picker, and the link follows a rename of that page', async () => {
    await page.goto(`${url}home/?tykerf=full-frame`);
    await page.locator('section.panel').waitFor();
    // a box of home with a link written by hand, then a second one picked from the Text tab
    const box = (await fetch(`${url}home/_tykerf/state`).then((r) => r.json())).tree;
    const first = (function leaf(n: any): string { return n.kind === 'box' ? n.id : leaf(n.children[0]); })(box);
    const res = await post('home/_tykerf/box', { id: first, full: '<p><a href="/about/">About us</a> <a href="https://example.com">x</a></p>' });
    expect(res.ok).toBe(true);
    await page.goto(`${url}home/?tykerf=full-frame`);
    await page.locator('section.panel').waitFor();
    await page.locator('.tree [data-all="open"]').click();
    await page.locator(`.tree .item[data-id="${first}"]`).click();
    // a box opens on its Text tab; click it only if another tab was kept (the panel may still be moving)
    const textTab = page.locator('.work .tabs [data-tab="text"]');
    if ((await textTab.getAttribute('aria-selected')) !== 'true') await textTab.click();
    const pick = page.locator('.work select[data-link]').first();
    await pick.waitFor(); // the Text tab loads the box first
    await expect.poll(() => pick.locator('option').allTextContents()).toEqual(['Link to a page…', 'about', 'home', 'team']);

    // rename "about" from its card on the Overview: a tab open on it follows, and home's link points at the new name
    const tab = await browser.newPage();
    await tab.goto(`${url}_tykerf/edit/about/`);
    await tab.frameLocator('.frame').locator('[data-sw]').first().waitFor();
    await page.goto(`${url}_tykerf/edit/_site/`);
    await page.locator('.ocard[data-page="about"] [data-pact="name"]').click();
    await page.locator('.pform [name="to"]').fill('about-us');
    await page.locator('.pform [type="submit"]').click();
    await page.locator('.ocard[data-page="about-us"]').waitFor();
    await expect.poll(() => tab.url(), { timeout: 8000 }).toBe(`${url}_tykerf/edit/about-us/`);
    await tab.close();
    expect(existsSync(join(site, 'about'))).toBe(false);
    // (home's first box is the site's shared navigation: the link follows there, for every page)
    expect(await (await fetch(`${url}home/?tykerf=frame`)).text()).toContain('href="/about-us/"');
    expect((await fetch(`${url}about/`)).status).toBe(404);
    // the old address says what happened and lists the pages there are
    await page.goto(`${url}about/`);
    await expect.poll(() => page.locator('ul a').allTextContents()).toContain('about-us');
    expect(await page.locator('.where').textContent()).toBe('Nothing is at /about/.');
    await page.locator('ul a', { hasText: 'about-us' }).click();
    await page.waitForURL(`${url}_tykerf/edit/about-us/`);
  });

  it('refuses a bad new name, and removes a page into .trash', async () => {
    const r = await post('_tykerf/site/rename', { name: 'about-us', to: 'home' });
    expect(r.status).toBe(422);
    expect((await r.json()).error).toMatch(/already/);
    const foreign = await fetch(`${url}_tykerf/site/remove`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: JSON.stringify({ name: 'home' }) });
    expect(foreign.status).toBe(403);

    await page.goto(`${url}_tykerf/edit/_site/`);
    await page.locator('.ocard[data-page="about-us"] [data-pact="more"]').click();
    await page.locator('.ocard[data-page="about-us"] [data-pact="remove"]').click();
    // the link is in the shared navigation, so on every page that shows it
    expect(await page.locator('.pconfirm .hint').textContent()).toMatch(/2 links to it from home, team will point nowhere/);
    await page.locator('[data-pact="remove-yes"]').click();
    await expect.poll(() => page.locator('.ocard h3 a').allTextContents(), { timeout: 8000 }).toEqual(['home', 'team']);
    expect(await page.locator('.rail .rpage').allTextContents()).toEqual(['homeHome', 'team']);
    expect(existsSync(join(site, 'about-us'))).toBe(false);
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(join(site, '.trash'))[0]).toMatch(/^about-us-/);
    const links = await fetch(`${url}_tykerf/site/links`).then((x) => x.json());
    expect(links.links.filter((l: any) => l.broken).map((l: any) => `${l.page} ${l.href}`)).toEqual(['home /about-us/', 'team /about-us/']);
  });

  it('downloads the site as a zip with a short report', async () => {
    const r = await fetch(`${url}_tykerf/export.zip`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/zip');
    expect(r.headers.get('content-disposition')).toMatch(/^attachment; filename="my-site-\d{4}-\d{2}-\d{2}\.zip"$/);
    expect(JSON.parse(r.headers.get('x-tykerf-report')!)).toMatchObject({ pages: 2, broken: 2 }); // the shared navigation's link, on both pages
    const bytes = Buffer.from(await r.arrayBuffer());
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    // one page of the site, its link to another page reported; never a page that isn't there
    const one = await fetch(`${url}_tykerf/export.zip?page=home`);
    expect(one.headers.get('content-disposition')).toMatch(/filename="home-\d{4}-\d{2}-\d{2}\.zip"/);
    expect(JSON.parse(one.headers.get('x-tykerf-report')!)).toMatchObject({ pages: 1, broken: 1 });
    expect((await fetch(`${url}_tykerf/export/report?page=home`).then((x) => x.json())).report.pages).toEqual(['index']);
    for (const bad of ['nope', '..', '.trash']) expect((await fetch(`${url}_tykerf/export.zip?page=${bad}`)).status).toBe(404);
  });

  it('keeps only editing in the full editor\'s header: the pages, the site, export and Kaity status are the shell\'s', async () => {
    await page.goto(`${url}home/?tykerf=full-frame`);
    await page.locator('section.panel').waitFor();
    // the breadcrumb, Dim / Blur, Undo / Redo, Compact (R9)
    const head = page.locator('section.panel .head .head-tools');
    expect(await head.locator('button').evaluateAll((b) => b.map((x) => x.className || (x as HTMLElement).dataset.view))).toEqual(['dim', 'blur', 'undo', 'redo', 'minimize', 'closebtn']);
    for (const gone of ['.pagesw', '.sitebtn', '.backtasks', '.modesw', '.tabsbtn', '.copybtn', '.managebtn', '.taskpanel']) expect(await page.locator(gone).count()).toBe(0);
    // no Kaity tab: tasks are how she is asked
    await expect.poll(() => page.locator('.work .tabs [role=tab]').evaluateAll((b) => b.map((x) => (x as HTMLElement).dataset.tab)), { timeout: 10_000 }).toEqual(['blocks', 'page', 'size']);
    await page.locator('.work .tabs [data-tab="page"]').click();
    await page.locator('.head-code').waitFor();
    expect(await page.locator('[data-page^="export"]').count()).toBe(0);
    // export and Kaity status are on the site's screens
    await page.goto(`${url}_tykerf/edit/_site/publish?from=home`);
    await page.locator('a[href="/_tykerf/export.zip?page=home"]').waitFor();
  });

  it('in Edit mode, floats the v3 full editor, whole, over the page: one box with its tree, details and actions', async () => {
    // on its own, the full editor keeps its dark header
    await page.goto(`${url}home/?tykerf=full-frame`);
    await page.locator('section.panel').waitFor();
    const dark = await page.locator('section.panel .head').evaluate((h) => getComputedStyle(h).backgroundColor);
    expect(dark).toBe('rgb(10, 84, 117)');
    await post('_tykerf/site/new', { name: 'me', layout: 'basic+person' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${url}_tykerf/edit/me/?mode=full`);
    const fr = page.frameLocator('.frame');
    const inspector = page.locator('#tykerf-inspector');
    await inspector.locator('section.panel').waitFor();
    expect(await page.locator('.bar .modes [aria-current]').textContent()).toBe('Edit');
    // the widths stay in the top bar in Edit mode
    expect(await page.locator('.bar .widths button').allTextContents()).toEqual(['Desktop', '768', '375']);
    // the editor floats over the page in the shell's window: nothing in the page's frame, nothing docked beside it
    expect(await fr.locator('section.panel').count()).toBe(0);
    expect(await fr.locator('html').evaluate((h) => getComputedStyle(h).marginRight)).toBe('0px');
    expect(await page.locator('.stage').evaluate((s) => s.clientWidth)).toBeGreaterThanOrEqual(1080);
    expect(Math.round((await page.locator('.rail').boundingBox())!.width)).toBe(280);
    const float = page.locator('.ifloat');
    expect(await float.locator('#tykerf-inspector section.panel').count()).toBe(1);
    // one box, as in v3: its header (path, Dim/Blur, Compact, ×), the tree, the block's actions and details; no
    // Undo or Redo of its own (the top bar has the one Undo), and nothing drawn on the block
    for (const shown of ['.head .path', '.head-tools > .minimize', '.head-tools > .closebtn', '.tree', '.work .actions', '.work .tabs']) expect(await inspector.locator(shown).first().isVisible(), shown).toBe(true);
    for (const gone of ['.head-tools > .undo', '.head-tools > .redo']) expect(await inspector.locator(gone).first().isHidden(), gone).toBe(true);
    expect(await page.getByRole('button', { name: /^Undo|^Nothing to undo/ }).count()).toBe(1);
    expect(await fr.locator('.btool').count()).toBe(0);
    // the rail's tree has every block, as the inspector's path has them: intro inside its containers
    await page.locator('.rail [data-block="intro"]').click();
    await expect.poll(() => inspector.locator('.path').textContent()).toMatch(/^page\/(.+\/)?body\/intro$/);
    const path = (await inspector.locator('.path').textContent())!.split('/');
    const tree = await page.locator('.rail .tree [data-block]').evaluateAll((b) => b.map((x) => (x as HTMLElement).dataset.block));
    for (const id of path.slice(1)) expect(tree).toContain(id);
    for (let i = 2; i < path.length; i++) expect(await page.locator(`.rail .tree li:has(> .tline [data-block="${path[i - 1]}"]) [data-block="${path[i]}"]`).count()).toBe(1);
    // dragged by its header (where it is is remembered); the page's widths leave it at its own size; Compact
    const at = (await float.boundingBox())!;
    const brand = (await inspector.locator('.head .brand').boundingBox())!;
    await page.mouse.move(brand.x + 10, brand.y + 8);
    await page.mouse.down();
    await page.mouse.move(brand.x - 190, brand.y + 78, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => Math.round((await float.boundingBox())!.x)).toBe(Math.round(at.x - 200));
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem('tykerf.editor') ?? '{}')).x).toBe(Math.round(at.x - 200));
    await page.locator('.bar [data-device="phone"]').click();
    await expect.poll(() => page.locator('.frame').evaluate((f: HTMLIFrameElement) => f.contentWindow!.innerWidth)).toBe(375);
    expect(Math.round((await float.boundingBox())!.width)).toBe(Math.round(at.width));
    await page.locator('.bar [data-device="full"]').click();
    await inspector.locator('.head-tools > .minimize').click();
    await expect.poll(async () => (await float.boundingBox())!.height).toBeLessThan(80);
    await inspector.locator('.head-tools > .minimize').click();
    await expect.poll(async () => Math.round((await float.boundingBox())!.height)).toBe(Math.round(at.height));
    // its actions: move the block down, then up again
    const order = () => page.locator('.rail .tree li:has(> .tline [data-block="body"]) > ul > li > .tline [data-block]').evaluateAll((b) => b.map((x) => (x as HTMLElement).dataset.block));
    const was = await order();
    await inspector.locator('.work .actions [data-act="later"]').click();
    await expect.poll(order).not.toEqual(was);
    await inspector.locator('.work .actions [data-act="earlier"]').click();
    await expect.poll(order).toEqual(was);
    await inspector.locator('.work .tab-body textarea, .work .tab-body input').first().waitFor();
    // the editor's selection shows in the rail, and the rail's selects in the editor
    await page.locator('.rail [data-block="footer"]').click();
    await expect.poll(() => inspector.locator('.path [aria-current]').textContent()).toBe('footer');
    await inspector.locator('.path button').first().click();
    await expect.poll(() => page.locator('.rail .tree [aria-current]').count()).toBe(0);
    // a block is deleted from its actions, after asking
    await page.locator('.rail [data-block="contact"]').click();
    await inspector.locator('.work .actions [data-act="remove"]').click();
    await inspector.locator('.sheet:not([hidden])').waitFor();
    // with the rail folded the page takes the whole width; the editor stays
    await page.locator('.rail [data-rail="fold"]').click();
    expect(await float.isVisible()).toBe(true);
    await page.locator('.rail [data-rail="unfold"]').click();
    await page.evaluate(() => localStorage.removeItem('tykerf.editor'));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('about:blank'); // the page follows a removal: leave it first
    await post('_tykerf/site/remove', { name: 'me' });
  });

  it('tells which AI answers, never its key', async () => {
    const st = await fetch(`${url}_tykerf/ai/status`).then((r) => r.json());
    expect(st).toMatchObject({ ok: true, runner: 'claude-code', testable: true, running: [] });
    expect(typeof st.ready).toBe('boolean');
    expect(JSON.stringify(st)).not.toMatch(/key=|sk-/);
  });

  it('manages the pages from the Overview: names, copies, the trash, home and title; the head code and the site\'s Undo', async () => {
    await post('_tykerf/site/new', { name: 'notes', layout: 'blank' });
    await page.goto(`${url}_tykerf/edit/_site/`);
    const sb = page.locator('.screen');
    const rail = page.locator('.rail');
    const card = (name: string) => sb.locator(`.ocard[data-page="${name}"]`);
    await card('notes').waitFor();
    // a name that can't be one is refused; a good one renames the page
    const bad = await post('_tykerf/site/rename', { name: 'notes', to: 'Bad Name' });
    expect([bad.status, (await bad.json()).error]).toEqual([422, expect.stringMatching(/can't be a page name/)]);
    await card('notes').locator('[data-pact="name"]').click();
    await sb.locator('.pform [name=to]').fill('');
    await sb.locator('.pform [name=to]').pressSequentially('journal'); // real key presses
    await sb.locator('.pform [type=submit]').click();
    await card('journal').waitFor();
    expect(existsSync(join(site, 'journal', 'layout.slice'))).toBe(true);

    // a copy of a page, next to it, without its history
    await card('journal').locator('[data-pact="duplicate"]').click();
    await card('journal-copy').waitFor();
    expect(readFileSync(join(site, 'journal-copy', 'layout.slice'), 'utf8')).toBe(readFileSync(join(site, 'journal', 'layout.slice'), 'utf8'));
    expect(existsSync(join(site, 'journal-copy', '.history.jsonl'))).toBe(false);
    const again = await post('_tykerf/site/duplicate', { name: 'journal' }).then((r) => r.json());
    expect(again).toMatchObject({ ok: true, name: 'journal-copy-2', url: '/journal-copy-2/' });
    for (const n of ['journal-copy', 'journal-copy-2']) await post('_tykerf/site/remove', { name: n });
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); // coming back: the list looks again
    await expect.poll(() => rail.locator('.rpage').allTextContents(), { timeout: 5000 }).not.toContain('journal-copy');

    // ⋯ is a menu: Escape closes it, and so does a click elsewhere
    await card('journal').locator('[data-pact="more"]').click();
    await card('journal').locator('.pmore[role="menu"]').waitFor();
    await page.keyboard.press('Escape');
    expect(await card('journal').locator('.pmore').count()).toBe(0);
    expect(await card('journal').locator('[data-pact="more"]').evaluate((b) => b === document.activeElement)).toBe(true);
    await card('journal').locator('[data-pact="more"]').click();
    await sb.locator('h2').first().click();
    expect(await card('journal').locator('.pmore').count()).toBe(0);
    // removing asks first
    await card('journal').locator('[data-pact="more"]').click();
    await card('journal').locator('[data-pact="remove"]').click();
    expect(await sb.locator('.pconfirm p').first().textContent()).toBe("Remove journal? It goes to the site's trash, and links to it stop working.");
    expect(await sb.locator('.pconfirm .hint').textContent()).toBe('No other page links to it.');
    await sb.locator('[data-pact="remove-yes"]').click();
    await expect.poll(() => sb.locator('.ocard h3 a').allTextContents()).not.toContain('journal');
    expect(existsSync(join(site, 'journal'))).toBe(false);

    // removed pages wait in the trash, until it is emptied for good (asked first)
    await rail.locator('[data-screen="history"]').click();
    await expect.poll(() => page.locator('.trashsec li b').allTextContents()).toContain('journal');
    await page.locator('[data-h="empty"]').click();
    expect(await page.locator('.trashsec .confirm p').textContent()).toMatch(/for good\? This cannot be undone\./);
    await page.locator('[data-h="empty-yes"]').click();
    await page.locator('.trashsec').waitFor({ state: 'detached' });
    expect(existsSync(join(site, '.trash'))).toBe(false);

    // the home page (the site's first page, from the start), and a title set by hand
    await rail.locator('[data-screen="overview"]').click();
    await card('home').locator('.hometag').waitFor();
    await card('home').locator('[data-pact="name"]').click();
    await sb.locator('.pform [name=title]').fill('Our home');
    await sb.locator('.pform [type=submit]').click();
    await expect.poll(() => JSON.parse(readFileSync(join(site, 'site.json'), 'utf8'))).toMatchObject({ home: 'home', titles: { home: 'Our home' } });
    // the site's address opens the site manager's Overview for a person signed in (the home page in View mode and for
    // visitors); a page's address opens it in the editor; /pages/ lists them by title
    const front = await fetch(url, { redirect: 'manual' });
    expect([front.status, front.headers.get('location')]).toEqual([302, '/_tykerf/edit/_site/']);
    expect((await fetch(url, { redirect: 'manual', headers: { cookie: 'tykerf_view=1' } })).headers.get('location')).toBe('/home/');
    expect((await fetch(`${url}home/`, { redirect: 'manual' })).headers.get('location')).toBe('/_tykerf/edit/home/');
    expect((await fetch(`${url}_tykerf/site/`, { redirect: 'manual' })).headers.get('location')).toBe('/_tykerf/edit/_site/');
    expect(await (await fetch(`${url}pages/`)).text()).toMatch(/<a href="\/home\/"><span class="title">Our home<\/span><span class="route">\/home\/ <b>home<\/b><\/span>/);

    // the head code of every page, apart from the theme: saved, and a style block refused (styles are the kit's)
    await rail.locator('[data-screen="settings"]').click();
    const code = page.locator('form[data-s="code"]');
    await code.locator('textarea').fill('<meta name="tykerf-note" content="outline: 3px solid red">');
    await code.locator('[type=submit]').click();
    await page.locator('.toast', { hasText: 'Saved' }).waitFor();
    expect(await (await fetch(`${url}home/?tykerf=frame`)).text()).toContain('<meta name="tykerf-note" content="outline: 3px solid red">');
    expect(siteTheme()).toBeTruthy(); // the theme stays
    // (the screen draws itself again after Saved: a field filled meanwhile can be replaced, so try again then)
    for (let i = 0; ; i++) {
      await code.locator('textarea').fill('<style data-tykerf-theme>:root{}</style>');
      await code.locator('[type=submit]').click();
      try {
        await page.locator('.toast.bad', { hasText: 'Page tab' }).waitFor({ timeout: 3000 });
        break;
      } catch (e) {
        if (i === 2) throw e;
      }
    }

    // the kit's tags: a file with no name to give, and nothing to remove yet
    await rail.locator('[data-screen="shared"]').click();
    await page.locator('[data-kit-tab="tags"]').click();
    await page.locator('[data-k="new"]').click();
    await page.locator('.kitedit textarea').waitFor();
    expect(await page.locator('.kitedit [name=name]').count()).toBe(0);
    expect(await page.locator('.kitedit [data-k="delete"]').count()).toBe(0);
    await page.locator('.kitedit [data-k="close"]').click();
    await page.locator('[data-kit-tab="blocks"]').click();

    // the site's one Undo: it takes back the head's change and the kit's, newest first
    await rail.locator('[data-screen="history"]').click();
    const undo = page.locator('[data-h="undo"]');
    await expect.poll(() => undo.textContent()).toBe('Undo "edit the head code of every page"');
    kitWrite(site, 'styles', 'note', '.t-note { color: blue }'); // a kit change after it (as Kaity's would come)
    await page.reload();
    await expect.poll(() => undo.textContent()).toBe('Undo "add kit/styles/note.css"');
    expect(await page.locator('.steps li').first().textContent()).toMatch(/^add kit\/styles\/note\.css you · /);
    await undo.click();
    await page.locator('.toast', { hasText: 'Undone: add kit/styles/note.css' }).waitFor();
    expect(existsSync(join(site, 'kit', 'styles', 'note.css'))).toBe(false);
    await expect.poll(() => undo.textContent()).toBe('Undo "edit the head code of every page"');
    await undo.click();
    await page.locator('.toast', { hasText: 'Undone: edit the head code of every page' }).waitFor();
    expect(await (await fetch(`${url}home/?tykerf=frame`)).text()).not.toContain('outline: 3px solid red');
    // and Redo brings it back
    await page.locator('[data-h="redo"]').click();
    await page.locator('.toast', { hasText: 'Redone: edit the head code of every page' }).waitFor();
    expect(await (await fetch(`${url}home/?tykerf=frame`)).text()).toContain('outline: 3px solid red');
  });

  it('gives the site an icon, and TYKERF\'s screens TYKERF\'s', async () => {
    const icon = await fetch(`${url}favicon.svg`);
    expect([icon.status, icon.headers.get('content-type')]).toEqual([200, 'image/svg+xml']);
    // the icon and where it comes from; a file of its own, then the made one again
    await page.goto(`${url}_tykerf/edit/_site/settings`);
    expect(await page.locator('head link[rel="icon"]').getAttribute('href')).toBe('/_tykerf/favicon.svg');
    await page.locator('.setting .note', { hasText: 'Made by tykerf' }).waitFor();
    const file = join(mkdtempSync(join(tmpdir(), 'tykerf-icon-')), 'mine.svg');
    writeFileSync(file, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="red"/></svg>');
    await page.locator('input[type=file][data-s="icon"]').setInputFiles(file);
    await page.locator('.setting .note', { hasText: 'Your own icon' }).waitFor();
    expect(await (await fetch(`${url}favicon.svg`)).text()).toContain('fill="red"');
    await page.locator('[data-s="icon-made"]').click();
    await page.locator('.setting .note', { hasText: 'Made by tykerf' }).waitFor();
    expect(existsSync(join(site, 'favicon.svg'))).toBe(false);
    // a page's HTML links the site's icon (what visitors get); the editors show TYKERF's mark in their tab
    expect(await (await fetch(`${url}home/?tykerf=frame`)).text()).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
    await page.goto(`${url}_tykerf/edit/home/`);
    expect(await page.locator('head link[rel~="icon"]').evaluateAll((ls) => ls.map((l) => l.getAttribute('href')))).toEqual(['/_tykerf/favicon.svg']);
    await page.goto(`${url}home/?tykerf=full-frame`);
    await page.locator('section.panel').waitFor({ state: 'attached' });
    expect(await page.locator('head link[rel~="icon"]').evaluateAll((ls) => ls.map((l) => l.getAttribute('href')))).toEqual(['/_tykerf/favicon.svg']);
  });

  it('lists the links between pages, broken ones first, and opens a page on the box a link is in', async () => {
    // nothing running: Kaity is at work nowhere
    expect((await fetch(`${url}_tykerf/site`).then((r) => r.json())).kaity).toEqual({ site: false, pages: [] });
    const tree = (await fetch(`${url}home/_tykerf/state`).then((r) => r.json())).tree;
    const first = (function leaf(n: any): string { return n.kind === 'box' ? n.id : leaf(n.children[0]); })(tree);
    await post('home/_tykerf/box', { id: first, full: '<p><a href="/team/">Team</a> <a href="/nowhere/">Gone</a></p>' });
    await page.goto(`${url}_tykerf/edit/_site/links`);
    const bad = page.locator('.cgroup.bad');
    await bad.waitFor();
    expect(await bad.locator('h2').textContent()).toBe('Links that lead nowhere');
    // the link is in the shared navigation: every page that shows it has it
    expect(await bad.locator('li', { hasText: '/nowhere/' }).count()).toBeGreaterThan(1);
    const row = bad.locator('li', { has: page.locator('b', { hasText: /^home$/ }) }).filter({ hasText: '/nowhere/' }).first();
    expect(await row.locator('a').getAttribute('href')).toBe(`/_tykerf/edit/home/?show=${first}`);
    expect(await page.locator('.lcard', { has: page.locator('h3', { hasText: /^home/ }) }).textContent()).toMatch(/Links to team/);
    // the page opens on that box, and its address is clean again
    await row.locator('a').click();
    await page.waitForURL(`${url}_tykerf/edit/home/`);
    await page.frameLocator('.frame').locator(`[data-sw="${first}"]`).waitFor();
  });

  it('serves the kit\'s styles as one stylesheet, kept for a year at the address pages link', async () => {
    const { kitWrite } = await import('../src/kit.js');
    kitWrite(site, 'styles', 'note', '.t-note { color: teal }');
    const html = await (await fetch(`${url}home/?tykerf=frame`)).text();
    const href = /<link rel="stylesheet" href="(\/kit\/site\.css\?v=[0-9a-f]{12})" data-tykerf-kit>/.exec(html)![1];
    const css = await fetch(`${url}${href.slice(1)}`);
    expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(css.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await css.text()).toContain('/* kit/styles/note.css */\n.t-note { color: teal }');
    expect((await fetch(`${url}kit/site.css`)).headers.get('cache-control')).toBe('no-cache');
    kitWrite(site, 'styles', 'note', null);
  });

  it('shows the site\'s files in Media, with who uses them, and removes an unused one', async () => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(site, 'assets'), { recursive: true });
    writeFileSync(join(site, 'assets', 'leftover.png'), 'nothing uses me');
    await page.goto(`${url}_tykerf/edit/_site/media`);
    const card = page.locator('.mcard', { has: page.locator('h3', { hasText: /^leftover\.png$/ }) });
    expect(await card.textContent()).toMatch(/the site's files[\s\S]*Not used/);
    await page.locator('[data-filter="unused"]').click();
    await card.waitFor();
    await card.locator('[data-remove]').click();
    await page.locator('.toast', { hasText: 'leftover.png is removed' }).waitFor();
    expect(existsSync(join(site, 'assets', 'leftover.png'))).toBe(false);
  });

  it('adds a font of the site from the kit, with its file, weight and licence', async () => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(site, 'assets'), { recursive: true });
    writeFileSync(join(site, 'assets', 'diavlo.woff2'), 'x');
    await page.goto(`${url}_tykerf/edit/_site/shared`);
    await page.locator('[data-kit-tab="fonts"]').click();
    const form = page.locator('.fontform');
    await form.locator('input[name=family]').fill('Diavlo');
    await form.locator('select[name=file]').selectOption('diavlo.woff2');
    await form.locator('input[name=licence]').fill('free for web use');
    await form.locator('[type=submit]').click();
    await expect.poll(() => page.locator('.fonts .font').first().textContent()).toBe('Diavlo (400; free for web use)');
    expect(JSON.parse(readFileSync(join(site, 'kit', 'fonts.json'), 'utf8'))).toEqual({ Diavlo: { files: [{ file: 'diavlo.woff2', weight: '400', style: 'normal' }], display: 'swap', licence: 'free for web use' } });
    expect(readFileSync(join(site, 'head.html'), 'utf8')).toContain('font-family: "Diavlo"; src: url("/assets/diavlo.woff2")');
    await page.locator('[data-kit-tab="blocks"]').click();
  });

  it("offers to move an older site's head styles to the kit, and does it when asked", async () => {
    const { setSiteHead, siteHead } = await import('../src/site.js');
    setSiteHead(site, `${siteHead(site)}\n<style>.old { color: red }</style>`); // written before styles were the kit's
    await page.goto(`${url}_tykerf/edit/_site/settings`);
    const offer = page.locator('.headstyles');
    await expect.poll(() => offer.textContent()).toMatch(/The head code has a style block: styles for every page belong in the site kit\. Move it to the kit/);
    await offer.locator('button').click();
    await page.locator('.toast', { hasText: 'Moved 1 to the kit: kit/styles/head.css' }).waitFor();
    expect(readFileSync(join(site, 'kit', 'styles', 'head.css'), 'utf8')).toContain('.old { color: red }');
    expect(siteHead(site)).not.toContain('.old');
    await expect.poll(() => offer.count()).toBe(0);
  });

  it('goes from a shared block to the pages that show it, and from a page to the shared blocks', async () => {
    const kit = await fetch(`${url}_tykerf/site/kit`).then((r) => r.json());
    expect(kit.where?.nav, JSON.stringify(kit).slice(0, 400)).toBeDefined();
    const where = kit.where.nav as Record<string, string[]>;
    const [first, boxes] = Object.entries(where)[0];
    // the shared block opens on a page that shows it
    await page.goto(`${url}_tykerf/edit/_site/shared`);
    const nav = page.locator('.bcard', { has: page.locator('h3', { hasText: /^nav$/ }) });
    expect(await nav.locator('a', { hasText: `Open it on ${first}` }).getAttribute('href')).toBe(`/_tykerf/edit/${first}/?show=${boxes[0]}`);
    // the full editor: a box that shows it links to the site's shared blocks
    await page.goto(`${url}${first}/?tykerf=full-frame&block=${boxes[0]}`);
    expect(await page.locator('.shared-explanation .kit-link').getAttribute('href')).toBe(`/_tykerf/edit/_site/shared?from=${first}`);
  });

  it('keeps a shared block whole from a page: its pictures are the site\'s, its current link marked after a refresh, the site\'s fonts offered', async () => {
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 7, 7, 7]).toString('base64');
    const post = (path: string, data: unknown) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }).then((r) => r.json());
    // a picture for the shared navigation is the site's; one for the page's own box stays the page's
    const shared = await post('home/_tykerf/asset', { data: PNG, box: 'nav' });
    expect(shared.path).toMatch(/^\/assets\/img-[0-9a-f]{12}\.png$/);
    expect(existsSync(join(site, shared.path.slice(1)))).toBe(true);
    const own = await post('home/_tykerf/asset', { data: PNG, box: 'hero' });
    expect(own.path).toMatch(/^assets\/img-[0-9a-f]{12}\.png$/);
    // the editor's refresh of the page's body marks this page's link in the shared navigation, as the page does
    const { kitRead, kitWrite } = await import('../src/kit.js');
    const before = kitRead(site, 'blocks', 'nav');
    kitWrite(site, 'blocks', 'nav', '<nav><a href="/home/">Home</a> <a href="/team/">Team</a></nav>');
    try {
      const body = (await fetch(`${url}home/_tykerf/page`).then((r) => r.json())).body as string;
      expect(body).toContain('<a href="/home/" aria-current="page">Home</a>');
      expect(body).not.toContain('<a href="/team/" aria-current');
    } finally {
      kitWrite(site, 'blocks', 'nav', before);
    }
    // the site's own fonts are offered in the Page tab's font fields
    expect((await fetch(`${url}home/_tykerf/kit`).then((r) => r.json())).fonts).toContain('Diavlo');
  });

  it('pastes a removed shared block as the shared block, not a copy of its code', async () => {
    const op = (data: unknown) => fetch(`${url}home/_tykerf/op`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }).then((r) => r.json());
    const slice = () => readFileSync(join(site, 'home', 'layout.slice'), 'utf8');
    expect(slice()).toMatch(/footer\[[^\]]*use=footer/);
    expect((await op({ op: 'remove', id: 'footer' })).ok).toBe(true);
    const state = await fetch(`${url}home/_tykerf/state`).then((r) => r.json());
    expect(state.buffer[0]).toMatchObject({ from: 'footer', shared: 'footer' });
    // as a new box: it shows the shared block, so a change to the footer reaches it too
    const pasted = (await op({ op: 'paste', i: 0, id: 'intro', how: 'below' })).result;
    expect(slice()).toMatch(new RegExp(`${pasted}\\[[^\\]]*use=footer`));
    // into another box: that box shows it (its own code waits underneath)
    expect((await op({ op: 'paste', i: 0, id: 'people', how: 'into' })).ok).toBe(true);
    expect(slice()).toMatch(/people\[[^\]]*use=footer/);
    // the page as it was, for the tests that follow
    for (let i = 0; i < 3; i++) await fetch(`${url}home/_tykerf/undo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(slice()).toMatch(/footer\[[^\]]*use=footer/);
    expect(slice()).not.toMatch(/people\[[^\]]*use=/);
  });

  it("follows a page renamed or removed from another process (Kaity's site run), and lists Kaity's work", async () => {
    await post('_tykerf/site/new', { name: 'draft', layout: 'blank' });
    // the full editor follows it
    await page.goto(`${url}draft/?tykerf=full-frame`);
    await page.locator('section.panel').waitFor();
    await page.waitForTimeout(500); // its event stream, which brings the move, is open by then
    renamePage(site, 'draft', 'madrid'); // as MCP rename_page does, outside the editor
    await page.waitForURL(`${url}_tykerf/edit/madrid/?mode=full`);
    // and so does the editor's shell
    await page.goto(`${url}_tykerf/edit/madrid/`);
    await page.frameLocator('.frame').locator('[data-sw]').first().waitFor();
    await page.waitForTimeout(500);
    renamePage(site, 'madrid', 'lisbon');
    await page.waitForURL(`${url}_tykerf/edit/lisbon/`);
    await page.frameLocator('.frame').locator('[data-sw]').first().waitFor();
    await page.waitForTimeout(500);
    removePage(site, 'lisbon');
    await page.waitForURL(`${url}_tykerf/edit/_site/`);

    logStart(site, { run: 'r1', page: 'home', block: 'hero', request: 'Work through this task:\n\n#1 · hero › h1 · 1280 px\nShorter title' });
    logEnd(site, { run: 'r1', end: 'done', block: 'hero', answer: 'The title is **shorter**.', steps: 4 });
    logStart(site, { run: 'r2', page: null, block: null, request: 'Link every page' });
    // the Kaity center as a page: one thread, oldest first, each request and her answer once
    await page.goto(`${url}_tykerf/edit/_site/kaity`);
    const thread = page.locator('.screen .kview .thread');
    await thread.locator('.ti.you').nth(1).waitFor();
    expect(await thread.locator('.ti.you .req').allTextContents()).toEqual(['Work through this task:\n\n#1 · hero › h1 · 1280 px\nShorter title', 'Link every page']);
    const [home, site_] = [thread.locator('.ti.her').nth(0), thread.locator('.ti.her').nth(1)];
    expect(await home.locator('.scopechip').textContent()).toBe('home · hero');
    expect(await home.locator('.md strong').textContent()).toBe('shorter');
    expect(await home.locator('.when').textContent()).toContain('4 steps');
    expect(await site_.locator('.scopechip').textContent()).toBe('Whole site');
    expect(await site_.locator('.note').textContent()).toBe('Cut short: tykerf was closed while she worked.'); // no run going on now
    // opened at the newest, next to the composer
    expect(await page.locator('.screen .kscroll').evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight)).toBeLessThan(40);
    await page.locator('.screen .kfilters [data-filter="site"]').click();
    await expect.poll(() => thread.locator('.ti.you').count()).toBe(1);
    await page.locator('.screen .kfilters [data-filter="all"]').click();
  });
});

describe('an editor older than its code', () => {
  it('says so, so it gets restarted', async () => {
    // its own folder of "code" and its own editor, so no other test sees the change
    const code = mkdtempSync(join(tmpdir(), 'tykerf-code-'));
    writeFileSync(join(code, 'a.ts'), 'export {};');
    const dir = mkdtempSync(join(tmpdir(), 'tykerf-outdated-'));
    const port = await freePort();
    const ed = spawn(process.execPath, ['--import', 'tsx', 'src/editor/server.ts', join(dir, 'site'), '--layout', 'blank', '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, TYKERF_CODE_DIR: code } });
    try {
      await new Promise<void>((ok) => ed.stdout!.on('data', (d) => String(d).includes('TYKERF: http') && ok()));
      const at = `http://localhost:${port}/`;
      expect(await (await fetch(`${at}_tykerf/version`)).json()).toEqual({ ok: true, outdated: false, page: expect.any(String) });
      const tab = await browser.newPage();
      await tab.goto(at);
      await tab.locator('.bar .brandlink').waitFor();
      await tab.waitForTimeout(300); // it has asked
      expect(await tab.locator('.outdated').isHidden()).toBe(true);
      utimesSync(join(code, 'a.ts'), new Date(), new Date(Date.now() + 60_000));
      expect(await (await fetch(`${at}_tykerf/version`)).json()).toMatchObject({ ok: true, outdated: true });
      await tab.reload();
      await tab.locator('.outdated', { hasText: 'Restart it' }).waitFor();
      expect(await tab.locator('.outdated .reload').count()).toBe(0);
      await tab.close();
    } finally {
      ed.kill();
    }
  });

  it('says a page older than its editor needs a reload: after an update, a tab keeps the script it loaded', async () => {
    const files = mkdtempSync(join(tmpdir(), 'tykerf-page-files-'));
    writeFileSync(join(files, 'tykerf.js'), '// the browser part');
    const dir = mkdtempSync(join(tmpdir(), 'tykerf-reload-'));
    const port = await freePort();
    const ed = spawn(process.execPath, ['--import', 'tsx', 'src/editor/server.ts', join(dir, 'site'), '--layout', 'blank', '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, TYKERF_PAGE_DIR: files } });
    try {
      await new Promise<void>((ok) => ed.stdout!.on('data', (d) => String(d).includes('TYKERF: http') && ok()));
      const at = `http://localhost:${port}/`;
      const tab = await browser.newPage();
      await tab.goto(`${at}home/`);
      await tab.locator('.bar .brandlink').waitFor();
      await tab.waitForTimeout(300); // it has asked which version it loaded
      expect(await tab.locator('.outdated').isHidden()).toBe(true);
      writeFileSync(join(files, 'tykerf.js'), '// the browser part, updated'); // as an update does
      await tab.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); // coming back to the tab
      await tab.locator('.outdated', { hasText: 'reload this page' }).waitFor();
      await tab.locator('.outdated .reload').click();
      await tab.waitForLoadState();
      await tab.locator('.bar .brandlink').waitFor();
      await tab.waitForTimeout(300);
      expect(await tab.locator('.outdated').isHidden()).toBe(true); // the new script, nothing to say
      await tab.close();
    } finally {
      ed.kill();
    }
  });
});

describe('odd addresses', () => {
  it('never stop the editor: doubled slashes go to the clean address', async () => {
    const { get } = await import('node:http');
    const raw = (path: string) => new Promise<{ status: number; location?: string }>((ok, fail) =>
      get({ host: 'localhost', port: new URL(url).port, path }, (r) => (r.resume(), ok({ status: r.statusCode!, location: r.headers.location }))).on('error', fail));
    expect(await raw('//')).toEqual({ status: 302, location: '/' });
    expect(await raw('//home//?x=1')).toEqual({ status: 302, location: '/home/?x=1' });
    expect((await raw('/_tykerf/site')).status).toBe(200); // still running
  });
});
