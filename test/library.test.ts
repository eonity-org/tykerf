import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validate } from '../src/model.js';
import { serializeSlice } from '../src/notation.js';
import { MemoryStore } from '../src/store.js';
import { componentCode, components, createPage, hasTheme, pageLayouts, readTheme, theme, themeValueError, themeVariables, themes, useComponent, useLayout, withThemeValues } from '../src/library.js';
import { Workspace } from '../src/workspace.js';

// relative to this file, so the tests also run from another folder
const LIBRARY = join(dirname(fileURLToPath(import.meta.url)), '..', 'library');
const fresh = () => new Workspace(new MemoryStore('memory:new'));

describe('the library', () => {
  it('lists every component file, and every file is listed', () => {
    const files = readdirSync(join(LIBRARY, 'components')).map((f) => f.replace(/\.html$/, '')).sort();
    expect(components().map((c) => c.name).sort()).toEqual(files);
    for (const c of components()) expect(c.label && c.description).toBeTruthy();
  });

  it('uses every component in some page layout, so each one is seen and kept working', () => {
    // Image fills a box sized by hand (its handles): a building block for pages people compose themselves
    const BUILDING_BLOCKS = ['image'];
    const used = new Set(pageLayouts().flatMap((p) => Object.values(p.boxes)));
    expect(components().map((c) => c.name).filter((c) => !used.has(c) && !BUILDING_BLOCKS.includes(c))).toEqual([]);
  });

  it('builds components only on theme variables that the theme defines', () => {
    const defined = new Set([...theme().matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    for (const c of components()) {
      const used = [...componentCode(c.name).matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]);
      for (const v of used) expect(defined, `${c.name} uses ${v}`).toContain(v);
    }
  });

  it('refuses unknown components and names that could reach other files', () => {
    expect(() => componentCode('nope')).toThrow(/unknown component/);
    expect(() => componentCode('../theme')).toThrow(/unknown component/);
  });

  it('starts every layout as a valid page with its theme and images', () => {
    for (const p of pageLayouts()) {
      const ws = fresh();
      createPage(ws, p.name);
      expect(validate(ws.load()), p.name).toMatchObject({ ok: true });
      expect(Object.keys(ws.contents()).sort(), p.name).toEqual(Object.keys(p.boxes).sort());
      expect(hasTheme(ws.head())).toBe(true);
      for (const [, file] of Object.values(ws.contents()).join('\n').matchAll(/assets\/([\w.-]+)/g)) expect(ws.store.exists(`assets/${file}`), `${p.name}: ${file}`).toBe(true);
      expect(ws.history()).toEqual([]); // a new page starts with nothing to undo
    }
  });

  it('refuses to start a page over an existing one', () => {
    const ws = fresh();
    createPage(ws, 'blank');
    expect(() => createPage(ws, 'launch')).toThrow(/already a page/);
    expect(() => createPage(fresh(), 'nope')).toThrow(/unknown layout/);
  });
});

describe('using a page layout', () => {
  it('replaces the page with the layout, keeps the head and the top block\'s name, in one undo step', async () => {
    const ws = fresh();
    createPage(ws, 'blank', 'ivory');
    const before = serializeSlice(ws.load());
    ws.setContent('text', '<p>my old notes</p>', 'user');
    const head = ws.head();
    useLayout(ws, 'factual');
    expect(ws.load().root.id).toBe('page');
    expect(ws.boxIds().sort()).toEqual(['banner', 'chart', 'figures', 'footer', 'highlight', 'intro', 'nav', 'timeline']);
    expect(ws.content('text')).toBeNull(); // the old box's code doesn't linger
    expect(ws.content('intro')).toContain('A headline that states the main fact');
    expect(ws.store.exists('assets/placeholder-wide.svg')).toBe(true);
    expect(ws.head()).toBe(head);
    expect(ws.undo()).toBe('use layout factual');
    expect(serializeSlice(ws.load())).toBe(before);
    expect(ws.content('text')?.trim()).toBe('<p>my old notes</p>');
    expect(() => useLayout(ws, 'nope')).toThrow(/unknown layout "nope"/);

    // a page whose top block has another name keeps it (Kaity's scope is that block)
    const other = new Workspace(new MemoryStore('memory:', { 'layout.slice': 'a b H@home\n' }));
    useLayout(other, 'blank');
    expect(other.load().root.id).toBe('home');
    expect(hasTheme(other.head())).toBe(true); // a page without a theme gets the variables

    // Kaity: only with the whole page in scope; and theme presets through use_theme
    const { openTools } = await import('../src/editor/tools-client.js');
    const narrow = await openTools(ws, 'text');
    expect((await narrow.call('use_layout', { name: 'docs' })).text).toMatch(/refused: a layout replaces the whole page/);
    await narrow.close();
    const tools = await openTools(ws, 'page');
    expect((await tools.call('list_layouts', {})).text).toMatch(/^blank: Blank\./m);
    expect((await tools.call('use_layout', { name: 'docs' })).text).toMatch(/^ok: the page now follows the docs layout/);
    expect((await tools.call('list_themes', {})).text).toMatch(/^warm: Warm\./m);
    expect((await tools.call('use_theme', { name: 'warm' })).text).toMatch(/^theme now follows the warm preset/);
    expect(readTheme(ws.head())['--font-heading']).toBe('"Playfair Display", Georgia, serif');
    expect(ws.store.exists('assets/playfair-display-latin-wght-normal.woff2')).toBe(true);
    expect((await tools.call('use_theme', { name: 'warm' })).text).toBe('the theme already follows the warm preset');
    await tools.close();
  });
});

describe('using a component', () => {
  it('fills a box, brings its images and the theme variables, in one undo step', () => {
    const ws = new Workspace(new MemoryStore('memory:', { 'layout.slice': 'header main H\n', 'head.html': '<style>body{color:red}</style>\n' }));
    useComponent(ws, 'main', 'hero');
    expect(ws.content('main')).toContain('The short promise of your product');
    expect(ws.store.exists('assets/mockup-app.svg')).toBe(true);
    expect(ws.store.exists('assets/inter-latin-wght-normal.woff2')).toBe(true); // the theme's fonts come along
    // the page keeps its own look; only the variables are added
    expect(ws.head()).toContain('body{color:red}');
    expect(ws.head()).toContain(themeVariables().trim());
    expect(ws.history()).toHaveLength(3); // head, box, and the group that makes them one step
    expect(ws.undo()).toBe('use component hero in main');
    expect(ws.content('main')).toBeNull();
    expect(ws.head()).toBe('<style>body{color:red}</style>\n');
  });

  it('leaves the head alone when the page already has the theme', () => {
    const ws = fresh();
    createPage(ws, 'blank');
    const head = ws.head();
    useComponent(ws, 'text', 'faq');
    expect(ws.head()).toBe(head);
  });

  it('only fills boxes', () => {
    const ws = fresh();
    createPage(ws, 'blank');
    expect(() => useComponent(ws, 'page', 'hero')).toThrow(/not a box/);
    expect(ws.history()).toEqual([]);
  });
});

describe('the page head', () => {
  it('is undoable and redoable like any change', () => {
    const ws = fresh();
    createPage(ws, 'blank');
    const before = ws.head();
    ws.setHead(before.replace('#1a52dd', '#aa3300'), 'user');
    expect(ws.peekUndo()).toMatchObject({ label: 'edit page head', head: true });
    ws.undo();
    expect(ws.head()).toBe(before);
    expect(ws.peekRedo()).toMatchObject({ head: true });
    ws.redo();
    expect(ws.head()).toContain('#aa3300');
  });

  it('copies the page images next to the rendered page', () => {
    const ws = fresh();
    createPage(ws, 'portfolio');
    ws.render();
    expect(ws.store.exists('out/index.html')).toBe(true);
    expect(ws.store.exists('out/assets/placeholder-square.svg')).toBe(true);
  });
});

describe('every layout in a browser', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  for (const p of pageLayouts()) {
    it(`${p.name}: no horizontal scroll, every image loads, theme applied (375 and 1440 px)`, async () => {
      const ws = fresh();
      createPage(ws, p.name);
      // images and fonts as data URLs, so the page needs no server
      const data = Object.fromEntries(ws.assets().map((f) => [f, f.endsWith('.woff2')
        ? `data:font/woff2;base64,${readFileSync(join(LIBRARY, 'fonts', f)).toString('base64')}`
        : `data:image/svg+xml,${encodeURIComponent(readFileSync(join(LIBRARY, 'assets', f), 'utf8'))}`]));
      const html = ws.page().replace(/assets\/([\w.-]+)/g, (_m, f) => data[f]);
      for (const width of [375, 1440]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await page.setContent(html, { waitUntil: 'load' });
        const r = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth - innerWidth,
          broken: [...document.images].filter((i) => !i.complete || !i.naturalWidth).length,
          accent: getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim(),
          font: getComputedStyle(document.body).fontSize,
          inter: document.fonts.check('16px Inter'),
        }));
        await page.close();
        expect(r, `${p.name} at ${width}px`).toEqual({ scroll: 0, broken: 0, accent: '#1a52dd', font: '17px', inter: true });
      }
    });
  }
});

describe('theme presets', () => {
  it('set only variables the theme has, with values the theme accepts', () => {
    const vars = Object.keys(readTheme(theme()));
    const raw = JSON.parse(readFileSync(join(LIBRARY, 'themes.json'), 'utf8')) as Record<string, { values: Record<string, string> }>;
    expect(themes().map((t) => t.name)).toEqual(['studio', 'product', 'ivory', 'gallery', 'dark', 'warm', 'biased']);
    for (const [name, p] of Object.entries(raw)) {
      for (const [k, v] of Object.entries(p.values)) {
        expect(vars, `${name} sets ${k}`).toContain(k);
        expect(themeValueError(k, v), `${name} ${k}`).toBeNull();
      }
    }
    for (const t of themes()) expect(Object.keys(t.values).sort(), t.name).toEqual([...vars].sort()); // the theme's own values fill the rest
  });

  it('give every layout a valid page whose head carries the preset', () => {
    for (const p of pageLayouts()) for (const t of themes()) {
      const ws = fresh();
      createPage(ws, p.name, t.name);
      expect(validate(ws.load()), `${p.name} ${t.name}`).toMatchObject({ ok: true });
      expect(readTheme(ws.head()), `${p.name} ${t.name}`).toEqual(t.values);
    }
    expect(() => createPage(fresh(), 'blank', 'neon')).toThrow(/unknown theme "neon"/);
  });

  it('change only :root, never the band tones that reuse the names', () => {
    const { head } = withThemeValues(theme(), { '--color-text': '#000000', '--color-muted': '#111111' });
    expect(readTheme(head)['--color-text']).toBe('#000000');
    expect(head).toContain('--color-text: var(--color-on-dark);');
    expect(head).toMatch(/\.t-tone-dark \{[^}]*--color-muted: color-mix/);
  });

  it('change the theme values and nothing else in the head', () => {
    const head = `<link rel="icon" href="x.png">\n${theme()}<style>.mine{color:red}</style>`;
    const { head: next, changed } = withThemeValues(head, { '--color-accent': '#123456', '--nope': 'x' });
    expect(changed).toEqual({ '--color-accent': { from: '#1a52dd', to: '#123456' } });
    expect(next).toBe(head.replace('--color-accent: #1a52dd;', '--color-accent: #123456;'));
  });
});

// Other_Layouts/ keeps what TYKERF no longer offers (and its IC-inspired layouts): it must stay usable,
// so moving an item back into library/ just works.
describe('Other_Layouts', () => {
  const OTHER = join(LIBRARY, '..', 'Other_Layouts', 'library');
  const read = (f: string) => JSON.parse(readFileSync(join(OTHER, f), 'utf8'));
  it('has valid layouts, existing components and valid theme values', async () => {
    const { parseSlice } = await import('../src/notation.js');
    const { validate } = await import('../src/model.js');
    const { existsSync } = await import('node:fs');
    const ours = new Set(components().map((c) => c.name));
    for (const [name, p] of Object.entries(read('layouts.json')) as [string, { layout: string; boxes: Record<string, string> }][]) {
      expect(validate(parseSlice(p.layout + '\n')), name).toMatchObject({ ok: true });
      for (const c of Object.values(p.boxes)) expect(ours.has(c) || existsSync(join(OTHER, 'components', `${c}.html`)), `${name}: ${c}`).toBe(true);
    }
    const vars = Object.keys(readTheme(theme()));
    for (const [name, th] of Object.entries(read('themes.json')) as [string, { values: Record<string, string> }][])
      for (const [k, v] of Object.entries(th.values)) {
        expect(vars, `${name} ${k}`).toContain(k);
        expect(themeValueError(k, v), `${name} ${k}`).toBeNull();
      }
    for (const c of Object.keys(read('components.json'))) expect(existsSync(join(OTHER, 'components', `${c}.html`)), c).toBe(true);
  });
});

