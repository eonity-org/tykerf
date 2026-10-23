// The importer in the editor: a new page that starts as a copy of a website, and one section of a
// website in place of a box. A local page stands in for the website, so no test needs the network.

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type ImportResult, importPage, importURL, namesIn, placeSection, pruneImports, writeWorkspace } from '../src/importer.js';
import { find, isOp, validate } from '../src/model.js';
import * as M from '../src/moves.js';
import { parseSlice } from '../src/notation.js';
import { MemoryStore } from '../src/store.js';
import { createPage } from '../src/library.js';
import { Workspace } from '../src/workspace.js';
import { freePort } from './ports.js';

vi.setConfig({ testTimeout: 60_000 });

const SITE = `<!doctype html><html><head><title>Fixture</title><style>
  body { margin: 0; font: 16px/1.5 Georgia, serif; color: #222; background: #fafaf5; }
  header { display: flex; justify-content: space-between; padding: 16px 40px; background: #123; color: #fff; }
  header nav a { color: #fff; margin-left: 16px; }
  .hero { padding: 80px 40px; background: #fe5; }
  .hero h1 { font-size: 48px; margin: 0 0 12px; }
  .features { display: flex; gap: 24px; max-width: 1000px; margin: 40px auto; }
  .features article { flex: 1; padding: 20px; background: #fff; border-radius: 8px; min-height: 120px; }
  @font-face { font-family: Fixture Sans; src: url(/fixture.woff2) format('woff2'); }
  footer { padding: 24px 40px; background: #333 url(/bg.png); color: #eee; }
  .vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .more { padding: 40px; }
  .mid { width: 220px; margin: 30px auto 0; background: #cde; perspective: 700px; }
  .mid b { display: inline-block; animation: spin 7s linear infinite; }
  @keyframes spin { to { transform: rotateY(360deg); } }
  @keyframes unused { to { opacity: 0; } }
  .two { width: 66.666%; background: #eee; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 20px; }
  .grid div { background: #ddd; padding: 10px; border: 0 solid #f00; } /* Tailwind's reset: a style, no width */
  @media (max-width: 700px) { .features { flex-direction: column; } .two { width: auto; } .grid { grid-template-columns: 1fr; } }
</style></head><body>
  <header><b>Fixture Co</b><nav><a href="/a">One</a><a href="/b">Two</a></nav></header>
  <section class="hero" id="hero"><h1>Big claim</h1><p>Some words under the claim.<span class="vh">A hidden label</span></p></section>
  <div class="features" id="features">
    <article><h3>Fast</h3><p>It is fast and plain.</p></article>
    <article><h3>Small</h3><p>It is small and quiet.</p></article>
    <article><h3>Kind</h3><p>It is kind to people.</p></article>
  </div>
  <div class="mid"><b>Centred</b></div>
  <section class="more" id="more"><div class="two"><p>A column two thirds wide, full width on phones.</p></div>
    <div class="grid"><div>One</div><div>Two</div><div>Three</div></div></section>
  <footer><p>© Fixture Co</p></footer>
</body></html>`;

// a 1×1 PNG, and a file that starts like a WOFF2 font (only its first bytes are checked)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const WOFF2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(60)]);

let fixture: Server;
let fixtureURL: string;
let browser: Browser;
let copy: ImportResult;

beforeAll(async () => {
  fixture = createServer((req, res) => {
    if (req.url === '/bg.png') return res.writeHead(200, { 'content-type': 'image/png' }).end(PNG);
    if (req.url === '/fixture.woff2') return res.writeHead(200, { 'content-type': 'font/woff2' }).end(WOFF2);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(SITE);
  });
  await new Promise<void>((ok) => fixture.listen(0, '127.0.0.1', ok));
  fixtureURL = `http://127.0.0.1:${(fixture.address() as { port: number }).port}/`;
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
  fixture?.close();
});

describe('graft', () => {
  const page = () => parseSlice('a b c H3@page');
  it('replaces a box with a subtree whose root keeps the box name', () => {
    const sub = parseSlice('x y V@b').root;
    const l = M.graft(page(), 'b', sub, [{ id: 'r9', below: 600, action: 'flip', target: 'b' }]);
    expect(validate(l).errors).toEqual([]);
    const b = find(l.root, 'b')!.node;
    expect(isOp(b) && b.children.map((c) => c.id)).toEqual(['x', 'y']);
    expect(l.rules).toEqual([{ id: 'r9', below: 600, action: 'flip', target: 'b' }]);
  });
  it('refuses names the page already has, and blocks that are not boxes', () => {
    expect(() => M.graft(page(), 'b', parseSlice('a y V@b').root)).toThrow(/already exists/);
    expect(() => M.graft(page(), 'page', parseSlice('x y V@z').root)).toThrow();
  });
});

describe('importing a page', () => {
  it('only opens http and https addresses', () => {
    expect(() => importURL('file:///etc/passwd')).toThrow(/only http and https/);
    expect(() => importURL('not a url')).toThrow(/not a web address/);
    expect(importURL(' https://example.com ')).toBe('https://example.com/');
  });

  it('lists the sections of the page, each with a picture, with names new to the page they go into', async () => {
    const ws = new Workspace(new MemoryStore('memory:a'));
    createPage(ws, 'launch', 'clean');
    copy = await importPage(fixtureURL, { browser, sections: true, taken: namesIn(ws) });
    const ids = copy.sections!.map((s) => s.id);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(copy.sections!.every((s) => s.shot?.startsWith('data:image/jpeg;base64,'))).toBe(true);
    // the launch layout already has hero, features and footer: the copy may not reuse them
    const taken = new Set(namesIn(ws));
    const mine: string[] = [];
    const walk = (n: any) => (mine.push(n.id), n.children?.forEach(walk));
    walk(copy.layout.root);
    expect(mine.filter((id) => taken.has(id))).toEqual([]);
    expect(copy.styles.every((s) => !taken.has(s.tag))).toBe(true);
  });

  it('keeps widths, grids and hidden labels as the site has them, and never scrolls sideways', async () => {
    const ws = new Workspace(new MemoryStore('memory:w'));
    writeWorkspace(ws.store, await importPage(fixtureURL, { browser }), fixtureURL);
    const page = await browser.newPage();
    await page.setContent(ws.page());
    const measure = () => page.evaluate(() => {
      const w = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      const two = [...document.querySelectorAll('p')].find((p) => p.textContent!.includes('two thirds'))!.parentElement!;
      const grid = [...document.querySelectorAll('div')].find((d) => d.children.length === 3 && d.textContent === 'OneTwoThree')!;
      const label = [...document.querySelectorAll('span')].find((s) => s.textContent === 'A hidden label')!;
      return {
        overflow: document.documentElement.scrollWidth - innerWidth,
        two: two.getBoundingClientRect().width / two.parentElement!.getBoundingClientRect().width,
        cols: new Set([...grid.children].map((c) => Math.round(c.getBoundingClientRect().top))).size,
        label: label.getBoundingClientRect().width * label.getBoundingClientRect().height,
        border: getComputedStyle(grid.children[0]).borderTopWidth,
        // a block centred with margin: 0 auto stays centred (its middle on the page's middle)
        mid: (() => { const r = [...document.querySelectorAll('b')].find((b) => b.textContent === 'Centred')!.parentElement!.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.left + r.width / 2 - innerWidth / 2)]; })(),
        body: w('body').width,
      };
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    const wide = await measure();
    expect(wide.overflow).toBeLessThanOrEqual(0);
    expect(wide.two).toBeCloseTo(0.667, 1);
    expect(wide.cols).toBe(1); // three side by side: one row
    expect(wide.label).toBeLessThanOrEqual(1);
    expect(wide.border).toBe('0px');
    expect(wide.mid[0]).toBe(220);
    expect(Math.abs(wide.mid[1])).toBeLessThanOrEqual(2);
    for (const width of [1000, 375]) {
      await page.setViewportSize({ width, height: 900 });
      const m = await measure();
      expect(m.overflow).toBeLessThanOrEqual(0);
      expect(Math.abs(m.mid[1])).toBeLessThanOrEqual(2);
      if (width === 375) {
        expect(m.two).toBeCloseTo(1, 1);
        expect(m.cols).toBe(3); // stacked
      }
    }
    await page.close();
  });

  it('keeps animations, with only the @keyframes the copy uses', async () => {
    expect(copy.head).toMatch(/@keyframes spin/);
    expect(copy.head).not.toMatch(/@keyframes unused/);
    const code = Object.values(copy.boxes).find((c) => c.includes('Centred'))!;
    expect(code).toMatch(/animation-name:\s*spin/);
    expect(code).toMatch(/perspective:\s*700px/);
    const ws = new Workspace(new MemoryStore('memory:anim'));
    writeWorkspace(ws.store, copy, fixtureURL);
    const page = await browser.newPage();
    await page.setContent(ws.page());
    expect(await page.evaluate(() => document.getAnimations().map((a) => (a as CSSAnimation).animationName))).toContain('spin');
    await page.close();
  });

  it("brings the site's images and fonts into the copy's assets/", () => {
    const paths = Object.keys(copy.files).sort();
    expect(paths).toEqual([expect.stringMatching(/^assets\/font-fixture-sans-[0-9a-f]{12}\.woff2$/), expect.stringMatching(/^assets\/img-[0-9a-f]{12}\.png$/)]);
    expect(copy.remote).toEqual([]);
    const code = [copy.head, ...Object.values(copy.boxes), ...copy.styles.map((s) => s.rule)].join('\n');
    // links between pages stay; nothing is loaded from the site any more
    expect(code).not.toMatch(/(src="|url\(["']?)http:\/\/127/);
    expect(code).toContain(`url("${paths[1]}")`);
    const ws = new Workspace(new MemoryStore('memory:f'));
    writeWorkspace(ws.store, copy, fixtureURL);
    for (const f of paths) expect(ws.store.readBytes(f)).toEqual(new Uint8Array(copy.files[f]));
  });

  it('puts one section in place of a box as one undo step, its look in a marked block of the head', () => {
    const ws = new Workspace(new MemoryStore('memory:b'));
    createPage(ws, 'launch', 'clean');
    const before = { slice: ws.store.read('layout.slice'), head: ws.head(), hero: ws.content('hero') };
    // the features row: three cards side by side, which stack on phones
    const row = copy.sections!.find((s) => /features/.test(s.id))!;
    expect(row).toBeTruthy();
    placeSection(ws, copy, row.id, 'hero');
    const l = ws.load();
    expect(validate(l).errors).toEqual([]);
    const hero = find(l.root, 'hero')!.node;
    expect(isOp(hero) && hero.kind).toBe('V');
    expect(isOp(hero) && hero.children.length).toBe(3);
    expect(l.rules?.some((r) => r.action === 'flip' && r.target === 'hero')).toBe(true);
    expect(ws.content('hero')).toBeNull(); // a container has no code of its own
    for (const c of isOp(hero) ? hero.children : []) expect(ws.content(c.id)).toMatch(/It is/);
    expect(ws.head()).toContain(before.head.trim());
    expect(ws.head()).toMatch(/<!-- tykerf-import in-hero from http:\/\/127\.0\.0\.1:\d+\/ -->[\s\S]*\.t-in-hero\{[^}]*Georgia[\s\S]*<!-- \/tykerf-import in-hero -->/);
    expect(ws.page()).toContain('t-in-hero');

    ws.undo();
    expect(ws.store.read('layout.slice')).toBe(before.slice);
    expect(ws.head()).toBe(before.head);
    expect(ws.content('hero')).toBe(before.hero);
  });

  it('a section that is a single box keeps the box and fills it', () => {
    const ws = new Workspace(new MemoryStore('memory:c'));
    createPage(ws, 'launch', 'clean');
    const box = copy.sections!.find((s) => find(copy.layout.root, s.id)!.node.type === 'leaf')!;
    placeSection(ws, copy, box.id, 'cta');
    expect(find(ws.load().root, 'cta')!.node.type).toBe('leaf');
    expect(ws.content('cta')!.trim()).toBe(copy.boxes[box.id].trim());
  });

  it('a placed section brings the images it uses, and only those', () => {
    const ws = new Workspace(new MemoryStore('memory:g'));
    createPage(ws, 'launch', 'clean');
    const img = Object.keys(copy.files).find((f) => f.endsWith('.png'))!;
    const sec = copy.sections!.find((s) => copy.boxes[s.id]?.includes(img))!;
    expect(sec).toBeTruthy();
    placeSection(ws, copy, sec.id, 'cta');
    expect(ws.store.exists(img)).toBe(true);
  });

  it('drops the styles of an imported section once its block is gone', () => {
    const ws = new Workspace(new MemoryStore('memory:d'));
    createPage(ws, 'launch', 'clean');
    placeSection(ws, copy, copy.sections![0].id, 'hero');
    const head = ws.head();
    expect(pruneImports(head, ws.load())).toBe(head);
    expect(pruneImports(head, M.remove(ws.load(), 'hero'))).not.toContain('tykerf-import');
  });

  it('refuses when the page took one of the names while the copy was being made', () => {
    const ws = new Workspace(new MemoryStore('memory:e'));
    createPage(ws, 'launch', 'clean');
    const sec = copy.sections!.find((s) => isOp(find(copy.layout.root, s.id)!.node))!;
    const inner = (find(copy.layout.root, sec.id)!.node as any).children[0].id;
    ws.save(M.rename(ws.load(), 'cta', inner), 'rename', 'user');
    expect(() => placeSection(ws, copy, sec.id, 'hero')).toThrow(/page changed/);
  });
});

describe('the importer in the editor', () => {
  let server: ChildProcess;
  let site: string;
  let url: string;

  beforeAll(async () => {
    site = join(mkdtempSync(join(tmpdir(), 'tykerf-import-')), 'my-site');
    const port = await freePort();
    server = spawn(process.execPath, ['--import', 'tsx', 'src/editor/server.ts', site, '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise<void>((ok, fail) => {
      server.stdout!.on('data', (d) => String(d).includes('TYKERF: http') && ok());
      server.on('exit', (c) => fail(new Error(`editor exited with ${c}`)));
    });
    url = `http://localhost:${port}/`;
  }, 60_000);
  afterAll(() => server?.kill());

  const post = (path: string, body: unknown) =>
    fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));

  it('starts a page from a website on the start screen, with the copying advice', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.goto(url);
    await page.locator('[data-from="website"]').click();
    expect(await page.locator('.ch-advice').textContent()).toMatch(/owner's permission/);
    expect(await page.locator('[data-layout]').first().isVisible()).toBe(false);
    await page.locator('input[name=url]').fill(fixtureURL);
    expect(await page.locator('input[name=name]').inputValue()).toBe('127-0-0-1'); // named after the site
    await page.locator('input[name=name]').fill('copy');
    await page.locator('[type=submit]').click();
    // the page opens at once, with the copy's progress in a modal
    await page.waitForURL(`${url}copy/`, { timeout: 15_000 });
    await page.locator('.jobmodal').waitFor({ state: 'visible' });
    await page.locator('.job-steps li').first().waitFor();
    // the copy replaces the empty page, the page reloads with it, and the modal says it is ready
    await page.locator('.job-box h2', { hasText: 'Your page is ready' }).waitFor({ timeout: 60_000 });
    // (the copy's new head reloads the page, which may come just after "ready": read again across it)
    await expect.poll(() => page.locator('.job-steps li').allTextContents().catch(() => []), { timeout: 15_000 })
      .toEqual(expect.arrayContaining([expect.stringMatching(/^Opening 127\.0\.0\.1/), 'Cutting the page into rows, columns and boxes', 'Writing the page']));
    await page.waitForLoadState('load');
    expect(readFileSync(join(site, 'copy', 'layout.slice'), 'utf8')).toMatch(/^\/\/ imported from http:\/\/127\.0\.0\.1/);
    // see the page as visitors do: the editor stays closed, and its button is pointed out
    await page.locator('[data-job="page"]').click();
    await page.locator('.jobmodal').waitFor({ state: 'hidden' });
    expect(await page.locator('h1').textContent()).toBe('Big claim');
    await page.locator('button.toggle', { hasText: 'Edit with TYKERF' }).waitFor(); // TYKERF's own button, not the copy's
    // the job is forgotten once seen
    expect((await fetch(`${url}copy/_tykerf/job`).then((r) => r.json())).job).toBeNull();
    await page.close();
  });

  it('stops a copy with the X: the unfinished page goes to .trash', async () => {
    const r = await post('_tykerf/site/new', { name: 'stopped', url: fixtureURL });
    expect(r.ok).toBe(true);
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.goto(`${url}stopped/`);
    await page.locator('.job-x').click();
    await page.locator('[data-job="stop"]').click();
    await page.waitForURL((u) => !u.pathname.startsWith('/stopped/'), { timeout: 30_000 });
    await expect.poll(() => existsSync(join(site, 'stopped')), { timeout: 30_000 }).toBe(false);
    await page.close();
  });

  it('refuses a taken name before copying anything, and bad addresses', async () => {
    expect(await post('_tykerf/site/new', { name: 'copy', url: fixtureURL })).toMatchObject({ ok: false, error: expect.stringMatching(/already a "copy"/) });
    expect(await post('_tykerf/site/new', { name: 'other', url: 'javascript:alert(1)' })).toMatchObject({ ok: false, error: expect.stringMatching(/http and https/) });
    expect(existsSync(join(site, 'other'))).toBe(false);
  });

  it('imports a section of a website in place of a box', async () => {
    expect((await post('_tykerf/site/new', { name: 'home', layout: 'launch', theme: 'clean' })).ok).toBe(true);
    const r = await post('home/_tykerf/import', { url: fixtureURL });
    expect(r.ok).toBe(true);
    expect(r.sections.length).toBeGreaterThanOrEqual(3);
    const sec = r.sections.find((s: { id: string }) => /features/.test(s.id));
    expect((await post('home/_tykerf/op', { op: 'section', id: 'hero', token: 'stale', section: sec.id })).error).toMatch(/copy the page again/);
    expect((await post('home/_tykerf/op', { op: 'section', id: 'hero', token: r.token, section: sec.id })).ok).toBe(true);
    expect(readFileSync(join(site, 'home', 'head.html'), 'utf8')).toContain('<!-- tykerf-import in-hero');
    const state = await fetch(`${url}home/_tykerf/state`).then((x) => x.json());
    expect(state.lastChange).toMatch(/^import .* into hero$/);
  });
});
