import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validate } from '../src/model.js';
import { serializeSlice } from '../src/notation.js';
import { MemoryStore } from '../src/store.js';
import { componentCode, components, composeLayout, createPage, demoteTitle, frames, hasTheme, layoutSections, pageLayout, pageLayouts, purposes, readTheme, theme, themeValueError, themeVariables, themes, offeredThemes, useComponent, useLayout, withThemeValues } from '../src/library.js';
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
    // Image fills a box sized by hand (its handles): a building block for pages people compose themselves; the page
    // banner is shared by every page of a site, each filling its slots: a block for sites, not for one layout
    const BUILDING_BLOCKS = ['image', 'page-banner'];
    const used = new Set([...pageLayouts(), ...frames()].flatMap((p) => Object.values(p.boxes)).concat(purposes().flatMap((p) => p.sections.map((x) => x.component))));
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

  it('ships behaviours that components ask for, each small, with a default export, and each used or standalone', async () => {
    const { behaviourCode, behavioursIn, libraryBehaviours } = await import('../src/library.js');
    const shelf = libraryBehaviours();
    expect(shelf.map((b) => b.name).sort()).toEqual(['accordion', 'carousel', 'form', 'reveal', 'tabs', 'year']);
    expect(readdirSync(join(LIBRARY, 'behaviours')).sort()).toEqual(shelf.map((b) => `${b.name}.js`).sort());
    const asked = new Set(components().flatMap((c) => behavioursIn(componentCode(c.name))));
    for (const name of asked) expect(shelf.map((b) => b.name), `a component asks for "${name}"`).toContain(name);
    for (const b of shelf) {
      const code = behaviourCode(b.name)!;
      expect(code.length, b.name).toBeLessThanOrEqual(3 * 1024);
      expect(code, b.name).toMatch(/^export default function \(el\) \{/m);
      expect(code, b.name).not.toMatch(/^\s*import\b/m); // no dependencies
      expect(asked.has(b.name) || b.standalone, `${b.name}: used by a component, or standalone`).toBe(true);
    }
    expect(componentCode('contact')).not.toContain('<script'); // the form's script is the library's form now
    expect(behavioursIn(componentCode('faq'))).toEqual(['accordion']);
  });

  it('declares the boxes every page of a site shares, and each is a box of its layout', () => {
    for (const p of pageLayouts()) {
      expect(p.shared, p.name).toBeDefined();
      for (const box of p.shared!) expect(Object.keys(p.boxes), `${p.name}: ${box}`).toContain(box);
    }
    expect(pageLayouts().find((p) => p.name === 'launch')!.shared).toEqual(['nav', 'footer']);
    expect(pageLayouts().find((p) => p.name === 'blank')!.shared).toEqual(['nav']); // it has no footer
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
    expect((await narrow.call('use_layout', { name: 'docs', why: 'a test page' })).text).toMatch(/refused: a layout replaces the whole page/);
    await narrow.close();
    const tools = await openTools(ws, 'page');
    expect((await tools.call('list_layouts', {})).text).toMatch(/^place: Place\./m);
    expect((await tools.call('use_layout', { name: 'docs', why: 'a test page' })).text).toMatch(/^ok: the page now follows the docs layout/);
    expect((await tools.call('list_themes', {})).text).toMatch(/^natural: Natural\./m);
    expect((await tools.call('list_themes', {})).text).not.toMatch(/^warm:/m); // retired: hidden, still applied by name
    expect((await tools.call('use_theme', { name: 'warm' })).text).toMatch(/^theme now follows the warm preset/);
    expect(readTheme(ws.head())['--font-heading']).toBe('"Playfair Display", Georgia, serif');
    expect(ws.store.exists('assets/playfair-display-latin-wght-normal.woff2')).toBe(true);
    expect((await tools.call('use_theme', { name: 'warm' })).text).toBe('the theme already follows the warm preset');
    await tools.close();
  });
});

describe('frames and purposes', () => {
  it('make a valid page for every frame alone and every purpose in every frame, with one h1 at most', () => {
    for (const f of frames()) {
      expect(Object.keys(f.boxes), f.name).toContain('body');
      for (const p of [undefined, ...purposes()]) {
        const t = composeLayout(f.name, p?.name);
        const ws = fresh();
        createPage(ws, t.name);
        expect(validate(ws.load()), t.name).toMatchObject({ ok: true });
        expect(Object.keys(ws.contents()).sort(), t.name).toEqual(Object.keys(t.boxes).sort());
        for (const [, file] of Object.values(ws.contents()).join('\n').matchAll(/assets\/([\w.-]+)/g)) expect(ws.store.exists(`assets/${file}`), `${t.name}: ${file}`).toBe(true);
        expect(Object.values(ws.contents()).join('\n').match(/<h1\b/g)?.length ?? 0, `${t.name}: h1`).toBeLessThanOrEqual(1);
        if (p) expect(Object.keys(t.boxes).filter((b) => p.sections.some((x) => x.box === b)), t.name).toEqual(p.sections.map((x) => x.box));
      }
    }
    for (const p of purposes()) expect(p.label && p.description && p.sections.length, p.name).toBeTruthy();
  });

  it('name a layout as frame+purpose, a purpose alone in the default frame, and keep what is kept', () => {
    expect(pageLayout('place').name).toBe('basic+place');
    expect(pageLayout('basic+place').shared).toEqual(['nav', 'footer']);
    expect(() => pageLayout('basic+nope')).toThrow(/unknown layout "basic\+nope" \(layouts: .*; frames: simple, basic, full; purposes: place, person, event, organization, concept, post, guide; or <frame>\+<purpose>\)/);
    // the side menu is optional: kept out, its row goes and the sections are the page's body
    const t = pageLayout('basic+place', ['intro', 'visit']);
    expect(Object.keys(t.boxes)).toEqual(['nav', 'intro', 'visit', 'footer']);
    expect(t.layout).not.toMatch(/side|rule/);
    // a frame with a page title: the sections' own titles go one level down, looking the same
    expect(pageLayout('full+event').demote).toEqual(['intro']);
    expect(pageLayout('basic+event').demote).toBeUndefined();
    const hero = demoteTitle(componentCode('hero'));
    expect(hero).not.toMatch(/<h1|\bh1\b/);
    expect(hero).toMatch(/<h2 data-title[^>]*>/);
    expect(hero).toMatch(/h2\[data-title\] \{ font-size: var\(--text-hero\)/);
  });

  it('are what list_layouts offers first, and what use_layout and new_page take', async () => {
    const ws = new Workspace(new MemoryStore('memory:', { 'layout.slice': 'a b H@page\n' }));
    const { openTools } = await import('../src/editor/tools-client.js');
    const tools = await openTools(ws, 'page');
    const list = (await tools.call('list_layouts', {})).text;
    expect(list).toMatch(/^Purposes \(use_layout purpose\):\nplace: Place\. A place people visit/);
    expect(list).toMatch(/^  sections: intro \(Headline and buttons beside a picture\); offer \(What a place offers/m);
    expect(list).toMatch(/^Frames \(use_layout frame; default basic\):\nsimple: Simple\./m);
    expect(list).toMatch(/^  around the body: side; on every page of a site: nav, footer$/m);
    expect(list).not.toMatch(/Ready-made layouts|^blank:|^launch:/m); // retired: still made by name, no longer offered
    expect((await tools.call('use_layout', { purpose: 'place', name: 'blank', why: 'x' })).text).toMatch(/not both/);
    expect((await tools.call('use_layout', { why: 'x' })).text).toMatch(/give a purpose/);
    expect((await tools.call('use_layout', { purpose: 'place', why: 'a bakery for neighbours', keep: ['intro', 'offer', 'visit'], theme: 'warm' })).text)
      .toMatch(/^ok: the page now follows the basic\+place layout \(left out: side, gallery, contact\); the theme now follows the warm preset/);
    expect(ws.boxIds().sort()).toEqual(['footer', 'intro', 'nav', 'offer', 'visit']);
    await tools.close();
  });
});

describe('choosing a layout', () => {
  it('makes only the sections kept, and always the shared navigation and footer', () => {
    const launch = pageLayouts().find((p) => p.name === 'launch')!;
    expect(layoutSections(launch)).not.toContain('nav');
    const t = pageLayout('launch', ['hero', 'faq']);
    expect(Object.keys(t.boxes)).toEqual(['nav', 'hero', 'faq', 'footer']);
    const ws = new Workspace(new MemoryStore('memory:'));
    createPage(ws, 'launch', 'studio', { keep: ['hero', 'faq'] });
    const l = ws.load();
    expect(validate(l)).toEqual({ ok: true, errors: [] });
    expect(serializeSlice(l)).not.toMatch(/pricing|logos/);
    expect(ws.boxIds().sort()).toEqual(['faq', 'footer', 'hero', 'nav']);
    // a row left with one block becomes that block, and the rule on the row goes with it
    const magazine = pageLayout('magazine', ['stories']);
    expect(magazine.layout).not.toMatch(/latest|rule/);
    useLayout(ws, 'magazine', 'user', ['stories', 'cta']);
    expect(ws.boxIds().sort()).toEqual(['cta', 'footer', 'nav', 'stories']);
    expect(ws.load().rules ?? []).toEqual([]);
    // without keep, the whole layout
    expect(pageLayout('launch')).toEqual(launch);
  });

  it('refuses sections the layout doesn\'t have, and keeping none', () => {
    expect(() => pageLayout('launch', ['hero', 'menu'])).toThrow(/the launch layout has no section "menu" \(its sections: hero, logos, .*; nav, footer always stay\)/);
    expect(() => pageLayout('launch', ['nav'])).toThrow(/no section "nav"/);
    expect(() => pageLayout('launch', [])).toThrow(/keep at least one of the launch layout's sections/);
  });

  it('asks the model why a layout fits, lists each layout\'s sections, and says what it left out', async () => {
    const ws = new Workspace(new MemoryStore('memory:', { 'layout.slice': 'a b H@page\n' }));
    const { openTools } = await import('../src/editor/tools-client.js');
    const tools = await openTools(ws, 'page');
    const list = (await tools.call('list_layouts', {})).text;
    expect(list).toMatch(/^place: .*\n  sections: intro \(Headline and buttons beside a picture\); offer \(/m);
    expect(list).toMatch(/on every page of a site: nav, footer$/m);
    expect((await tools.call('use_layout', { name: 'launch' })).text).toMatch(/expected string, received undefined at why/);
    expect((await tools.call('use_layout', { name: 'launch', why: 'x', keep: ['menu'] })).text).toMatch(/the launch layout has no section "menu"/);
    expect(ws.load().root.type).toBe('op'); // nothing changed
    expect(ws.boxIds()).toEqual([]);
    const done = (await tools.call('use_layout', { name: 'launch', why: 'a bakery\'s page for neighbours: find us and come in', keep: ['hero', 'faq'] })).text;
    expect(done).toMatch(/^ok: the page now follows the launch layout \(left out: logos, features, feature, feature2, stats, testimonials, pricing, cta\)/);
    expect(ws.boxIds().sort()).toEqual(['faq', 'footer', 'hero', 'nav']);
    // a theme given with the layout is applied on an existing page too (it used to be dropped without a word)
    expect((await tools.call('use_layout', { name: 'blank', why: 'x', theme: 'nope' })).text).toMatch(/unknown theme "nope"/);
    expect(ws.boxIds().sort()).toEqual(['faq', 'footer', 'hero', 'nav']);
    expect((await tools.call('use_layout', { name: 'blank', why: 'x', theme: 'warm' })).text).toMatch(/^ok: the page now follows the blank layout; the theme now follows the warm preset/);
    expect(readTheme(ws.head())['--font-heading']).toBe('"Playfair Display", Georgia, serif');
    expect(ws.head()).toMatch(/data-tykerf-preset="warm"/);
    ws.undo();
    expect(ws.boxIds().sort()).toEqual(['faq', 'footer', 'hero', 'nav']); // one undo step takes both back
    expect(readTheme(ws.head())['--font-heading']).not.toBe('"Playfair Display", Georgia, serif');
    await tools.close();
  });
});

describe('using a component', () => {
  it('fills a box, brings its images and the theme variables, in one undo step', () => {
    const ws = new Workspace(new MemoryStore('memory:', { 'layout.slice': 'header main H\n', 'head.html': '<style>body{color:red}</style>\n' }));
    useComponent(ws, 'main', 'hero');
    expect(ws.content('main')).toContain('The main idea, in a few words');
    expect(ws.store.exists('assets/placeholder-wide.svg')).toBe(true);
    expect(ws.store.exists('assets/instrument-sans-latin-wght-normal.woff2')).toBe(true); // the theme's fonts come along
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
          font_: document.fonts.check('16px "Instrument Sans"'),
        }));
        await page.close();
        expect(r, `${p.name} at ${width}px`).toEqual({ scroll: 0, broken: 0, accent: '#1a52dd', font: '17px', font_: true });
      }
    });
  }
});

describe('theme presets', () => {
  it('set only variables the theme has, with values the theme accepts', () => {
    const vars = Object.keys(readTheme(theme()));
    const raw = JSON.parse(readFileSync(join(LIBRARY, 'themes.json'), 'utf8')) as Record<string, { values: Record<string, string> }>;
    expect(themes().map((t) => t.name)).toEqual(['studio', 'ivory', 'natural', 'vivid', 'civic', 'playful', 'dark', 'product', 'warm', 'gallery', 'biased']);
    expect(offeredThemes().map((t) => t.name)).toEqual(['studio', 'ivory', 'natural', 'vivid', 'civic', 'playful', 'dark']);
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

