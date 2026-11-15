// Fixing one thing by hand in the v3 editor (shell/fix.js): only the element clicked, saved into its box's code;
// the bigger fixes in the full editor, on the box and the tab for them (R8, R9); and the page shrunk to fit beside
// the panel at its real width.

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

  it('leads to the full editor for a bigger fix: the box selected, at the tab for it', async () => {
    const full = '/_tykerf/edit/first/?mode=full&block=hero';
    expect(await panel().locator('.fxmore a').evaluateAll((a) => a.map((x) => x.getAttribute('href')))).toEqual([`${full}&tab=size`, `${full}&tab=text`, `${full}&tab=code`, full]);
    await panel().locator('[data-full="code"]').click();
    await page.waitForURL(/\/_tykerf\/edit\/first\/\?mode=full$/);
    await expect.poll(() => frame().locator('.work .w-name').inputValue()).toBe('hero');
    expect(await frame().locator('.work .tabs [data-tab="code"]').getAttribute('aria-selected')).toBe('true');
    // the quick fix has no copies of those editors
    await page.locator('.bar .modes a', { hasText: 'Tasks' }).click();
    await page.waitForURL(/\/_tykerf\/edit\/first\/$/);
    await frame().locator('[data-sw="hero"]').waitFor();
  });

  it('shrinks the page to fit beside the panel, at its real width', async () => {
    await frame().locator('[data-sw="hero"] h1').click();
    await page.locator('.taskbox [data-box="hand"]').click();
    await panel().locator('.fxtitle').waitFor();
    expect(await panel().locator('[data-view]').count()).toBe(0);
    await panel().locator('[data-mode="shrink"]').click();
    // the page keeps its width; it is scaled to fit beside the panel, and the bar says how much
    expect(await page.locator('.frame').evaluate((f: HTMLIFrameElement) => f.contentWindow!.innerWidth)).toBe(1440);
    expect(await page.locator('.viewport').evaluate((v) => getComputedStyle(v).transform)).toMatch(/^matrix\(0\.7/);
    expect(await page.locator('.bar [data-device="full"]').textContent()).toMatch(/^7\d %$/); // on the full-width button
    // over the page, the page is as it was
    await panel().locator('[data-mode="over"]').click();
    expect(await page.locator('.viewport').evaluate((v) => getComputedStyle(v).transform)).toBe('none');
  });

  it('never shrinks the page in Full editor mode: its panel is in the page, and would shrink with it', async () => {
    await panel().locator('[data-mode="shrink"]').click();
    const url = page.url();
    await page.goto(url.replace(/\/$/, '/?mode=full'));
    await frame().locator('.panel').waitFor();
    await page.locator('[data-bar="pages"]').click();
    await page.locator('.sidebar .pcard').first().waitFor();
    // the switch is there, as in Tasks: Over the page, and Shrink greyed out with why
    expect(await page.locator('.sidebar [data-mode="over"]').getAttribute('aria-pressed')).toBe('true');
    const shrink = page.locator('.sidebar [data-mode="shrink"]');
    expect(await shrink.getAttribute('aria-disabled')).toBe('true');
    expect(await shrink.getAttribute('title')).toMatch(/isn't shrunk: its panel would shrink with it/);
    await shrink.click({ force: true }); // (it can be clicked: it says why, and nothing changes)
    await page.locator('.toast', { hasText: "isn't shrunk" }).waitFor();
    expect(await page.locator('.viewport').evaluate((v) => getComputedStyle(v).transform)).toBe('none');
    expect(await page.locator('.bar [data-device="full"]').textContent()).toBe('100 %');
    // back in Tasks, shrink to fit is as the person left it
    await page.locator('.sidebar [data-sb="collapse"]').click();
    await page.goto(url);
    await frame().locator('[data-sw="hero"]').waitFor();
    await frame().locator('[data-sw="hero"] h1').click();
    await page.locator('.taskbox [data-box="hand"]').click();
    await panel().locator('.fxtitle').waitFor();
    expect(await page.locator('.viewport').evaluate((v) => getComputedStyle(v).transform)).toMatch(/^matrix\(0\.7/);
    await panel().locator('[data-mode="over"]').click();
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
