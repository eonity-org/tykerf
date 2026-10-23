import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as M from '../src/moves.js';
import { parse, serializeSlice } from '../src/notation.js';
import { toHTML } from '../src/render.js';
import { Workspace } from '../src/workspace.js';

// Complex boxes (examples/widgets): each box is a file with its own CSS and JS.
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });

function tempWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'sw-boxes-'));
  cpSync('examples/widgets', dir, { recursive: true });
  rmSync(join(dir, 'out'), { recursive: true, force: true });
  return new Workspace(dir);
}

async function probe(html: string) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await p.setContent(html, { waitUntil: 'load' });
  const color = (sel: string) => p.$eval(sel, (el) => getComputedStyle(el).color);
  const res = {
    pricingH3: await color('[data-sw="pricing"] h3'),
    signupH3: await color('[data-sw="signup"] h3'),
    faqH3: await color('[data-sw="faq"] h3'),
    tabsButtonsElsewhere: await p.$eval('[data-sw="signup"] button', (el) => getComputedStyle(el).borderBottomWidth),
    tab: '', form: '',
  };
  await p.click('[data-sw="tabs"] [data-tab="1"]');
  res.tab = await p.$eval('[data-sw="tabs"] [role="tabpanel"]:not([hidden])', (el) => el.textContent ?? '');
  await p.fill('[data-sw="signup"] input', 'nope');
  await p.click('[data-sw="signup"] button');
  res.form = await p.$eval('[data-sw="signup"] .msg', (el) => el.textContent ?? '');
  await p.close();
  return res;
}

describe('complex boxes', () => {
  it('box CSS stays inside its box, and box scripts work', async () => {
    const ws = tempWorkspace();
    const r = await probe(toHTML(ws.load(), ws.contents()));
    expect(r.pricingH3).toBe('rgb(198, 40, 40)'); // pricing's own `h3 { color: #c62828 }`
    expect(r.signupH3).not.toBe('rgb(198, 40, 40)'); // ...does not leak
    expect(r.faqH3).not.toBe('rgb(198, 40, 40)');
    expect(r.tab).toContain('Operators');
    expect(r.form).toBe('Please enter a valid email.');
  });

  it('moving boxes moves their code; everything still works after the move', async () => {
    const ws = tempWorkspace();
    let l = M.swap(ws.load(), 'tabs', 'signup'); // tabs widget and form trade places
    l = M.flip(l, 'row2');
    ws.save(l, 'test moves', 'user');
    const r = await probe(toHTML(ws.load(), ws.contents()));
    expect(r.signupH3).not.toBe('rgb(198, 40, 40)');
    expect(r.tab).toContain('Operators');
    expect(r.form).toBe('Please enter a valid email.');
  });

  it('content edits are files, logged with author and undoable', () => {
    const ws = tempWorkspace();
    const before = ws.content('footer');
    ws.setContent('footer', '<small>new footer</small>', 'user');
    expect(readFileSync(join(ws.boxesDir, 'footer.html'), 'utf8').trim()).toBe('<small>new footer</small>');
    const last = JSON.parse(readFileSync(ws.historyPath, 'utf8').trim().split('\n').pop()!);
    expect(last).toMatchObject({ kind: 'content', id: 'footer', author: 'user', prev: before });
    expect(ws.undo()).toMatch(/set_content footer/);
    expect(ws.content('footer')).toBe(before);
    ws.setContent('newbox', '<p>x</p>');
    ws.undo();
    expect(existsSync(join(ws.boxesDir, 'newbox.html'))).toBe(false);
  });
});

describe('content and style apart', () => {
  it('a box is stored as content (.html) + style (.css) and renders the same', () => {
    const ws = tempWorkspace();
    const before = ws.content('pricing')!;
    ws.setContent('pricing', before.replace('9 €', '10 €'), 'user'); // an edit: the <style> moves to pricing.css
    const html = readFileSync(join(ws.boxesDir, 'pricing.html'), 'utf8');
    const css = readFileSync(join(ws.boxesDir, 'pricing.css'), 'utf8');
    expect(html).not.toMatch(/<style/);
    expect(css).toMatch(/\.plan \{/);
    expect(ws.parts('pricing')).toEqual({ html: html.trim(), css: css.replace(/\s+$/, '') }); // CSS kept as written
    expect(toHTML(ws.load(), ws.contents())).toContain('@scope ([data-sw="pricing"])');
    ws.setContent('pricing', ws.parts('pricing')!.html, 'user'); // content without style: the .css goes away
    expect(existsSync(join(ws.boxesDir, 'pricing.css'))).toBe(false);
    ws.undo();
    expect(existsSync(join(ws.boxesDir, 'pricing.css'))).toBe(true); // undo brings the style back
  });
});

describe('history groups', () => {
  it('undoes a group of changes as one step', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sw-group-'));
    writeFileSync(join(dir, 'layout.slice'), 'a b V\n');
    const ws = new Workspace(dir);
    ws.setContent('a', '<p>A</p>', 'user');
    ws.group('merge b into a', 'user', () => {
      ws.setContent('a', '<p>A</p><p>B</p>', 'user');
      ws.save(M.remove(ws.load(), 'b'), 'remove b', 'user');
    });
    expect(ws.peekUndo()?.label).toBe('merge b into a');
    expect(ws.undo()).toBe('merge b into a');
    expect(ws.content('a')).toBe('<p>A</p>\n');
    expect(serializeSlice(ws.load())).toContain('a b V');
    expect(ws.undo()).toMatch(/set_content a/);
  });
});

describe('minh in a column', () => {
  it('a block with a min height is never squeezed below its content', async () => {
    // a column with spare height inside a row: its children share that height by ratio
    const layout = { root: parse('side a[minh=50] b H{minh=120} V'), overlays: [] };
    const html = toHTML(layout, { a: '<p>' + 'long text '.repeat(400) + '</p>', b: '<p>b</p>', side: '<p>side</p>' });
    const p = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await p.setContent(html);
    const a = await p.evaluate(() => { const e = document.querySelector('[data-sw="a"]')!; return { sh: e.scrollHeight, ch: e.clientHeight }; });
    await p.close();
    expect(a.ch).toBeGreaterThan(300);
    expect(a.sh - a.ch).toBeLessThanOrEqual(1);
  });
});

describe('screenshot', () => {
  it('pictures one block with context, and refuses unknown or hidden blocks', async () => {
    const { screenshot, closeScreenshots } = await import('../src/screenshot.js');
    const l = { root: parse('a b V c H'), overlays: [], rules: [{ id: 'r1', below: 500, action: 'hide' as const, target: 'b' }] };
    const html = toHTML(l, { a: '<p>A</p>', b: '<p>B</p>', c: '<p>C</p>' });
    const shot = await screenshot(html, { width: 800, id: 'a' });
    expect(shot.png.subarray(1, 4).toString()).toBe('PNG');
    expect(shot.box!.w).toBeGreaterThan(300);
    await expect(screenshot(html, { id: 'zz' })).rejects.toThrow(/no block/);
    await expect(screenshot(html, { width: 400, id: 'b' })).rejects.toThrow(/hidden/);
    // a page taller than the limit is cut, and says so (the whole page as well as a block)
    const tall = toHTML(l, { a: '<div style="height:3000px">A</div>', b: '<p>B</p>', c: '<p>C</p>' });
    const first = await screenshot(tall, { width: 800 });
    expect(first).toMatchObject({ cropped: true, box: null, from: 0 });
    expect(first.total).toBeGreaterThan(3000);
    expect((await screenshot(html, { width: 800 })).cropped).toBe(false);
    // from: the rest of a long picture, of the page or of a block
    expect(await screenshot(tall, { width: 800, from: 2000 })).toMatchObject({ cropped: false, from: 2000, total: first.total });
    const block = await screenshot(tall, { width: 800, id: 'a' });
    expect(block).toMatchObject({ cropped: true, from: 0 });
    expect((await screenshot(tall, { width: 800, id: 'a', from: 2000 })).cropped).toBe(false);
    await expect(screenshot(tall, { width: 800, id: 'a', from: block.total })).rejects.toThrow(/nothing from/);
    await closeScreenshots();
  });
});
