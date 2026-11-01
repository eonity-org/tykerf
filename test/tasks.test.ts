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
    // nothing about tasks is part of the page or its history
    expect(ws.history()).toEqual([]);
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

  beforeAll(async () => {
    // a site with its home page, which the editor serves at /home/
    const site = join(mkdtempSync(join(tmpdir(), 'tykerf-tasks-')), 'site');
    const dir = join(site, 'home');
    ws = new Workspace(dir);
    createPage(ws, 'launch');
    const port = await freePort();
    server = spawn(process.execPath, ['--import', 'tsx', 'src/editor/server.ts', site, '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise<void>((ok, fail) => {
      server.stdout!.on('data', (d) => String(d).includes('TYKERF: http') && ok());
      server.on('exit', (c) => fail(new Error(`editor exited with ${c}`)));
    });
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(5000);
    await page.addInitScript(() => {
      localStorage.setItem('tykerf.on', 'true');
      localStorage.setItem('tykerf.min', 'true');
      if (!localStorage.getItem('tykerf.mode')) localStorage.setItem('tykerf.mode', '"edit"');
    });
    await page.goto(`http://localhost:${port}/home/`);
    await page.locator('.panel').waitFor();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    server?.kill();
  });

  it('adds a task on the element clicked in the Tasks mode, and closes it from its tab', async () => {
    await page.locator('[data-mode="tasks"]').click();
    await expect.poll(() => page.locator('[data-mode="tasks"]').getAttribute('aria-checked')).toBe('true');
    // choosing Tasks opens the panel; the headline's left edge stays in view
    await expect.poll(() => page.locator('.minimize').getAttribute('aria-expanded')).toBe('true');
    const h1 = page.locator('[data-sw="hero"] h1');
    const box = (await h1.boundingBox())!;
    await page.mouse.move(box.x + 14, box.y + 20);
    await expect.poll(() => page.locator('.nhover .tag').textContent()).toMatch(/^hero › h1 "The short promise/);
    await page.mouse.click(box.x + 14, box.y + 20);
    await page.locator('.pop textarea').fill('Say it in five words');
    await page.keyboard.press('Enter');
    await expect.poll(() => tasks(ws).length).toBe(1);
    expect(tasks(ws)[0]).toMatchObject({ n: 1, block: 'hero', width: 1280, text: 'Say it in five words', label: expect.stringMatching(/^h1 "/) });
    // the path finds the same element on the page
    expect(await page.evaluate((path) => {
      let x: Element = document.querySelector('[data-sw="hero"]')!;
      for (const i of path) x = [...x.children].filter((c) => !['STYLE', 'SCRIPT', 'TEMPLATE', 'NOSCRIPT'].includes(c.nodeName))[i];
      return x.nodeName;
    }, tasks(ws)[0].path!)).toBe('H1');
    await expect.poll(() => page.locator('[data-mode="tasks"] .count').textContent()).toBe('1');
    // a click in the Tasks mode doesn't select or edit anything
    expect(await h1.getAttribute('contenteditable')).toBeNull();

    await page.locator('[data-mode="edit"]').click(); // the Edit mode: the tab stays
    await expect.poll(() => page.locator('[data-mode="edit"]').getAttribute('aria-checked')).toBe('true');
    await page.locator('.minimize').click(); // compact again, out of the page's way
    await page.locator('.pin[data-pin="1"]').click();
    await page.locator('.pop [data-n="close"]').click();
    await expect.poll(() => tasks(ws)[0].done?.by).toBe('user');
    await expect.poll(() => page.locator('.pins .pin').count()).toBe(0);
  });

  it('adds a task from the context menu, on the element under the pointer, ready for Kaity', async () => {
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

  it('offers one run for every open task on the page, from the top block', async () => {
    const a = addTask(ws, { block: 'cta', text: 'One' }).n, b = addTask(ws, { block: 'faq', text: 'Two' }).n;
    await expect.poll(() => page.locator(`.pin[data-pin="${b}"]`).count(), { timeout: 5000 }).toBe(1); // a change from outside: slower on a CI runner
    await page.locator('[data-mode="tasks"]').click();
    const all = page.locator('.taskpanel .ask-all');
    await expect.poll(() => all.textContent()).toMatch(/Give Kaity every task \(\d+\)/);
    expect(await all.getAttribute('data-ask')).toBe('page');
    await page.locator('[data-mode="edit"]').click();
    closeTask(ws, a);
    closeTask(ws, b);
  });

  it('opens new people in the Tasks mode, and a link to a block in the Edit mode', async () => {
    const fresh = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await fresh.addInitScript(() => localStorage.setItem('tykerf.on', 'true'));
    await fresh.goto(page.url());
    await fresh.locator('.panel').waitFor();
    await expect.poll(() => fresh.locator('[data-mode="tasks"]').getAttribute('aria-checked')).toBe('true');
    expect(await fresh.locator('.taskpanel').isVisible()).toBe(true);
    expect(await fresh.locator('.panel .body').isVisible()).toBe(false);
    await fresh.goto(`${page.url().replace(/[?#].*$/, '')}?block=hero&tab=text`);
    await expect.poll(() => fresh.locator('[data-mode="edit"]').getAttribute('aria-checked')).toBe('true');
    expect(await fresh.locator('.work .w-name').inputValue()).toBe('hero');
    await fresh.close();
  });

  it('serves the handbook, as a page and as Markdown, with the page\'s tasks', async () => {
    const base = page.url();
    const html = await (await fetch(`${base}_tykerf/handbook`)).text();
    expect(html).toContain('<base href="../">');
    expect(html).toContain('Say it in five words');
    const md = await fetch(`${base}_tykerf/handbook.md`);
    expect(md.headers.get('content-type')).toMatch(/^text\/markdown/);
    expect(await md.text()).toMatch(/task #1 on hero › h1 "The short promise.*: Say it in five words \[done\]/);
  });

  it('shows tasks Kaity closes from outside at once', async () => {
    const n = addTask(ws, { block: 'cta', text: 'Check the button colour' }).n;
    await expect.poll(() => page.locator(`.pin[data-pin="${n}"]`).count(), { timeout: 5000 }).toBe(1);
    closeTask(ws, n, 'ai', 'It follows the theme accent now.');
    await expect.poll(() => page.locator(`.pin[data-pin="${n}"]`).count(), { timeout: 5000 }).toBe(0);
  });
});
