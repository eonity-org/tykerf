// "Show or describe it": a new site's first page built by the AI from words and a picture. The
// editor runs with the Anthropic runner against a fake API that answers with scripted turns, so the
// whole path is real: New page, the AI run with the picture, the shell with her work, a task's review.

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPage } from '../src/library.js';
import { Workspace } from '../src/workspace.js';
import { zip } from '../src/zip.js';
import { freePort } from './ports.js';

vi.setConfig({ testTimeout: 45_000 });

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
const message = (content: unknown[], stop = 'tool_use') => ({ id: 'msg', type: 'message', role: 'assistant', model: 'm', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });

let api: Server;
const got: any[] = [];
const replies = [
  message([{ type: 'tool_use', id: 't1', name: 'use_component', input: { id: 'main', name: 'hero' } }]),
  message([{ type: 'text', text: 'I built a hero for the bakery.' }], 'end_turn'),
  // the hero's sample text is left: Kaity gets one pass over it before the build ends
  message([{ type: 'text', text: 'I left the hero text for you to write.' }], 'end_turn'),
];
let browser: Browser;
const editors: ChildProcess[] = [];

/** An editor on a new site folder, with this environment; resolves to its address. */
async function editor(env: Record<string, string>): Promise<{ url: string; site: string }> {
  const site = join(mkdtempSync(join(tmpdir(), 'tykerf-start-ai-')), 'site');
  const port = await freePort();
  const p = spawn(process.execPath, ['--import', 'tsx', 'src/editor/server.ts', site, '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_BASE_URL: '', ...env } });
  editors.push(p);
  await new Promise<void>((ok, fail) => {
    p.stdout!.on('data', (d) => String(d).includes('TYKERF: http') && ok());
    p.on('exit', (c) => fail(new Error(`editor exited with ${c}`)));
  });
  return { url: `http://localhost:${port}/`, site };
}

beforeAll(async () => {
  api = createServer(async (req, res) => {
    let s = '';
    for await (const c of req) s += c;
    got.push(JSON.parse(s));
    const r: any = replies.shift() ?? message([{ type: 'text', text: 'done' }], 'end_turn');
    if (r.delay) await new Promise((ok) => setTimeout(ok, r.delay));
    if (!res.destroyed) res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(r));
  });
  await new Promise<void>((ok) => api.listen(0, '127.0.0.1', ok));
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
  for (const e of editors) e.kill();
  api?.close();
});

describe('show or describe it', () => {
  /** The top block of a page, where the whole-page build's conversation is. */
  const top = async (url: string, page: string) => (await fetch(`${url}${page}/_tykerf/state`).then((x) => x.json())).tree.id;

  it('makes the first page and opens the editor on the AI building it from the words and the picture', async () => {
    const { url, site } = await editor({ TYKERF_RUNNER: 'anthropic', TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}` });
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    page.setDefaultTimeout(8000);
    await page.goto(url); // a new site: New page
    await page.waitForURL(/\/_tykerf\/edit\/_site\/new$/);
    expect(await page.locator('.np-kaity [type="submit"]').isDisabled()).toBe(false); // the AI is ready
    await page.locator('#np-name').fill('bakery');
    await page.locator('#np-prompt').fill('A page for our bakery in Murcia');
    const shot = join(mkdtempSync(join(tmpdir(), 'tykerf-pic-')), 'sketch.png');
    writeFileSync(shot, PNG);
    await page.locator('.np-drop input[type=file]').setInputFiles(shot);
    await page.locator('.np-pics img').waitFor();
    await page.locator('.np-kaity [type=submit]').click();
    await page.waitForURL(`${url}_tykerf/edit/bakery/`);

    // the page opens at once; the bar says Kaity is building it and the tray lists her steps, then her answer
    await expect.poll(() => page.locator('.bar .status').textContent(), { timeout: 20_000 }).toContain('Your page is ready');
    expect(await page.locator('.jobsteps li').allTextContents()).toEqual([expect.stringMatching(/^use component main hero/), expect.stringMatching(/^checking \d+ things left unfinished$/)]);
    expect(await page.locator('.tray .how').textContent()).toBe('I left the hero text for you to write.');
    // Got it; then the whole conversation is the top block's, to read from Kaity's work
    await page.locator('[data-bar="job-seen"]').click();
    await page.locator('.bar .hint').waitFor();
    await page.goto(`${url}_tykerf/edit/bakery/?conversation=${await top(url, 'bakery')}`);
    await page.locator('.convo .msg.ai').first().waitFor();
    expect(await page.locator('.convo .msg.ai .who').first().textContent()).toBe('Kaity'); // Kaity's replies carry her name and mark
    expect(await page.locator('.convo .msg.ai').first().textContent()).toBe('KaityI built a hero for the bakery.');
    expect(await page.locator('.convo .msg.check b').first().textContent()).toMatch(/^Kaity checks the \d+ things she left unfinished$/);
    expect(await page.locator('.convo .msg.user').textContent()).toContain('A page for our bakery in Murcia');
    expect(await page.locator('.convo [data-close]').count()).toBe(1); // to read: nothing is asked from here
    expect(readFileSync(join(site, 'bakery', 'boxes', 'main.html'), 'utf8')).toContain('The short promise of your product');
    // Kaity started from an empty page: two boxes with no code, no sample text
    expect(readFileSync(join(site, 'bakery', 'layout.slice'), 'utf8')).toMatch(/^header\[role=header\] main\[role=main\]/);
    expect(readFileSync(join(site, 'bakery', 'boxes', 'header.html'), 'utf8').trim()).toBe('');

    // what the model got: the words, the picture, and the brief for building a whole page
    const first = got[0];
    expect(first.system).toMatch(/This page was just made for this request/);
    expect(first.system).toMatch(/list_layouts, then use_layout/);
    expect(first.system).toMatch(/The user left the theme to you/);
    expect(first.messages[0].content.map((c: any) => c.type)).toEqual(['text', 'image']);
    expect(first.messages[0].content[1].source.media_type).toBe('image/png');
    // and the pass over what the build left: the hero's sample text
    const fix = got[2].messages.at(-1).content[0].text;
    expect(fix).toMatch(/^These were left unfinished on the page:/);
    expect(fix).toContain('main: placeholder text "The short promise of your product"');
  });

  it('builds the page from a design exported as a ZIP file: its pictures attached, its text files as reference', async () => {
    const { url } = await editor({ TYKERF_RUNNER: 'anthropic', TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}` });
    replies.push(message([{ type: 'text', text: 'I built the page from your design.' }], 'end_turn'));
    const before = got.length;
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    page.setDefaultTimeout(8000);
    await page.goto(`${url}_tykerf/edit/_site/new`);
    await page.locator('#np-name').fill('paris');
    const file = join(mkdtempSync(join(tmpdir(), 'tykerf-zip-')), 'stitch_paris.zip');
    writeFileSync(file, zip([
      { path: 'DESIGN.md', bytes: new TextEncoder().encode('# L\'Odyssée Parisienne\nPrimary: #0F1B29') },
      { path: 'code.html', bytes: new TextEncoder().encode('<h1>Paris en Données Rares</h1>') },
      { path: 'screen.png', bytes: new Uint8Array(PNG) },
    ]));
    await page.locator('.np-drop input[type=file]').setInputFiles(file);
    expect(await page.locator('.np-zip b').textContent()).toBe('stitch_paris.zip');
    await page.locator('.np-kaity [type=submit]').click(); // no words needed: the ZIP is enough
    await page.waitForURL(`${url}_tykerf/edit/paris/`);
    await expect.poll(() => page.locator('.bar .status').textContent(), { timeout: 20_000 }).toContain('Your page is ready');

    // the chat shows the request and the file names; the model gets the files' text and the picture
    await page.locator('[data-bar="job-seen"]').click();
    await page.locator('.bar .hint').waitFor();
    await page.goto(`${url}_tykerf/edit/paris/?conversation=${await top(url, 'paris')}`);
    await page.locator('.convo .msg.user').waitFor();
    expect(await page.locator('.convo .msg.user').textContent()).toContain('(Attached: stitch_paris.zip: DESIGN.md, code.html, screen.png)');
    expect(await page.locator('.convo .msg.user').textContent()).not.toContain('#0F1B29');
    const first = got[before];
    const [words, picture] = first.messages[0].content;
    expect(words.text).toMatch(/^Make this page from the attached design\./);
    expect(words.text).toContain('--- DESIGN.md ---\n# L\'Odyssée Parisienne\nPrimary: #0F1B29');
    expect(words.text).toContain('<h1>Paris en Données Rares</h1>');
    expect(picture.source.media_type).toBe('image/png');

    // a file that is not a ZIP is refused before any page is made
    const r = await page.evaluate(async () => (await fetch('/_tykerf/site/new', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'bad', zip: { name: 'x.zip', data: btoa('not a zip') } }) })).json());
    expect(r).toMatchObject({ ok: false, error: 'x.zip: this is not a ZIP file' });
  });

  it('stops the AI from the bar; what it built stays', async () => {
    const { url } = await editor({ TYKERF_RUNNER: 'anthropic', TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}` });
    replies.push({ ...message([{ type: 'text', text: 'too late' }], 'end_turn'), delay: 8000 } as any);
    const r = await fetch(`${url}_tykerf/site/new`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'slow', prompt: 'a long page' }) }).then((x) => x.json());
    expect(r.ok).toBe(true);
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${url}_tykerf/edit/slow/`);
    await expect.poll(() => page.locator('.bar .status').textContent()).toContain('Kaity is building slow');
    await page.locator('[data-bar="job-stop"]').click();
    await expect.poll(() => page.locator('.bar .status').textContent(), { timeout: 10_000 }).toContain('Stopped');
    expect(await page.locator('.tray .how').textContent()).toMatch(/What Kaity built so far stays/);
  });

  it('shows where Kaity works: on the site\'s Kaity screen, and on the block in the full editor\'s tree', async () => {
    const { url } = await editor({ TYKERF_RUNNER: 'anthropic', TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}` });
    const post = (path: string, body: unknown) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
    expect((await post('_tykerf/site/new', { name: 'tour', layout: 'blank' })).ok).toBe(true);
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    page.setDefaultTimeout(8000);
    await page.goto(`${url}tour/?tykerf=full-frame`); // the page's full editor is open: Kaity runs in it
    // only this run's slow reply: one left by an earlier test would end it at once
    replies.length = 0;
    replies.push({ ...message([{ type: 'text', text: 'slow' }], 'end_turn'), delay: 8000 } as any);
    expect((await post('tour/_tykerf/ask', { id: 'nav', prompt: 'make it shorter' })).ok).toBe(true);
    expect((await fetch(`${url}_tykerf/site`).then((x) => x.json())).kaity).toEqual({ site: false, pages: [{ page: 'tour', block: 'nav' }] });

    // the site's Kaity screen lists her run as going on
    const screen = await browser.newPage();
    await screen.goto(`${url}_tykerf/edit/_site/kaity`);
    const run = screen.locator('.runs .run.working');
    await run.waitFor();
    expect(await run.locator('.rhead').textContent()).toMatch(/^Working\s*tour · nav/);
    expect(await run.locator('.rhead a').getAttribute('href')).toBe('/_tykerf/edit/tour/?conversation=nav');
    expect(await screen.locator('.sidebar [data-screen="kaity"] .sstate').textContent()).toBe('working now');
    await screen.close();

    // in the full editor: her balls on the block in the tree
    await page.goto(`${url}tour/?tykerf=full-frame&block=nav`);
    await expect.poll(() => page.locator('.tree .item[data-id="nav"] .at-work').count()).toBe(1);
    await post('tour/_tykerf/ask/cancel', {});
    await expect.poll(async () => (await fetch(`${url}_tykerf/site`).then((x) => x.json())).kaity.pages, { timeout: 5000 }).toEqual([]);
  });

  it('starts from a layout when the AI is not ready, and says why', async () => {
    const { url } = await editor({ TYKERF_RUNNER: 'anthropic' }); // no key
    const page = await browser.newPage();
    await page.goto(`${url}_tykerf/edit/_site/new`);
    expect(await page.locator('.np-kaity [type=submit]').isDisabled()).toBe(true);
    expect(await page.locator('.np-kaity .warn').textContent()).toMatch(/not ready.*no key/);
    expect(await page.locator('[data-np="layout"] [type=submit]').isDisabled()).toBe(false);
    const r = await fetch(`${url}_tykerf/site/new`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x', prompt: 'a page' }) });
    expect(r.status).toBe(422);
    expect((await r.json()).error).toMatch(/Kaity is not ready/);
  });
});

describe("a task's review", () => {
  it('takes the task\'s pictures to Kaity, shows what she left unfinished with Fix them / Leave them, and her conversation', async () => {
    const { url } = await editor({ TYKERF_RUNNER: 'anthropic', TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}`, TYKERF_TASK_SHOTS: 'off' });
    replies.splice(0); // the scripted replies of the tests before, when this one runs alone
    replies.push(message([{ type: 'text', text: 'built' }], 'end_turn') as any);
    const post = (path: string, body: unknown) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
    expect((await post('_tykerf/site/new', { name: 'log', prompt: 'a page' })).ok).toBe(true);
    await expect.poll(async () => (await fetch(`${url}log/_tykerf/job`).then((x) => x.json())).job?.state, { timeout: 10_000 }).toBe('done');
    await post('log/_tykerf/job/seen', {});
    // a task with a picture, as the task box sends it
    const one = await post('log/_tykerf/tasks/add', { block: 'main', text: 'Add a link like in the picture', images: [{ mediaType: 'image/png', data: PNG.toString('base64') }] });
    expect(one.result.images).toEqual([expect.stringMatching(/^[a-f0-9]{40}\.png$/)]);

    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    page.setDefaultTimeout(8000);
    await page.goto(`${url}_tykerf/edit/log/`);
    await page.locator('[data-bar="tray"]').click();
    expect(await page.locator('.card[data-card="1"] .pics img').count()).toBe(1);
    const before = got.length;
    replies.push(
      message([{ type: 'tool_use', id: 'a1', name: 'set_content', input: { id: 'main', html: '<p>Rome</p><a href="#">Read on</a>' } }]) as any,
      message([{ type: 'tool_use', id: 'a2', name: 'close_task', input: { n: 1, reply: 'Added the link.' } }]) as any,
      message([{ type: 'text', text: 'added' }], 'end_turn') as any,
    );
    await page.locator('[data-bar="give"]').click();
    // what she left unfinished in the task, on its card
    const left = page.locator('.card[data-card="1"] .left');
    await left.waitFor({ timeout: 15_000 });
    expect(await left.locator('b').textContent()).toBe('Kaity left 1 thing unfinished');
    expect(await left.locator('li').allTextContents()).toEqual(['main: the link "Read on" goes nowhere']);
    // the picture went to her with the task
    expect(got[before].messages[0].content.map((c: any) => c.type)).toEqual(['text', 'image']);

    // Fix them: she finishes it, under the task (Undo this one takes both)
    replies.push(
      message([{ type: 'tool_use', id: 'f1', name: 'set_content', input: { id: 'main', html: '<p>Rome</p><a href="/log/">Read on</a>' } }]) as any,
      message([{ type: 'text', text: 'fixed' }], 'end_turn') as any,
    );
    await left.locator('[data-card-act="fix-left"]').click();
    await expect.poll(() => page.locator('.card[data-card="1"] .left').count(), { timeout: 15_000 }).toBe(0);
    expect(JSON.stringify(got.at(-2).messages)).toContain('These were left unfinished');

    // Leave them: another task leaves one; it stays as it is
    await post('log/_tykerf/tasks/add', { block: 'main', text: 'And a second link' });
    replies.push(
      message([{ type: 'tool_use', id: 'b1', name: 'set_content', input: { id: 'main', html: '<p>Rome</p><a href="/log/">Read on</a> <a href="#">More</a>' } }]) as any,
      message([{ type: 'tool_use', id: 'b2', name: 'close_task', input: { n: 2, reply: 'Added a second link.' } }]) as any,
      message([{ type: 'text', text: 'added more' }], 'end_turn') as any,
    );
    await page.locator('.tray .card[data-card="2"]').waitFor();
    await post('log/_tykerf/taskrun/start', { tasks: [2] });
    const left2 = page.locator('.card[data-card="2"] .left');
    await left2.locator('[data-card-act="leave-left"]').click({ timeout: 15_000 });
    await expect.poll(() => left2.locator('b').textContent()).toBe('1 thing left as it is');

    // her conversation on the block: every task on it, and what she left
    await page.locator('.card[data-card="2"] [data-card-act="convo"]').click();
    await page.locator('.convo .msg.ai', { hasText: 'added more' }).waitFor();
    expect(await page.locator('.convo h2').textContent()).toBe('Kaity on main');
    expect(await page.locator('.convo .msg.check b').allTextContents()).toContain('1 thing left as it is');
    expect(await page.locator('.convo .msg.user .pics img').count()).toBe(1); // the task's picture, as she got it
  });
});

describe('the site in the editor', () => {
  it('shows the pages made in its folder meanwhile, when the person comes back to it', async () => {
    const { url, site } = await editor({ TYKERF_RUNNER: 'anthropic' });
    createPage(new Workspace(join(site, 'home')), 'blank');
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    page.setDefaultTimeout(8000);
    await page.goto(`${url}_tykerf/edit/_site/tasks`);
    await expect.poll(() => page.locator('.sidebar .pname').allTextContents()).toEqual(['home']);
    for (const name of ['rome', 'prague']) createPage(new Workspace(join(site, name)), 'blank');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => page.locator('.sidebar .pname').allTextContents(), { timeout: 6000 }).toEqual(['home', 'prague', 'rome']);
    await page.locator('.sidebar .popen', { hasText: 'rome' }).click();
    await page.waitForURL(`${url}_tykerf/edit/rome/`);
  });
});

describe('pages while Kaity works', () => {
  it('can be renamed and removed, except her page and the pages it links to', async () => {
    const { url, site } = await editor({ TYKERF_RUNNER: 'anthropic', TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}` });
    const post = (path: string, data: unknown) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    for (const name of ['busy', 'other', 'target']) await post('_tykerf/site/new', { name, layout: 'blank', shared: false }); // each page's own navigation
    new Workspace(join(site, 'busy')).setContent('nav', '<a href="/target/">Target</a>', 'user');
    replies.splice(0);
    replies.push({ ...message([{ type: 'text', text: 'done' }], 'end_turn'), delay: 4000 } as any);
    await post('busy/_tykerf/ask', { id: 'nav', prompt: 'take your time' });

    expect((await post('_tykerf/site/rename', { name: 'other', to: 'other-2' })).status).toBe(200);
    const linked = await post('_tykerf/site/rename', { name: 'target', to: 'target-2' });
    expect(linked.status).toBe(409);
    expect((await linked.json()).error).toBe('Kaity is working on "busy", which links to "target"; wait for her to finish, so those links can follow the new name');
    const hers = await post('_tykerf/site/rename', { name: 'busy', to: 'busy-2' });
    expect([hers.status, (await hers.json()).error]).toEqual([409, 'Kaity is working on "busy"; wait for her to finish before you rename it']);
    expect((await post('_tykerf/site/remove', { name: 'busy' })).status).toBe(409);
    expect((await post('_tykerf/site/remove', { name: 'target' })).status).toBe(200); // removing rewrites no links
    await post('busy/_tykerf/ask/cancel', {});
  });
});

describe('a page Kaity builds', () => {
  it('comes into focus box by box: blurred until she reaches a box, softly while she is on it, clear when it is done', async () => {
    const { url } = await editor({ TYKERF_RUNNER: 'anthropic', TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}` });
    const call = (id: string, name: string, input: unknown) => ({ ...message([{ type: 'tool_use', id, name, input }]), delay: 1500 }) as any;
    replies.splice(0);
    replies.push(
      call('b1', 'use_layout', { name: 'blank' }),
      call('b2', 'set_content', { id: 'text', html: '<h1>Fresh bread every morning</h1>' }),
      call('b3', 'set_content', { id: 'nav', html: '<nav><a href="#">Page one</a></nav>' }),
      { ...message([{ type: 'text', text: 'built' }], 'end_turn'), delay: 1500 } as any,
      message([{ type: 'text', text: 'I left the menu for you.' }], 'end_turn'), // the pass over what is left
    );
    await fetch(`${url}_tykerf/site/new`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'bakery', prompt: 'a bakery' }) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.addInitScript(() => localStorage.setItem('tykerf.mode', '\"edit\"')); // her conversation is in the Edit mode
    page.setDefaultTimeout(10_000);
    await page.goto(`${url}bakery/?tykerf=full-frame`); // the full editor shows her build coming into focus
    const focus = () => page.evaluate(() => document.getElementById('tykerf-focus')?.textContent ?? '');
    const blur = async (id: string) => /\d+/.exec((await focus()).split('\n').find((l) => l.includes(`[data-sw="${id}"]`))?.match(/blur\((\d+)px\)/)?.[0] ?? '')?.[0] ?? null;

    await expect.poll(() => blur('nav'), { timeout: 8000 }).toBe('14'); // the layout is placed: nothing done yet
    expect(await blur('text')).toBe('14');
    await expect.poll(() => blur('text'), { timeout: 8000 }).toBe(null); // finished: clear
    await page.waitForTimeout(1000); // the transition
    await page.screenshot({ path: join(tmpdir(), 'tykerf-focus-text-done.png') });
    await expect.poll(() => blur('nav'), { timeout: 8000 }).toBe('5'); // she is on it, sample text left
    await page.waitForTimeout(1000);
    await page.screenshot({ path: join(tmpdir(), 'tykerf-focus-nav-soft.png') });

    await page.locator('.job-clear').click(); // See the page clearly
    expect(await blur('nav')).toBe(null);
    expect(await page.locator('.job-clear').getAttribute('aria-pressed')).toBe('true');
    await page.locator('.job-clear').click();
    expect(await blur('nav')).toBe('5');

    await page.locator('.job-box h2', { hasText: 'Your page is ready' }).waitFor({ timeout: 20_000 });
    expect(await focus()).not.toMatch(/blur\(/); // the build is over: all clear
  }, 60_000);
});

describe('Kaity at work on the page', () => {
  it('scrolls the page to the block she works on, and carries her label there, unless you scroll yourself', async () => {
    const { url } = await editor({ TYKERF_RUNNER: 'anthropic', TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}` });
    const post = (path: string, data: unknown) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    await post('_tykerf/site/new', { name: 'home', layout: 'launch' });
    const call = (id: string, name: string, input: unknown, delay = 200) => ({ ...message([{ type: 'tool_use', id, name, input }]), delay }) as any;
    replies.splice(0);
    replies.push(
      call('f1', 'get_layout', {}),
      call('f2', 'get_content', { id: 'faq' }, 1500), // far down the page
      call('f3', 'get_content', { id: 'nav' }, 2500), // you scroll meanwhile: she doesn't pull you back
      { ...message([{ type: 'text', text: 'Read them.' }], 'end_turn'), delay: 3000 } as any, // she stays on the navigation a while
    );
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.setDefaultTimeout(10_000);
    await page.goto(`${url}home/?tykerf=full-frame`); // the full editor, as the shell's Full editor mode loads it
    await page.locator('section.panel').waitFor();
    expect(await page.evaluate('scrollY')).toBe(0);
    await post('home/_tykerf/ask', { id: 'page', prompt: 'Read the FAQ and the navigation' });
    // she reads the FAQ: the page goes there, and her label is on it
    await expect.poll(() => page.evaluate('Math.round(document.querySelector("[data-sw=faq]").getBoundingClientRect().top)'), { timeout: 8000 }).toBeLessThan(720);
    await page.locator('.kframe .ktag', { hasText: 'get content faq' }).waitFor();
    // scrolling yourself pauses the following: her next block (the navigation, out of sight above) doesn't pull you back
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(500); // the wheel's own scroll is animated: let it settle
    const yours = await page.evaluate('scrollY');
    await page.locator('.kframe .ktag', { hasText: 'get content nav' }).waitFor();
    await page.waitForTimeout(600);
    expect(Math.abs((await page.evaluate('scrollY')) as number - (yours as number))).toBeLessThan(40); // not back up at the navigation
  }, 40_000);
});

describe('Kaity for the whole site', () => {
  it('goes through the pages one by one from the site\'s Kaity screen, while page-level work waits', async () => {
    const { url, site } = await editor({ TYKERF_RUNNER: 'anthropic', TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}` });
    const post = (path: string, data: unknown) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    for (const name of ['rome', 'munich']) await post('_tykerf/site/new', { name, layout: 'blank', shared: false }); // each page's own navigation, which she changes page by page
    const nav = '<nav><a href="/rome/">Rome</a> <a href="/munich/">Munich</a></nav>';
    const call = (id: string, name: string, input: unknown, delay = 200) => ({ ...message([{ type: 'tool_use', id, name, input }]), delay }) as any;
    replies.splice(0);
    replies.push(
      call('s1', 'list_pages', {}),
      call('s2', 'open_page', { name: 'rome' }),
      call('s3', 'set_content', { id: 'nav', html: nav }),
      call('s4', 'open_page', { name: 'munich' }, 2500),
      call('s5', 'set_content', { id: 'nav', html: nav }),
      message([{ type: 'text', text: 'Both navigations now link to every page.' }], 'end_turn') as any,
    );
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(10_000);
    await page.goto(`${url}_tykerf/edit/_site/kaity`);
    await page.locator('.convo #ask-site-2').pressSequentially('Link every page from the navigation'); // real key presses
    await page.locator('.convo [type="submit"]').click();
    await page.locator('.convo [data-k="stop"]').waitFor();

    // while she works on the site, renames and a page's own Kaity wait
    const rename = await post('_tykerf/site/rename', { name: 'rome', to: 'roma' });
    expect([rename.status, (await rename.json()).error]).toEqual([409, 'Kaity is working on the whole site; wait for her to finish before you rename a page']);
    expect((await post('rome/_tykerf/ask', { id: 'nav', prompt: 'hi' })).status).toBe(409);
    expect((await post('rome/_tykerf/tasks/ask', { id: 'nav' })).status).toBe(409); // a page's tasks too
    const build = await post('_tykerf/site/new', { name: 'lisbon', prompt: 'A page about Lisbon' }); // and a new page she would build
    expect([build.status, (await build.json()).error]).toEqual([409, 'Kaity is working on the whole site; wait for her to finish']);
    expect(existsSync(join(site, 'lisbon'))).toBe(false);
    // the site's log of her work shows the run going on, with what she does now
    const going = (await fetch(`${url}_tykerf/site/kaity`).then((r) => r.json())).runs[0];
    expect(going).toMatchObject({ page: null, request: 'Link every page from the navigation', state: 'working' });

    await page.locator('.convo .msg.ai', { hasText: 'Both navigations now link to every page.' }).waitFor({ timeout: 20_000 });
    for (const name of ['rome', 'munich']) expect(readFileSync(join(site, name, 'boxes', 'nav.html'), 'utf8')).toContain('<a href="/munich/">Munich</a>');
    expect(await page.locator('.convo .msg.user').textContent()).toContain('Link every page from the navigation');
    // her conversation is the site's, kept in its folder
    expect(JSON.parse(readFileSync(join(site, '.tykerf', 'chats', 'site.json'), 'utf8')).messages.at(-1)).toMatchObject({ role: 'ai' });
    expect((await fetch(`${url}_tykerf/site/kaity`).then((r) => r.json())).runs[0]).toMatchObject({ page: null, state: 'done', steps: 5, answer: 'Both navigations now link to every page.' });
  }, 60_000);
});
