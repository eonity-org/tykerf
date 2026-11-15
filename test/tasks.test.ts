// Tasks left on the page (src/tasks.ts): stored beside the page, following renames, limited by the
// scope for Kaity (MCP list_tasks / close_task), and written and closed in the editor.

import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AI, type RunEvents, type RunRequest, type Runner } from '../src/editor/ai.js';
import * as M from '../src/moves.js';
import { createPage } from '../src/library.js';
import { addTask, clearDone, closeTask, removeTask, reopenTask, sayTask, tasks } from '../src/tasks.js';
import { MemoryStore } from '../src/store.js';
import { Workspace } from '../src/workspace.js';
import { freePort } from './ports.js';

vi.setConfig({ testTimeout: 30_000 });

const landing = () => {
  const ws = new Workspace(new MemoryStore('memory:tasks'));
  createPage(ws, 'launch');
  return ws;
};

describe('tasks', () => {
  it('keeps the block, the element, the width and the words, numbered in order', () => {
    const ws = landing();
    const a = addTask(ws, { block: 'hero', path: [0, 1], label: 'h1 "The short promise"', width: 1280, text: ' Shorter, please ' });
    const b = addTask(ws, { block: 'cta', text: 'Is this the right link?' });
    expect([a.n, b.n]).toEqual([1, 2]);
    expect(tasks(ws)).toMatchObject([{ n: 1, block: 'hero', path: [0, 1], width: 1280, text: 'Shorter, please', by: 'user' }, { n: 2, block: 'cta', path: null, width: null }]);
    expect(sayTask(tasks(ws)[0])).toBe('#1 on hero › h1 "The short promise" (element 0.1), seen 1280 px wide: Shorter, please');
    // tasks are not part of the page, but each change to them is a step of its history (Undo takes it back)
    expect(ws.history().map((h) => h.label)).toEqual(['add task 2', 'add task 1']);
    expect(ws.page()).not.toContain('Shorter, please');
  });

  it('refuses empty tasks, unknown blocks and bad paths', () => {
    const ws = landing();
    expect(() => addTask(ws, { block: 'hero', text: '  ' })).toThrow(/write the task/);
    expect(() => addTask(ws, { block: 'nope', text: 'x' })).toThrow(/no block "nope"/);
    expect(() => addTask(ws, { block: 'hero', text: 'x', path: [-1] })).toThrow(/bad element path/);
    expect(() => addTask(ws, { block: 'hero', text: 'x', width: -5 })).toThrow(/bad width/);
    expect(tasks(ws)).toEqual([]);
  });

  it('follows its block when it is renamed, and says so when the block is gone', () => {
    const ws = landing();
    addTask(ws, { block: 'hero', text: 'bigger picture' });
    ws.rename('hero', 'welcome');
    expect(tasks(ws)[0]).toMatchObject({ block: 'welcome' });
    expect(tasks(ws)[0].gone).toBeUndefined();
    ws.save(M.remove(ws.load(), 'welcome'), 'remove welcome');
    expect(tasks(ws)[0]).toMatchObject({ block: 'welcome', gone: true });
    expect(tasks(ws, { within: 'page' })).toEqual([]); // a gone block is in no scope
    ws.undo();
    expect(tasks(ws)[0].gone).toBeUndefined();
  });

  it('closes with a reply, opens again, and clears the ones that are done', () => {
    const ws = landing();
    addTask(ws, { block: 'hero', text: 'one' });
    addTask(ws, { block: 'cta', text: 'two' });
    closeTask(ws, 1, 'ai', 'Made it shorter.');
    expect(tasks(ws, { open: true }).map((x) => x.n)).toEqual([2]);
    expect(tasks(ws)[0].done).toMatchObject({ by: 'ai', reply: 'Made it shorter.' });
    expect(sayTask(tasks(ws)[0])).toMatch(/\[done: Made it shorter\.\]$/);
    reopenTask(ws, 1);
    expect(tasks(ws, { open: true })).toHaveLength(2);
    closeTask(ws, 2);
    expect(clearDone(ws)).toBe(1);
    removeTask(ws, 1);
    expect(tasks(ws)).toEqual([]);
    expect(() => closeTask(ws, 9)).toThrow(/no task 9/);
    // numbers are never reused
    expect(addTask(ws, { block: 'hero', text: 'three' }).n).toBe(3);
  });

  it('gives Kaity the open tasks inside her scope, and lets her close only those', async () => {
    const ws = landing();
    addTask(ws, { block: 'hero', path: [0], label: 'h1 "Hi"', width: 375, text: 'Too big on a phone' });
    addTask(ws, { block: 'cta', text: 'Another colour' });
    const { openTools } = await import('../src/editor/tools-client.js');
    const hero = await openTools(ws, 'hero');
    expect((await hero.call('list_tasks', {})).text).toBe('#1 on hero › h1 "Hi" (element 0), seen 375 px wide: Too big on a phone');
    expect((await hero.call('close_task', { n: 2, reply: 'done' })).text).toMatch(/task 2 is on "cta", outside the scope "hero"/);
    expect((await hero.call('close_task', { n: 1, reply: 'Smaller below 600 px.' })).text).toMatch(/^closed #1/);
    expect((await hero.call('list_tasks', {})).text).toBe('no open tasks on this part of the page');
    expect((await hero.call('list_tasks', { all: true })).text).toMatch(/\[done: Smaller below 600 px\.\]$/);
    await hero.close();
    const whole = await openTools(ws, 'page');
    expect((await whole.call('list_tasks', {})).text).toBe('#2 on cta: Another colour');
    await whole.close();
    expect(tasks(ws)[0].done).toMatchObject({ by: 'ai' });
  });
});

describe('giving tasks to Kaity', () => {
  it('gives her every open task on the block, and shows them in its chat', () => {
    const ws = landing();
    addTask(ws, { block: 'hero', path: [0], label: 'h1 "Hi"', width: 375, text: 'Too big on a phone' });
    addTask(ws, { block: 'hero', text: 'Warmer picture' });
    addTask(ws, { block: 'cta', text: 'Not this one' });
    closeTask(ws, 2);
    let req: RunRequest | undefined;
    const runner: Runner = { start: (r: RunRequest, on: RunEvents) => ((req = r), { cancel: () => on.end() }) };
    const ai = new AI(ws, () => {}, runner);
    expect(() => ai.askTasks('footer')).toThrow(/no open tasks on "footer"/);
    ai.askTasks('hero');
    expect(req!.scope).toBe('hero');
    expect(req!.prompt).toMatch(/^Work through this task:\n\n#1 · hero › h1 "Hi" · 375 px\nToo big on a phone\n/);
    expect(req!.prompt).toContain('- #1 on hero › h1 "Hi" (element 0), seen 375 px wide: Too big on a phone');
    expect(req!.prompt).not.toMatch(/Warmer picture|Not this one/);
    expect(req!.prompt).toContain('close_task');
    expect(req!.prompt).toContain('Work only on these tasks (#1): people may add more while you work');
    // a task added while she works isn't hers: she knows which ones are, and so does the editor
    expect(ai.running()).toEqual({ id: 'hero', tasks: [1] });
    addTask(ws, { block: 'hero', text: 'Added while she works' });
    expect(ai.running()).toEqual({ id: 'hero', tasks: [1] });
    expect(() => ai.askTasks('hero')).toThrow(/already working/);
    expect(ai.running()).toEqual({ id: 'hero', tasks: [1] }); // a refused second request leaves the run as it was
    // the chat shows the task as it was written, not only its number
    expect(ai.chat('hero').messages[0]).toMatchObject({ role: 'user', text: 'Work through this task:\n\n#1 · hero › h1 "Hi" · 375 px\nToo big on a phone' });
  });
});

describe('tasks in the editor', () => {
  let browser: Browser;
  let server: ChildProcess;
  let ws: Workspace;
  let page: Page;
  let base: string; // the page's address, /home/

  beforeAll(async () => {
    // a site with its home page, which the editor serves at /home/
    const site = join(mkdtempSync(join(tmpdir(), 'tykerf-tasks-')), 'site');
    const dir = join(site, 'home');
    ws = new Workspace(dir);
    createPage(ws, 'launch');
    const port = await freePort();
    base = `http://localhost:${port}/home/`;
    server = spawn(process.execPath, ['--import', 'tsx', 'src/editor/server.ts', site, '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise<void>((ok, fail) => {
      server.stdout!.on('data', (d) => String(d).includes('TYKERF: http') && ok());
      server.on('exit', (c) => fail(new Error(`editor exited with ${c}`)));
    });
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(5000);
    await page.addInitScript(() => localStorage.setItem('tykerf.min', 'true'));
    await page.goto(`${base}?tykerf=full-frame`); // the full editor
    await page.locator('.panel').waitFor();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    server?.kill();
  });

  it('opens a page in the shell; the full editor is the shell\'s other mode, and its old addresses lead there', async () => {
    const r = await fetch(base, { redirect: 'manual' });
    expect([r.status, r.headers.get('location')]).toEqual([302, '/_tykerf/edit/home/']);
    // the full editor's old addresses: the shell's Full editor mode, on the block and tab asked for
    const loc = async (q: string) => (await fetch(`${base}${q}`, { redirect: 'manual' })).headers.get('location');
    expect(await loc('?tykerf=full')).toBe('/_tykerf/edit/home/?mode=full');
    expect(await loc('?block=hero&tab=code')).toBe('/_tykerf/edit/home/?mode=full&block=hero&tab=code');
    // where it loads it: the page with the full editor, in the shell's frame
    expect(await (await fetch(`${base}?tykerf=full-frame`)).text()).toContain('_tykerf/tykerf.js');
    expect(await (await fetch(`${base}?tykerf=frame`)).text()).not.toContain('_tykerf/tykerf.js');
    // the shell's bar has the pages, the site and the way back to tasks: the full editor's header only edits
    for (const gone of ['.backtasks', '.modesw', '.pagesw', '.sitebtn']) expect(await page.locator(gone).count()).toBe(0);
    const fresh = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    // a link to a block: the shell's Full editor mode, the full editor in its frame on that block, the bar on top
    await fresh.goto(`${base}?block=hero&tab=text`);
    await fresh.waitForURL(/\/_tykerf\/edit\/home\/\?mode=full$/);
    await expect.poll(() => fresh.frameLocator('.frame').locator('.work .w-name').inputValue()).toBe('hero');
    expect(await fresh.locator('.bar .modes a[aria-current="page"]').textContent()).toBe('Full editor');
    // its tasks are in Tasks: the count leads there, the tray doesn't open here
    expect(await fresh.locator('.bar .actions a.btn').first().getAttribute('href')).toBe('/_tykerf/edit/home/');
    // its × goes back to Tasks
    await fresh.frameLocator('.frame').locator('.panel .closebtn').click();
    await fresh.waitForURL(/\/_tykerf\/edit\/home\/$/);
    await fresh.close();
  });

  it('adds a task from the context menu of the full editor, on the element under the pointer, ready for Kaity', async () => {
    const lead = page.locator('[data-sw="hero"] p').first();
    await lead.scrollIntoViewIfNeeded();
    const r = (await lead.boundingBox())!;
    await page.mouse.click(r.x + 20, r.y + 8, { button: 'right' });
    await page.locator('.menu [data-act="task-here"]').click();
    // the form offers to give the task to Kaity at once; Add task keeps it for later
    await expect.poll(() => page.locator('.pop [data-n="ask"]').count()).toBe(1);
    await page.locator('.pop textarea').fill('Say who it is for');
    await page.locator('.pop [data-n="add"]').click();
    await expect.poll(() => tasks(ws).find((x) => x.text === 'Say who it is for')?.block).toBe('hero');
    expect(tasks(ws).find((x) => x.text === 'Say who it is for')!.label).toMatch(/^p "/);
  });

  it('serves the handbook, as a page and as Markdown, with the page\'s tasks', async () => {
    const n = addTask(ws, { block: 'hero', path: [1], label: 'h1 "The short promise of your product"', text: 'Say it in five words' }).n;
    closeTask(ws, n);
    const html = await (await fetch(`${base}_tykerf/handbook`)).text();
    expect(html).toContain('<base href="../">');
    expect(html).toContain('Say it in five words');
    const md = await fetch(`${base}_tykerf/handbook.md`);
    expect(md.headers.get('content-type')).toMatch(/^text\/markdown/);
    expect(await md.text()).toMatch(/task #\d+ on hero › h1 "The short promise.*: Say it in five words \[done\]/);
  });

  it('shows tasks Kaity closes from outside at once', async () => {
    const shell = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await shell.goto(base);
    await shell.frameLocator('.frame').locator('[data-sw="cta"]').waitFor();
    const n = addTask(ws, { block: 'cta', text: 'Check the button colour' }).n;
    await expect.poll(() => shell.locator(`.pin[data-pin="${n}"]`).count(), { timeout: 5000 }).toBe(1);
    closeTask(ws, n, 'ai', 'It follows the theme accent now.');
    await expect.poll(() => shell.locator(`.pin[data-pin="${n}"]`).count(), { timeout: 5000 }).toBe(0);
    await shell.close();
  });

  it('lists every open task of the site, and Undo takes back a question just added', async () => {
    const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
    const q = await post('_tykerf/tasks/add', { block: 'hero', text: 'Is this the same on every page?', question: true });
    expect(q.result).toMatchObject({ kind: 'question', text: 'Is this the same on every page?' });
    const site = await (await fetch(new URL('/_tykerf/site/tasks', base))).json();
    expect(site.pages.map((x: { page: string }) => x.page)).toEqual(['home']);
    expect(site.pages[0].tasks.at(-1)).toMatchObject({ n: q.result.n, kind: 'question' });
    expect(site.total).toBe(tasks(ws, { open: true }).length);
    expect((await (await fetch(`${base}_tykerf/taskrun`)).json()).run).toBeNull();
    expect(await post('_tykerf/undo', {})).toMatchObject({ ok: true, undone: `add question ${q.result.n}` });
    expect(tasks(ws).some((x) => x.n === q.result.n)).toBe(false);
  });
});
