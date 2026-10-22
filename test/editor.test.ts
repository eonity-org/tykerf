// The editor in a real browser: editing text and images in place, and the context menu's popovers.

import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { walk } from '../src/model.js';
import * as M from '../src/moves.js';
import { createPage, useComponent } from '../src/library.js';
import { Workspace } from '../src/workspace.js';

vi.setConfig({ testTimeout: 30_000 });

let browser: Browser;
let server: ChildProcess;
let ws: Workspace;
let url: string;
let page: Page;

/** The tags of a block, as saved. */
const tagsOf = (id: string) => {
  let found: string[] = [];
  walk(ws.load().root, (n) => { if (n.id === id && n.type !== 'empty') found = [...n.tags]; });
  return found;
};

/** A landing page, plus a box whose script changes its own text (so it can't be edited on the page). */
async function start() {
  const dir = join(mkdtempSync(join(tmpdir(), 'tykerf-editor-')), 'site');
  ws = new Workspace(dir);
  createPage(ws, 'launch');
  ws.setContent('stats', '<p class="n">0</p>\n<script>document.currentScript.closest(\'[data-sw]\').querySelector(\'.n\').textContent = \'42\';</script>', 'user');
  useComponent(ws, 'testimonials', 'image');
  ws.save(M.setLeaf(ws.load(), 'testimonials', { minH: 700 }), 'taller', 'user');
  ws.setContent('cta', '<h2>Ready?</h2>\n<p>Start <a class="go" href="/start">today</a> with us.</p>', 'user');
  const port = 45000 + Math.floor(Math.random() * 10000);
  server = spawn(process.execPath, ['--import', 'tsx', 'src/editor/server.ts', dir, '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise<void>((ok, fail) => {
    server.stdout!.on('data', (d) => String(d).includes('TYKERF: http') && ok());
    server.on('exit', (c) => fail(new Error(`editor exited with ${c}`)));
  });
  url = `http://localhost:${port}/`;
}

beforeAll(async () => {
  await start();
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
  server?.kill();
});

beforeEach(async () => {
  await page?.close();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(5000);
  // TYKERF on, its panel collapsed so it doesn't cover the page (it opens when it's needed)
  await page.addInitScript(() => {
    localStorage.setItem('tykerf.on', 'true');
    localStorage.setItem('tykerf.min', 'true');
  });
  await page.goto(url);
  await page.locator('.panel').waitFor();
});

/** Wait until the box code satisfies a check (saves go through the server). */
async function until<T>(read: () => T, ok: (v: T) => boolean, ms = 5000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = read();
    if (ok(v)) return v;
    if (Date.now() - t0 > ms) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** A PNG's width and height, from its header. */
const pngSize = (path: string) => {
  const b = ws.store.readBytes(path)!;
  const dv = new DataView(b.buffer, b.byteOffset);
  return [dv.getUint32(16), dv.getUint32(20)];
};

const heading = () => page.locator('[data-sw="hero"] h1');
/** Select the last `n` characters of the element being edited (n = 0: put the caret at its end). */
const selectEnd = (n: number) => page.evaluate((n) => {
  const el = document.activeElement!;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  while (walker.nextNode()) last = walker.currentNode as Text;
  const r = document.createRange();
  r.setStart(last!, last!.length - n);
  r.setEnd(last!, last!.length);
  getSelection()!.removeAllRanges();
  getSelection()!.addRange(r);
}, n);

/** Right-click with the mouse itself: the menu opens under the pointer, which Playwright's click takes for a cover. */
async function rightClick(selector: string) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  const r = (await page.locator(selector).boundingBox())!;
  await page.mouse.click(r.x + 8, r.y + 8, { button: 'right' });
}

/** TYKERF's height handles sit on the edges between stacked boxes, so click text near its start, not its middle. */
const corner = { position: { x: 8, y: 8 } };

describe('editing text in place', () => {
  it('changes only the words, and one undo brings them back', async () => {
    const before = ws.content('hero')!;
    await heading().dblclick();
    await expect.poll(() => heading().getAttribute('contenteditable')).toBe('true');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Bread from Murcia');
    await page.keyboard.press('Enter');
    const after = await until(() => ws.content('hero')!, (c) => c !== before);
    expect(after).toBe(before.replace('The short promise of your product', 'Bread from Murcia'));
    expect(ws.history(1)[0]).toMatchObject({ author: 'user', kind: 'content' });
    await page.waitForTimeout(300);
    await page.keyboard.press('ControlOrMeta+z');
    expect(await until(() => ws.content('hero')!, (c) => c === before)).toBe(before);
  });

  it('adds bold as <strong>, keeps a styled link as it was, and pastes plain text only', async () => {
    const p = page.locator('[data-sw="cta"] p');
    await p.dblclick(corner);
    await expect.poll(() => p.getAttribute('contenteditable')).toBe('true');
    await selectEnd(3); // "us."
    await page.keyboard.press('ControlOrMeta+b');
    await selectEnd(0);
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/html', '<span style="color:red">Red</span>');
      dt.setData('text/plain', ' Red');
      document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await page.locator('.tbar [data-fmt="done"]').click();
    const code = await until(() => ws.content('cta')!, (c) => c.includes('Red'));
    // the pasted words follow the bold, as typing after bold text does; the HTML of the paste is gone
    expect(code).toBe('<h2>Ready?</h2>\n<p>Start <a class="go" href="/start">today</a> with <strong>us. Red</strong></p>\n');
  });

  it('cancels with Esc without saving anything', async () => {
    const steps = ws.history(500).length;
    await heading().dblclick();
    await expect.poll(() => heading().getAttribute('contenteditable')).toBe('true');
    await page.keyboard.type('nope');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    expect(ws.history(500).length).toBe(steps);
    expect(await heading().textContent()).not.toContain('nope');
  });

  it('sends text a script changed to the Text tab instead of guessing', async () => {
    const before = ws.content('stats');
    await page.locator('[data-sw="stats"] .n').dblclick(corner);
    await expect.poll(() => page.locator('.work .tabs [aria-selected="true"]').textContent()).toContain('Text');
    await expect.poll(() => page.locator('[data-sw="stats"] .n').getAttribute('contenteditable')).toBeNull();
    expect(ws.content('stats')).toBe(before);
  });

  it('starts from the context menu too', async () => {
    await rightClick('[data-sw="cta"] h2');
    await page.locator('.menu [data-act="edit-here"]').click();
    expect(await page.locator('[data-sw="cta"] h2').getAttribute('contenteditable')).toBe('true');
    await page.keyboard.press('Escape');
  });
});

describe('the context menu', () => {
  it('renames a block in a popover on the page', async () => {
    await rightClick('[data-sw="faq"]');
    await page.locator('.menu [data-act="rename-here"]').click();
    await page.locator('.pop input.nm').fill('questions');
    await page.keyboard.press('Enter');
    await until(() => ws.load().root.type === 'op' && ws.content('questions') !== null, Boolean);
    expect(ws.content('questions')).not.toBeNull();
    expect(ws.content('faq')).toBeNull();
  });
});

describe('editing images in place', () => {
  it('crops an uploaded picture to a square and points the image at the new file', async () => {
    const png = await page.evaluate(async () => {
      const c = Object.assign(document.createElement('canvas'), { width: 300, height: 200 });
      const g = c.getContext('2d')!;
      g.fillStyle = '#c33';
      g.fillRect(0, 0, 300, 200);
      const blob: Blob = await new Promise((ok) => c.toBlob((b) => ok(b!), 'image/png'));
      return [...new Uint8Array(await blob.arrayBuffer())];
    });
    await page.locator('[data-sw="hero"] img').dblclick();
    await page.locator('.imgtool').waitFor();
    await page.locator('input.imgfile').setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: Buffer.from(png) });
    await page.locator('.imgtool [data-aspect="1:1"]').click();
    await page.locator('.imgtool input.alt').fill('A red square');
    await page.locator('.imgtool [data-i="apply"]').click();
    const code = await until(() => ws.content('hero')!, (c) => c.includes('A red square'));
    const src = /<img src="(assets\/img-[0-9a-f]{12}\.png)" alt="A red square">/.exec(code)?.[1];
    expect(src).toBeTruthy();
    expect(pngSize(src!)).toEqual([200, 200]);

    // opened again, the tool shows the whole original with the crop on it; "Original" undoes the crop
    await expect.poll(() => page.locator('[data-sw="hero"] img').getAttribute('src')).toBe(src);
    await page.locator('[data-sw="hero"] img').dblclick();
    await page.locator('.imgtool .note').waitFor();
    expect(await page.locator('.imgtool .note').textContent()).toMatch(/crop of an earlier one/);
    await page.locator('.imgtool [data-aspect="original"]').click();
    await page.locator('.imgtool [data-i="apply"]').click();
    const back = await until(() => ws.content('hero')!, (c) => !c.includes(src!));
    const original = /<img src="(assets\/img-[0-9a-f]{12}\.png)"/.exec(back)?.[1];
    expect(original).not.toBe(src);
    expect(pngSize(original!)).toEqual([300, 200]);
  });

  it('makes a box narrower and centred with the handle on its right edge, and full width again', async () => {
    const img = page.locator('[data-sw="testimonials"] img');
    const full = (await img.boundingBox())!.width;
    await page.locator('[data-sw="testimonials"]').scrollIntoViewIfNeeded();
    await page.locator('[data-sw="testimonials"] figcaption').click();
    await page.locator('.whandle').waitFor();
    const h = (await page.locator('.whandle').boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2 - 200, h.y + h.height / 2, { steps: 5 });
    await page.mouse.up();
    const node = () => ws.load().root.type === 'op' && (ws.load().root as { children: { id: string; maxW?: number }[] }).children.find((c) => c.id === 'testimonials');
    const maxW = (await until(() => (node() || undefined)?.maxW, (v) => v !== undefined))!;
    expect(maxW).toBeGreaterThan(1280 - 2 * 200 - 30); // centred: both edges move
    expect(maxW).toBeLessThan(1280 - 2 * 200 + 30);
    await expect.poll(async () => (await img.boundingBox())!.width).toBeLessThan(full - 300);
    await page.locator('.whandle').dblclick();
    expect(await until(() => (node() || undefined)?.maxW, (v) => v === undefined)).toBeUndefined();
  });

  it('the Image component fills its box, so the box handles size it', async () => {
    // the previous test's change refreshes the page: wait for the box to be back
    await page.locator('[data-sw="testimonials"] img').waitFor({ state: 'visible' });
    await expect.poll(async () => (await page.locator('[data-sw="testimonials"]').boundingBox())?.height ?? 0, { timeout: 5000 }).toBeGreaterThanOrEqual(700);
    const box = (await page.locator('[data-sw="testimonials"]').boundingBox())!;
    const img = (await page.locator('[data-sw="testimonials"] img').boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(700);
    expect(img.height).toBeGreaterThan(box.height - 120); // the caption and the box padding take the rest
    expect(await page.locator('[data-sw="testimonials"] img').evaluate((el) => getComputedStyle(el).objectFit)).toBe('cover');
  });
});

describe("a block's look", () => {
  it('gives a section a band and a density from the Size & look tab, and shows them in the list of blocks', async () => {
    // open the panel (the tests start with it collapsed)
    await page.locator('.minimize').click();
    await page.locator('.tree [data-all="open"]').waitFor({ state: 'visible' });
    await page.locator('.tree [data-all="open"]').click();
    await page.locator('.tree .item[data-id="cta"]').click();
    await page.locator('.work .tabs [data-tab="size"]').click();
    const tone = (v: string) => page.locator(`[data-sec="look"] [data-tone="${v}"]`);
    await tone('dark').click();
    await expect.poll(() => tagsOf('cta'), { timeout: 5000 }).toContain('tone-dark');
    await expect.poll(() => tone('dark').getAttribute('aria-pressed'), { timeout: 5000 }).toBe('true');
    await page.locator('[data-sec="look"] [data-dense="yes"]').click();
    await expect.poll(() => tagsOf('cta'), { timeout: 5000 }).toEqual(['tone-dark', 'dense']);
    // the band's colours reach the page
    await expect.poll(() => page.locator('[data-sw="cta"]').evaluate((el) => getComputedStyle(el).backgroundColor), { timeout: 5000 }).not.toBe('rgba(0, 0, 0, 0)');
    // the top block's list of blocks shows them
    await page.locator('.tree .item[data-id="page"]').click();
    await page.locator('.work .tabs [data-tab="blocks"]').click();
    // (the page hears of the change over SSE, a moment after it is on disk)
    await expect.poll(() => page.locator('.blocks [data-pick="cta"] .chip').allTextContents(), { timeout: 5000 }).toEqual(['Dark band', 'Dense']);
    // back to none, in one step each
    await page.locator('.tree .item[data-id="cta"]').click();
    await page.locator('.work .tabs [data-tab="size"]').click();
    await tone('').click();
    await expect.poll(() => tagsOf('cta'), { timeout: 5000 }).toEqual(['dense']);
    expect(ws.history(1)[0]).toMatchObject({ label: 'cta: no band', author: 'user' });
  });
});

describe('the sanitizer', () => {
  it('keeps text, <br>, <strong>, <em> and safe links, and nothing else', async () => {
    await page.addScriptTag({ type: 'module', content: "import { cleanInline } from '/_tykerf/inline.js'; window.cleanInline = cleanInline;" });
    await page.waitForFunction(() => 'cleanInline' in window);
    const out = await page.evaluate(() => {
      const cleanInline = (window as unknown as { cleanInline: (el: Element) => string }).cleanInline;
      const run = (html: string) => {
        const d = document.createElement('div');
        d.innerHTML = html;
        return cleanInline(d);
      };
      return [
        run('a <span style="color:red">b</span> <b>c</b> <i>d</i> <font>e</font>'),
        run('<a href="javascript:alert(1)">x</a> <a href="https://e.com" onclick="x()" class="k">y</a>'),
        run('<b><strong>twice</strong></b><br><br>'),
        run('end '),
        run('<div>block</div><img src="x">'),
      ];
    });
    expect(out).toEqual([
      'a b <strong>c</strong> <em>d</em> e',
      'x <a href="https://e.com">y</a>',
      '<strong>twice</strong>',
      'end ',
      'block',
    ]);
  });
});
