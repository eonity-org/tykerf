// Fixing one thing by hand in the v4 editor (shell/fix.js): only the element clicked, in the rail's section beside the
// page, saved into its box's code; the bigger fixes in the full editor, on the box and the tab for them; what tykerf
// draws at its own size over a page shown smaller; and the right-click menu's small changes.

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
  /** expect.poll with time for the editor under load (its default is one second). */
  const poll = <T>(fn: () => T | Promise<T>, opts: { timeout?: number } = {}) => expect.poll(fn, { timeout: 15_000, ...opts });
  const panel = () => page.locator('.fixbar');

  it('shows only the element clicked: a link\'s words and where it leads, saved into the box', async () => {
    // Fix it by hand is in the right-click menu (the task box keeps to the task)
    await frame().locator('[data-sw="hero"] a', { hasText: 'The main action' }).first().click({ button: 'right' });
    await page.locator('.ctxmenu [data-ctx="hand"]').click();
    await panel().locator('.fxtitle').waitFor();
    expect(await panel().locator('.fxtitle').textContent()).toBe('the link "The main action"');
    expect(await page.locator('.pstatus .status').textContent()).toContain('Fixing by hand · the link "The main action"');
    // in the rail's section, beside the page: the page keeps its width
    expect(await page.locator('.rail [data-section="fix"] .fixbar').isVisible()).toBe(true);
    expect(await page.locator('.rail [data-acc="fix"] .acc-t').textContent()).toBe('Fixing by hand · the link "The main action"');
    expect(await panel().locator('.fxnote').last().textContent()).toBe('hero is the same on second. This fix stays on first unless you share the box.');
    await panel().locator('[name="text"]').fill('Start for free');
    await panel().locator('[name="href"]').selectOption('#sw-pricing');
    await panel().locator('[type="submit"]').click();
    await poll(() => ws.content('hero')).toContain('Start for free');
    expect(ws.content('hero')).toContain('href="#sw-pricing"');
    await frame().locator('[data-sw="hero"] a', { hasText: 'Start for free' }).waitFor();
    // one step, which Undo takes back
    expect(ws.peekUndo()?.label).toMatch(/hero/);
    await page.locator('[data-top="undo"]').click();
    await poll(() => ws.content('hero')).toContain('The main action');
  });

  it('leads to the full editor for a bigger fix: the box selected, at the tab for it', async () => {
    const full = '/_tykerf/edit/first/?mode=full&block=hero';
    expect(await panel().locator('.fxmore a').evaluateAll((a) => a.map((x) => x.getAttribute('href')))).toEqual([`${full}&tab=size`, `${full}&tab=text`, `${full}&tab=code`, full]);
    await panel().locator('[data-full="code"]').click();
    await page.waitForURL(/\/_tykerf\/edit\/first\/\?mode=full$/);
    // its inspector floats over the page, in the shell's window
    await poll(() => page.locator('#tykerf-inspector .work .w-name').inputValue()).toBe('hero');
    expect(await page.locator('#tykerf-inspector .work .tabs [data-tab="code"]').getAttribute('aria-selected')).toBe('true');
    expect(await page.locator('#tykerf-inspector .path [aria-current]').textContent()).toBe('hero');
    // the quick fix has no copies of those editors
    await page.locator('.bar .modes a', { hasText: 'Tasks' }).click();
    await page.waitForURL(/\/_tykerf\/edit\/first\/$/);
    await frame().locator('[data-sw="hero"]').waitFor();
  });

  it('opens beside the page, in the rail, and the page is not covered or moved', async () => {
    const before = await page.locator('.frame').evaluate((f: HTMLIFrameElement) => f.contentWindow!.innerWidth);
    await frame().locator('[data-sw="hero"] h1').click({ button: 'right' });
    await page.locator('.ctxmenu [data-ctx="hand"]').click();
    await panel().locator('.fxtitle').waitFor();
    expect(await panel().locator('[data-view], [data-mode]').count()).toBe(0);
    expect(await page.locator('.frame').evaluate((f: HTMLIFrameElement) => f.contentWindow!.innerWidth)).toBe(before);
    const p = (await panel().boundingBox())!, stage = (await page.locator('.stage').boundingBox())!;
    expect(p.x + p.width).toBeLessThanOrEqual(stage.x);
    // nothing is docked on the page's right
    expect(await page.locator('.pside').count()).toBe(0);
  });

  it('leaves it as a task for Kaity instead', async () => {
    await frame().locator('[data-sw="hero"] h1').click();
    await poll(() => panel().locator('.fxtitle').textContent()).toMatch(/^the heading "/);
    await panel().locator('[data-fx="task"]').click();
    expect(await panel().isHidden()).toBe(true);
    await page.locator('.taskbox textarea').fill('Shorter, please');
    await page.locator('.taskbox [data-box="add"]').click();
    await poll(() => tasks(ws).at(-1)?.text).toBe('Shorter, please');
    expect(tasks(ws).at(-1)?.label).toMatch(/^h1 "/);
  });

  it('draws the task box at its own size when a tablet\'s width is shown smaller in a narrow column', async () => {
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: 1000, height: size.height });
    await page.goto(page.url().replace(/\?.*$/, ''));
    await frame().locator('[data-sw="hero"] h1').waitFor();
    await page.locator('.bar [data-device="tablet"]').click();
    // laid out at 768 px, shown smaller to fit the column beside the rail
    await poll(() => page.locator('.frame').evaluate((f: HTMLIFrameElement) => f.contentWindow!.innerWidth)).toBe(768);
    expect(await page.locator('.viewport').evaluate((v) => getComputedStyle(v).transform)).toMatch(/^matrix\(0\.[5-9]/);
    await frame().locator('[data-sw="hero"] h1').click();
    await page.locator('.taskbox').waitFor();
    // the page is shown smaller; the box to write in isn't (440 px)
    expect(Math.round((await page.locator('.taskbox').boundingBox())!.width)).toBe(440);
    // so is the task's pin (22 px high), on the element's top edge
    await page.locator('.taskbox textarea').fill('Shorter');
    await page.locator('.taskbox [data-box="add"]').click();
    const n = tasks(ws).at(-1)!.n;
    const pin = page.locator(`.pin[data-pin="${n}"]`);
    await pin.waitFor();
    const h1 = (await frame().locator('[data-sw="hero"] h1').boundingBox())!;
    await poll(async () => {
      const b = await pin.boundingBox();
      return b && Math.round(b.height) === 22 && Math.abs(b.y + 22 - h1.y) < 6;
    }).toBe(true);
    await page.locator('.bar [data-device="full"]').click();
    await page.setViewportSize(size);
  });

  it('has small changes in its right-click menu: words in place, a box added with a task on it, a box deleted', async () => {
    const shell = page.url().replace(/\?.*$/, '');
    await page.goto(shell);
    const h1 = frame().locator('[data-sw="hero"] h1');
    await h1.waitFor();
    const menu = page.locator('.ctxmenu');
    // (under load the frame may take a moment to listen again after a change: the right-click is tried again)
    const open = async (where = h1) => {
      for (let i = 0; ; i++) {
        await where.click({ button: 'right' });
        try {
          return await menu.locator('[role=menuitem]').first().waitFor({ timeout: 3000 });
        } catch (e) {
          if (i === 3) throw e;
        }
      }
    };
    await open();
    expect(await menu.locator('[role=menuitem]').allTextContents()).toEqual(['Leave a task here…', 'Ask a question here…', 'Edit this text', 'Fix it by hand', 'Add a box below…', 'Add a box beside…', 'Delete this box…', 'Open hero in the full editor', 'View the site as visitors see it']);

    // the words, right on the page: Enter keeps them (one step), Escape puts them back
    await menu.locator('[data-ctx="text"]').click();
    await page.keyboard.type('A shorter promise');
    await page.keyboard.press('Enter');
    await poll(() => ws.content('hero')).toContain('A shorter promise');
    expect(ws.peekUndo()?.label).toMatch(/hero/);
    await poll(() => h1.textContent()).toBe('A shorter promise');
    await open();
    await menu.locator('[data-ctx="text"]').click();
    await page.keyboard.type('nope');
    await page.keyboard.press('Escape');
    expect(await h1.textContent()).toBe('A shorter promise');
    expect(ws.content('hero')).not.toContain('nope');
    await page.locator('[data-top="undo"]').click();
    await poll(() => ws.content('hero')).not.toContain('A shorter promise');
    // two clicks do the same, as in the full editor: the first click's task box goes
    await poll(() => h1.textContent()).not.toBe('A shorter promise'); // the page shows the undo first
    await h1.dblclick();
    await page.keyboard.type('Two clicks');
    await page.keyboard.press('Enter');
    await poll(() => ws.content('hero')).toContain('Two clicks');
    expect(await page.locator('.taskbox').count()).toBe(0);
    await page.locator('[data-top="undo"]').click();
    await poll(() => ws.content('hero')).not.toContain('Two clicks');

    // a box below: added empty, and the task box asks what goes in it
    const order = () => (ws.load().root as { children: { id: string }[] }).children.map((c) => c.id);
    const n = order().length;
    await open();
    await menu.locator('[data-ctx="below"]').click();
    await poll(() => order().length).toBe(n + 1);
    const added = order()[order().indexOf('hero') + 1];
    await page.locator('.taskbox').waitFor();
    expect(await page.locator('.taskbox textarea').getAttribute('placeholder')).toBe('What should go in this new box? Kaity fills it, or leave it empty.');
    expect(await page.locator('.taskbox .where b').textContent()).toBe(added);
    await page.keyboard.press('Escape');

    // delete asks first, then the box goes; Undo brings it back
    await open(frame().locator('[data-sw="stats"]'));
    await menu.locator('[data-ctx="delete"]').click();
    expect(await menu.locator('.ctxconfirm p').textContent()).toBe('Delete stats? Its code goes into the box before it, and Undo brings it back.');
    await menu.locator('[data-ctx="delete-yes"]').click();
    await poll(() => order().includes('stats')).toBe(false);
    await page.locator('[data-top="undo"]').click();
    await poll(() => order().includes('stats')).toBe(true);
  });
});
