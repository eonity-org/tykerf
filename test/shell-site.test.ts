// The site in the v3 editor (shell/site.js, shell/screens.js): the sidebar over a page, the site's screens beside it
// docked, and Give Kaity everything going page by page. The editor runs the Anthropic runner against a fake API
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
  return n && turn === 0 ? message([{ type: 'tool_use', id: 'c', name: 'close_task', input: { n, reply: `Did task ${n}.`, ...suggest } }]) : message([{ type: 'text', text: 'done' }], 'end_turn');
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

  it('opens the site over the page from the page switcher, without moving the page', async () => {
    await page.goto(`${base}/_tykerf/edit/first/`);
    await page.frameLocator('.frame').locator('[data-sw="hero"]').waitFor();
    const width = await frameWidth();
    await page.locator('[data-bar="pages"]').click();
    const sb = page.locator('.sidebar');
    await sb.locator('.pcard').first().waitFor();
    expect(await page.locator('[data-bar="pages"]').getAttribute('aria-expanded')).toBe('true');
    expect(await frameWidth()).toBe(width);
    expect(await sb.locator('.pname').allTextContents()).toEqual(['first', 'second']);
    expect(await sb.locator('.pcard.current .pstate').textContent()).toMatch(/^Open now · 1 task/);
    expect(await sb.locator('.pcard[data-page="first"] .hometag').count()).toBe(1);
    expect(await sb.locator('[data-screen="tasks"] .sstate').textContent()).toBe('3 open on 2 pages');
    expect(await sb.locator('[data-screen="settings"] .sstate').textContent()).toBe('language not set');
    // its page actions are words: a title set here is the page's
    await sb.locator('.pcard[data-page="second"] [data-pact="name"]').click();
    await sb.locator('.pform input[name="title"]').fill('The second page');
    await sb.locator('.pform [type="submit"]').click();
    await expect.poll(() => readSite(site).titles.second).toBe('The second page');
    await sb.locator('.pcard[data-page="second"] [data-pact="home"]').click();
    await expect.poll(() => readSite(site).home).toBe('second');
    await sb.locator('.pcard[data-page="second"] .hometag').waitFor();
    // it stays until the person closes it: a click on the page leaves a task, and the sidebar is still there
    await page.frameLocator('.frame').locator('[data-sw="hero"] h1').click();
    await page.locator('.taskbox').waitFor();
    expect(await sb.isVisible()).toBe(true);
    await page.keyboard.press('Escape'); // the task box goes, the sidebar stays
    expect(await page.locator('.taskbox').count()).toBe(0);
    expect(await sb.isVisible()).toBe(true);
    // from one page to the next, to look at them all
    await sb.locator('.pcard[data-page="second"] a.popen').click();
    await page.waitForURL(`${base}/_tykerf/edit/second/`);
    await page.locator('.sidebar .pcard.current[data-page="second"]').waitFor();
    // folded: only its edge, and › opens it again; folded it stays folded on the next page
    await page.locator('.sidebar [data-sb="fold"]').click();
    expect(await page.locator('.sidebar.folded .sbunfold').isVisible()).toBe(true);
    expect(await page.locator('.sidebar').evaluate((e) => e.getBoundingClientRect().width)).toBeLessThan(30);
    await page.goto(`${base}/_tykerf/edit/first/`);
    await page.locator('.sidebar.folded .sbunfold').click();
    await page.locator('.sidebar:not(.folded) .pcard').first().waitFor();
    // Close closes it, for the next pages too
    await page.locator('.sidebar [data-sb="collapse"]').click();
    expect(await page.locator('.sidebar').isHidden()).toBe(true);
    await page.reload();
    await page.frameLocator('.frame').locator('[data-sw="hero"]').waitFor();
    expect(await page.locator('.sidebar').isHidden()).toBe(true);
  });

  it('shows the site\'s screens beside it, docked, and goes from one to another', async () => {
    await page.locator('[data-bar="pages"]').click();
    await page.locator('.sidebar [data-screen="check"]').click();
    await page.waitForURL(/\/_tykerf\/edit\/_site\/check\?from=first$/);
    await page.locator('.screen h1', { hasText: 'Check the site' }).waitFor();
    expect(await page.locator('.sidebar.docked').isVisible()).toBe(true);
    expect(await page.locator('.bar a', { hasText: 'Back to first' }).getAttribute('href')).toBe('/_tykerf/edit/first/');
    // the language, set where the check says it is missing (English, chosen on purpose)
    const lang = page.locator('form[data-lang]');
    await lang.locator('input').fill('en');
    await lang.locator('[type="submit"]').click();
    await expect.poll(() => readSite(site).langSet).toBe(true);
    await expect.poll(() => page.locator('form[data-lang]').count()).toBe(0);
    expect(await page.locator('.sidebar [data-screen="settings"] .sstate').textContent()).toBe('language: en');
    // every screen of the list opens
    for (const [k, h1] of [['shared', 'Shared blocks'], ['media', 'Media'], ['links', 'Links between pages'], ['kaity', 'Kaity\'s work'], ['settings', 'Head code, icon & language'], ['history', 'Site history'], ['publish', 'Publish']] as const) {
      await page.locator(`.sidebar [data-screen="${k}"]`).first().click();
      await page.locator('.screen h1', { hasText: h1 }).waitFor();
    }
    // the site's history has the language and the home page; Undo takes back the last
    await page.locator('.sidebar [data-screen="history"]').click();
    expect(await page.locator('.steps li b').first().textContent()).toBe('the site\'s language: en');
    await page.locator('[data-h="undo"]').click();
    await expect.poll(() => readSite(site).langSet).toBeUndefined();
  });

  it('shares a box that is the same on both pages', async () => {
    await page.locator('.sidebar [data-screen="shared"]').click();
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
    await page.locator('[data-bar="tray"]').click();
    const q = page.locator('.card[data-card="2"]');
    const share = q.locator('[data-card-act="next"]', { hasText: 'Share hero with every page' });
    await share.click();
    await expect.poll(() => existsSync(join(site, 'kit', 'blocks', 'hero.html'))).toBe(true);
    // shared now: that button goes, the other stays
    await expect.poll(() => share.count()).toBe(0);
    await q.locator('[data-card-act="next"]', { hasText: 'Go to first' }).click();
    await page.waitForURL(`${base}/_tykerf/edit/first/`);
  });
});
