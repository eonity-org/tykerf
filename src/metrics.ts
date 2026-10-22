// Render any HTML page in headless Chromium at several widths and score it. The metrics are
// DOM-generic (no dependency on TYKERF markup), so they score hand-edited HTML as well as pages
// produced through the MCP tools.
//
//   npx tsx src/metrics.ts out/index.html [--widths 375,768,1440] [--shots out/]

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Browser } from 'playwright';
import { launchChromium } from './screenshot.js';

export const DEFAULT_WIDTHS = [375, 768, 1440];
export const VIEWPORT_H = 900;

export interface WidthReport {
  width: number;
  horizontalScroll: boolean;
  overflowing: string[]; // elements whose content sticks out (deepest only)
  distortedImages: number;
  missingPriority: string[]; // .t-priority / [data-priority] elements not in the first screen
  lineLength: { blocks: number; tooLong: number; tooShort: number; worst: number | null };
  smallTapTargets: number;
  totalHeight: number;
  wasteRatio: number; // empty area in flex rows / page area
  breakage: number; // hard failures: hscroll + overflow + distortion + missing priority
}

export interface Report {
  widths: WidthReport[];
  breakage: number;
  lineLengthIssues: number;
  smallTapTargets: number;
}

// Runs inside the page. Must be self-contained.
function measure(vh: number) {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const describe = (el: Element) =>
    el.getAttribute('data-sw') ?? (el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}`);
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const all = [...document.body.querySelectorAll('*')].filter(visible);

  const over = new Set<Element>();
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display.startsWith('inline') || el.clientWidth === 0) continue;
    if (cs.overflowX !== 'visible') continue;
    if (el.scrollWidth > el.clientWidth + 1) over.add(el);
  }
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && getComputedStyle(el).position !== 'fixed') over.add(el);
  }
  const overflowing = [...over].filter((el) => ![...over].some((o) => o !== el && el.contains(o))).map(describe);

  let distortedImages = 0;
  for (const img of document.querySelectorAll('img')) {
    if (!img.naturalWidth || !visible(img)) continue;
    const fit = getComputedStyle(img).objectFit;
    if (fit === 'cover' || fit === 'contain') continue;
    const r = img.getBoundingClientRect();
    const a = img.naturalWidth / img.naturalHeight;
    if (Math.abs(r.width / r.height - a) / a > 0.02) distortedImages++;
  }

  const missingPriority = [...document.querySelectorAll('.t-priority,[data-priority]')]
    .filter((el) => el.getBoundingClientRect().top + window.scrollY >= vh)
    .map(describe);

  // Line length: blocks with >45 chars of direct text spanning >= 2 lines.
  let blocks = 0, tooLong = 0, tooShort = 0, worst: number | null = null;
  for (const el of all) {
    const texts = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim());
    const chars = el.textContent!.replace(/\s+/g, ' ').trim().length;
    if (!texts.length || chars <= 45) continue;
    const range = document.createRange();
    range.selectNodeContents(el);
    const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top / 4)));
    const lines = tops.size;
    if (lines < 2) continue;
    blocks++;
    const cpl = chars / (lines - 0.5);
    if (cpl > 85) tooLong++;
    if (cpl < 35) tooShort++;
    const dev = Math.max(cpl - 75, 45 - cpl);
    if (worst === null || dev > Math.max(worst - 75, 45 - worst)) worst = Math.round(cpl);
  }

  let smallTapTargets = 0;
  for (const el of document.querySelectorAll('a,button,input,select,textarea,[role=button]')) {
    if (!visible(el) || (el.tagName === 'A' && el.closest('p,li'))) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) smallTapTargets++;
  }

  // Wasted space in flex rows: compare each child's natural height with the row height.
  let waste = 0;
  for (const row of all) {
    const cs = getComputedStyle(row);
    if (!cs.display.includes('flex') || !cs.flexDirection.startsWith('row') || cs.flexWrap !== 'nowrap') continue;
    const kids = [...row.children].filter(visible) as HTMLElement[];
    if (kids.length < 2) continue;
    const H = row.getBoundingClientRect().height;
    const saved = kids.map((k) => k.style.alignSelf);
    kids.forEach((k) => (k.style.alignSelf = 'flex-start'));
    for (const k of kids) {
      const r = k.getBoundingClientRect();
      waste += Math.max(0, H - r.height) * r.width;
    }
    kids.forEach((k, i) => (k.style.alignSelf = saved[i]));
  }
  const totalHeight = de.scrollHeight;
  return {
    horizontalScroll: de.scrollWidth > vw + 1,
    overflowing,
    distortedImages,
    missingPriority,
    lineLength: { blocks, tooLong, tooShort, worst },
    smallTapTargets,
    totalHeight,
    wasteRatio: Number((waste / (vw * totalHeight)).toFixed(4)),
  };
}

export async function evaluateHTML(
  html: string,
  opts: { widths?: number[]; shotsDir?: string; baseURL?: string; browser?: Browser } = {},
): Promise<Report> {
  const browser = opts.browser ?? (await launchChromium());
  try {
    const widths: WidthReport[] = [];
    for (const width of opts.widths ?? DEFAULT_WIDTHS) {
      const page = await browser.newPage({ viewport: { width, height: VIEWPORT_H } });
      if (opts.baseURL) await page.goto(opts.baseURL);
      await page.setContent(html, { waitUntil: 'load' });
      // tsx/esbuild may wrap named functions in __name(); define it in the page.
      await page.evaluate('window.__name = (f) => f');
      const m = await page.evaluate(measure, VIEWPORT_H);
      if (opts.shotsDir) await page.screenshot({ path: join(opts.shotsDir, `shot-${width}.png`), fullPage: true });
      await page.close();
      const breakage = (m.horizontalScroll ? 1 : 0) + m.overflowing.length + m.distortedImages + m.missingPriority.length;
      widths.push({ width, ...m, breakage });
    }
    return {
      widths,
      breakage: widths.reduce((a, w) => a + w.breakage, 0),
      lineLengthIssues: widths.reduce((a, w) => a + w.lineLength.tooLong + w.lineLength.tooShort, 0),
      smallTapTargets: widths.reduce((a, w) => a + w.smallTapTargets, 0),
    };
  } finally {
    if (!opts.browser) await browser.close();
  }
}

export async function evaluateFile(path: string, opts: { widths?: number[]; shotsDir?: string } = {}): Promise<Report> {
  return evaluateHTML(readFileSync(path, 'utf8'), opts);
}

// run as a command (npm run metrics), not when bundled into another program
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href && /metrics\.[jt]s$/.test(process.argv[1] ?? '')) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('usage: tsx src/metrics.ts <page.html> [--widths 375,768,1440] [--shots dir]');
    process.exit(1);
  }
  const wi = args.indexOf('--widths');
  const si = args.indexOf('--shots');
  const report = await evaluateFile(resolve(file), {
    widths: wi >= 0 ? args[wi + 1].split(',').map(Number) : undefined,
    shotsDir: si >= 0 ? resolve(args[si + 1]) : undefined,
  });
  console.log(JSON.stringify(report, null, 2));
}
