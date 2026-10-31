// A site in the editor: the start screen of a new folder, the page switcher, New page… and the
// Page tab's theme presets.

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readTheme, themes } from '../src/library.js';
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
  page.setDefaultTimeout(5000);
  // TYKERF on; the preview frames are sandboxed and may not touch storage
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

describe('a new site', () => {
  it('starts on the start screen: the AI first, or a layout with a preview of it and a theme', async () => {
    await page.goto(url);
    await page.locator('.chooser').waitFor();
    expect(await page.locator('[data-from]').evaluateAll((b) => b.map((x) => (x as HTMLElement).dataset.from))).toEqual(['idea', 'layout', 'website']);
    await page.locator('[data-from="layout"]').click();
    expect(await page.locator('[data-layout]').count()).toBe(10);
    expect(await page.locator('[data-theme]:not([data-theme="auto"])').count()).toBe(7);
    await page.locator('[data-layout="launch"]').click();
    await page.locator('[data-theme="dark"]').click();
    await expect.poll(() => page.locator('.ch-frame iframe').getAttribute('src')).toBe('/_tykerf/preview/launch/dark/');
    const bg = await page.frameLocator('.ch-frame iframe').locator('body').evaluate((b) => getComputedStyle(b).backgroundColor);
    expect(bg).toBe('rgb(13, 17, 23)'); // #0d1117
  });

  it('creates the first page from them; its theme becomes the theme of the whole site', async () => {
    await page.locator('.chooser [type=submit]').click();
    await page.waitForURL(`${url}home/`);
    expect(siteTheme()).toEqual(values('dark'));
    expect(existsSync(join(site, 'home', 'head.html'))).toBe(false);
    await page.locator('.pagesw').waitFor();
    expect(await page.locator('.pagesw').textContent()).toBe('home');
    const bg = await page.locator('body').evaluate((b) => getComputedStyle(b).backgroundColor);
    expect(bg).toBe('rgb(13, 17, 23)');
  });

  it('refuses a page name that is taken, then adds a new page with New page…, in the site theme', async () => {
    await page.locator('.pagesw').click();
    await page.locator('.pop [data-pg="new"]').click();
    await page.locator('.newpage .chooser').waitFor();
    expect(await page.locator('.newpage [data-from]').evaluateAll((b) => b.map((x) => (x as HTMLElement).dataset.from))).toEqual(['idea', 'like', 'layout', 'website']);
    await page.locator('.newpage [data-from="layout"]').click();
    expect(await page.locator('.newpage [data-theme]').count()).toBe(0); // the site's theme, not a choice
    await expect.poll(() => page.locator('.newpage .ch-frame iframe').getAttribute('src')).toBe('/_tykerf/preview/launch/site/');
    await page.locator('.newpage input[name=name]').fill('home');
    await page.locator('.newpage [type=submit]').click();
    expect(await page.locator('.newpage .ch-error').textContent()).toMatch(/already a page called home/);
    await page.locator('.newpage input[name=name]').fill('about');
    await page.locator('.newpage [data-layout="article"]').click();
    await page.locator('.newpage [type=submit]').click();
    await page.waitForURL(`${url}about/`);
    expect(existsSync(join(site, 'about', 'layout.slice'))).toBe(true);
    expect(existsSync(join(site, 'about', 'head.html'))).toBe(false);
    await page.locator('.pagesw').click();
    expect(await page.locator('.pop .pages a').allTextContents()).toEqual(['about', 'home']);
    await page.keyboard.press('Escape');
  });

  it('makes a new page like this one: same navigation, footer and theme', async () => {
    await page.goto(`${url}home/`);
    await page.locator('section.panel').waitFor();
    await page.locator('.pagesw').click();
    await page.locator('.pop [data-pg="new"]').click();
    await page.locator('.newpage [data-from="like"]').click();
    await expect.poll(() => page.locator('.newpage .ch-frame iframe').getAttribute('src')).toBe('/home/');
    await page.locator('.newpage input[name=name]').fill('team');
    await page.locator('.newpage [type=submit]').click();
    await page.waitForURL(`${url}team/`);
    expect(readFileSync(join(site, 'team', 'layout.slice'), 'utf8')).toMatch(/nav\b.*main\b.*footer\b/s);
    expect(readFileSync(join(site, 'team', 'boxes', 'footer.html'), 'utf8')).toBe(readFileSync(join(site, 'home', 'boxes', 'footer.html'), 'utf8'));
  });

  it('shares one theme: a preset in any Page tab restyles every page, with its own undo', async () => {
    await page.goto(`${url}about/`);
    await page.locator('section.panel').waitFor();
    await page.locator('.work .tabs [data-tab="page"]').click();
    expect(await page.locator('.work .size-head').first().textContent()).toMatch(/^Site theme/);
    await page.locator('.presets [data-preset="ivory"]').click();
    await expect.poll(() => siteTheme()).toEqual(values('ivory'));
    expect(existsSync(join(site, 'home', 'head.html'))).toBe(false); // no page changed
    await page.goto(`${url}about/`);
    await page.locator('.work .tabs [data-tab="page"]').click();
    await page.locator('[data-page="site-undo"]').click();
    await expect.poll(() => siteTheme()).toEqual(values('dark'));
  });

  it('says where the page\'s look comes from, and lets one page set its own values', async () => {
    await page.goto(`${url}about/`);
    await page.locator('section.panel').waitFor();
    await page.locator('.work .tabs [data-tab="page"]').click();
    expect(await page.locator('.theme-status').textContent()).toMatch(/^Inherited: this page uses the site theme/);
    await page.locator('.theme-scope [data-scope="page"]').click();
    // the tab draws itself again for this page only
    await expect.poll(() => page.locator('.work .size-head').first().textContent(), { timeout: 5000 }).toMatch(/^This page's theme/);
    await page.locator('.theme-var .origin').first().waitFor();
    expect(await page.locator('.theme-var .origin.mine').count()).toBe(0);
    // a preset for this page only: its values that differ from the site's become the page's own
    await page.locator('.presets [data-preset="ivory"]').click();
    const aboutHead = () => (existsSync(join(site, 'about', 'head.html')) ? readFileSync(join(site, 'about', 'head.html'), 'utf8') : '');
    await expect.poll(aboutHead, { timeout: 5000 }).toContain('data-tykerf-override');
    expect(siteTheme()).toEqual(values('dark')); // the site theme is untouched
    await page.goto(`${url}about/`);
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
    await page.goto(`${url}about/`);
    await page.locator('section.panel').waitFor();
    await page.locator('.work .tabs [data-tab="page"]').click();
    await page.locator('.theme-scope [data-scope="site"]').click();
    await page.locator('.presets [data-preset="gallery"]').click();
    await expect.poll(() => siteTheme(), { timeout: 5000 }).toEqual(values('gallery'));
    expect(readFileSync(headFile, 'utf8')).toContain('--color-text: var(--color-on-dark);');
  });

  it('remembers the preset a theme came from, says when it changed, and resets to it', async () => {
    // the site theme is Gallery now (the previous test chose it)
    await page.goto(`${url}about/`);
    await page.locator('section.panel').waitFor();
    await page.locator('.work .tabs [data-tab="page"]').click();
    await page.locator('.theme-scope [data-scope="site"]').click();
    await expect.poll(() => page.locator('.presets [data-preset="gallery"]').getAttribute('aria-pressed'), { timeout: 5000 }).toBe('true');
    expect(await page.locator('[data-page="reset-preset"]').count()).toBe(0);
    // change one value
    await page.locator('.theme-var input[data-var="--color-accent"]').fill('#ff0000');
    await page.locator('[data-page="theme"]').click();
    await expect.poll(() => siteTheme()['--color-accent'], { timeout: 5000 }).toBe('#ff0000');
    await page.goto(`${url}about/`);
    await page.locator('.work .tabs [data-tab="page"]').click();
    await expect.poll(() => page.locator('.presets [data-preset="gallery"] .changed').count(), { timeout: 5000 }).toBe(1);
    await page.locator('[data-page="reset-preset"]').click();
    await expect.poll(() => siteTheme(), { timeout: 5000 }).toEqual(values('gallery'));
  });

  it('links to another page with the picker, and the link follows a rename of that page', async () => {
    await page.goto(`${url}home/`);
    await page.locator('section.panel').waitFor();
    // a box of home with a link written by hand, then a second one picked from the Text tab
    const box = (await fetch(`${url}home/_tykerf/state`).then((r) => r.json())).tree;
    const first = (function leaf(n: any): string { return n.kind === 'box' ? n.id : leaf(n.children[0]); })(box);
    const res = await fetch(`${url}home/_tykerf/box`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: first, full: '<p><a href="/about/">About us</a> <a href="https://example.com">x</a></p>' }) });
    expect(res.ok).toBe(true);
    await page.goto(`${url}home/`);
    await page.locator('section.panel').waitFor();
    await page.locator('.tree [data-all="open"]').click();
    await page.locator(`.tree .item[data-id="${first}"]`).click();
    // a box opens on its Text tab; click it only if another tab was kept (the panel may still be moving)
    const textTab = page.locator('.work .tabs [data-tab="text"]');
    if ((await textTab.getAttribute('aria-selected')) !== 'true') await textTab.click();
    const pick = page.locator('.work select[data-link]').first();
    await pick.waitFor(); // the Text tab loads the box first
    expect(await pick.locator('option').allTextContents()).toEqual(['Link to a page…', 'about', 'home', 'team']);

    // rename "about" from its own page: the tab follows, and home's link points at the new name
    await page.goto(`${url}about/`);
    await page.locator('.pagesw').click();
    await page.locator('.pop [data-pg="rename"]').click();
    await page.locator('.pop .pgname').fill('about-us');
    await page.locator('.pop [data-r="ok"]').click();
    // the tab goes to the new address twice (after the rename, and on the "moved" event): one may cut the other short
    await expect.poll(() => page.url(), { timeout: 8000 }).toBe(`${url}about-us/`);
    await page.waitForLoadState();
    expect(existsSync(join(site, 'about'))).toBe(false);
    expect(readFileSync(join(site, 'home', 'boxes', `${first}.html`), 'utf8')).toContain('href="/about-us/"');
    expect((await fetch(`${url}about/`)).status).toBe(404);
    // the old address says what happened and lists the pages there are
    await page.goto(`${url}about/`);
    await expect.poll(() => page.locator('ul a').allTextContents()).toContain('about-us');
    expect(await page.locator('.where').textContent()).toBe('Nothing is at /about/.');
    await page.locator('ul a', { hasText: 'about-us' }).click();
    await page.waitForURL(`${url}about-us/`);
  });

  it('refuses a bad new name, and removes a page into .trash', async () => {
    const r = await fetch(`${url}_tykerf/site/rename`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'about-us', to: 'home' }) });
    expect(r.status).toBe(422);
    expect((await r.json()).error).toMatch(/already/);
    const foreign = await fetch(`${url}_tykerf/site/remove`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: JSON.stringify({ name: 'home' }) });
    expect(foreign.status).toBe(403);

    await page.goto(`${url}about-us/`);
    await page.locator('.pagesw').click();
    await page.locator('.pop [data-pg="remove"]').click();
    expect(await page.locator('.pop .hint').textContent()).toMatch(/One link to it from home will point nowhere/);
    await page.locator('.pop [data-r="ok"]').click();
    // the tab goes to the site's home, with the pages left
    await expect.poll(() => page.url(), { timeout: 8000 }).toBe(`${url}_tykerf/site/`);
    await expect.poll(() => page.locator('.pages .who a').allTextContents(), { timeout: 8000 }).not.toContain('about-us');
    expect(existsSync(join(site, 'about-us'))).toBe(false);
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(join(site, '.trash'))[0]).toMatch(/^about-us-/);
    const links = await fetch(`${url}_tykerf/site/links`).then((x) => x.json());
    expect(links.links.filter((l: any) => l.broken).map((l: any) => l.href)).toEqual(['/about-us/']);
  });

  it('downloads the site as a zip with a short report', async () => {
    const r = await fetch(`${url}_tykerf/export.zip`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/zip');
    expect(r.headers.get('content-disposition')).toMatch(/^attachment; filename="my-site-\d{4}-\d{2}-\d{2}\.zip"$/);
    expect(JSON.parse(r.headers.get('x-tykerf-report')!)).toMatchObject({ pages: 2, broken: 1 });
    const bytes = Buffer.from(await r.arrayBuffer());
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    // one page of the site, its link to another page reported; never a page that isn't there
    const one = await fetch(`${url}_tykerf/export.zip?page=home`);
    expect(one.headers.get('content-disposition')).toMatch(/filename="home-\d{4}-\d{2}-\d{2}\.zip"/);
    expect(JSON.parse(one.headers.get('x-tykerf-report')!)).toMatchObject({ pages: 1, broken: 1 });
    expect((await fetch(`${url}_tykerf/export/report?page=home`).then((x) => x.json())).report.pages).toEqual(['index']);
    for (const bad of ['nope', '..', '.trash']) expect((await fetch(`${url}_tykerf/export.zip?page=${bad}`)).status).toBe(404);
  });

  it('manages pages in the page list, and puts export and the AI in the Site menu', async () => {
    await page.goto(`${url}home/`);
    await page.locator('section.panel').waitFor();
    await page.locator('.pagesw').click();
    expect(await page.locator('.pop [data-pg]').evaluateAll((b) => b.map((x) => (x as HTMLElement).dataset.pg))).toEqual(['rename', 'remove', 'new']);
    expect(await page.locator('.pop .page-row a').textContent()).toBe('home');
    await page.keyboard.press('Escape');

    await page.locator('.sitebtn').click();
    expect(await page.locator('.pop .sitemenu [data-site]').evaluateAll((b) => b.map((x) => (x as HTMLElement).dataset.site))).toEqual(['manage', 'export', 'export-page', 'ai']);
    await page.locator('.pop [data-site="export-page"]').click();
    await page.locator('.pop .choices').waitFor();
    expect(await page.locator('.pop').textContent()).toMatch(/Export this page[\s\S]*The page home/);
    expect(await page.locator('.pop .report').first().textContent()).toMatch(/Links to other pages/);
    const one = page.waitForEvent('download');
    await page.locator('.pop [data-x="web"]').click();
    expect((await one).suggestedFilename()).toMatch(/^home-.*\.zip$/);

    await page.locator('.sitebtn').click();
    await page.locator('.pop [data-site="export"]').click();
    await page.locator('.pop [data-x="files"]').waitFor();
    expect(await page.locator('.pop .report.bad').textContent()).toMatch(/home → \/about-us\//);
    const download = page.waitForEvent('download');
    await page.locator('.pop [data-x="files"]').click();
    expect((await download).suggestedFilename()).toMatch(/^my-site-.*\.zip$/);

    await page.locator('.sitebtn').click();
    await page.locator('.pop [data-site="ai"]').click();
    await page.locator('.pop .status-line').waitFor();
    expect(await page.locator('.pop .runner').textContent()).toMatch(/^Claude Code/);
    expect(await page.locator('.pop').textContent()).toMatch(/Not working on anything now/);
    // the Page tab is about this page only now
    await page.keyboard.press('Escape');
    await page.locator('.work .tabs [data-tab="page"]').click();
    await page.locator('.head-code').waitFor();
    expect(await page.locator('[data-page^="export"]').count()).toBe(0);
  });

  it('tells which AI answers, never its key', async () => {
    const st = await fetch(`${url}_tykerf/ai/status`).then((r) => r.json());
    expect(st).toMatchObject({ ok: true, runner: 'claude-code', testable: true, running: [] });
    expect(typeof st.ready).toBe('boolean');
    expect(JSON.stringify(st)).not.toMatch(/key=|sk-/);
  });

  it("has a home at /: its pages to open, rename and remove, and the ways to make a new one", async () => {
    await fetch(`${url}_tykerf/site/new`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'notes', layout: 'blank' }) });
    await page.goto(url);
    await page.locator('.pages .who a', { hasText: /^notes$/ }).waitFor();
    // a new page waits behind + New page, and then opens step by step
    expect(await page.locator('.chooser').count()).toBe(0);
    await page.locator('.pages .add').click();
    await page.locator('.chooser').waitFor();
    expect(await page.locator('.chooser [data-from][aria-pressed=true]').count()).toBe(0);
    expect(await page.locator('.chooser .ch-actions').isHidden()).toBe(true);
    await page.locator('[data-from="layout"]').click();
    expect(await page.locator('.chooser [data-layout]').first().isVisible()).toBe(true);
    expect(await page.locator('.chooser [type=submit]').textContent()).toBe('Create the page');
    await page.locator('.chooser [data-ch="cancel"]').click();
    expect(await page.locator('.chooser').count()).toBe(0);

    const row = page.locator('.pages li', { has: page.locator('a', { hasText: /^notes$/ }) });
    await row.locator('[data-act="rename"]').click();
    await page.locator('.pages form input').first().fill('Bad Name');
    await page.locator('.pages button.primary').click();
    await expect.poll(() => page.locator('.pages .error').textContent()).toMatch(/can't be a page name/);
    await page.locator('.pages form input').first().fill('');
    await page.locator('.pages form input').first().pressSequentially('journal'); // real key presses
    await page.locator('.pages button.primary').click();
    await page.locator('.pages .who a', { hasText: /^journal$/ }).waitFor();
    expect(existsSync(join(site, 'journal', 'layout.slice'))).toBe(true);

    // a copy of a page, next to it, without its history
    await page.locator('.pages li', { has: page.locator('a', { hasText: /^journal$/ }) }).locator('[data-act="duplicate"]').click();
    await page.locator('.pages .who a', { hasText: /^journal-copy$/ }).waitFor();
    expect(readFileSync(join(site, 'journal-copy', 'layout.slice'), 'utf8')).toBe(readFileSync(join(site, 'journal', 'layout.slice'), 'utf8'));
    expect(existsSync(join(site, 'journal-copy', '.history.jsonl'))).toBe(false);
    const again = await fetch(`${url}_tykerf/site/duplicate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'journal' }) }).then((r) => r.json());
    expect(again).toMatchObject({ ok: true, name: 'journal-copy-2', url: '/journal-copy-2/' });
    for (const n of ['journal-copy', 'journal-copy-2']) await fetch(`${url}_tykerf/site/remove`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: n }) });
    await expect.poll(() => page.locator('.pages .who a').allTextContents(), { timeout: 5000 }).not.toContain('journal-copy'); // the list looks again every 2 s

    const journal = page.locator('.pages li', { has: page.locator('a', { hasText: /^journal$/ }) });
    await journal.locator('[data-act="remove"]').click();
    const confirm = page.locator('.pages li', { has: page.locator('p') }); // the row asks before removing
    expect(await confirm.locator('p').textContent()).toBe("Remove the page journal? It goes to the site's .trash folder.");
    await confirm.locator('button.danger').click();
    await expect.poll(() => page.locator('.pages .who a').allTextContents()).not.toContain('journal');
    expect(existsSync(join(site, 'journal'))).toBe(false);

    // removed pages wait in the trash, until it is emptied for good
    await expect.poll(() => page.locator('.trash li b').allTextContents()).toContain('journal');
    await page.locator('.trash .empty').click();
    expect(await page.locator('.trash .row p').textContent()).toMatch(/for good\? This cannot be undone\./);
    await page.locator('.trash .row button.danger').click();
    await page.locator('.trash').waitFor({ state: 'hidden' });
    expect(existsSync(join(site, '.trash'))).toBe(false);

    // the home page, and a title set by hand
    const home = page.locator('.pages li', { has: page.locator('a', { hasText: /^home$/ }) });
    expect(await home.locator('[data-act="home"]').getAttribute('aria-label')).toBe('Make home the home page');
    await home.locator('[data-act="home"]').click();
    await home.locator('.home-mark').waitFor();
    await home.locator('[data-act="rename"]').click();
    await page.locator('.pages form input').nth(1).fill('Our home');
    await page.locator('.pages form button.primary').click();
    await page.locator('.pages li .who small', { hasText: 'Our home' }).waitFor();
    expect(JSON.parse(readFileSync(join(site, 'site.json'), 'utf8'))).toMatchObject({ home: 'home', titles: { home: 'Our home' } });
    // the site's address now opens the home page; the manager has its own; /pages/ lists them by title
    const front = await fetch(url, { redirect: 'manual' });
    expect([front.status, front.headers.get('location')]).toEqual([302, '/home/']);
    expect((await fetch(`${url}_tykerf/site/`)).status).toBe(200);
    expect(await (await fetch(`${url}pages/`)).text()).toMatch(/<a href="\/home\/"><span class="title">Our home<\/span><span class="route">\/home\/ <b>home<\/b><\/span>/);

    expect(await page.locator('header .to-home').getAttribute('href')).toBe('/home/');

    // styles and scripts for every page, apart from the theme
    await page.locator('.pages .styles-btn').click();
    await page.locator('.code textarea').fill('<style>.t-note { outline: 3px solid red }</style>');
    await page.locator('.code [data-code="save"]').click();
    await page.locator('.code .msg', { hasText: 'Saved' }).waitFor();
    expect(await (await fetch(`${url}home/`)).text()).toContain('.t-note { outline: 3px solid red }');
    expect(siteTheme()).toBeTruthy(); // the theme stays
    await page.locator('.code textarea').fill('<style data-tykerf-theme>:root{}</style>');
    await page.locator('.code [data-code="save"]').click();
    await page.locator('.code .msg.error', { hasText: 'Page tab' }).waitFor();
    await page.locator('.code [data-code="undo"]').click();
    await page.locator('.code .msg', { hasText: 'Undone' }).waitFor();
    expect(await page.locator('.code textarea').inputValue()).toBe('');
    await page.locator('.code [data-code="close"]').click();

    // from a page, the page list leads back to this home
    await page.locator('.pages .who a', { hasText: /^home$/ }).click();
    await page.locator('.pagesw').click();
    expect(await page.locator('.pop a.newpage-btn').getAttribute('href')).toBe('/_tykerf/site/');
    // and so do the Site button next to Edit with TYKERF, and the Site menu
    expect(await page.locator('.managebtn').getAttribute('href')).toBe('/_tykerf/site/');
    expect(await page.locator('.managebtn').isVisible()).toBe(true);
  });

  it('gives the site an icon, and TYKERF\'s screens TYKERF\'s', async () => {
    const icon = await fetch(`${url}favicon.svg`);
    expect([icon.status, icon.headers.get('content-type')]).toEqual([200, 'image/svg+xml']);
    // the manager: the icon and where it comes from; a file of its own, then the made one again
    await page.goto(`${url}_tykerf/site/`);
    expect(await page.locator('head link[rel="icon"]').getAttribute('href')).toBe('/_tykerf/favicon.svg');
    await page.locator('.pages .styles-btn').click();
    await page.locator('.code .icon-say', { hasText: 'made from the home page' }).waitFor();
    const file = join(mkdtempSync(join(tmpdir(), 'tykerf-icon-')), 'mine.svg');
    writeFileSync(file, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="red"/></svg>');
    const chooser = page.waitForEvent('filechooser');
    await page.locator('[data-icon="pick"]').click();
    await (await chooser).setFiles(file);
    await page.locator('.code .icon-say', { hasText: 'your file, favicon.svg' }).waitFor();
    expect(await (await fetch(`${url}favicon.svg`)).text()).toContain('fill="red"');
    await page.locator('[data-icon="reset"]').click();
    await page.locator('.code .icon-say', { hasText: 'made from the home page' }).waitFor();
    expect(existsSync(join(site, 'favicon.svg'))).toBe(false);
    await page.locator('.code [data-code="close"]').click();
    // a page being edited shows TYKERF's mark in its tab; its HTML links the site's icon (what visitors get)
    expect(await (await fetch(`${url}home/`)).text()).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
    await page.goto(`${url}home/`);
    await page.locator('section.panel').waitFor({ state: 'attached' });
    expect(await page.locator('head link[rel~="icon"]').evaluateAll((ls) => ls.map((l) => l.getAttribute('href')))).toEqual(['/_tykerf/favicon.svg']);
  });

  it('lists the links between pages, broken ones first, and opens a page on the box a link is in', async () => {
    // nothing running: Kaity's list stays hidden
    expect((await fetch(`${url}_tykerf/site`).then((r) => r.json())).kaity).toEqual({ site: false, pages: [] });
    const tree = (await fetch(`${url}home/_tykerf/state`).then((r) => r.json())).tree;
    const first = (function leaf(n: any): string { return n.kind === 'box' ? n.id : leaf(n.children[0]); })(tree);
    await fetch(`${url}home/_tykerf/box`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: first, full: '<p><a href="/team/">Team</a> <a href="/nowhere/">Gone</a></p>' }) });
    await page.goto(`${url}_tykerf/site/`);
    expect(await page.locator('.now').isHidden()).toBe(true);
    await page.locator('.links-btn').click();
    await page.locator('.links .summary', { hasText: /of them broken/ }).waitFor();
    expect(await page.locator('.links h3').first().textContent()).toBe("Links to pages that don't exist");
    const bad = page.locator('.links ul').first().locator('li', { hasText: '/nowhere/' });
    expect(await bad.textContent()).toBe(`home · ${first}/nowhere/no page "nowhere"`);
    expect(await page.locator('.links li', { hasText: /^home→/ }).textContent()).toMatch(/team/);
    expect(await bad.locator('a').getAttribute('href')).toBe(`/home/?block=${first}&tab=text`);
    // the page opens on that box's Text tab, and its address is clean again
    await bad.locator('a').click();
    await expect.poll(() => page.locator('.tree .item.sel').getAttribute('data-id')).toBe(first);
    expect(await page.locator('.work .tabs [data-tab="text"]').getAttribute('aria-selected')).toBe('true');
    expect(page.url()).toBe(`${url}home/`);
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
      expect(await (await fetch(`${at}_tykerf/version`)).json()).toEqual({ ok: true, outdated: false });
      const tab = await browser.newPage();
      await tab.goto(at);
      await tab.locator('.toggle').waitFor();
      expect(await tab.locator('.outdated').isHidden()).toBe(true);
      utimesSync(join(code, 'a.ts'), new Date(), new Date(Date.now() + 60_000));
      expect(await (await fetch(`${at}_tykerf/version`)).json()).toEqual({ ok: true, outdated: true });
      await tab.reload();
      await tab.locator('.outdated', { hasText: 'Restart it' }).waitFor();
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
