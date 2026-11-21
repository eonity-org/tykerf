// Kaity in the v4 editor (shell/shell.js, shell/kaity.js): she works through the page's tasks one at a time while the
// status line and the tray follow her; then what she did waits in Kaity on this page (round 2: no review bar): a
// change Needs review, with Keep and Undo, before and after and on a phone on its item; her question, answered there;
// her answer to a question, with what it points at; one task's work undone, and keeping the rest. Then a request
// about the whole page from the one-line composer under it, its place in the thread, and Undo from there. The editor runs the Anthropic runner
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
const systems: string[] = [];
function kaity(body: { system?: string | { text: string }[]; messages: { role: string; content: { type: string; text?: string }[] }[] }) {
  systems.push(typeof body.system === 'string' ? body.system : (body.system ?? []).map((b) => b.text).join('\n'));
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
    if (/Their answer: \$90/.test(prompt)) return turn === 0 ? message([call('set_content', { id: 'pricing', html: '<h2>$90 a year</h2>' }, 'a'), call('close_task', { n: 2, reply: 'Added $90 a year.' }, 'b')]) : say('Added it.');
    return turn === 0 ? message([call('ask_person', { question: 'What is the yearly price?' })]) : say('I need the yearly price.');
  }
  if (prompt.startsWith('Make the call to action warmer')) return turn === 0 ? message([call('set_content', { id: 'cta', html: '<h2>Warmer call to action</h2>' })]) : say('Made it warmer.');
  if (prompt.startsWith('Question 3:')) return turn === 0 ? message([call('close_task', { n: 3, reply: 'Yes: hero is the same on both pages.', suggest: [{ do: 'open', name: 'hero' }] })]) : say('Answered.');
  return say('done');
}

describe('Kaity in the v4 editor', () => {
  let api: Server;
  let browser: Browser;
  let server: ChildProcess;
  let ws: Workspace;
  let page: Page;
  let hero: string | null;
  let cta: string | null;
  let desk = 0;

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
    cta = ws.content('cta');
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
    desk = await page.locator('.frame').evaluate((f: HTMLIFrameElement) => f.contentWindow!.innerWidth);
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    server?.kill();
    api?.close();
  });

  const frame = () => page.frameLocator('.frame');
  /** expect.poll with time for the thread to come back under load (its default is one second). */
  const poll = <T>(fn: () => T | Promise<T>, opts: { timeout?: number } = {}) => expect.poll(fn, { timeout: 15_000, ...opts });
  const status = () => page.locator('.pstatus .status, .pstatus .hint').first().textContent();
  const kaityItem = (n: number) => page.locator(`.rail [data-section="kaity"] li[data-card="${n}"]`);
  async function leave(sel: string, text: string) {
    await frame().locator(sel).first().click();
    await page.locator('.taskbox textarea').fill(text);
    await page.locator('.taskbox [data-box="add"]').click();
    await poll(() => page.locator('.taskbox').count()).toBe(0);
  }

  it('works through the tasks one at a time, and the bar, the tray and the page follow her', async () => {
    await leave('[data-sw="hero"] h1', 'Make the headline fit on two lines on a phone');
    await leave('[data-sw="pricing"] h2', 'Add a yearly price next to the monthly one');
    await leave('[data-sw="hero"] p', 'Is this box the same on second?');
    expect(tasks(ws).map((x) => [x.n, x.kind ?? 'task'])).toEqual([[1, 'task'], [2, 'task'], [3, 'question']]);
    // Tasks on this page lists them, with Give them to Kaity
    expect(await page.locator('.rail .ptask').count()).toBe(3);
    await page.locator('.rail [data-side="give"]').click();
    // she starts: the steps open, the status line says where she is, the page marks her element
    await poll(status).toMatch(/^Kaity is working · task 1 of 3/);
    expect(await page.locator('.pstatus .chip').textContent()).toContain('hero');
    expect(await page.locator('.tray').isVisible()).toBe(true);
    expect(await page.locator('.tray h2').textContent()).toBe('Kaity is working through 3 tasks on home');
    await page.locator('.ktag', { hasText: '1 · Kaity is here' }).waitFor();
    expect(await page.locator('.card[data-card="1"] .state').textContent()).toBe('1 · now');
    expect(await page.locator('.card[data-card="2"] [data-card-act="skip"]').textContent()).toBe('Take it off her list');
    expect(await page.locator('[data-bar="undo-all"]').isVisible()).toBe(true);
    // then the steps close, and what waits for the person is in Kaity on this page: never "stopped" for a run that finished
    await poll(status, { timeout: 30_000 }).toBe('Kaity is done: 2 things wait for you in Kaity on this page.');
    expect(await page.locator('.tray').isHidden()).toBe(true);
    expect(await page.locator('[data-bar="keep"]').count()).toBe(0);
    expect(await page.locator('.pstatus').textContent()).not.toContain('stopped');
    await poll(() => kaityItem(1).locator('.otag').textContent()).toBe('Needs review');
    expect(await kaityItem(1).locator('[data-keep-run]').textContent()).toBe('Keep');
    expect(await kaityItem(1).locator('[data-undo-run]').textContent()).toBe('Undo');
    expect(await kaityItem(2).locator('.otag').textContent()).toBe('Kaity asks');
    expect(await kaityItem(3).locator('.otag').textContent()).toBe('answered');
    expect(await kaityItem(3).locator('.tick').textContent()).not.toBe('✓'); // only a change gets ✓
    // the top bar's Kaity counts what waits for the person
    expect(await page.locator('.bar [data-top="kaity"] .count').textContent()).toBe('2');
  });

  it('shows what she did: her words, before and after, on a phone, and her finished pin', async () => {
    const done = kaityItem(1);
    expect(await done.locator('.eanswer').textContent()).toBe('Shortened the headline.');
    await page.locator('.pin.done[data-pin="1"]', { hasText: '1 done' }).waitFor();
    // before and after, as pictures of hero at the task's width
    await done.locator('[data-card-act="compare"]').click();
    const dialog = page.locator('dialog.compare');
    await dialog.waitFor();
    await poll(() => dialog.locator('img').evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).naturalWidth > 0))).toEqual([true, true]);
    await dialog.locator('[data-close]').click();
    // the task was about a phone: the page at 375 px, then back
    await done.locator('[data-card-act="phone"]').click();
    await poll(() => page.locator('.frame').evaluate((f: HTMLIFrameElement) => f.contentWindow!.innerWidth)).toBe(375);
    expect(await page.locator('.bar [data-device="phone"]').getAttribute('aria-pressed')).toBe('true');
    await page.locator('.bar [data-device="full"]').click();
    await poll(() => page.locator('.frame').evaluate((f: HTMLIFrameElement) => f.contentWindow!.innerWidth)).toBe(desk);
  });

  it('takes the person\'s answer to her question and goes on; her answer to a question points at what to do', async () => {
    const needs = kaityItem(2);
    expect(await needs.locator('.asked').textContent()).toBe('What is the yearly price?');
    await needs.locator('[data-answer-for]').fill('$90');
    await needs.locator('[data-answer-run]').click();
    await poll(() => ws.content('pricing'), { timeout: 30_000 }).toContain('$90 a year');
    await poll(status, { timeout: 30_000 }).toBe('Kaity is done: 2 things wait for you in Kaity on this page.');
    await poll(() => kaityItem(2).locator('.otag').textContent()).toBe('Needs review');
    // her answer to the question, and what it points at in one click: here, the box to fix by hand
    const q = kaityItem(3);
    expect(await q.locator('.eanswer').textContent()).toBe('Yes: hero is the same on both pages.');
    await q.locator('[data-card-act="next"]', { hasText: 'Open hero' }).click();
    await page.locator('.fixbar .fxtitle', { hasText: 'The hero box' }).waitFor();
    await page.locator('.fixbar [data-fx="close"]').click();
    await poll(() => page.locator('.fixbar').isHidden()).toBe(true);
  });

  it('undoes one task\'s work on its own, then keeps the rest', async () => {
    expect(ws.content('hero')).toContain('Short promise');
    await kaityItem(1).locator('[data-undo-run]').click();
    await poll(() => ws.content('hero')).toBe(hero);
    expect(tasks(ws, { open: true }).map((x) => x.n)).toEqual([1]);
    await poll(() => kaityItem(1).locator('[data-keep-run]').count()).toBe(0);
    await kaityItem(2).locator('[data-keep-run]').first().click();
    await page.locator('.pstatus').waitFor({ state: 'hidden' });
    expect(await page.locator('.tray').isHidden()).toBe(true);
    expect(await page.locator('.rail [data-side="tray"]').textContent()).toBe('See them all');
    expect(await page.locator('.pin.done').count()).toBe(0);
    expect(await page.locator('.rail [data-keep-run]').count()).toBe(0);
  });

  it('asks Kaity about the whole page from the composer under it; the thread shows it, and Undo takes it back', async () => {
    const composer = page.locator('.pagecol .composer');
    // aimed at the box picked last: back to the whole page
    await composer.locator('select').selectOption('page');
    expect(await composer.locator('select option:checked').textContent()).toBe('This page');
    await composer.locator('textarea').fill('Make the call to action warmer');
    await composer.locator('textarea').press('Enter');
    await poll(() => ws.content('cta'), { timeout: 30_000 }).toContain('Warmer call to action');
    // she was told the whole page is hers, and nothing on other pages
    expect(systems.at(-1)).toMatch(/You are working on the whole page "home": any of its blocks may change, and nothing on the site's other pages/);
    expect(systems.at(-1)).toMatch(/Attach button/);
    // Kaity on this page: the request, and Undo
    const item = page.locator('.pthread li', { hasText: 'Make the call to action warmer' });
    await item.waitFor();
    expect(await item.locator('.scopechip').textContent()).toBe('home');
    // the Kaity center: what was asked and what she answered, oldest first, opened at the newest
    await page.locator('.bar [data-top="kaity"]').click();
    const center = page.locator('.kcenter');
    await center.locator('.ti.you', { hasText: 'Make the call to action warmer' }).waitFor();
    expect(await center.locator('.ti.her').last().locator('.md').textContent()).toBe('Made it warmer.');
    expect(await center.locator('.ti.event').count()).toBeGreaterThan(0); // her task runs: compact events
    expect(await center.locator('.kscroll').evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight)).toBeLessThan(40);
    await center.locator('[data-kc="close"]').click();
    await item.locator('[data-undo-run]').click();
    await poll(() => ws.content('cta')).toBe(cta);
    await poll(() => page.locator('.pthread li', { hasText: 'Make the call to action warmer' }).locator('[data-undo-run]').count()).toBe(0);
  });
});
