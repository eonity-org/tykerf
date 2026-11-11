import { describe, expect, it } from 'vitest';
import { parse } from '../src/notation.js';
import { toHTML } from '../src/render.js';

describe('render', () => {
  it('page wrapper ids cannot collide with node ids (a node may be called "page" or "style")', () => {
    const html = toHTML({ root: parse('style a H@page'), overlays: [] });
    expect(html.match(/id="sw--page"/g)).toHaveLength(1);
    expect(html.match(/id="sw--style"/g)).toHaveLength(1);
    expect(html).toContain('id="sw-page"');
    expect(html).toContain('id="sw-style"');
  });
});

describe('the cascade layers', () => {
  it('put a box\'s own rule over the kit, the kit over the theme, a page\'s head over the kit, and keep the responsive hide', async () => {
    const { chromium } = await import('playwright');
    const { layerStyles } = await import('../src/render.js');
    const { parseSlice } = await import('../src/notation.js');
    const layout = parseSlice('a b title H3@page\nrule r1 below=600 hide b\n');
    const html = toHTML(layout, {
      a: '<style>p { color: rgb(0, 0, 255) }</style><p class="mine">box</p><h2>kit</h2><h3>page</h3>',
      b: '<style>:scope { display: block }</style><p>hidden when narrow</p>',
      title: '<p>a box named like a content slot</p>',
    }, {
      head: layerStyles('<style data-tykerf-theme>:root { --x: 1 } body h2, body h3 { color: rgb(128, 0, 128) }</style>', 'kit')
        + '<style data-tykerf-kit>@layer kit { .sw-leaf p { color: rgb(255, 0, 0) } h2, h3 { color: rgb(0, 128, 0) } }</style>'
        + layerStyles('<style>h3 { color: rgb(255, 165, 0) }</style>', 'page')
        + '<template><div data-slot="title"></div></template>',
    });
    expect(html.indexOf('@layer tykerf, theme, kit, page;')).toBeLessThan(html.indexOf('@layer tykerf {'));
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
      await page.setContent(html);
      const color = (sel: string) => page.locator(sel).evaluate((e) => getComputedStyle(e).color);
      expect(await color('[data-sw="a"] p')).toBe('rgb(0, 0, 255)'); // the box's rule beats a more specific kit rule
      expect(await color('[data-sw="a"] h2')).toBe('rgb(0, 128, 0)'); // the kit beats a more specific theme rule
      expect(await color('[data-sw="a"] h3')).toBe('rgb(255, 165, 0)'); // the page's head beats the kit
      await page.setViewportSize({ width: 500, height: 800 });
      expect(await page.locator('[data-sw="b"]').isVisible()).toBe(false); // hidden, though the box says display: block
      // a box named "title" hidden by a rule would not hide a shared block's slot named "title"
      expect(html).not.toMatch(/(^|[,}])\[data-slot=/);
    } finally {
      await browser.close();
    }
  });
});
