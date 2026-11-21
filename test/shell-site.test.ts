// The site in the v4 editor (shell/site.js, shell/overview.js, shell/screens.js, shell/kaity.js): the Overview, the
// site's screens beside the docked rail, the Kaity center, and Give Kaity everything going page by page. The editor runs the Anthropic runner against a fake API
// that closes each task it is given.

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { newSitePage, readSite } from '../src/site.js';
import { addTask, tasks } from '../src/tasks.js';
import type { Workspace } from '../src/workspace.js';
import { freePort } from './ports.js';

vi.setConfig({ testTimeout: 60_000 });

const message = (content: unknown[], stop = 'tool_use') => ({ id: 'msg', type: 'message', role: 'assistant', model: 'm', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });

/** Kaity closes the task she is given, then says so. */
function kaity(body: { messages: { role: string; content: { type: string; text?: string }[] }[] }) {
  const msgs = body.messages;
  let i = msgs.length - 1;
  while (i >= 0 && !(msgs[i].role === 'user' && msgs[i].content.some((c) => c.type === 'text'))) i--;
  const prompt = msgs[i].content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const n = Number(/^(?:Task|Question) (\d+):/.exec(prompt)?.[1]);
  const turn = msgs.slice(i + 1).filter((m) => m.role === 'assistant').length;
  // her answer to the question on second's hero suggests sharing it, and going to first
  const suggest = prompt.startsWith('Question') ? { suggest: [{ do: 'share', name: 'hero' }, { do: 'page', name: 'first' }] } : {};
  // a task asks for a change: she makes one in the task's block (a task closed with nothing changed is one she couldn't do)
  const block = /Do what it asks in ([\w-]+)/.exec(prompt)?.[1];
  const change = block ? [{ type: 'tool_use', id: 'e', name: 'set_content', input: { id: block, html: `<p>Task ${n}, done</p>` } }] : [];
  return n && turn === 0 ? message([...change, { type: 'tool_use', id: 'c', name: 'close_task', input: { n, reply: `Did task ${n}.`, ...suggest } }]) : message([{ type: 'text', text: 'done' }], 'end_turn');
}

describe('the site in the v3 editor', () => {
  let api: Server;
  let browser: Browser;
  let server: ChildProcess;
  let site: string;
  let first: Workspace, second: Workspace;
  let base: string;
  let page: Page;

  beforeAll(async () => {
    api = createServer(async (req, res) => {
      let s = '';
      for await (const c of req) s += c;
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(kaity(JSON.parse(s))));
    });
    await new Promise<void>((ok) => api.listen(0, '127.0.0.1', ok));
    site = join(mkdtempSync(join(tmpdir(), 'tykerf-shell-site-')), 'site');
    first = newSitePage(site, 'first', 'launch', 'studio');
    second = newSitePage(site, 'second', 'launch', 'studio', { shared: false });
    addTask(first, { block: 'hero', text: 'Shorter headline' });
    addTask(second, { block: 'cta', text: 'Warmer button' });
    addTask(second, { block: 'hero', text: 'Is this the same on first?', question: true });
    const port = await freePort();
    base = `http://localhost:${port}`;
    server = spawn(process.execPath, ['--import', 'tsx', 'src/editor/server.ts', site, '--port', String(port)], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, TYKERF_DOTENV: 'off', TYKERF_TASK_SHOTS: 'off', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_BASE_URL: '', TYKERF_RUNNER: 'anthropic', TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}` },
    });
    await new Promise<void>((ok, fail) => {
      server.stdout!.on('data', (d) => String(d).includes('TYKERF: http') && ok());
      server.on('exit', (c) => fail(new Error(`editor exited with ${c}`)));
    });
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15_000);
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    server?.kill();
    api?.close();
  });

  const frameWidth = () => page.locator('.frame').evaluate((f: HTMLIFrameElement) => f.contentWindow!.innerWidth);

  it('opens on the Overview: the pages as cards with their actions, what to check before publishing, Kaity lately', async () => {
    await page.goto(`${base}/`);
    await page.waitForURL(`${base}/_tykerf/edit/_site/`);
    const main = page.locator('.screen');
    await main.locator('.ocard h3 a').first().waitFor();
    expect(await page.locator('.bar .crumb b').textContent()).toBe('Overview');
    expect(await main.locator('.ocard h3 a').allTextContents()).toEqual(['first', 'second']);
    expect(await main.locator('.ocard[data-page="first"] .hometag').count()).toBe(1);
    expect(await main.locator('.ocard[data-page="first"] .note').textContent()).toMatch(/1 open task$/);
    expect(await main.locator('.ocard[data-page="second"] .note').textContent()).toMatch(/2 open tasks$/);
    // each card's actions are words, More holds the rest
    await main.locator('.ocard[data-page="second"] [data-pact="name"]').click();
    await main.locator('.pform input[name="title"]').fill('The second page');
    await main.locator('.pform [type="submit"]').click();
    await expect.poll(() => readSite(site).titles.second).toBe('The second page');
    await main.locator('.ocard[data-page="second"] [data-pact="more"]').click();
    await main.locator('.ocard[data-page="second"] [data-pact="home"]').click();
    await expect.poll(() => readSite(site).home).toBe('second');
    await main.locator('.ocard[data-page="second"] .hometag').waitFor();
    // before you publish, and Kaity's latest work (no box of its own: the Kaity line under the screen, on the whole site)
    expect(await main.locator('.ocheck li > span:first-child').allTextContents()).toEqual(['Design check', 'About this site', 'Links between pages', 'Language', 'Other checks']);
    expect(await main.locator('.olately h2').textContent()).toBe('Kaity lately');
    expect(await main.locator('.olately .composer').count()).toBe(0);
    const line = page.locator('.sitecol > .kline');
    expect(await line.locator('textarea').getAttribute('placeholder')).toBe('Ask Kaity about the whole site…');
    expect(await line.locator('select').count()).toBe(0);
    expect(await line.locator('[data-c="attach"]').count()).toBe(1);
    // New page in one click from the rail, the header and the card; one Undo and one Publish
    for (const where of ['.rail [data-screen="new"]', '.ohead [data-screen="new"]', '.ocard.onew']) expect(await page.locator(where).count()).toBe(1);
    expect(await page.getByRole('button', { name: /^Undo|^Nothing to undo/ }).count()).toBe(1);
    expect(await page.getByRole('link', { name: 'Publish', exact: true }).count()).toBe(1);
    // the guides
    expect(await main.locator('.olearn a').count()).toBe(5);
    expect(await main.locator('.olearn a').first().getAttribute('href')).toMatch(/^https:\/\/github\.com\/eonity-org\/tykerf\/.*getting-started\.md$/);
  });

  it('shows the site\'s screens beside the docked rail, the same frame on each, and goes from one to another', async () => {
    await page.locator('.rail [data-screen="check"]').click();
    await page.waitForURL(/\/_tykerf\/edit\/_site\/check$/);
    await page.locator('.screen h1', { hasText: 'Check the site' }).waitFor();
    expect(await page.locator('.rail [data-screen="check"]').getAttribute('aria-current')).toBe('page');
    // the language, set where the check says it is missing (English, chosen on purpose)
    const lang = page.locator('form[data-lang]');
    await lang.locator('input').fill('en');
    await lang.locator('[type="submit"]').click();
    await expect.poll(() => readSite(site).langSet).toBe(true);
    await expect.poll(() => page.locator('form[data-lang]').count()).toBe(0);
    await expect.poll(() => page.locator('.rail [data-screen="settings"] .rstate').textContent()).toBe('en');
    // every screen of the list opens, in the same frame: one Undo, one Publish
    for (const [k, h1] of [['shared', 'Shared blocks'], ['media', 'Media'], ['links', 'Links between pages'], ['settings', 'Head code, icon & language'], ['history', 'Site history'], ['about', 'About this site']] as const) {
      await page.locator(`.rail [data-screen="${k}"]`).first().click();
      await page.locator('.screen h1', { hasText: h1 }).waitFor();
      expect(await page.locator('.bar .crumb b').textContent()).toBe(h1);
      expect(await page.getByRole('link', { name: 'Publish', exact: true }).count()).toBe(1);
    }
    await page.locator('.bar [data-top="publish"]').click();
    await page.locator('.screen h1', { hasText: 'Publish' }).waitFor();
    // the Kaity center: a drawer from the top bar, and the same thread as a page
    await page.locator('.bar [data-top="kaity"]').click();
    const center = page.locator('.kcenter');
    await expect.poll(() => center.locator('.kfilters button').allTextContents()).toEqual(['Everything', 'Whole site', 'first', 'second', 'Tasks']);
    await center.locator('[data-filter="tasks"]').click();
    await expect.poll(() => center.locator('.group h3').allTextContents()).toEqual(['first', 'second']);
    await center.locator('[data-filter="all"]').click();
    await center.locator('a', { hasText: 'Open as page' }).click();
    await page.locator('.screen h1', { hasText: 'Kaity center' }).waitFor();
    // the site's history has the language and the home page; Undo takes back the last
    await page.locator('.rail [data-screen="history"]').click();
    await page.locator('.steps li b').first().waitFor();
    expect(await page.locator('.steps li b').first().textContent()).toBe('the site\'s language: en');
    await page.locator('[data-h="undo"]').click();
    await expect.poll(() => readSite(site).langSet).toBeUndefined();
  });

  it('keeps the site\'s brief and frame in About this site', async () => {
    await page.locator('.rail [data-screen="about"]').click();
    const form = page.locator('form[data-s="about"]');
    await form.waitFor();
    await expect.poll(() => page.locator('.rail [data-screen="about"] .rstate').textContent(), { timeout: 10_000 }).toBe('not written yet');
    await form.locator('[name="audience"]').fill('Neighbours who want good bread');
    await form.locator('[name="tone"]').fill('warm and simple');
    await form.locator('[name="frame"]').selectOption('simple');
    await form.locator('[type="submit"]').click();
    await expect.poll(() => readSite(site).brief, { timeout: 10_000 }).toEqual({ audience: 'Neighbours who want good bread', tone: 'warm and simple' });
    await expect.poll(() => readSite(site).frame, { timeout: 10_000 }).toBe('simple');
    await expect.poll(() => page.locator('.rail [data-screen="about"] .rstate').textContent(), { timeout: 10_000 }).toBe('written');
  });

  it('fits a phone: the rail folds above the screen, nothing scrolls sideways', async () => {
    const narrow = await browser.newPage({ viewport: { width: 375, height: 760 } });
    for (const path of ['/_tykerf/edit/_site/', '/_tykerf/edit/_site/check', '/_tykerf/edit/_site/new', '/_tykerf/edit/_site/kaity']) {
      await narrow.goto(`${base}${path}`);
      await narrow.locator('.screen h1, .screen .ofirst').first().waitFor();
      expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
      expect(await narrow.locator('.rail').getAttribute('class')).toContain('folded');
    }
    await narrow.close();
  });

  it('checks the design of every page on demand, the style notes folded with their rules', async () => {
    await page.locator('.rail [data-screen="check"]').click();
    const design = page.locator('[data-design]');
    await design.locator('[data-c="design"]').click();
    await design.locator('.dresult .lead').waitFor({ timeout: 60_000 });
    expect(await design.locator('.dresult .lead').textContent()).toMatch(/to fix for people to read and use the pages|Nothing to fix/);
    expect(await design.locator('[data-c="design"]').textContent()).toBe('Check the design again');
    // every rule listed says its hint
    expect(await design.locator('.drule').count()).toBe(await design.locator('.drule .hint').count());
  });

  it('shares a box that is the same on both pages', async () => {
    await page.locator('.rail [data-screen="shared"]').click();
    const suggest = page.locator('.suggest');
    await suggest.waitFor();
    await suggest.locator('[data-share="stats"]').click();
    await page.locator('.bcard h3', { hasText: 'stats' }).waitFor();
    expect(readFileSync(join(site, 'kit', 'blocks', 'stats.html'), 'utf8').length).toBeGreaterThan(0);
    // Leave a task on it opens the page with a task box on the block
    const card = page.locator('.bcard', { has: page.locator('h3', { hasText: 'stats' }) });
    await card.locator('a', { hasText: 'Leave a task' }).click();
    await page.waitForURL(/\/_tykerf\/edit\/(first|second)\/$/);
    await page.locator('.taskbox .where b', { hasText: 'stats' }).waitFor();
  });

  it('gives Kaity every open task of the site, page by page', async () => {
    await page.goto(`${base}/_tykerf/edit/_site/tasks`);
    const screen = page.locator('.screen');
    await screen.locator('.group').first().waitFor();
    expect(await screen.locator('.group h2').allTextContents()).toEqual(['first', 'second']);
    expect(await screen.locator('.ttext').allTextContents()).toEqual(['Shorter headline', 'Warmer button', 'Is this the same on first?']);
    await screen.locator('[data-t="all"]').click();
    await expect.poll(() => [...tasks(first, { open: true }), ...tasks(second, { open: true })].length, { timeout: 30_000 }).toBe(0);
    // she went through both pages; each page keeps its review
    await expect.poll(() => screen.locator('.state.done').count(), { timeout: 15_000 }).toBe(2);
    expect(await screen.locator('[data-t="all"]').isDisabled()).toBe(true);
  });

  it('does what her answer suggests in one click: shares the box, goes to the page', async () => {
    await page.goto(`${base}/_tykerf/edit/second/`);
    await page.frameLocator('.frame').locator('[data-sw="hero"]').waitFor();
    // her answer to the question is in Kaity on this page, with what it points at
    const q = page.locator('.rail [data-section="kaity"] li[data-card="2"]');
    const share = q.locator('[data-card-act="next"]', { hasText: 'Share hero with every page' });
    await share.click();
    await expect.poll(() => existsSync(join(site, 'kit', 'blocks', 'hero.html'))).toBe(true);
    // shared now: that button goes, the other stays
    await expect.poll(() => share.count()).toBe(0);
    await q.locator('[data-card-act="next"]', { hasText: 'Go to first' }).click();
    await page.waitForURL(`${base}/_tykerf/edit/first/`);
  });
});
