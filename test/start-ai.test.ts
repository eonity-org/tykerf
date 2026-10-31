// "Show or describe it": a new site's first page built by the AI from words and a picture. The
// editor runs with the Anthropic runner against a fake API that answers with scripted turns, so the
// whole path is real: the chooser, the new page, the AI run with the picture, the editor on its AI tab.

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
  it('makes the first page and opens the editor on the AI building it from the words and the picture', async () => {
    const { url, site } = await editor({ TYKERF_RUNNER: 'anthropic', TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}` });
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.addInitScript(() => localStorage.setItem('tykerf.mode', '\"edit\"')); // her conversation is in the Edit mode
    page.setDefaultTimeout(8000);
    await page.goto(url);
    await page.locator('.chooser').waitFor();
    expect(await page.locator('[data-from="idea"]').getAttribute('aria-pressed')).toBe('true'); // the AI comes first when it is ready
    expect(await page.locator('.ch-ai').textContent()).toMatch(/Anthropic API/);
    // the theme is Kaity's to choose unless the user picks one (a layout keeps its own choice)
    expect(await page.locator('.ch-auto').getAttribute('aria-pressed')).toBe('true');
    await page.locator('[data-from="layout"]').click();
    expect(await page.locator('.ch-auto').isHidden()).toBe(true);
    expect(await page.locator('[data-theme="studio"]').getAttribute('aria-pressed')).toBe('true');
    await page.locator('[data-from="idea"]').click();
    expect(await page.locator('.ch-auto').getAttribute('aria-pressed')).toBe('true');
    await page.locator('input[name=name]').fill('bakery');
    await page.locator('textarea[name=prompt]').fill('A page for our bakery in Murcia');
    const shot = join(mkdtempSync(join(tmpdir(), 'tykerf-pic-')), 'sketch.png');
    writeFileSync(shot, PNG);
    await page.locator('.ch-drop input[type=file]').setInputFiles(shot);
    await page.locator('.ch-pics img').waitFor();
    await page.locator('.chooser [type=submit]').click();
    await page.waitForURL(`${url}bakery/`);

    // the page opens with the AI's work in a modal: its steps, then its answer and how to go on
    await page.locator('.jobmodal').waitFor({ state: 'visible' });
    expect(await page.locator('.job-brand .wordmark').textContent()).toBe('tykerf'); // Kaity never shows without TYKERF
    // only the page and the modal: the editor and its button stay out of sight until the user picks
    expect(await page.locator('.panel').isHidden()).toBe(true);
    expect(await page.locator('.toggle').isHidden()).toBe(true);
    await page.locator('.job-box h2', { hasText: 'Your page is ready' }).waitFor({ timeout: 20_000 });
    expect(await page.locator('.panel').isHidden()).toBe(true);
    expect(await page.locator('.job-steps li').allTextContents()).toEqual([expect.stringMatching(/^use component main hero/), expect.stringMatching(/^checking \d+ things left unfinished$/)]);
    expect(await page.locator('.job-answer').textContent()).toBe('I left the hero text for you to write.');
    // the editor, on the top block's AI tab, with the whole conversation
    await page.locator('[data-job="editor"]').click();
    await page.locator('.jobmodal').waitFor({ state: 'hidden' });
    expect(await page.locator('.toggle').isVisible()).toBe(true);
    expect(await page.locator('.panel').isVisible()).toBe(true);
    await expect.poll(() => page.locator('.work .tabs [data-tab="ai"]').getAttribute('aria-selected')).toBe('true');
    await page.locator('.chat .msg.ai').first().waitFor();
    expect(await page.locator('.chat .msg.ai .who').first().textContent()).toBe('Kaity'); // Kaity's replies carry its name and mark
    expect(await page.locator('.chat .msg.ai').first().textContent()).toBe('KaityI built a hero for the bakery.');
    expect(await page.locator('.chat .msg.check.auto b').textContent()).toMatch(/^Kaity checks the \d+ things she left unfinished$/);
    expect(await page.locator('.chat .msg.user').textContent()).toContain('A page for our bakery in Murcia');
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
    await page.addInitScript(() => localStorage.setItem('tykerf.mode', '\"edit\"')); // her conversation is in the Edit mode
    page.setDefaultTimeout(8000);
    await page.goto(url);
    await page.locator('.chooser').waitFor();
    await page.locator('input[name=name]').fill('paris');
    const file = join(mkdtempSync(join(tmpdir(), 'tykerf-zip-')), 'stitch_paris.zip');
    writeFileSync(file, zip([
      { path: 'DESIGN.md', bytes: new TextEncoder().encode('# L\'Odyssée Parisienne\nPrimary: #0F1B29') },
      { path: 'code.html', bytes: new TextEncoder().encode('<h1>Paris en Données Rares</h1>') },
      { path: 'screen.png', bytes: new Uint8Array(PNG) },
    ]));
    await page.locator('.ch-drop input[type=file]').setInputFiles(file);
    expect(await page.locator('.ch-zip b').textContent()).toBe('stitch_paris.zip');
    await page.locator('.chooser [type=submit]').click(); // no words needed: the ZIP is enough
    await page.waitForURL(`${url}paris/`);
    await page.locator('.job-box h2', { hasText: 'Your page is ready' }).waitFor({ timeout: 20_000 });

    // the chat shows the request and the file names; the model gets the files' text and the picture
    await page.locator('[data-job="editor"]').click();
    await page.locator('.chat .msg.user').waitFor();
    expect(await page.locator('.chat .msg.user').textContent()).toContain('(Attached: stitch_paris.zip: DESIGN.md, code.html, screen.png)');
    expect(await page.locator('.chat .msg.user').textContent()).not.toContain('#0F1B29');
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

  it('stops the AI with the X; what it built stays', async () => {
    const { url } = await editor({ TYKERF_RUNNER: 'anthropic', TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}` });
    replies.push({ ...message([{ type: 'text', text: 'too late' }], 'end_turn'), delay: 8000 } as any);
    const r = await fetch(`${url}_tykerf/site/new`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'slow', prompt: 'a long page' }) }).then((x) => x.json());
    expect(r.ok).toBe(true);
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.addInitScript(() => localStorage.setItem('tykerf.mode', '\"edit\"')); // her conversation is in the Edit mode
    await page.goto(`${url}slow/`);
    // while Kaity works, its progress is a small card in the bottom right corner, over the page
    await page.locator('.jobmodal.running').waitFor();
    await page.waitForTimeout(400); // the card's entrance
    await page.screenshot({ path: join(tmpdir(), 'tykerf-job-running.png') });
    const card = (await page.locator('.job-box').boundingBox())!;
    expect(card.width).toBeLessThanOrEqual(380);
    expect(1280 - (card.x + card.width)).toBeLessThan(40);
    expect(800 - (card.y + card.height)).toBeLessThan(40);
    await page.locator('.job-x').click();
    expect(await page.locator('.job-confirm').textContent()).toMatch(/What it built so far stays/);
    await page.locator('[data-job="stop"]').click();
    await page.locator('.job-box h2', { hasText: 'Stopped' }).waitFor({ timeout: 10_000 });
    expect(await page.locator('[data-job="editor"]').isVisible()).toBe(true);
    // at the end it comes back to the middle
    await page.waitForTimeout(400);
    const end = (await page.locator('.job-box').boundingBox())!;
    expect(Math.abs(end.x + end.width / 2 - 640)).toBeLessThan(4);
    await page.screenshot({ path: join(tmpdir(), 'tykerf-job-ended.png') });
  });

  it('shows where Kaity works: in the site manager, on the page list, and in the page editor with a way there', async () => {
    const { url } = await editor({ TYKERF_RUNNER: 'anthropic', TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}` });
    const post = (path: string, body: unknown) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
    expect((await post('_tykerf/site/new', { name: 'tour', layout: 'blank' })).ok).toBe(true);
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.addInitScript(() => localStorage.setItem('tykerf.mode', '\"edit\"')); // her conversation is in the Edit mode
    page.setDefaultTimeout(8000);
    await page.goto(`${url}tour/`); // the page's editor is open: Kaity runs in it
    // only this run's slow reply: one left by an earlier test would end it at once
    replies.length = 0;
    replies.push({ ...message([{ type: 'text', text: 'slow' }], 'end_turn'), delay: 8000 } as any);
    expect((await post('tour/_tykerf/ask', { id: 'nav', prompt: 'make it shorter' })).ok).toBe(true);
    expect((await fetch(`${url}_tykerf/site`).then((x) => x.json())).kaity).toEqual({ site: false, pages: [{ page: 'tour', block: 'nav' }] });

    // the site manager lists it, and marks the page
    const manager = await browser.newPage();
    await manager.addInitScript(() => localStorage.setItem('tykerf.mode', '\"edit\"')); // her conversation is in the Edit mode
    await manager.goto(`${url}_tykerf/site/`);
    await manager.locator('.now li').waitFor();
    expect(await manager.locator('.now li').textContent()).toBe('tour · nav');
    expect(await manager.locator('.now a').getAttribute('href')).toBe('/tour/?block=nav&tab=ai');
    expect(await manager.locator('.pages li .who a[title="Kaity is working on nav"]').count()).toBe(1);
    await manager.close();

    // in the page editor: her balls on the block in the tree, and from another block's Kaity tab, a way there
    const other = (await fetch(`${url}tour/_tykerf/state`).then((x) => x.json())).tree.children.find((c: any) => c.id !== 'nav' && c.kind === 'box')?.id ?? 'footer';
    await page.goto(`${url}tour/?block=${other}&tab=ai`);
    await page.locator('.work .elsewhere').waitFor();
    expect(await page.locator('.work .elsewhere').textContent()).toBe('Kaity is working on nav.Go there');
    expect(await page.locator('.tree .item[data-id="nav"] .at-work').count()).toBe(1);
    await page.locator('[data-ai="goto"]').click();
    expect(await page.locator('.tree .item.sel').getAttribute('data-id')).toBe('nav');
    await page.locator('.work [data-ai="stop"]').waitFor();
    await post('tour/_tykerf/ask/cancel', {});
    await expect.poll(async () => (await fetch(`${url}_tykerf/site`).then((x) => x.json())).kaity.pages, { timeout: 5000 }).toEqual([]);
  });

  it('starts from a layout when the AI is not ready, and says why', async () => {
    const { url } = await editor({ TYKERF_RUNNER: 'anthropic' }); // no key
    const page = await browser.newPage();
    await page.addInitScript(() => localStorage.setItem('tykerf.mode', '\"edit\"')); // her conversation is in the Edit mode
    await page.goto(url);
    await page.locator('.chooser').waitFor();
    expect(await page.locator('[data-from="layout"]').getAttribute('aria-pressed')).toBe('true');
    await page.locator('[data-from="idea"]').click();
    expect(await page.locator('.ch-ai').textContent()).toMatch(/not ready.*no key/);
    expect(await page.locator('.chooser [type=submit]').isDisabled()).toBe(true);
    const r = await fetch(`${url}_tykerf/site/new`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x', prompt: 'a page' }) });
    expect(r.status).toBe(422);
    expect((await r.json()).error).toMatch(/Kaity is not ready/);
  });
});

describe("Kaity's steps in the AI tab", () => {
  it('stay open while she works, and stay as the person leaves them', async () => {
    const { url } = await editor({ TYKERF_RUNNER: 'anthropic', TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}` });
    replies.splice(0); // the scripted replies of the tests before, when this one runs alone
    replies.push(message([{ type: 'text', text: 'built' }], 'end_turn') as any);
    await fetch(`${url}_tykerf/site/new`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'log', prompt: 'a page' }) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.addInitScript(() => localStorage.setItem('tykerf.mode', '\"edit\"')); // her conversation is in the Edit mode
    page.setDefaultTimeout(8000);
    await page.goto(`${url}log/`);
    await page.locator('[data-job="editor"]').click();
    await page.locator('.chat .msg.ai').waitFor();

    const call = (i: number) => ({ ...message([{ type: 'tool_use', id: `s${i}`, name: 'get_layout', input: {} }]), delay: 700 });
    replies.push(call(1), call(2), call(3), call(4), { ...message([{ type: 'text', text: 'looked' }], 'end_turn'), delay: 700 } as any);
    await page.locator('.composer textarea').fill('look at the layout');
    await page.locator('[data-ai="send"]').click();
    // each step draws the chat again: the run's list stays open and grows
    const live = page.locator('.chat details.steps').last();
    await expect.poll(() => live.locator('div').count(), { timeout: 5000 }).toBe(2);
    expect(await live.getAttribute('open')).not.toBeNull();
    // closed by the person, it stays closed while more steps come
    await live.locator('summary').click();
    await expect.poll(() => live.locator('summary').textContent(), { timeout: 5000 }).toBe('4 steps');
    expect(await live.getAttribute('open')).toBeNull();
    await page.locator('.chat .msg.ai', { hasText: 'looked' }).waitFor();
    expect(await live.getAttribute('open')).toBeNull();

    // what a request leaves unfinished is listed after it, with a choice: Kaity finishes it, or it stays
    replies.push(message([{ type: 'tool_use', id: 'l1', name: 'set_content', input: { id: 'main', html: '<p>Rome</p><a href="#">Read on</a>' } }]) as any, message([{ type: 'text', text: 'added' }], 'end_turn') as any);
    await page.locator('.composer textarea').fill('add a link');
    await page.locator('[data-ai="send"]').click();
    const check = page.locator('.chat .msg.check.open');
    await check.waitFor();
    expect(await check.locator('b').textContent()).toBe('Kaity left 1 thing unfinished');
    expect(await check.locator('li').allTextContents()).toEqual(['main: the link "Read on" goes nowhere']);
    await check.locator('[data-check="leave"]').click();
    await page.locator('.chat .msg.check.left b', { hasText: '1 thing left as it is' }).waitFor();
    expect(await page.locator('[data-check]').count()).toBe(0);
  });
});

describe('the start screen', () => {
  it('offers the pages made in its folder meanwhile', async () => {
    const { url, site } = await editor({ TYKERF_RUNNER: 'anthropic' });
    const page = await browser.newPage();
    await page.addInitScript(() => localStorage.setItem('tykerf.mode', '\"edit\"')); // her conversation is in the Edit mode
    page.setDefaultTimeout(8000);
    await page.goto(url);
    await page.locator('.chooser').waitFor();
    expect(await page.locator('.pages').isHidden()).toBe(true);
    for (const name of ['rome', 'prague']) createPage(new Workspace(join(site, name)), 'blank');
    await expect.poll(() => page.locator('.pages .who a').allTextContents(), { timeout: 6000 }).toEqual(['prague', 'rome']);
    expect(await page.locator('.chooser').isVisible()).toBe(true); // making another page stays possible
    await page.locator('.pages .who a', { hasText: 'rome' }).click();
    await page.waitForURL(`${url}rome/`);
  });
});

describe('pages while Kaity works', () => {
  it('can be renamed and removed, except her page and the pages it links to', async () => {
    const { url, site } = await editor({ TYKERF_RUNNER: 'anthropic', TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}` });
    const post = (path: string, data: unknown) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    for (const name of ['busy', 'other', 'target']) await post('_tykerf/site/new', { name, layout: 'blank' });
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
    await page.goto(`${url}bakery/`);
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
    await page.goto(`${url}home/?edit`);
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
  it('goes through the pages one by one from the site manager, while page-level work waits', async () => {
    const { url, site } = await editor({ TYKERF_RUNNER: 'anthropic', TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}` });
    const post = (path: string, data: unknown) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    for (const name of ['rome', 'munich']) await post('_tykerf/site/new', { name, layout: 'blank' });
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
    await page.addInitScript(() => localStorage.setItem('tykerf.mode', '\"edit\"')); // her conversation is in the Edit mode
    page.setDefaultTimeout(10_000);
    await page.goto(`${url}_tykerf/site/`);
    await page.locator('.kaity-btn').click();
    await page.locator('.kaity textarea').pressSequentially('Link every page from the navigation'); // real key presses
    await page.locator('.kaity [data-k="send"]').click();
    await page.locator('.kaity [data-k="send"]', { hasText: 'Stop' }).waitFor();

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

    await page.locator('.kaity .msg.ai', { hasText: 'Both navigations now link to every page.' }).waitFor({ timeout: 20_000 });
    for (const name of ['rome', 'munich']) expect(readFileSync(join(site, name, 'boxes', 'nav.html'), 'utf8')).toContain('<a href="/munich/">Munich</a>');
    expect(await page.locator('.kaity details summary').textContent()).toBe('5 steps');
    await page.screenshot({ path: join(tmpdir(), 'tykerf-site-kaity.png') });
    expect(await page.locator('.kaity .msg.user').textContent()).toBe('Link every page from the navigation');
    // her conversation is the site's, kept in its folder
    expect(JSON.parse(readFileSync(join(site, '.tykerf', 'chats', 'site.json'), 'utf8')).messages.at(-1)).toMatchObject({ role: 'ai' });
    expect((await fetch(`${url}_tykerf/site/kaity`).then((r) => r.json())).runs[0]).toMatchObject({ page: null, state: 'done', steps: 5, answer: 'Both navigations now link to every page.' });
  }, 60_000);
});
