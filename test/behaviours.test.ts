// The library's behaviours (library/behaviours/) at work in a browser: in the editor and in an export, with the
// keyboard; and a behaviour that fails, which the editor says.

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { exportToFolder } from '../src/export.js';
import { kitError, kitWrite } from '../src/kit.js';
import { newSitePage } from '../src/site.js';
import { freePort } from './ports.js';

vi.setConfig({ testTimeout: 60_000 });

const TABS = `<div data-use="tabs">
  <div role="tablist"><button role="tab" aria-controls="p-one">One</button><button role="tab" aria-controls="p-two">Two</button></div>
  <div role="tabpanel" id="p-one">First panel</div>
  <div role="tabpanel" id="p-two">Second panel</div>
</div>`;

let site: string;
let browser: Browser;
let editor: ChildProcess;
let url: string;
let files: Server;
let exported: string;

beforeAll(async () => {
  site = join(mkdtempSync(join(tmpdir(), 'tykerf-behaviours-')), 'site');
  const home = newSitePage(site, 'home', 'launch', 'studio'); // its FAQ uses accordion
  home.setContent('logos', TABS, 'user'); // and Kaity's way: data-use brings the library's tabs (here written directly)
  kitWrite(site, 'scripts', 'tabs', readFileSync(join('library', 'behaviours', 'tabs.js'), 'utf8'));
  const other = newSitePage(site, 'other', 'blank', 'studio');
  kitWrite(site, 'scripts', 'boom', 'export default function (el) { throw new Error("boom"); }');
  other.setContent('text', '<p data-use="boom">This one fails.</p>', 'user');
  const port = await freePort();
  editor = spawn(process.execPath, ['--import', 'tsx', 'src/editor/server.ts', site, '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise<void>((ok, fail) => {
    editor.stdout!.on('data', (d) => String(d).includes('TYKERF: http') && ok());
    editor.on('exit', (c) => fail(new Error(`editor exited with ${c}`)));
  });
  url = `http://localhost:${port}/`;
  // the export, served as a web host would (modules don't load from file://)
  exported = mkdtempSync(join(tmpdir(), 'tykerf-behaviours-export-'));
  exportToFolder(site, exported);
  files = createServer((req, res) => {
    let path = join(exported, decodeURIComponent(new URL(req.url!, 'http://x').pathname));
    if (path.endsWith('/')) path = join(path, 'index.html');
    if (!existsSync(path)) return res.writeHead(404).end();
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(path)] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type }).end(readFileSync(path));
  });
  await new Promise<void>((ok) => files.listen(0, '127.0.0.1', ok));
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
  editor?.kill();
  files?.close();
});

/** The accordion keeps one answer open, the tabs move with the arrow keys: on a page, wherever it is served. */
async function works(page: Page) {
  const details = page.locator('[data-sw="faq"] details');
  await expect.poll(() => details.nth(0).getAttribute('open')).not.toBeNull();
  await details.nth(1).locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => details.nth(1).getAttribute('open')).not.toBeNull();
  await expect.poll(() => details.nth(0).getAttribute('open')).toBeNull(); // one open at a time
  const tabs = page.locator('[data-sw="logos"] [role=tab]');
  await expect.poll(() => tabs.nth(0).getAttribute('aria-selected')).toBe('true');
  expect(await page.locator('#p-two').isHidden()).toBe(true);
  await tabs.nth(0).focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => tabs.nth(1).getAttribute('aria-selected')).toBe('true');
  expect(await page.locator('#p-two').isVisible()).toBe(true);
  expect(await page.locator('#p-one').isHidden()).toBe(true);
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Two');
}

describe("the library's behaviours", () => {
  it('work with the keyboard in the editor', async () => {
    const page = await browser.newPage();
    await page.goto(`${url}home/`);
    await works(page);
    await page.close();
  });

  it('work in an export, from its kit folder', async () => {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${(files.address() as { port: number }).port}/home/`);
    await works(page);
    await page.close();
  });
});

describe('a behaviour the person writes', () => {
  it('is refused without a default export or with a mistake in its code', () => {
    expect(kitError('scripts', 'x', 'document.body.style.color = "red";')).toMatch(/x\.js: a behaviour exports a function as default/);
    expect(kitError('scripts', 'x', 'export default function (el) { el.textContent = ; }')).toMatch(/x\.js: .* \(a mistake in the code: it would fail on every page\)/);
    expect(kitError('scripts', 'x', 'export default function (el) { el.hidden = true; }')).toBeNull();
    expect(kitError('scripts', 'x', 'import { a } from "./a.js";\nexport default function (el) { a(el); }')).toBeNull(); // imports: not checked here
  });

  it('that fails is said in the editor', async () => {
    const page = await browser.newPage();
    await page.addInitScript(() => localStorage.setItem('tykerf.on', 'true'));
    await page.goto(`${url}other/`);
    await expect.poll(() => page.locator('.toast').textContent({ timeout: 2000 }).catch(() => ''), { timeout: 10_000 }).toMatch(/A behaviour failed on this page: boom/);
    await page.close();
  });
});
