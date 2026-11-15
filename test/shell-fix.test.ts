// Fixing one thing by hand in the v3 editor (shell/fix.js): only the element clicked, saved into its box's code;
// the wider editors one step away (all the text, the code, size and look); the box tree; and the page shrunk to
// fit beside the panel at its real width.

import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { find } from '../src/model.js';
import { newSitePage } from '../src/site.js';
import { tasks } from '../src/tasks.js';
import type { Workspace } from '../src/workspace.js';
import { freePort } from './ports.js';

vi.setConfig({ testTimeout: 30_000 });

describe('fixing by hand in the v3 editor', () => {
  let browser: Browser;
  let server: ChildProcess;
  let ws: Workspace;
  let page: Page;

  beforeAll(async () => {
    const site = join(mkdtempSync(join(tmpdir(), 'tykerf-shell-fix-')), 'site');
    ws = newSitePage(site, 'first', 'launch', 'studio');
    newSitePage(site, 'second', 'launch', 'studio', { shared: false });
    const port = await freePort();
    server = spawn(process.execPath, ['--import', 'tsx', 'src/editor/server.ts', site, '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, TYKERF_DOTENV: 'off' } });
    await new Promise<void>((ok, fail) => {
      server.stdout!.on('data', (d) => String(d).includes('TYKERF: http') && ok());
      server.on('exit', (c) => fail(new Error(`editor exited with ${c}`)));
    });
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(10_000);
    await page.goto(`http://localhost:${port}/_tykerf/edit/first/`);
    await page.frameLocator('.frame').locator('[data-sw="hero"]').waitFor();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    server?.kill();
  });

  const frame = () => page.frameLocator('.frame');
  const panel = () => page.locator('.fixbar');

  it('shows only the element clicked: a link\'s words and where it leads, saved into the box', async () => {
    await frame().locator('[data-sw="hero"] a', { hasText: 'Get started' }).first().click();
    await page.locator('.taskbox [data-box="hand"]').click();
    await panel().locator('.fxtitle').waitFor();
    expect(await panel().locator('.fxtitle').textContent()).toBe('the link "Get started free"');
    expect(await page.locator('.bar .status').textContent()).toContain('Fixing by hand · the link "Get started free"');
    expect(await panel().locator('.fxnote').last().textContent()).toBe('hero is the same on second. This fix stays on first unless you share the box.');
    await panel().locator('[name="text"]').fill('Start for free');
    await panel().locator('[name="href"]').selectOption('#sw-pricing');
    await panel().locator('[type="submit"]').click();
    await expect.poll(() => ws.content('hero')).toContain('Start for free');
    expect(ws.content('hero')).toContain('href="#sw-pricing"');
    await frame().locator('[data-sw="hero"] a', { hasText: 'Start for free' }).waitFor();
    // one step, which Undo takes back
    expect(ws.peekUndo()?.label).toMatch(/hero/);
    await page.locator('[data-bar="undo"]').click();
    await expect.poll(() => ws.content('hero')).toContain('Get started free');
  });

  it('goes one step further: all the box\'s text, its code, its size and look', async () => {
    await panel().locator('[data-view="text"]').click();
    const fields = panel().locator('.fxtext input, .fxtext textarea');
    expect(await fields.count()).toBeGreaterThan(3);
    await panel().locator('[data-view="element"]').click();
    await panel().locator('[data-view="look"]').click();
    await panel().locator('[name="w"]').fill('900');
    await panel().locator('[name="tone"]').selectOption('soft');
    await panel().locator('.fxlook [type="submit"]').click();
    await expect.poll(() => (find(ws.load().root, 'hero')?.node as { maxW?: number }).maxW).toBe(900);
    expect((find(ws.load().root, 'hero')?.node as { tags?: string[] }).tags).toContain('tone-soft');
    await panel().locator('[data-view="element"]').click();
    await panel().locator('[data-view="code"]').click();
    expect(await panel().locator('[name="html"]').inputValue()).toContain('Get started free');
  });

  it('moves, adds and deletes boxes in the tree, with the page shrunk to fit at its real width', async () => {
    await panel().locator('[data-view="element"]').click();
    await panel().locator('[data-view="tree"]').click();
    await panel().locator('[data-box="pricing"]').click();
    await panel().locator('[data-mode="shrink"]').click();
    // the page keeps its width; it is scaled to fit beside the panel, and the bar says how much
    expect(await page.locator('.frame').evaluate((f: HTMLIFrameElement) => f.contentWindow!.innerWidth)).toBe(1440);
    expect(await page.locator('.viewport').evaluate((v) => getComputedStyle(v).transform)).toMatch(/^matrix\(0\.7/);
    expect(await page.locator('.bar .zoom').textContent()).toMatch(/^7\d %$/);
    const order = () => (ws.load().root as { children: { id: string }[] }).children.map((c) => c.id);
    const before = order().indexOf('pricing'), boxes = order().length;
    await panel().locator('[data-op="up"]').click();
    await expect.poll(() => order().indexOf('pricing')).toBe(before - 1);
    await panel().locator('[data-op="below"]').click();
    await expect.poll(() => order().length).toBe(boxes + 1);
    const added = order()[order().indexOf('pricing') + 1];
    expect(added).not.toBe('testimonials');
    await expect.poll(() => panel().locator('li[aria-selected="true"] .bname').textContent()).toBe(added);
    await panel().locator('[data-op="delete"]').click();
    await panel().locator('[data-op="delete-yes"]').click();
    await expect.poll(() => order().includes(added)).toBe(false);
    // the choice is remembered; over the page, the page is as it was
    await panel().locator('[data-mode="over"]').click();
    expect(await page.locator('.viewport').evaluate((v) => getComputedStyle(v).transform)).toBe('none');
  });

  it('leaves it as a task for Kaity instead', async () => {
    await frame().locator('[data-sw="hero"] h1').click();
    await expect.poll(() => panel().locator('.fxtitle').textContent()).toMatch(/^the heading "/);
    await panel().locator('[data-fx="task"]').click();
    expect(await panel().isHidden()).toBe(true);
    await page.locator('.taskbox textarea').fill('Shorter, please');
    await page.locator('.taskbox [data-box="add"]').click();
    await expect.poll(() => tasks(ws).at(-1)?.text).toBe('Shorter, please');
    expect(tasks(ws).at(-1)?.label).toMatch(/^h1 "/);
  });
});
