// The v3 editor's shell (public/shell.html, shell/*.js at /_tykerf/edit/<page>/): the bar, the page in a frame at
// its real width, tasks left by clicking the page, the tray, Undo for tasks, and Hide tykerf with the way back.

import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPage } from '../src/library.js';
import { tasks } from '../src/tasks.js';
import { Workspace } from '../src/workspace.js';
import { freePort } from './ports.js';

vi.setConfig({ testTimeout: 30_000 });

describe('the v3 editor', () => {
  let browser: Browser;
  let server: ChildProcess;
  let ws: Workspace;
  let base: string;
  let page: Page;

  beforeAll(async () => {
    const site = join(mkdtempSync(join(tmpdir(), 'tykerf-shell-')), 'site');
    ws = new Workspace(join(site, 'home'));
    createPage(ws, 'launch');
    const port = await freePort();
    base = `http://localhost:${port}`;
    server = spawn(process.execPath, ['--import', 'tsx', 'src/editor/server.ts', site, '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, TYKERF_DOTENV: 'off' } });
    await new Promise<void>((ok, fail) => {
      server.stdout!.on('data', (d) => String(d).includes('TYKERF: http') && ok());
      server.on('exit', (c) => fail(new Error(`editor exited with ${c}`)));
    });
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(8000);
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    server?.kill();
  });

  const frame = () => page.frameLocator('.frame');

  it('shows the bar and the page at its real width, untouched, under it', async () => {
    await page.goto(`${base}/_tykerf/edit/home/`);
    await expect.poll(() => page.locator('.bar .switcher .name').textContent()).toBe('home');
    expect(await page.locator('.bar .hint').textContent()).toBe('Click anything on the page and say what should change.');
    expect(await page.locator('[data-bar="tray"]').textContent()).toBe('0 tasks');
    expect(await page.locator('[data-bar="give"]').isDisabled()).toBe(true);
    await frame().locator('[data-sw="hero"]').waitFor();
    // the page in the frame has no editor of its own, and the frame is as wide as the window
    expect(await frame().locator('tykerf-root').count()).toBe(0);
    expect(await page.locator('.frame').evaluate((f: HTMLIFrameElement) => f.contentWindow!.innerWidth)).toBe(1280);
    const barBottom = await page.locator('.bar').evaluate((b) => b.getBoundingClientRect().bottom);
    expect(await page.locator('.frame').evaluate((f) => f.getBoundingClientRect().top)).toBe(barBottom);
  });

  it('leaves a task on what was clicked, with its block, element and width, and pins it there', async () => {
    const h1 = frame().locator('[data-sw="hero"] h1');
    await h1.hover();
    await page.locator('.outline.hover').waitFor();
    await h1.click();
    const box = page.locator('.taskbox');
    await box.waitFor();
    // one line: the number, the box (its tooltip says Kaity changes only it), the element; no width at full width
    expect(await box.locator('.where .num').textContent()).toBe('1');
    expect(await box.locator('.where b').textContent()).toBe('hero');
    expect(await box.locator('.where b').getAttribute('title')).toBe('Kaity changes only hero for it.');
    expect(await box.locator('.where .what').textContent()).toMatch(/^› the heading ".+"$/);
    expect(await box.locator('.where .chip').count()).toBe(0);
    expect(await box.locator('textarea').getAttribute('placeholder')).toBe('What should change here? End with ? to ask.');
    expect(await box.locator('button').evaluateAll((b) => b.map((x) => (x as HTMLElement).dataset.box))).toEqual(['q', 'cancel', 'pic', 'menu', 'now', 'add']);
    await box.locator('textarea').fill('Make the headline fit on two lines on a phone');
    // More… opens the right-click menu from the box, which stays with what is written in it
    expect(await box.locator('[data-box="menu"]').textContent()).toBe('More… or right-click');
    await box.locator('[data-box="menu"]').click();
    const menu = page.locator('.ctxmenu');
    await menu.locator('[role=menuitem]').first().waitFor();
    expect(await menu.locator('[data-ctx="task"], [data-ctx="question"]').count()).toBe(0);
    expect(await menu.locator('[data-ctx="hand"]').count()).toBe(1);
    await page.keyboard.press('Escape');
    expect(await menu.isHidden()).toBe(true);
    expect(await box.locator('textarea').inputValue()).toBe('Make the headline fit on two lines on a phone');
    expect(await box.locator('.num').getAttribute('aria-pressed')).toBe('false');
    await box.locator('[data-box="add"]').click();
    await page.locator('.pin[data-pin="1"]').waitFor();
    expect(await page.locator('.taskbox').count()).toBe(0);
    expect(await page.locator('[data-bar="tray"]').textContent()).toBe('1 task');
    expect(tasks(ws)[0]).toMatchObject({ n: 1, block: 'hero', width: 1280, text: 'Make the headline fit on two lines on a phone' });
    expect(tasks(ws)[0].label).toMatch(/^h1 "/);
    expect(tasks(ws)[0].path!.length).toBeGreaterThan(0);
  });

  it('takes a question, suggested by its question mark; nothing on the page reacts to a click', async () => {
    const url = await page.locator('.frame').evaluate((f: HTMLIFrameElement) => f.contentWindow!.location.href);
    const link = frame().locator('[data-sw="hero"] a').first();
    await link.click();
    const box = page.locator('.taskbox');
    await box.locator('textarea').pressSequentially('Where does this lead?');
    expect(await box.locator('.num').getAttribute('aria-pressed')).toBe('true'); // the number became Question
    expect(await box.locator('.num').textContent()).toBe('Question');
    expect(await box.locator('[data-box="add"]').textContent()).toBe('Add question');
    // a click on it makes it a task, and again a question
    await box.locator('.num').click();
    expect(await box.locator('[data-box="add"]').textContent()).toBe('Add task');
    await box.locator('.num').click();
    expect(await box.locator('textarea').inputValue()).toBe('Where does this lead?');
    await box.locator('[data-box="add"]').click();
    await page.locator('.pin.question').waitFor();
    expect(tasks(ws).at(-1)).toMatchObject({ kind: 'question', text: 'Where does this lead?' });
    expect(await page.locator('.frame').evaluate((f: HTMLIFrameElement) => f.contentWindow!.location.href)).toBe(url);
    // Escape closes an open box without adding anything
    await frame().locator('[data-sw="hero"] h1').click();
    await page.keyboard.press('Escape');
    expect(await page.locator('.taskbox').count()).toBe(0);
  });

  it('lists the tasks in the tray, and Undo takes back a task marked done', async () => {
    await page.locator('[data-bar="tray"]').click();
    const tray = page.locator('.tray');
    await tray.waitFor();
    expect(await tray.locator('h2').textContent()).toBe('1 task and 1 question on home');
    expect(await tray.locator('.card .text').allTextContents()).toEqual(['Make the headline fit on two lines on a phone', 'Where does this lead?']);
    expect(await tray.locator('.card[data-card="2"] [data-card-act="done"]').count()).toBe(0); // a question is answered, not marked done
    expect(await page.locator('[data-bar="tray"]').getAttribute('aria-expanded')).toBe('true');
    // a pin opens the tray on its card
    await tray.locator('.card[data-card="1"] [data-card-act="done"]').click();
    await expect.poll(() => tray.locator('.card').count()).toBe(1);
    expect(tasks(ws)[0].done).toBeTruthy();
    expect(await page.locator('[data-bar="undo"]').getAttribute('title')).toBe('Undo "close task 1"');
    await page.locator('[data-bar="undo"]').click();
    await expect.poll(() => tray.locator('.card').count()).toBe(2);
    expect(tasks(ws)[0].done).toBeUndefined();
    // Escape closes the tray
    await page.keyboard.press('Escape');
    expect(await tray.isHidden()).toBe(true);
    await page.locator('.pin[data-pin="2"]').click();
    expect(await page.locator('.tray .card[data-card="2"]').getAttribute('class')).toContain('lit');
    await page.locator('[data-bar="tray"]').click();
  });

  it('hides itself for a look as a visitor, and comes back', async () => {
    await page.locator('[data-bar="hide"]').click();
    await page.waitForURL(/\/home\/\?tykerf=hidden$/);
    expect(await page.locator('.bar').count()).toBe(0);
    expect(await page.locator('tykerf-root').count()).toBe(0);
    // TYKERF's pill in the corner: its mark and a word
    expect(await page.locator('[data-tykerf-show] svg rect').count()).toBe(5);
    expect(await page.locator('[data-tykerf-show]').textContent()).toBe('Show tykerf');
    await page.locator('[data-tykerf-show]').click();
    await page.waitForURL(/\/_tykerf\/edit\/home\/$/);
    await page.locator('.bar .switcher').waitFor();
    // and with the keyboard, both ways
    await frame().locator('[data-sw="hero"]').waitFor();
    await page.keyboard.press('Alt+Shift+KeyT');
    await page.waitForURL(/tykerf=hidden$/);
    await page.keyboard.press('Alt+Shift+KeyT');
    await page.waitForURL(/\/_tykerf\/edit\/home\/$/);
  });

  it('shows the page at a tablet\'s or a phone\'s width from the bar, and tasks written then say that width', async () => {
    const width = () => page.locator('.frame').evaluate((f: HTMLIFrameElement) => f.contentWindow!.innerWidth);
    expect(await page.locator('.bar .widths [aria-pressed="true"]').getAttribute('data-device')).toBe('full');
    expect(await page.locator('.bar .widths button').allTextContents()).toEqual(['100 %', '768', '375']);
    const box = () => page.locator('.bar .widths').evaluate((e) => e.getBoundingClientRect().width);
    const before = await box();
    await page.locator('.bar [data-device="tablet"]').click();
    await expect.poll(width).toBe(768);
    expect(await box()).toBe(before); // the box doesn't change size, so the hint after it stays where it is
    expect(await page.locator('.bar [data-device="tablet"]').textContent()).toBe('768');
    await page.locator('.bar [data-device="phone"]').click();
    await expect.poll(width).toBe(375);
    await frame().locator('[data-sw="hero"] h1').click();
    expect(await page.locator('.taskbox .where .chip').textContent()).toBe('375 px');
    await page.keyboard.press('Escape'); // the task box
    await page.keyboard.press('Escape'); // then the full width again
    await expect.poll(width).toBe(1280);
  });

  it('fits a narrow window: the bar wraps, nothing scrolls sideways', async () => {
    const narrow = await browser.newPage({ viewport: { width: 375, height: 760 } });
    await narrow.goto(`${base}/_tykerf/edit/home/`);
    await narrow.locator('.bar .switcher').waitFor();
    await narrow.frameLocator('.frame').locator('[data-sw="hero"]').waitFor();
    expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const b of ['tray', 'give', 'undo', 'hide']) expect(await narrow.locator(`[data-bar="${b}"]`).isVisible()).toBe(true);
    expect(await narrow.locator('.frame').evaluate((f: HTMLIFrameElement) => f.contentWindow!.innerWidth)).toBe(375);
    await narrow.close();
  });

  it('says so for a page the site does not have', async () => {
    const r = await fetch(`${base}/_tykerf/edit/nope/`);
    expect(r.status).toBe(404);
    expect((await fetch(`${base}/_tykerf/edit/home`, { redirect: 'manual' })).headers.get('location')).toBe('/_tykerf/edit/home/');
  });
});
