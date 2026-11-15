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
  it('starts on New page: Kaity first, or a layout with a theme for the whole site', async () => {
    await page.goto(url);
    await page.waitForURL(`${url}_tykerf/edit/_site/new`);
    await page.locator('[data-layout]').first().waitFor(); // the screen asks Kaity's status first, which may take a moment
    expect(await page.locator('[data-layout]').count()).toBe(10);
    expect(await page.locator('#np-theme option').count()).toBe(7);
    await page.locator('[data-layout="launch"]').click();
    await page.locator('#np-theme').selectOption('dark');
    expect(await page.locator('[data-np="layout"] a', { hasText: 'Preview at full size' }).getAttribute('href')).toBe('/_tykerf/preview/launch/dark/');
    const preview = await browser.newPage();
    await preview.goto(`${url}_tykerf/preview/launch/dark/`);
    expect(await preview.locator('body').evaluate((b) => getComputedStyle(b).backgroundColor)).toBe('rgb(13, 17, 23)'); // #0d1117
    await preview.close();
  });

  it('creates the first page from them; its theme becomes the theme of the whole site', async () => {
    // the layout's navigation and footer become the site's, shared, unless the box is unticked
    const card = page.locator('[data-np="layout"]');
    expect(await card.locator('[name=shared]').isChecked()).toBe(true);
    expect(await card.locator('.check').textContent()).toMatch(/With the site's navigation and footer \(shared\)/);
    await page.locator('#np-name').fill('home');
    await card.locator('[type=submit]').click();
    await page.waitForURL(`${url}_tykerf/edit/home/`);
    expect(existsSync(join(site, 'kit', 'blocks', 'nav.html')) && existsSync(join(site, 'kit', 'blocks', 'footer.html'))).toBe(true);
    expect(readFileSync(join(site, 'home', 'layout.slice'), 'utf8')).toMatch(/nav\[[^\]]*use=nav/);
    expect(siteTheme()).toEqual(values('dark'));
    expect(existsSync(join(site, 'home', 'head.html'))).toBe(false);
    expect(await page.locator('.bar .switcher .name').textContent()).toBe('home');
    await expect.poll(() => page.frameLocator('.frame').locator('body').evaluate((b) => getComputedStyle(b).backgroundColor)).toBe('rgb(13, 17, 23)');
  });

  it('refuses a page name that is taken, then adds a new page in the site theme', async () => {
    await page.goto(`${url}_tykerf/edit/_site/new?from=home`);
    expect(await page.locator('#np-theme').count()).toBe(0); // the site's theme, not a choice
    expect(await page.locator('[data-np="layout"] a', { hasText: 'Preview at full size' }).getAttribute('href')).toBe('/_tykerf/preview/launch/site/');
    await page.locator('#np-name').fill('home');
    await page.locator('[data-np="layout"] [type=submit]').click();
    expect(await page.locator('.np-error').textContent()).toMatch(/already a page called home/);
    await page.locator('#np-name').fill('about');
    await page.locator('[data-layout="article"]').click();
    await page.locator('[data-np="layout"] [type=submit]').click();
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
    await page.locator('.presets [data-preset="gallery"]').click();
    await expect.poll(() => siteTheme(), { timeout: 5000 }).toEqual(values('gallery'));
    expect(readFileSync(headFile, 'utf8')).toContain('--color-text: var(--color-on-dark);');
  });

  it('remembers the preset a theme came from, says when it changed, and resets to it', async () => {
    // the site theme is Gallery now (the previous test chose it)
    await page.goto(`${url}about/?tykerf=full-frame`);
    await page.locator('section.panel').waitFor();
    await page.locator('.work .tabs [data-tab="page"]').click();
    await page.locator('.theme-scope [data-scope="site"]').click();
    await expect.poll(() => page.locator('.presets [data-preset="gallery"]').getAttribute('aria-pressed'), { timeout: 5000 }).toBe('true');
    expect(await page.locator('[data-page="reset-preset"]').count()).toBe(0);
    // change one value
    await page.locator('.theme-var input[data-var="--color-accent"]').fill('#ff0000');
    await page.locator('[data-page="theme"]').click();
    await expect.poll(() => siteTheme()['--color-accent'], { timeout: 5000 }).toBe('#ff0000');
    await page.goto(`${url}about/?tykerf=full-frame`);
    await page.locator('.work .tabs [data-tab="page"]').click();
    await expect.poll(() => page.locator('.presets [data-preset="gallery"] .changed').count(), { timeout: 5000 }).toBe(1);
    await page.locator('[data-page="reset-preset"]').click();
    await expect.poll(() => siteTheme(), { timeout: 5000 }).toEqual(values('gallery'));
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
    expect(await pick.locator('option').allTextContents()).toEqual(['Link to a page…', 'about', 'home', 'team']);

    // rename "about" from its own page, in the site sidebar: the tab follows, and home's link points at the new name
    await page.goto(`${url}_tykerf/edit/about/`);
    await page.locator('[data-bar="pages"]').click();
    await page.locator('.sidebar .pcard[data-page="about"] [data-pact="name"]').click();
    await page.locator('.sidebar .pform [name="to"]').fill('about-us');
    await page.locator('.sidebar .pform [type="submit"]').click();
    // the tab goes to the new address twice (after the rename, and on the "moved" event): one may cut the other short
    await expect.poll(() => page.url(), { timeout: 8000 }).toBe(`${url}_tykerf/edit/about-us/`);
    await page.waitForLoadState();
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

    await page.goto(`${url}_tykerf/edit/about-us/`);
    // the sidebar stays open from page to page (it was left open on the last one)
    await page.frameLocator('.frame').locator('[data-sw]').first().waitFor();
    if (!(await page.locator('.sidebar').isVisible())) await page.locator('[data-bar="pages"]').click();
    await page.locator('.sidebar .pcard[data-page="about-us"] [data-pact="remove"]').click();
    // the link is in the shared navigation, so on every page that shows it
    expect(await page.locator('.sidebar .confirm .hint').textContent()).toMatch(/2 links to it from home, team will point nowhere/);
    await page.locator('.sidebar [data-pact="remove-yes"]').click();
    // the tab goes to the site's screens, with the pages left
    await expect.poll(() => page.url(), { timeout: 8000 }).toBe(`${url}_tykerf/edit/_site/tasks`);
    await expect.poll(() => page.locator('.sidebar .pname').allTextContents(), { timeout: 8000 }).toEqual(['home', 'team']);
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
    expect(await page.locator('.work .tabs [role=tab]').evaluateAll((b) => b.map((x) => (x as HTMLElement).dataset.tab))).toEqual(['blocks', 'page', 'size']);
    await page.locator('.work .tabs [data-tab="page"]').click();
    await page.locator('.head-code').waitFor();
    expect(await page.locator('[data-page^="export"]').count()).toBe(0);
    // export and Kaity status are on the site's screens
    await page.goto(`${url}_tykerf/edit/_site/publish?from=home`);
    await page.locator('a[href="/_tykerf/export.zip?page=home"]').waitFor();
  });

  it('in the shell, has a light header with the tykerf sign, and compacts while the site\'s sidebar is open', async () => {
    // on its own, the full editor keeps its dark header
    await page.goto(`${url}home/?tykerf=full-frame`);
    await page.locator('section.panel').waitFor();
    const dark = await page.locator('section.panel .head').evaluate((h) => getComputedStyle(h).backgroundColor);
    expect(dark).toBe('rgb(10, 84, 117)');
    // the editor open, the sidebar closed
    await page.evaluate(() => (localStorage.setItem('tykerf.min', 'false'), localStorage.setItem('tykerf.sidebar', '"closed"')));
    await page.goto(`${url}_tykerf/edit/home/?mode=full`);
    const fr = page.frameLocator('.frame');
    await fr.locator('section.panel').waitFor();
    expect(await fr.locator('section.panel .head').evaluate((h) => getComputedStyle(h).backgroundColor)).toBe('rgb(242, 247, 249)');
    expect(await fr.locator('section.panel .head .brand').isVisible()).toBe(true);
    const saved = () => page.evaluate(() => localStorage.getItem('tykerf.min'));
    const before = await saved();
    expect(await fr.locator('section.panel').evaluate((p) => p.classList.contains('min'))).toBe(false);
    // the sidebar opens: the editor shows only its header, out of the sidebar's way, and says why
    await page.locator('[data-bar="pages"]').click();
    await page.locator('.sidebar .pcard.current .pstate', { hasText: 'Open now in the full editor' }).waitFor();
    await expect.poll(() => fr.locator('section.panel').evaluate((p) => p.classList.contains('min'))).toBe(true);
    expect(await fr.locator('.compacted-note').textContent()).toBe('Compacted while the site is open');
    const side = (await page.locator('.sidebar').boundingBox())!;
    expect((await fr.locator('section.panel').boundingBox())!.x).toBeGreaterThanOrEqual(side.x + side.width);
    // closed: back as it was, and the person's own Compact choice was never touched
    await page.locator('.sidebar [data-sb="collapse"]').click();
    await expect.poll(() => fr.locator('section.panel').evaluate((p) => p.classList.contains('min'))).toBe(false);
    expect(await fr.locator('.compacted-note').isHidden()).toBe(true);
    expect(await saved()).toBe(before);
    // See more while it is open is the person's choice: it stays open when the sidebar closes
    await page.locator('[data-bar="pages"]').click();
    await expect.poll(() => fr.locator('section.panel').evaluate((p) => p.classList.contains('min'))).toBe(true);
    await fr.locator('.minimize').click();
    expect(await fr.locator('.compacted-note').isHidden()).toBe(true);
    await page.locator('.sidebar [data-sb="collapse"]').click();
    expect(await fr.locator('section.panel').evaluate((p) => p.classList.contains('min'))).toBe(false);
  });

  it('tells which AI answers, never its key', async () => {
    const st = await fetch(`${url}_tykerf/ai/status`).then((r) => r.json());
    expect(st).toMatchObject({ ok: true, runner: 'claude-code', testable: true, running: [] });
    expect(typeof st.ready).toBe('boolean');
    expect(JSON.stringify(st)).not.toMatch(/key=|sk-/);
  });

  it('manages the pages from the sidebar: names, copies, the trash, home and title; the head code and the site\'s Undo', async () => {
    await post('_tykerf/site/new', { name: 'notes', layout: 'blank' });
    await page.goto(`${url}_tykerf/edit/_site/tasks`);
    const sb = page.locator('.sidebar');
    const card = (name: string) => sb.locator(`.pcard[data-page="${name}"]`);
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
    await expect.poll(() => sb.locator('.pname').allTextContents(), { timeout: 5000 }).not.toContain('journal-copy');

    // removing asks first
    await card('journal').locator('[data-pact="remove"]').click();
    expect(await sb.locator('.confirm p').first().textContent()).toBe("Remove journal? It goes to the site's trash, and links to it stop working.");
    expect(await sb.locator('.confirm .hint').textContent()).toBe('No other page links to it.');
    await sb.locator('[data-pact="remove-yes"]').click();
    await expect.poll(() => sb.locator('.pname').allTextContents()).not.toContain('journal');
    expect(existsSync(join(site, 'journal'))).toBe(false);

    // removed pages wait in the trash, until it is emptied for good (asked first)
    await sb.locator('[data-screen="history"]').click();
    await expect.poll(() => page.locator('.trashsec li b').allTextContents()).toContain('journal');
    await page.locator('[data-h="empty"]').click();
    expect(await page.locator('.trashsec .confirm p').textContent()).toMatch(/for good\? This cannot be undone\./);
    await page.locator('[data-h="empty-yes"]').click();
    await page.locator('.trashsec').waitFor({ state: 'detached' });
    expect(existsSync(join(site, '.trash'))).toBe(false);

    // the home page (the site's first page, from the start), and a title set by hand
    await card('home').locator('.hometag').waitFor();
    await card('home').locator('[data-pact="name"]').click();
    await sb.locator('.pform [name=title]').fill('Our home');
    await sb.locator('.pform [type=submit]').click();
    await expect.poll(() => JSON.parse(readFileSync(join(site, 'site.json'), 'utf8'))).toMatchObject({ home: 'home', titles: { home: 'Our home' } });
    // the site's address opens the home page (in the editor, for a person signed in); /pages/ lists them by title
    const front = await fetch(url, { redirect: 'manual' });
    expect([front.status, front.headers.get('location')]).toEqual([302, '/home/']);
    expect((await fetch(`${url}home/`, { redirect: 'manual' })).headers.get('location')).toBe('/_tykerf/edit/home/');
    expect((await fetch(`${url}_tykerf/site/`, { redirect: 'manual' })).headers.get('location')).toBe('/_tykerf/edit/_site/tasks');
    expect(await (await fetch(`${url}pages/`)).text()).toMatch(/<a href="\/home\/"><span class="title">Our home<\/span><span class="route">\/home\/ <b>home<\/b><\/span>/);

    // the head code of every page, apart from the theme: saved, and a style block refused (styles are the kit's)
    await sb.locator('[data-screen="settings"]').click();
    const code = page.locator('form[data-s="code"]');
    await code.locator('textarea').fill('<meta name="tykerf-note" content="outline: 3px solid red">');
    await code.locator('[type=submit]').click();
    await page.locator('.toast', { hasText: 'Saved' }).waitFor();
    expect(await (await fetch(`${url}home/?tykerf=frame`)).text()).toContain('<meta name="tykerf-note" content="outline: 3px solid red">');
    expect(siteTheme()).toBeTruthy(); // the theme stays
    await code.locator('textarea').fill('<style data-tykerf-theme>:root{}</style>');
    await code.locator('[type=submit]').click();
    await page.locator('.toast.bad', { hasText: 'Page tab' }).waitFor();

    // the kit's tags: a file with no name to give, and nothing to remove yet
    await sb.locator('[data-screen="shared"]').click();
    await page.locator('[data-kit-tab="tags"]').click();
    await page.locator('[data-k="new"]').click();
    await page.locator('.kitedit textarea').waitFor();
    expect(await page.locator('.kitedit [name=name]').count()).toBe(0);
    expect(await page.locator('.kitedit [data-k="delete"]').count()).toBe(0);
    await page.locator('.kitedit [data-k="close"]').click();
    await page.locator('[data-kit-tab="blocks"]').click();

    // the site's one Undo: it takes back the head's change and the kit's, newest first
    await sb.locator('[data-screen="history"]').click();
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
    const pasted = (await op({ op: 'paste', i: 0, id: 'hero', how: 'below' })).result;
    expect(slice()).toMatch(new RegExp(`${pasted}\\[[^\\]]*use=footer`));
    // into another box: that box shows it (its own code waits underneath)
    expect((await op({ op: 'paste', i: 0, id: 'logos', how: 'into' })).ok).toBe(true);
    expect(slice()).toMatch(/logos\[[^\]]*use=footer/);
    // the page as it was, for the tests that follow
    for (let i = 0; i < 3; i++) await fetch(`${url}home/_tykerf/undo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(slice()).toMatch(/footer\[[^\]]*use=footer/);
    expect(slice()).not.toMatch(/logos\[[^\]]*use=/);
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
    await page.waitForURL(`${url}_tykerf/edit/_site/tasks`);

    logStart(site, { run: 'r1', page: 'home', block: 'hero', request: 'Work through this task:\n\n#1 · hero › h1 · 1280 px\nShorter title' });
    logEnd(site, { run: 'r1', end: 'done', block: 'hero', answer: 'The title is **shorter**.', steps: 4 });
    logStart(site, { run: 'r2', page: null, block: null, request: 'Link every page' });
    await page.goto(`${url}_tykerf/edit/_site/kaity`);
    await page.locator('.runs .run').nth(1).waitFor();
    expect(await page.locator('.workhead .summary').textContent()).toBe('0 going on now, 2 finished.');
    const [site_, home] = [page.locator('.runs .run').nth(0), page.locator('.runs .run').nth(1)];
    expect(await site_.locator('.state').textContent()).toBe('Cut short: TYKERF stopped while she worked'); // no run going on now
    expect(await site_.locator('.rhead b').textContent()).toBe('The whole site');
    expect(await home.locator('.rhead a').getAttribute('href')).toBe('/_tykerf/edit/home/?conversation=hero');
    expect(await home.locator('.state').textContent()).toBe('Done');
    expect(await home.locator('.md strong').textContent()).toBe('shorter');
    expect(await home.locator('.rhead .note').textContent()).toContain('4 steps');
    await page.locator('[data-k="filter"]').selectOption('site');
    await expect.poll(() => page.locator('.runs .run').count()).toBe(1);
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
      await tab.locator('.bar .switcher').waitFor();
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
      await tab.locator('.bar .switcher').waitFor();
      await tab.waitForTimeout(300); // it has asked which version it loaded
      expect(await tab.locator('.outdated').isHidden()).toBe(true);
      writeFileSync(join(files, 'tykerf.js'), '// the browser part, updated'); // as an update does
      await tab.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); // coming back to the tab
      await tab.locator('.outdated', { hasText: 'reload this page' }).waitFor();
      await tab.locator('.outdated .reload').click();
      await tab.waitForLoadState();
      await tab.locator('.bar .switcher').waitFor();
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
