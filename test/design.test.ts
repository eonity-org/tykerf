// Design checks for every page layout in the main theme presets, in a real browser: text is
// readable on its band (WCAG AA contrast), headings keep their order, and nothing scrolls sideways
// on a phone. Fonts and images are inlined, so the page needs no server.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryStore } from '../src/store.js';
import { createPage, pageLayouts } from '../src/library.js';
import { Workspace } from '../src/workspace.js';

vi.setConfig({ testTimeout: 60_000 });
const LIBRARY = join(dirname(fileURLToPath(import.meta.url)), '..', 'library');
const PRESETS = ['studio', 'product', 'ivory', 'gallery', 'dark', 'warm', 'biased'];

function page(layout: string, theme: string): string {
  const ws = new Workspace(new MemoryStore('memory:design'));
  createPage(ws, layout, theme);
  const data = Object.fromEntries(ws.assets().map((f) => [f, f.endsWith('.woff2')
    ? `data:font/woff2;base64,${readFileSync(join(LIBRARY, 'fonts', f)).toString('base64')}`
    : `data:image/svg+xml,${encodeURIComponent(readFileSync(join(LIBRARY, 'assets', f), 'utf8'))}`]));
  return ws.page().replace(/assets\/([\w.-]+)/g, (_m, f) => data[f]);
}

/** In the page: every text element whose contrast with its background is below WCAG AA, and the heading levels. */
function audit() {
  // rgb(r g b / a) in 0-255, or color(srgb r g b / a) in 0-1 (what color-mix() computes to)
  const rgb = (c: string) => {
    const n = (c.match(/[\d.]+/g) ?? []).map(Number);
    return c.startsWith('color(') ? [...n.slice(0, 3).map((v) => v * 255), ...n.slice(3)] : n;
  };
  const lum = ([r, g, b]: number[]) => {
    const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const background = (el: Element | null): number[] => {
    for (; el; el = el.parentElement) {
      const c = rgb(getComputedStyle(el).backgroundColor);
      if (c.length === 3 || (c.length === 4 && c[3] > 0.5)) return c.slice(0, 3);
    }
    return [255, 255, 255];
  };
  const opacity = (el: Element | null) => {
    let o = 1;
    for (; el; el = el.parentElement) o *= Number(getComputedStyle(el).opacity);
    return o;
  };
  const bad: string[] = [];
  for (const el of document.querySelectorAll('[data-sw] *')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
    const r = el.getBoundingClientRect();
    if (!own || !r.width || el.closest('[data-sw="logos"] li, svg')) continue; // wordmarks standing in for logos are exempt
    const s = getComputedStyle(el);
    const bg = background(el);
    const [r0, g0, b0, a0 = 1] = rgb(s.color);
    const a = a0 * opacity(el);
    const fg = [r0, g0, b0].map((v, i) => v * a + bg[i] * (1 - a));
    const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    const ratio = (hi + 0.05) / (lo + 0.05);
    const size = parseFloat(s.fontSize), weight = Number(s.fontWeight);
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    if (ratio < (large ? 3 : 4.5)) bad.push(`${el.closest('[data-sw]')!.getAttribute('data-sw')} ${el.tagName.toLowerCase()} "${el.textContent!.trim().slice(0, 30)}" ${ratio.toFixed(2)}`);
  }
  const levels = [...document.querySelectorAll('h1, h2, h3, h4')].map((h) => Number(h.tagName[1]));
  return { bad, levels, scroll: document.documentElement.scrollWidth - innerWidth };
}

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });

describe('every layout in the main presets', () => {
  for (const t of pageLayouts()) {
    it(`${t.name}: readable text on every band, headings in order, no sideways scroll`, async () => {
      for (const theme of PRESETS) {
        const html = page(t.name, theme);
        for (const width of [1440, 375]) {
          const p = await browser.newPage({ viewport: { width, height: 900 } });
          await p.setContent(html, { waitUntil: 'load' });
          const r = await p.evaluate(audit);
          await p.close();
          expect(r.bad, `${t.name} in ${theme} at ${width}px`).toEqual([]);
          expect(r.scroll, `${t.name} in ${theme} at ${width}px scrolls sideways`).toBe(0);
          expect(r.levels.filter((l) => l === 1).length, `${t.name}: one h1 at most`).toBeLessThanOrEqual(1);
          r.levels.forEach((l, i) => i && expect(l - r.levels[i - 1], `${t.name}: heading levels skip (${r.levels.join(' ')})`).toBeLessThanOrEqual(1));
        }
      }
    });
  }
});
