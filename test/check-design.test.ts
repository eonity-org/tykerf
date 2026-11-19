// check_design (design.ts): a page made to break the rules is caught rule by rule, the library's pages have
// nothing to fix, and Kaity's tool keeps to the scope.

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DESIGN_RULES, checkDesign, sayDesign } from '../src/design.js';
import { createPage, frames, offeredThemes, purposes } from '../src/library.js';
import { MemoryStore } from '../src/store.js';
import { newSitePage, pageWorkspace } from '../src/site.js';
import { Workspace } from '../src/workspace.js';

vi.setConfig({ testTimeout: 120_000 });
const LIBRARY = join(dirname(fileURLToPath(import.meta.url)), '..', 'library');

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });

const BAD = `<!doctype html><html><head><style>
body { margin: 0; font: 16px/1.5 Arial, sans-serif; }
.card { padding: 20px; border: 1px solid #ccc; border-radius: 8px; min-height: 100px; }
.stripe { padding: 20px; border-left: 6px solid #c00; border-radius: 6px; background: #f6f6f6; min-height: 100px; }
.grad { background: linear-gradient(90deg, #f0f, #0ff); -webkit-background-clip: text; background-clip: text; color: transparent; }
</style></head><body>
<div data-sw="hero"><h1 style="font-size: 160px; line-height: 1; margin: 0">A very long main headline that fills the whole first screen</h1></div>
<div data-sw="faint"><p style="color: #c8c8c8">Pale grey words on a white page that few people can read.</p><h4>A heading that skips two levels</h4></div>
<div data-sw="small"><p style="font-size: 11px">This running text is far too small to read comfortably on a phone screen.</p><a href="#" style="font-size: 12px">tiny</a></div>
<div data-sw="wide"><div style="width: 900px">A block wider than a phone.</div></div>
<div data-sw="cramped"><p style="line-height: 1; max-width: none">Lines set with no room between them are tiring to read and run on and on across the whole width of a wide desktop screen, far past the seventy or so characters a reader's eye can follow comfortably from one line to the next one.</p></div>
<div data-sw="loud"><p style="text-transform: uppercase">Whole sentences written in capitals are slow to read for nearly everyone</p><p class="grad">Shiny gradient words</p>
<p style="text-align: center; max-width: 300px">Centred text that goes on for several lines is hard to follow, because every line starts in a different place and the eye has to hunt for it again and again.</p></div>
<div data-sw="cards"><div class="card"><div class="card">A card in a card</div></div><div class="stripe">A card with a stripe</div></div>
<div data-sw="tiles"><div style="display: grid; grid-template-columns: repeat(3, 200px); gap: 10px"><div>One</div><div>Two</div><div style="grid-column: span 3">Three, across</div><div>Four</div></div></div>
<div data-sw="times"><div style="display: grid; grid-template-columns: 80px 200px"><b>10:00</b><span>Doors open</span><span style="grid-column: 2">The time column stays empty here on purpose.</span></div></div>
</body></html>`;

describe('check_design', () => {
  it('finds each broken rule, names its box and its widths, and says the rule', async () => {
    const found = await checkDesign(BAD, { browser });
    const rules = new Set(found.map((f) => f.rule));
    for (const r of ['contrast', 'small-text', 'tap-target', 'headings', 'sideways-scroll', 'long-lines', 'tight-lines', 'big-headline', 'effects', 'nested-cards', 'side-stripe', 'centred-text', 'all-caps', 'plain-fonts', 'grid-hole'] as const) expect(rules, r).toContain(r);
    // a gap the grid's next item would have filled; not the cell beside an item set on a column of its own
    expect(found.filter((f) => f.rule === 'grid-hole')).toMatchObject([{ box: 'tiles', detail: '1 empty cell among 4 items in 3 columns' }]);
    expect(found.find((f) => f.rule === 'contrast')).toMatchObject({ group: 'fix', box: 'faint', widths: [1440, 375] });
    expect(found.find((f) => f.rule === 'sideways-scroll')).toMatchObject({ box: null, widths: [375] });
    expect(found.find((f) => f.rule === 'headings' && f.box === 'faint')?.detail).toMatch(/h1 then h4/);
    // must fix first, then the style notes, each rule with its hint
    const said = sayDesign(found);
    expect(said).toMatch(/^Must fix \(\d+\):\n- Text too faint on its background \(Text needs a contrast of at least 4\.5:1/);
    expect(said).toMatch(/\nStyle notes \(\d+\): fix each, or say in your answer why it stays\.\n/);
    expect(said.indexOf('Style notes')).toBeGreaterThan(said.lastIndexOf('Lines too long'));
    expect(Object.values(DESIGN_RULES).every((r) => r.hint.length > 20)).toBe(true);
  });

  it('has nothing to fix, and no hole in a grid, on the pages people and Kaity start from, in every offered theme', async () => {
    const starts = [...frames().map((f) => f.name), ...purposes().map((p) => `basic+${p.name}`), 'full+event'];
    const bad: string[] = [];
    for (const theme of offeredThemes().map((t) => t.name)) {
      for (const layout of starts) {
        const ws = new Workspace(new MemoryStore('memory:design-check'));
        createPage(ws, layout, theme);
        const data = Object.fromEntries(ws.assets().map((f) => [f, f.endsWith('.woff2')
          ? `data:font/woff2;base64,${readFileSync(join(LIBRARY, 'fonts', f)).toString('base64')}`
          : `data:image/svg+xml,${encodeURIComponent(readFileSync(join(LIBRARY, 'assets', f), 'utf8'))}`]));
        const html = ws.page().replace(/assets\/([\w.-]+)/g, (_m, f) => data[f]);
        for (const f of await checkDesign(html, { browser })) if (f.group === 'fix' || f.rule === 'grid-hole') bad.push(`${theme} ${layout}: ${f.rule} in ${f.box} (${f.detail})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("is Kaity's tool, on the scope block or the whole page", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tykerf-design-'));
    newSitePage(dir, 'home', 'basic+event', 'studio', { keep: ['intro'] });
    const ws = pageWorkspace(dir, 'home');
    ws.setContent('intro', '<h1>Our day</h1><p style="color:#d0d0d0">Pale words on a white page that few people can read.</p>', 'user');
    const { openTools } = await import('../src/editor/tools-client.js');
    const page = await openTools(ws, '');
    const whole = (await page.call('check_design', {})).text;
    expect(whole).toMatch(/^Must fix \(\d+\):\n- Text too faint on its background/);
    expect(whole).toMatch(/  - intro: "Pale words on a white page th…" 1\.\d:1 \(at 1440 and 375 px\)/);
    await page.close();
    const footer = await openTools(pageWorkspace(dir, 'home'), 'footer');
    expect((await footer.call('check_design', {})).text).not.toMatch(/intro/);
    await footer.close();
  });
});
