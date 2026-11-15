// Kaity in the v3 editor (shell/shell.js): she works through the page's tasks one at a time while the bar and the
// tray follow her, then the review: what she changed, before and after, on a phone, her question answered, her
// answer to a question, one task's work undone, and keeping the rest. The editor runs the Anthropic runner
// against a fake API that answers each task by what it asks, so the whole path is real.

import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPage } from '../src/library.js';
import { tasks } from '../src/tasks.js';
import { Workspace } from '../src/workspace.js';
import { freePort } from './ports.js';

vi.setConfig({ testTimeout: 60_000 });

const message = (content: unknown[], stop = 'tool_use') => ({ id: 'msg', type: 'message', role: 'assistant', model: 'm', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
const say = (text: string) => message([{ type: 'text', text }], 'end_turn');
const call = (name: string, input: unknown, id = name) => ({ type: 'tool_use', id, name, input });

/** Kaity's side, by the task the request is about and how many turns it has had. */
function kaity(body: { messages: { role: string; content: { type: string; text?: string }[] }[] }) {
  const msgs = body.messages;
  let i = msgs.length - 1;
  while (i >= 0 && !(msgs[i].role === 'user' && msgs[i].content.some((c) => c.type === 'text'))) i--;
  const prompt = msgs[i].content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const turn = msgs.slice(i + 1).filter((m) => m.role === 'assistant').length;
  if (prompt.startsWith('Task 1:')) {
    return turn === 0
      ? { ...message([call('set_content', { id: 'hero', html: '<h1>Short promise</h1>' }, 'a'), call('close_task', { n: 1, reply: 'Shortened the headline. Nothing else in hero moved.' }, 'b')]), delay: 1500 }
      : say('Shortened it.');
  }
  if (prompt.startsWith('Task 2:')) {
    if (/Their answer: \$90/.test(prompt)) return turn === 0 ? message([call('close_task', { n: 2, reply: 'Added $90 a year.' })]) : say('Added it.');
    return turn === 0 ? message([call('ask_person', { question: 'What is the yearly price?' })]) : say('I need the yearly price.');
  }
  if (prompt.startsWith('Question 3:')) return turn === 0 ? message([call('close_task', { n: 3, reply: 'Yes: hero is the same on both pages.', suggest: [{ do: 'open', name: 'hero' }] })]) : say('Answered.');
  return say('done');
}

describe('Kaity in the v3 editor', () => {
  let api: Server;
  let browser: Browser;
  let server: ChildProcess;
  let ws: Workspace;
  let page: Page;
  let hero: string | null;

  beforeAll(async () => {
    api = createServer(async (req, res) => {
      let s = '';
      for await (const c of req) s += c;
      const r: any = kaity(JSON.parse(s));
      if (r.delay) await new Promise((ok) => setTimeout(ok, r.delay));
      if (!res.destroyed) res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(r));
    });
    await new Promise<void>((ok) => api.listen(0, '127.0.0.1', ok));
    const site = join(mkdtempSync(join(tmpdir(), 'tykerf-shell-kaity-')), 'site');
    ws = new Workspace(join(site, 'home'));
    createPage(ws, 'launch');
    hero = ws.content('hero');
    const port = await freePort();
    server = spawn(process.execPath, ['--import', 'tsx', 'src/editor/server.ts', site, '--port', String(port)], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, TYKERF_DOTENV: 'off', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_BASE_URL: '', TYKERF_RUNNER: 'anthropic', TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}` },
    });
    await new Promise<void>((ok, fail) => {
      server.stdout!.on('data', (d) => String(d).includes('TYKERF: http') && ok());
      server.on('exit', (c) => fail(new Error(`editor exited with ${c}`)));
    });
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(15_000);
    await page.goto(`http://localhost:${port}/_tykerf/edit/home/`);
    await page.frameLocator('.frame').locator('[data-sw="hero"]').waitFor();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    server?.kill();
    api?.close();
  });

  const frame = () => page.frameLocator('.frame');
  const status = () => page.locator('.bar .status').textContent();
  async function leave(sel: string, text: string) {
    await frame().locator(sel).first().click();
    await page.locator('.taskbox textarea').fill(text);
    await page.locator('.taskbox [data-box="add"]').click();
    await expect.poll(() => page.locator('.taskbox').count()).toBe(0);
  }

  it('works through the tasks one at a time, and the bar, the tray and the page follow her', async () => {
    await leave('[data-sw="hero"] h1', 'Make the headline fit on two lines on a phone');
    await leave('[data-sw="pricing"] h2', 'Add a yearly price next to the monthly one');
    await leave('[data-sw="hero"] p', 'Is this box the same on second?');
    expect(tasks(ws).map((x) => [x.n, x.kind ?? 'task'])).toEqual([[1, 'task'], [2, 'task'], [3, 'question']]);
    await page.locator('[data-bar="give"]').click();
    // she starts: the steps open, the bar says where she is, the page marks her element
    await expect.poll(status).toMatch(/^Kaity is working · task 1 of 3/);
    expect(await page.locator('.bar .chip').textContent()).toContain('hero');
    expect(await page.locator('.tray').isVisible()).toBe(true);
    expect(await page.locator('.tray h2').textContent()).toBe('Kaity is working through 3 tasks on home');
    await page.locator('.ktag', { hasText: '1 · Kaity is here' }).waitFor();
    expect(await page.locator('.card[data-card="1"] .state').textContent()).toBe('1 · now');
    expect(await page.locator('.card[data-card="2"] [data-card-act="skip"]').textContent()).toBe('Take it off her list');
    expect(await page.locator('[data-bar="undo-all"]').isVisible()).toBe(true);
    // then the sum-up
    await expect.poll(status, { timeout: 30_000 }).toBe('Kaity stopped · 1 done, 1 answered, 1 needs you');
    expect(await page.locator('[data-bar="keep"]').textContent()).toBe('Keep the change');
  });

  it('shows what she did: her words, before and after, on a phone, and her finished pin', async () => {
    const done = page.locator('.card[data-card="1"]');
    expect(await done.locator('.state').textContent()).toBe('1 · done');
    expect(await done.locator('.note').textContent()).toBe('Shortened the headline. Nothing else in hero moved.');
    await page.locator('.pin.done[data-pin="1"]', { hasText: '1 done' }).waitFor();
    // before and after, as pictures of hero at the task's width
    await done.locator('[data-card-act="compare"]').click();
    const dialog = page.locator('dialog.compare');
    await dialog.waitFor();
    await expect.poll(() => dialog.locator('img').evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).naturalWidth > 0))).toEqual([true, true]);
    await dialog.locator('[data-close]').click();
    // the task was about a phone: the page at 375 px, then back
    await done.locator('[data-card-act="phone"]').click();
    await expect.poll(() => page.locator('.frame').evaluate((f: HTMLIFrameElement) => f.contentWindow!.innerWidth)).toBe(375);
    expect(await page.locator('.bar [data-device="phone"]').getAttribute('aria-pressed')).toBe('true');
    await page.locator('.bar [data-device="full"]').click();
    await expect.poll(() => page.locator('.frame').evaluate((f: HTMLIFrameElement) => f.contentWindow!.innerWidth)).toBe(1280);
  });

  it('takes the person\'s answer to her question and goes on; an answered question is read and put away', async () => {
    await page.locator('[data-bar="tray"]').click();
    const needs = page.locator('.card[data-card="2"]');
    expect(await needs.locator('.asked').textContent()).toBe('Kaity asks: What is the yearly price?');
    await needs.locator('[data-answer]').fill('$90');
    await needs.locator('[data-card-act="answer"]').click();
    await expect.poll(status, { timeout: 30_000 }).toBe('Kaity stopped · 2 done, 1 answered');
    expect(await needs.locator('.note').textContent()).toBe('Added $90 a year.');
    const q = page.locator('.card[data-card="3"]');
    expect(await q.locator('.youasked').textContent()).toBe('You asked: Is this box the same on second?');
    expect(await q.locator('.answer').textContent()).toBe('Yes: hero is the same on both pages.');
    // what her answer points at, in one click: here, the box to fix by hand
    await q.locator('[data-card-act="next"]', { hasText: 'Open hero' }).click();
    await page.locator('.fixbar .fxtitle', { hasText: 'The hero box' }).waitFor();
    await page.locator('.fixbar [data-fx="close"]').click();
    await expect.poll(() => page.locator('.fixbar').isHidden()).toBe(true);
    await page.locator('[data-bar="tray"]').click();
    await q.locator('[data-card-act="seen"]').click();
    await expect.poll(() => q.count()).toBe(0);
  });

  it('undoes one task\'s work on its own, then keeps the rest', async () => {
    expect(ws.content('hero')).toContain('Short promise');
    await page.locator('.card[data-card="1"] [data-card-act="undo"]').click();
    await expect.poll(() => ws.content('hero')).toBe(hero);
    await expect.poll(() => page.locator('.card[data-card="1"] .note').textContent()).toBe('Her work on it was undone.');
    expect(tasks(ws, { open: true }).map((x) => x.n)).toEqual([1]);
    expect(await page.locator('[data-bar="keep"]').textContent()).toBe('Keep the change');
    await page.locator('[data-bar="keep"]').click();
    await page.locator('.bar .hint').waitFor();
    expect(await page.locator('.tray').isHidden()).toBe(true);
    expect(await page.locator('[data-bar="tray"]').textContent()).toBe('1 task');
    expect(await page.locator('.pin.done').count()).toBe(0);
  });
});
