// A picture of the page or of one block, so an AI can look at what its changes did (colours,
// spacing, alignment, text spilling out) instead of only reading metrics. The block gets a dashed
// frame drawn on top (it changes no layout) and a little of its surroundings for context.

import type { Browser } from 'playwright';

let browser: Promise<Browser> | null = null;
const getBrowser = () => (browser ??= launchChromium());

/**
 * Headless Chromium, loaded only when a picture or a measurement is asked for: the MCP server works
 * without it (the Claude Desktop extension may run where Chromium isn't installed).
 */
export async function launchChromium(): Promise<Browser> {
  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('screenshots and checks need Playwright, which is not installed here');
  }
  try {
    return await chromium.launch();
  } catch (e) {
    if (/Executable doesn't exist/i.test((e as Error).message)) throw new Error('screenshots and checks need Chromium: run `npx playwright install chromium` once, then ask again');
    throw e;
  }
}

export async function closeScreenshots() {
  if (browser) await (await browser.catch(() => null))?.close();
  browser = null;
}

export interface Shot {
  png: Buffer;
  width: number; // viewport width
  box: { x: number; y: number; w: number; h: number } | null; // the block, in page px (null = whole page)
  cropped: boolean; // the picture was cut at maxHeight
}

/**
 * Screenshot `html` at viewport `width`. With `id`, the picture is that block plus `context` px
 * around it (framed); otherwise the whole page. Heights over `maxHeight` are cut.
 */
export async function screenshot(html: string, opts: { width?: number; id?: string | null; context?: number; maxHeight?: number } = {}): Promise<Shot> {
  const width = opts.width ?? 1440, context = opts.context ?? 24, maxHeight = opts.maxHeight ?? 2000;
  const page = await (await getBrowser()).newPage({ viewport: { width, height: 900 } });
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
    await page.evaluate(() => document.fonts.ready);
    const docH = await page.evaluate(() => document.documentElement.scrollHeight);
    let box: Shot['box'] = null;
    let clip = { x: 0, y: 0, width, height: Math.min(docH, maxHeight) };
    if (opts.id) {
      box = await page.evaluate((id) => {
        const el = document.querySelector(`[data-sw="${CSS.escape(id)}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) return { x: 0, y: 0, w: 0, h: 0 };
        const f = document.createElement('div'); // the frame: drawn over the page, inside the block's edge
        f.style.cssText = `position:absolute;left:${r.left + scrollX}px;top:${r.top + scrollY}px;width:${r.width}px;height:${r.height}px;` +
          'box-sizing:border-box;border:2px dashed #e11d48;pointer-events:none;z-index:2147483647';
        document.body.appendChild(f);
        return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
      }, opts.id);
      if (!box) throw new Error(`no block "${opts.id}" on the page`);
      if (!box.w && !box.h) throw new Error(`"${opts.id}" is hidden at ${width}px (a responsive rule hides it)`);
      const x = Math.max(0, box.x - context), y = Math.max(0, box.y - context);
      clip = { x, y, width: Math.min(width, box.x + box.w + context) - x, height: Math.min(docH, box.y + box.h + context) - y };
    }
    const cropped = clip.height > maxHeight;
    clip.height = Math.min(clip.height, maxHeight);
    const png = await page.screenshot({ clip, fullPage: true });
    return { png, width, box, cropped };
  } finally {
    await page.close();
  }
}
