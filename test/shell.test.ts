// A page in the v4 editor (public/shell.html, shell/*.js at /_tykerf/edit/<page>/): the one frame (the top bar, the
// rail with the page's sections), the page in a frame at the rest of the width, tasks left by clicking it, the rail's
// sections and the drop-down from "This page", the tray, the one Undo, and View mode, which stays while following
// links until Edit.

import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPage } from '../src/library.js';
import { setHome } from '../src/site.js';
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
    createPage(new Workspace(join(site, 'about')), 'factual');
    setHome(site, 'home');
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

  it('shows the one frame: the top bar, the rail with the page\'s sections, the page at the rest of the width, and the composer', async () => {
    await page.goto(`${base}/_tykerf/edit/home/`);
    await frame().locator('[data-sw="hero"]').waitFor();
    // the top bar: where you are, the page's modes and widths, then Kaity, Checks, one Undo, one Publish
    expect(await page.locator('.bar .crumb b').textContent()).toBe('home');
    expect(await page.locator('.bar .modes a').allTextContents()).toEqual(['Tasks', 'Edit', 'View']);
    expect(await page.locator('.bar .modes [aria-current]').textContent()).toBe('Tasks');
    expect(await page.locator('.bar .widths button').allTextContents()).toEqual(['Desktop', '768', '375']);
    expect(await page.locator('.bar [data-top="kaity"]').count()).toBe(1);
    expect(await page.locator('.bar [data-top="page"]').textContent()).toBe('This page');
    expect(await page.getByRole('button', { name: /^Undo|^Nothing to undo/ }).count()).toBe(1);
    expect(await page.getByRole('link', { name: 'Publish' }).count()).toBe(1);
    // the rail is the page's: back to the site, its name, Home and address, then its sections; nothing on the right
    await expect.poll(() => page.locator('.rail .rpname').textContent()).toBe('homeHome/home/');
    expect(await page.locator('.rail .rback').textContent()).toBe('Site');
    expect(await page.locator('.rail .acc-t').allTextContents()).toEqual(['Tasks on this page', 'Kaity on this page', 'Blocks', 'Site']);
    expect(await page.locator('.pside').count()).toBe(0);
    // Blocks: every block, containers too (unfolded to read it)
    await page.locator('.rail [data-acc="blocks"]').click();
    expect(await page.locator('.rail .tree [data-block]').count()).toBeGreaterThan(3);
    // Site holds the rest of the site's rail: its pages, its screens, the Kaity center
    await page.locator('.rail [data-acc="site"]').click();
    expect(await page.locator('.rail .rlist a').allTextContents()).toContain('Kaity center');
    expect(await page.locator('.rail .rpage[aria-current]').textContent()).toContain('home');
    for (const k of ['blocks', 'site']) await page.locator(`.rail [data-acc="${k}"]`).click();
    // the status line, the sections, the composer under the page: one line, its scope a drop-down
    expect(await page.locator('.pstatus .hint').textContent()).toBe('Click anything on the page and say what should change, or ask Kaity about the whole page below.');
    expect(await page.locator('.rail [data-section="tasks"] .empty').textContent()).toBe('No open tasks. Click anything on the page and say what should change.');
    expect(await page.locator('.pagecol .composer.line select option').allTextContents()).toEqual(['This page', 'Whole site']);
    expect(await page.locator('.pagecol .composer [data-c="attach"]').getAttribute('aria-label')).toBe('Attach');
    expect(Math.round((await page.locator('.pagecol .composer').boundingBox())!.height)).toBeLessThanOrEqual(52);
    // at 1440 px with the rail open the page has at least 1080 px
    await page.setViewportSize({ width: 1440, height: 900 });
    expect(await page.locator('.stage').evaluate((s) => s.clientWidth)).toBeGreaterThanOrEqual(1080);
    await page.setViewportSize({ width: 1280, height: 900 });
    // the page in the frame has no editor of its own, and is laid out at the room its column has
    expect(await frame().locator('tykerf-root').count()).toBe(0);
    const inner = await page.locator('.frame').evaluate((f: HTMLIFrameElement) => f.contentWindow!.innerWidth);
    expect(inner).toBe(Math.round(await page.locator('.stage').evaluate((s) => s.clientWidth)));
  });

  it('leaves a task on what was clicked, with its block, element and width, and pins it there', async () => {
    const h1 = frame().locator('[data-sw="hero"] h1');
    await h1.hover();
    await page.locator('.outline.hover').waitFor();
    await h1.click();
    const box = page.locator('.taskbox');
    await box.waitFor();
    // one line: New task (no number until it is one), the box (its tooltip says Kaity changes only it), the element
    expect(await box.locator('.where .num').textContent()).toBe('New task');
    expect(await box.locator('.where b').textContent()).toBe('hero');
    expect(await box.locator('.where b').getAttribute('title')).toBe('Kaity changes only hero for it.');
    expect(await box.locator('.where .what').textContent()).toMatch(/^› the heading ".+"$/);
    expect(await box.locator('.where .chip').count()).toBe(0);
    expect(await box.locator('textarea').getAttribute('placeholder')).toBe('What should change here? End with ? to ask.');
    expect(await box.locator('button').evaluateAll((b) => b.map((x) => (x as HTMLElement).dataset.box))).toEqual(['q', 'cancel', 'pic', 'menu', 'add']);
    expect(await box.locator('[data-box="pic"]').textContent()).toBe('Attach');
    // the block picked is the composer's too: it is aimed at it (one Kaity input besides the task box)
    expect(await page.locator('.pagecol .composer select option').allTextContents()).toEqual(['This box: hero', 'This page', 'Whole site']);
    expect(await page.locator('.pagecol .composer select').inputValue()).toBe('box');
    expect(await page.locator('.pagecol .composer textarea').getAttribute('placeholder')).toBe('Ask Kaity about hero…');
    expect(await page.locator('textarea:visible').count()).toBe(2);
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
    expect(await page.locator('.pstatus [data-bar="tray"]').textContent()).toBe('1 task · see them all');
    // Tasks on this page lists it, with its number, as the pin does; the top bar's This page counts it
    expect(await page.locator('.rail .ptask').textContent()).toBe('1hero — Make the headline fit on two lines on a phone');
    expect(await page.locator('.rail [data-acc="tasks"] .acc-n').textContent()).toBe('1');
    expect(await page.locator('.bar [data-top="page"] .tcount').textContent()).toBe('1 task');
    expect(tasks(ws)[0]).toMatchObject({ n: 1, block: 'hero', text: 'Make the headline fit on two lines on a phone' });
    expect(tasks(ws)[0].width).toBe(Math.round(await page.locator('.stage').evaluate((s) => s.clientWidth)));
    expect(tasks(ws)[0].label).toMatch(/^h1 "/);
    expect(tasks(ws)[0].path!.length).toBeGreaterThan(0);
  });

  it('takes a question, suggested by its question mark; nothing on the page reacts to a click', async () => {
    const url = await page.locator('.frame').evaluate((f: HTMLIFrameElement) => f.contentWindow!.location.href);
    const link = frame().locator('[data-sw="hero"] a').first();
    await link.click();
    const box = page.locator('.taskbox');
    await box.locator('textarea').pressSequentially('Where does this lead?');
    expect(await box.locator('.num').getAttribute('aria-pressed')).toBe('true'); // New task became Question
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

  it('lists the tasks in the tray, and the top bar\'s one Undo takes back a task marked done', async () => {
    await page.locator('.pstatus [data-bar="tray"]').click();
    const tray = page.locator('.tray');
    await tray.waitFor();
    expect(await tray.locator('h2').textContent()).toBe('1 task and 1 question on home');
    expect(await tray.locator('.card .text').allTextContents()).toEqual(['Make the headline fit on two lines on a phone', 'Where does this lead?']);
    expect(await tray.locator('.card[data-card="2"] [data-card-act="done"]').count()).toBe(0); // a question is answered, not marked done
    expect(await page.locator('.pstatus [data-bar="tray"]').getAttribute('aria-expanded')).toBe('true');
    await tray.locator('.card[data-card="1"] [data-card-act="done"]').click();
    await expect.poll(() => tray.locator('.card').count()).toBe(1);
    expect(tasks(ws)[0].done).toBeTruthy();
    await expect.poll(() => page.locator('[data-top="undo"]').getAttribute('title')).toBe('Undo "close task 1"');
    await page.locator('[data-top="undo"]').click();
    await expect.poll(() => tray.locator('.card').count()).toBe(2);
    expect(tasks(ws)[0].done).toBeUndefined();
    // Escape closes the tray
    await page.keyboard.press('Escape');
    expect(await tray.isHidden()).toBe(true);
    // a pin opens the tray on its card
    await page.locator('.pin[data-pin="2"]').click();
    expect(await page.locator('.tray .card[data-card="2"]').getAttribute('class')).toContain('lit');
    await page.locator('.pstatus [data-bar="tray"]').click();
  });

  it('picks a block in the rail: it is shown on the page, and the composer\'s This box', async () => {
    await page.locator('.rail [data-acc="blocks"]').click();
    await page.locator('.rail [data-block="footer"]').click();
    expect(await page.locator('.rail [data-block="footer"]').getAttribute('aria-current')).toBe('true');
    await page.locator('.outline.flash').waitFor();
    expect(await page.locator('.pagecol .composer select option:checked').textContent()).toBe('This box: footer');
    // the open sections are remembered across a reload
    await page.reload();
    await frame().locator('[data-sw="hero"]').waitFor();
    expect(await page.locator('.rail [data-acc="blocks"]').getAttribute('aria-expanded')).toBe('true');
    await page.locator('.rail [data-acc="blocks"]').click();
  });

  it('folds the rail to a strip: the page takes the width, and This page drops the same sections from the top bar', async () => {
    const w = await page.locator('.stage').evaluate((s) => s.clientWidth);
    await page.locator('.rail [data-rail="fold"]').click();
    expect(await page.locator('.rail .rstrip [data-strip]').evaluateAll((b) => b.map((x) => (x as HTMLElement).dataset.strip))).toEqual(['tasks', 'kaity', 'blocks']);
    await expect.poll(() => page.locator('.stage').evaluate((s) => s.clientWidth)).toBeGreaterThan(w + 150);
    await page.locator('.bar [data-top="page"]').click();
    const menu = page.locator('.pmenu');
    await menu.waitFor();
    expect(await menu.locator('.acc-t').allTextContents()).toEqual(['Tasks on this page', 'Kaity on this page', 'Blocks']);
    expect(await menu.locator('.ptask').count()).toBe(2);
    await page.keyboard.press('Escape');
    expect(await menu.isHidden()).toBe(true);
    // the strip's icons drop it too; Pin to the side panel unfolds the rail
    await page.locator('.rail [data-strip="tasks"]').click();
    await menu.locator('[data-menu="pin"]').click();
    expect(await menu.isHidden()).toBe(true);
    await expect.poll(() => page.locator('.rail').getAttribute('class')).not.toContain('folded');
    // with the rail open, This page goes to its Tasks section
    await page.locator('.bar [data-top="page"]').click();
    expect(await page.locator('.pmenu').isHidden()).toBe(true);
    expect(await page.locator('.rail [data-acc="tasks"]').getAttribute('aria-expanded')).toBe('true');
  });

  it('views the site as a visitor does, and stays in View while following links, until Edit', async () => {
    await page.locator('.bar .modes a', { hasText: 'View' }).click();
    await page.waitForURL(/\/home\/$/);
    expect(await page.locator('.bar').count()).toBe(0);
    expect(await page.locator('tykerf-root').count()).toBe(0);
    // the pill: tykerf · Viewing · the page switcher · Edit this page
    const pill = page.locator('tykerf-view');
    await pill.locator('.pill').waitFor();
    expect(await pill.locator('.tag').textContent()).toBe('Viewing');
    expect(await pill.locator('.edit').textContent()).toBe('Edit this page');
    // a link to another page of the site keeps View
    await page.goto(`${base}/about/`);
    await pill.locator('.pill').waitFor();
    expect(await pill.locator('.switch').textContent()).toBe('about ▾');
    await pill.locator('.switch').click();
    await expect.poll(() => pill.locator('.menu a').allTextContents()).toEqual(['about', 'homeHome', '← Back to the site manager']);
    await page.keyboard.press('Escape');
    await page.goto(`${base}/`);
    await page.waitForURL(/\/home\/$/); // "/" in View is the home page, as for a visitor
    await pill.locator('.pill').waitFor();
    // Edit this page goes back to Tasks on it, and View is over
    await pill.locator('.edit').click();
    await page.waitForURL(/\/_tykerf\/edit\/home\/$/);
    await frame().locator('[data-sw="hero"]').waitFor();
    await page.goto(`${base}/about/`);
    await page.waitForURL(/\/_tykerf\/edit\/about\/$/);
    // and with the keyboard, both ways
    await page.goto(`${base}/_tykerf/edit/home/`);
    await frame().locator('[data-sw="hero"]').waitFor();
    await page.keyboard.press('Alt+Shift+KeyT');
    await page.waitForURL(/\/home\/$/);
    await page.locator('tykerf-view .pill').waitFor();
    await page.keyboard.press('Alt+Shift+KeyT');
    await page.waitForURL(/\/_tykerf\/edit\/home\/$/);
  });

  it('shows the page at a tablet\'s or a phone\'s width from the bar, and tasks written then say that width', async () => {
    await frame().locator('[data-sw="hero"]').waitFor();
    const width = () => page.locator('.frame').evaluate((f: HTMLIFrameElement) => f.contentWindow!.innerWidth);
    const desk = await width();
    expect(await page.locator('.bar .widths [aria-pressed="true"]').getAttribute('data-device')).toBe('full');
    await page.locator('.bar [data-device="tablet"]').click();
    await expect.poll(width).toBe(768);
    await page.locator('.bar [data-device="phone"]').click();
    await expect.poll(width).toBe(375);
    await frame().locator('[data-sw="hero"] h1').click();
    expect(await page.locator('.taskbox .where .chip').textContent()).toBe('375 px');
    // only the page takes the phone's width: the task box keeps its own (440 px), past the page's sides if it must
    expect(Math.round((await page.locator('.taskbox').boundingBox())!.width)).toBe(440);
    await page.keyboard.press('Escape'); // the task box
    await page.keyboard.press('Escape'); // then the full width again
    await expect.poll(width).toBe(desk);
  });

  it('keeps the top bar on one line in a 1280 px window', async () => {
    expect(Math.round((await page.locator('.bar').boundingBox())!.height)).toBeLessThan(60);
  });

  it('fits a narrow window: the rail folds above the page, nothing scrolls sideways', async () => {
    const narrow = await browser.newPage({ viewport: { width: 375, height: 760 } });
    await narrow.goto(`${base}/_tykerf/edit/home/`);
    await narrow.frameLocator('.frame').locator('[data-sw="hero"]').waitFor();
    expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await narrow.locator('.rail').getAttribute('class')).toContain('folded');
    for (const b of ['[data-top="undo"]', '[data-top="publish"]', '[data-top="kaity"]']) expect(await narrow.locator(b).isVisible()).toBe(true);
    await narrow.locator('.rail [data-rail="unfold"]').click();
    expect(await narrow.locator('.rail .acc-h').first().isVisible()).toBe(true);
    expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await narrow.close();
  });

  it('says so for a page the site does not have', async () => {
    const r = await fetch(`${base}/_tykerf/edit/nope/`);
    expect(r.status).toBe(404);
    expect((await fetch(`${base}/_tykerf/edit/home`, { redirect: 'manual' })).headers.get('location')).toBe('/_tykerf/edit/home/');
  });
});
