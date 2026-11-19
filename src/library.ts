// TYKERF's library (library/ in the repository): page layouts, components, themes and fonts.
//
//   library/theme.html        the shared theme: CSS variables (colours, fonts, radius, spacing) + a light base
//   library/components/*.html ready-made boxes with placeholders; they style their box through :scope and
//                               use only theme variables, so components from any layout look alike
//   library/components.json   their names, labels and descriptions
//   library/layouts.json      page layouts: a tree of blocks plus the component for each box
//   library/themes.json       theme presets: values for the theme's variables (installed fonts only)
//   library/assets/*          placeholder images the components refer to as assets/<file>
//   library/fonts/*           fonts a theme may use (SIL OFL, Latin, variable weight); a page gets the ones its
//                               theme names, copied to assets/ with @font-face rules in the head (no font CDN)
//
// A new page gets the theme as its head.html; a component used on an existing page brings the theme's
// variables along if the page doesn't have them, without restyling the rest of that page.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { find, walk } from './model.js';
import { graft, remove } from './moves.js';
import { parseSlice, serializeSlice } from './notation.js';
import type { Store } from './store.js';
import type { Workspace } from './workspace.js';
import { mapPageFiles } from './assets.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'library');
const NAME = /^[a-z0-9][a-z0-9-]*$/;

export interface ComponentInfo {
  name: string;
  label: string;
  description: string;
}
/** A ready-made page layout: its tree of blocks (`layout`, in the notation) and the component for each box. */
export interface PageLayout extends ComponentInfo {
  layout: string;
  /** The boxes every page of a site shares (its navigation, its footer): a site's page from this layout links them (site/pages.ts). */
  shared?: string[];
  boxes: Record<string, string>; // box name -> component name
  /** Boxes whose main heading goes one level down (demoteTitle): the frame has a page title of its own. */
  demote?: string[];
  /** No longer offered (New page, list_layouts): pages start from a purpose in a frame. Still made by name, for older requests and pages. */
  retired?: boolean;
}

/**
 * A section's main heading one level down, looking the same: its h1 becomes `<h2 data-title>`, and the section's
 * own styles for h1 follow it. In a frame with a page title of its own (the page banner), the page keeps one h1.
 */
export function demoteTitle(code: string): string {
  return code
    .replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (_m, open: string, css: string, close: string) => open + css.replace(/\bh1\b/g, 'h2[data-title]') + close)
    .replace(/<h1\b/g, '<h2 data-title')
    .replace(/<\/h1>/g, '</h2>');
}

const json = <T>(file: string): T => JSON.parse(readFileSync(join(DIR, file), 'utf8'));

export function components(): ComponentInfo[] {
  return Object.entries(json<Record<string, Omit<ComponentInfo, 'name'>>>('components.json')).map(([name, c]) => ({ name, ...c }));
}

export interface ThemePreset extends ComponentInfo {
  values: Record<string, string>; // theme variable -> value; the variables left out keep the theme's own
  /** No longer offered (Page tab, New page, list_themes): still applied by name, for older requests and sites. */
  retired?: boolean;
}

/** Theme presets, each with the full set of values it gives the theme (its own over the theme's defaults). */
export function themes(): ThemePreset[] {
  const base = readTheme(theme());
  return Object.entries(json<Record<string, Omit<ThemePreset, 'name'>>>('themes.json')).map(([name, p]) => ({ name, ...p, values: { ...base, ...p.values } }));
}

/** The theme presets still offered (none retired). */
export function offeredThemes(): ThemePreset[] {
  return themes().filter((t) => !t.retired);
}

/** The theme's own values, as a preset: what `createPage` uses by default (not offered in the chooser). */
export const BASE_THEME = 'clean';

function preset(name: string): ThemePreset {
  if (name === BASE_THEME) return { name, label: 'Base', description: 'The theme\'s own values', values: readTheme(theme()) };
  const p = themes().find((x) => x.name === name);
  if (!p) throw new Error(`unknown theme "${name}" (known: ${themes().map((x) => x.name).join(', ')})`);
  return p;
}

export function pageLayouts(): PageLayout[] {
  return Object.entries(json<Record<string, Omit<PageLayout, 'name'>>>('layouts.json')).map(([name, p]) => ({ name, ...p }));
}

/** The ready-made layouts still offered (none retired); pages start from a purpose in a frame. */
export function offeredLayouts(): PageLayout[] {
  return pageLayouts().filter((p) => !p.retired);
}

/**
 * A frame: what holds a page (a navigation bar, a side menu, an aside, a footer), with a `body` box where the
 * page's own sections go. Its side boxes are optional: `keep` leaves them out like any section.
 */
export interface Frame extends ComponentInfo {
  layout: string;
  shared?: string[];
  boxes: Record<string, string>; // box name -> component name; `body` holds plain text when the frame is used alone
}
/** A purpose: the sections a kind of page needs (a place, a person, an event…), in order, each with its component. */
export interface Purpose extends ComponentInfo {
  sections: { box: string; component: string; tags?: string[] }[];
}
/** The frame a purpose goes in when none is named. */
export const DEFAULT_FRAME = 'basic';

export function frames(): Frame[] {
  return Object.entries(json<Record<string, Omit<Frame, 'name'>>>('frames.json')).map(([name, f]) => ({ name, ...f }));
}
export function purposes(): Purpose[] {
  return Object.entries(json<Record<string, Omit<Purpose, 'name'>>>('purposes.json')).map(([name, p]) => ({ name, ...p }));
}

/**
 * A purpose's skill (`library/skills/<purpose>.md`): what a page of that kind needs, what only the person can
 * tell, how it links. Kaity gets it with use_layout and new_page, and asks for it with get_skill; anyone may
 * edit the files. Null for a purpose without one.
 */
export function purposeSkill(purpose: string): string | null {
  if (!NAME.test(purpose) || !purposes().some((p) => p.name === purpose)) return null;
  const file = join(DIR, 'skills', `${purpose}.md`);
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : null;
}

/** The purpose a layout name makes a page for (`<frame>+<purpose>`, or a purpose alone); null for a frame or an older layout. */
export function purposeOf(name: string): string | null {
  const p = name.includes('+') ? name.split('+', 2)[1] : name;
  return purposes().some((x) => x.name === p) ? p : null;
}

/** Where a page keeps the purpose it was made for (TYKERF's state: not exported). */
const PURPOSE_FILE = '.tykerf/purpose';

/** The purpose a page was made for (use_layout, new_page, a copy of a page), or null. */
export function pagePurpose(ws: Workspace): string | null {
  const p = ws.store.read(PURPOSE_FILE)?.trim() ?? '';
  return p && purposes().some((x) => x.name === p) ? p : null;
}

/** Record the purpose a page is made for; null forgets it (a frame alone: the page's structure is its own). */
export function setPagePurpose(ws: Workspace, purpose: string | null) {
  if (purpose) ws.store.write(PURPOSE_FILE, `${purpose}\n`);
  else if (ws.store.exists(PURPOSE_FILE)) ws.store.remove(PURPOSE_FILE);
}

/**
 * A frame with a purpose's sections in its body, as one page layout named `<frame>+<purpose>`: 21 pages from
 * 10 entries, none stored. Without a purpose, the frame alone (its body a plain text block).
 */
export function composeLayout(frameName: string, purposeName?: string): PageLayout {
  const f = frames().find((x) => x.name === frameName);
  if (!f) throw new Error(`unknown frame "${frameName}" (known: ${frames().map((x) => x.name).join(', ')})`);
  // a frame with a page title of its own (the page banner's h1): its body's title goes one level down
  const titledFrame = Object.entries(f.boxes).some(([box, c]) => box !== 'body' && /<h1\b/.test(componentCode(c)));
  if (!purposeName) {
    const demoteBody = titledFrame && /<h1\b/.test(componentCode(f.boxes.body)) ? { demote: ['body'] } : {};
    return { name: f.name, label: f.label, description: f.description, layout: f.layout, ...(f.shared ? { shared: f.shared } : {}), boxes: f.boxes, ...demoteBody };
  }
  const p = purposes().find((x) => x.name === purposeName);
  if (!p) throw new Error(`unknown purpose "${purposeName}" (known: ${purposes().map((x) => x.name).join(', ')})`);
  const leaves = p.sections.map((s) => `${s.box}[role=section${(s.tags ?? []).map((t) => ` #${t}`).join('')}]`);
  const sub = parseSlice(`${leaves.length > 1 ? `${leaves.join(' ')} H${leaves.length > 2 ? leaves.length : ''}@body` : leaves[0]}\n`);
  const l = graft(parseSlice(f.layout + '\n'), 'body', sub.root);
  // the boxes in page order: the frame's around the body, the purpose's in it
  const comp: Record<string, string> = { ...f.boxes, ...Object.fromEntries(p.sections.map((s) => [s.box, s.component])) };
  const boxes: Record<string, string> = {};
  walk(l.root, (n) => { if (n.type === 'leaf') boxes[n.id] = comp[n.id]; });
  // a frame with a page title (an h1 of its own): the sections' main headings go one level down
  const titled = titledFrame;
  const demote = titled ? p.sections.filter((x) => /<h1\b/.test(componentCode(x.component))).map((x) => x.box) : [];
  return { name: `${f.name}+${p.name}`, label: `${p.label} in ${f.label.toLowerCase()}`, description: p.description, layout: serializeSlice(l).trimEnd(), ...(f.shared ? { shared: f.shared } : {}), boxes, ...(demote.length ? { demote } : {}) };
}

/** A layout by name: a library layout, a frame, a purpose (in the default frame) or `<frame>+<purpose>`; null when unknown. */
function findLayout(name: string): PageLayout | null {
  const own = pageLayouts().find((p) => p.name === name);
  if (own) return own;
  const [f, p] = name.includes('+') ? name.split('+', 2) : frames().some((x) => x.name === name) ? [name] : purposes().some((x) => x.name === name) ? [DEFAULT_FRAME, name] : [];
  if (!f || !frames().some((x) => x.name === f) || (p !== undefined && !purposes().some((x) => x.name === p))) return null;
  return composeLayout(f, p);
}

/** The frame a layout name starts in: a frame, `<frame>+<purpose>`, or a purpose alone (the default frame); null for others. */
export function frameOf(name: string): string | null {
  const [f, p] = name.includes('+') ? name.split('+', 2) : [name];
  if (p === undefined && purposes().some((x) => x.name === f)) return DEFAULT_FRAME;
  return frames().some((x) => x.name === f) ? f : null;
}

/** The boxes a layout declares shared by every page of a site (navigation, footer…); none for an unknown name. */
export function layoutShared(name: string): string[] {
  return findLayout(name)?.shared ?? [];
}

/** A layout's sections: its boxes less the ones every page of a site shares (navigation, footer), in page order. */
export function layoutSections(t: PageLayout): string[] {
  const shared = new Set(t.shared ?? []);
  return Object.keys(t.boxes).filter((b) => !shared.has(b));
}

/**
 * A page layout by name, with only the sections in `keep` (the shared boxes always stay): the others are
 * not made, so a page starts with what it needs instead of every section the layout has.
 */
export function pageLayout(name: string, keep?: string[]): PageLayout {
  const t = findLayout(name);
  if (!t) throw new Error(`unknown layout "${name}" (layouts: ${pageLayouts().map((p) => p.name).join(', ')}; frames: ${frames().map((f) => f.name).join(', ')}; purposes: ${purposes().map((p) => p.name).join(', ')}; or <frame>+<purpose>)`);
  if (!keep) return t;
  const sections = layoutSections(t);
  const unknown = keep.filter((k) => !sections.includes(k));
  if (unknown.length) throw new Error(`the ${name} layout has no section ${unknown.map((k) => `"${k}"`).join(', ')} (its sections: ${sections.join(', ')}; ${(t.shared ?? []).join(', ') || 'none'} always stay)`);
  if (!keep.length) throw new Error(`keep at least one of the ${name} layout's sections (${sections.join(', ')})`);
  const drop = sections.filter((s) => !keep.includes(s));
  if (!drop.length) return t;
  let l = parseSlice(t.layout + '\n');
  for (const id of drop) l = remove(l, id);
  return { ...t, layout: serializeSlice(l).trimEnd(), boxes: Object.fromEntries(Object.entries(t.boxes).filter(([b]) => !drop.includes(b))) };
}

/** A behaviour the library ships (library/behaviours/<name>.js): a component asks for it with data-use="<name>". */
export interface LibraryBehaviour extends ComponentInfo {
  /** The markup it expects. */
  markup: string;
  /** Used by no component: for people (and Kaity) to use in their own code. */
  standalone?: boolean;
}

export function libraryBehaviours(): LibraryBehaviour[] {
  return Object.entries(json<Record<string, Omit<LibraryBehaviour, 'name'>>>('behaviours.json')).map(([name, b]) => ({ name, ...b }));
}

/** A library behaviour's code, or null when the library has none of that name. */
export function behaviourCode(name: string): string | null {
  if (!NAME.test(name) || !libraryBehaviours().some((b) => b.name === name)) return null;
  return readFileSync(join(DIR, 'behaviours', `${name}.js`), 'utf8');
}

/** The behaviours some code asks for (data-use="a b"), by name. */
export function behavioursIn(code: string): string[] {
  return [...new Set([...code.matchAll(/\bdata-use\s*=\s*["']([^"']*)["']/gi)].flatMap((m) => m[1].trim().split(/\s+/)).filter(Boolean))];
}

/**
 * Give a page's site the library behaviours some code asks for, as fonts are copied: each one its kit lacks is
 * written to kit/scripts/<name>.js (a step of the site's history). Outside a site nothing is copied: the code
 * still works as plain HTML (a form sends, a <details> opens), only without the behaviour.
 */
export function copyBehaviours(ws: Workspace, code: string, author = 'user'): string[] {
  if (!ws.site) return [];
  const added: string[] = [];
  for (const name of behavioursIn(code)) {
    const lib = behaviourCode(name);
    if (lib !== null && ws.site.useBehaviour(name, lib, author)) added.push(name);
  }
  return added;
}

export function componentCode(name: string): string {
  if (!NAME.test(name) || !components().some((c) => c.name === name)) throw new Error(`unknown component "${name}" (known: ${components().map((c) => c.name).join(', ')})`);
  return readFileSync(join(DIR, 'components', `${name}.html`), 'utf8');
}

/** The full theme (variables and base styles), as a new page's head.html (or a site's shared head). */
export function theme(): string {
  return readFileSync(join(DIR, 'theme.html'), 'utf8');
}

/** Only the theme's variables, for pages that have their own look (imported sites, older pages). */
export function themeVariables(): string {
  const root = /:root\s*\{[^}]*\}/.exec(theme());
  if (!root) throw new Error('library/theme.html has no :root block');
  return `<!-- TYKERF theme variables, used by components -->\n<style data-tykerf-theme>\n${root[0]}\n</style>\n`;
}

/** The preset a theme was made from (remembered on its <style data-tykerf-preset>), or null. */
export function themePreset(head: string): string | null {
  return /<style[^>]*\bdata-tykerf-theme\b[^>]*\bdata-tykerf-preset="([a-z0-9-]+)"/.exec(head)?.[1] ?? null;
}

/** A head whose theme block remembers the preset it was made from (null forgets it). */
export function withPresetName(head: string, name: string | null): string {
  return head.replace(/<style([^>]*\bdata-tykerf-theme\b[^>]*)>/, (_m, attrs: string) => {
    const rest = attrs.replace(/\s*data-tykerf-preset="[^"]*"/, '');
    return `<style${rest}${name ? ` data-tykerf-preset="${name}"` : ''}>`;
  });
}

/** Whether a page head defines the theme variables. */
export const hasTheme = (head: string) => /<style[^>]*\bdata-tykerf-theme\b/.test(head);

/** A library image or font (library/assets/<file>, library/fonts/<file>), for previews; null for unknown names. */
export function libraryAsset(file: string): Buffer | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file)) return null;
  for (const dir of ['assets', 'fonts']) {
    const f = join(DIR, dir, file);
    if (existsSync(f) && !f.endsWith('.txt')) return readFileSync(f);
  }
  return null;
}

// ---- fonts: a theme may name the bundled families; the page gets their files and @font-face rules ----

/** The bundled font families and their files (library/fonts, variable weight). */
export const FONTS: Record<string, { file: string; style: 'normal' | 'italic' }[]> = {
  Inter: [{ file: 'inter-latin-wght-normal.woff2', style: 'normal' }],
  Manrope: [{ file: 'manrope-latin-wght-normal.woff2', style: 'normal' }],
  'DM Sans': [{ file: 'dm-sans-latin-wght-normal.woff2', style: 'normal' }],
  Newsreader: [{ file: 'newsreader-latin-wght-normal.woff2', style: 'normal' }, { file: 'newsreader-latin-wght-italic.woff2', style: 'italic' }],
  'Playfair Display': [{ file: 'playfair-display-latin-wght-normal.woff2', style: 'normal' }, { file: 'playfair-display-latin-wght-italic.woff2', style: 'italic' }],
  'Plus Jakarta Sans': [{ file: 'plus-jakarta-sans-latin-wght-normal.woff2', style: 'normal' }],
  'Instrument Sans': [{ file: 'instrument-sans-latin-wght-normal.woff2', style: 'normal' }],
  'Public Sans': [{ file: 'public-sans-latin-wght-normal.woff2', style: 'normal' }],
  Fraunces: [{ file: 'fraunces-latin-wght-normal.woff2', style: 'normal' }, { file: 'fraunces-latin-wght-italic.woff2', style: 'italic' }],
  'Bricolage Grotesque': [{ file: 'bricolage-grotesque-latin-wght-normal.woff2', style: 'normal' }],
  Nunito: [{ file: 'nunito-latin-wght-normal.woff2', style: 'normal' }],
};

const FONTS_BLOCK = /<style[^>]*\bdata-tykerf-fonts\b[^>]*>[\s\S]*?<\/style>\n?/;

/** One file of a registered font: which weights and style it has. */
export interface FontFile {
  /** In the site's assets/ (served at /assets/<file>). */
  file: string;
  /** One weight ("400") or a range, for a variable font ("100 900"). */
  weight: string;
  style: 'normal' | 'italic';
}
/** A site's own font (kit/fonts.json): its files, how it shows while loading, and its licence. */
export interface RegisteredFont {
  files: FontFile[];
  display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
  licence?: string;
}
/** The fonts a site registers, by family: kit/fonts.json. */
export type FontRegistry = Record<string, RegisteredFont>;

const FONT_FORMAT: Record<string, string> = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };

/** Font families every browser has, or a system's: a theme can name them without registering them. */
const SYSTEM_FONTS = new Set(['system-ui', 'georgia', 'arial', 'helvetica', 'helvetica neue', 'times', 'times new roman', 'courier', 'courier new', 'verdana', 'tahoma', 'trebuchet ms', 'segoe ui', '-apple-system', 'blinkmacsystemfont', 'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'emoji', 'math']);

/**
 * A warning for a theme's font list that names a family (in quotes) neither bundled with TYKERF, nor registered
 * by the site, nor one every system has: visitors without it installed see the next one in the list. Null when
 * every family is known. Not an error: a theme may name a font the person has, on purpose.
 */
export function fontWarning(name: string, value: string, registry: FontRegistry = {}): string | null {
  if (!name.startsWith('--font')) return null;
  const known = new Set([...Object.keys(FONTS), ...Object.keys(registry)].map((f) => f.toLowerCase()));
  const unknown = [...value.matchAll(/["']([^"']+)["']/g)].map((m) => m[1].trim())
    .filter((f) => !known.has(f.toLowerCase()) && !SYSTEM_FONTS.has(f.toLowerCase()) && !/^ui-/i.test(f));
  if (!unknown.length) return null;
  const list = unknown.map((f) => `"${f}"`).join(', ');
  return `${name}: ${list} ${unknown.length === 1 ? 'is not a bundled or registered font' : 'are not bundled or registered fonts'}; register ${unknown.length === 1 ? 'it' : 'them'} in the kit's Fonts (kit/fonts.json) with ${unknown.length === 1 ? 'its' : 'their'} files in the site's assets/, or visitors without ${unknown.length === 1 ? 'it' : 'them'} see the next font in the list`;
}

// ---- a page's own values over the site's shared theme ----
// A page of a site that shares one theme may change some of its values for itself: they go in a
// <style data-tykerf-override> block of the page's head (after the site's head, so they win). Only the
// values that differ from the site's are kept; removing the block puts the page back on the site theme.

const OVERRIDE_BLOCK = /<style[^>]*\bdata-tykerf-override\b[^>]*>([\s\S]*?)<\/style>\n?/;

/** The theme values a page sets for itself over the site theme ({} when it follows the site). */
export function readOverrides(head: string): Record<string, string> {
  const root = /:root\s*\{([^}]*)\}/.exec(OVERRIDE_BLOCK.exec(head)?.[1] ?? '')?.[1] ?? '';
  return Object.fromEntries([...root.matchAll(DECL)].map((m) => [m[1], m[3].trim()]));
}

/** A head whose own values are exactly `values` (none: the block goes). Each value is checked like a theme value. */
export function withOverrides(head: string, values: Record<string, string>): string {
  const errors = Object.entries(values).map(([n, v]) => themeValueError(n, v)).filter(Boolean);
  if (errors.length) throw new Error(errors.join('; '));
  const entries = Object.entries(values);
  const block = entries.length ? `<style data-tykerf-override>\n:root {\n${entries.map(([n, v]) => `  ${n}: ${v.trim()};`).join('\n')}\n}\n</style>\n` : '';
  return OVERRIDE_BLOCK.test(head) ? head.replace(OVERRIDE_BLOCK, block) : block + head;
}

/** The bundled families a head's theme (and its own values over a site theme) name in their font variables. */
export function themeFonts(head: string): string[] {
  const lists = Object.entries({ ...readTheme(head), ...readOverrides(head) }).filter(([n]) => n.startsWith('--font')).map(([, v]) => v);
  const named = new Set(lists.flatMap((v) => v.split(',').map((f) => f.trim().replace(/^["']|["']$/g, '').toLowerCase())));
  return Object.keys(FONTS).filter((f) => named.has(f.toLowerCase()));
}

/**
 * A head whose fonts block declares exactly the bundled families its theme uses, and the font files
 * copied into the assets/ folder of the page (or of the site, for its shared head: then `base` is
 * "/assets/", where the editor and an export serve the site's files). The rest of the head stays as it is.
 */
export function withFonts(ws: Workspace | Store, head: string, base = 'assets/', registry: FontRegistry = {}): string {
  const store = 'store' in ws ? ws.store : ws;
  // a family the site registers (kit/fonts.json) is the site's: a page doesn't declare it again, nor the bundled one of that name
  const theirs = new Set(Object.keys({ ...registry, ...('store' in ws ? ws.site?.fonts() ?? {} : {}) }).map((f) => f.toLowerCase()));
  const families = themeFonts(head).filter((f) => !theirs.has(f.toLowerCase()));
  for (const f of families) for (const { file } of FONTS[f]) {
    if (!store.exists(`assets/${file}`)) store.write(`assets/${file}`, new Uint8Array(readFileSync(join(DIR, 'fonts', file))));
  }
  const faces = [
    ...families.flatMap((f) => FONTS[f].map(({ file, style }) => `@font-face { font-family: "${f}"; src: url("${base}${file}") format("woff2"); font-weight: 100 900; font-style: ${style}; font-display: swap; }`)),
    // every registered family, not only those the theme names: a kit style may use one
    ...Object.entries(registry).flatMap(([f, r]) => r.files.map(({ file, weight, style }) =>
      `@font-face { font-family: "${f}"; src: url("${base}${file}") format("${FONT_FORMAT[file.split('.').pop()!.toLowerCase()] ?? 'woff2'}"); font-weight: ${weight}; font-style: ${style}; font-display: ${r.display ?? 'swap'}; }`)),
  ];
  const block = faces.length ? `<style data-tykerf-fonts>\n${faces.join('\n')}\n</style>\n` : '';
  if (FONTS_BLOCK.test(head)) return head.replace(FONTS_BLOCK, block);
  return block ? block + head : head;
}

/** Copy the library images a piece of code refers to (assets/<file>) into the page, if they are missing. */
export function copyAssets(ws: Workspace, code: string): string[] {
  const copied: string[] = [];
  for (const [, file] of code.matchAll(/assets\/([A-Za-z0-9._-]+)/g)) {
    const src = join(DIR, 'assets', file);
    if (!existsSync(src) || ws.store.exists(`assets/${file}`)) continue;
    ws.store.write(`assets/${file}`, new Uint8Array(readFileSync(src)));
    copied.push(file);
  }
  return copied;
}

/**
 * Replace a page's blocks with a page layout's: its tree, every box's component and their images. The
 * head and the theme stay (the variables are added if the page lacks them). One undo step.
 */
export function useLayout(ws: Workspace, name: string, author = 'user', keep?: string[]) {
  const t = pageLayout(name, keep);
  ws.group(`use layout ${name}`, author, () => {
    // the code of boxes the layout doesn't have goes, so an old box can't come back under a new block's name
    for (const id of ws.boxIds()) if (!(id in t.boxes)) ws.setContent(id, null, author);
    // the top block keeps its name (it is the block the user, and Kaity's scope, know the page by)
    const next = parseSlice(t.layout + '\n');
    const top = ws.load().root.id;
    if (next.root.type === 'op' && top !== next.root.id && !find(next.root, top)) Object.assign(next.root, { id: top, named: true });
    ws.save(next, `use layout ${name}`, author);
    for (const [box, c] of Object.entries(t.boxes)) {
      const code = t.demote?.includes(box) ? demoteTitle(componentCode(c)) : componentCode(c);
      copyAssets(ws, code);
      copyBehaviours(ws, code, author);
      ws.setContent(box, code, author);
    }
    if (!hasTheme(ws.siteHead() + ws.head())) ws.setHead(withFonts(ws, themeVariables() + ws.head()), author);
  });
  setPagePurpose(ws, purposeOf(name));
}

/** Fill a box with a component: its code, its images and, if the page lacks them, the theme variables. One undo step. */
export function useComponent(ws: Workspace, id: string, name: string, author = 'user') {
  const code = componentCode(name);
  if (find(ws.load().root, id)?.node.type !== 'leaf') throw new Error(`"${id}" is not a box`);
  ws.group(`use component ${name} in ${id}`, author, () => {
    if (!hasTheme(ws.siteHead() + ws.head())) ws.setHead(withFonts(ws, themeVariables() + ws.head()), author);
    // in a box that shows a shared block, the component's pictures are the site's (every page shows them)
    if (ws.site && ws.sharedBlock(id)) {
      const site = ws.site;
      const shared = mapPageFiles(code, (f) => {
        const src = join(DIR, 'assets', f);
        if (!existsSync(src)) return null;
        site.putFile(f, new Uint8Array(readFileSync(src)));
        return `/assets/${f}`;
      });
      copyBehaviours(ws, code, author);
      return ws.setContent(id, shared, author);
    }
    copyAssets(ws, code);
    copyBehaviours(ws, code, author);
    ws.setContent(id, code, author);
  });
}

/** Start a page from a page layout: its tree, every box's component, the theme (with a preset's values) and the images. */
/** The theme preset people start with, wherever they don't choose one. */
export const DEFAULT_THEME = 'studio';

/**
 * The page Kaity starts a build from (not offered in the chooser): two empty boxes on the theme's
 * background, so what appears is what Kaity builds, and no sample page shows first.
 */
export const EMPTY_LAYOUT = 'empty';
const EMPTY = { layout: 'header[role=header] main[role=main] H@page', boxes: { header: '', main: '' } as Record<string, string> };

export function createPage(ws: Workspace, name = 'blank', themeName = 'clean', opts: { ownTheme?: boolean; keep?: string[] } = {}) {
  const t = name === EMPTY_LAYOUT ? EMPTY : pageLayout(name, opts.keep);
  const values = preset(themeName).values;
  const demote: string[] = (t as Partial<PageLayout>).demote ?? [];
  // the empty page's boxes hold empty code, so they show nothing (not their names)
  const boxes = Object.fromEntries(Object.entries(t.boxes).map(([box, c]) => [box, !c ? '' : demote.includes(box) ? demoteTitle(componentCode(c)) : componentCode(c)]));
  ws.create(t.layout + '\n', boxes);
  // a page of a site that shares its theme has none of its own (the site's head comes first)
  if (opts.ownTheme !== false) ws.store.write('head.html', withFonts(ws, withPresetName(withThemeValues(theme(), values).head, themeName === BASE_THEME ? null : themeName)));
  for (const code of Object.values(boxes)) copyAssets(ws, code);
  setPagePurpose(ws, purposeOf(name));
}

// ---- the theme as data: what the AI (and any tool) may change without touching the rest of the head ----

const THEME_BLOCK = /(<style[^>]*\bdata-tykerf-theme\b[^>]*>)([\s\S]*?)(<\/style>)/;
const DECL = /(--[\w-]+)(\s*:\s*)([^;]+);/g;

/** The theme variables of a page head, in order ({} when the page has no theme). */
export function readTheme(head: string): Record<string, string> {
  const root = /:root\s*\{([^}]*)\}/.exec(THEME_BLOCK.exec(head)?.[2] ?? '')?.[1] ?? '';
  return Object.fromEntries([...root.matchAll(DECL)].map((m) => [m[1], m[3].trim()]));
}

const COLOR = /^(#[0-9a-f]{3,8}|[a-z]+|var\(--[\w-]+\)|(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix)\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))$/i;
const LENGTH = /^(0|-?\d*\.?\d+(px|rem|em|%|vw|vh|ch|ex)|var\(--[\w-]+\)|(calc|clamp|min|max)\((?:[^()]|\([^()]*\))*\))$/i;
const FONT = /^\s*("[^"]+"|'[^']+'|[a-z][\w -]*)(\s*,\s*("[^"]+"|'[^']+'|[a-z][\w -]*))*\s*$/i;

/** Why a value can't go into a theme variable, or null when it can. */
export function themeValueError(name: string, value: string): string | null {
  const v = value.trim();
  if (!v || v.length > 200) return `${name}: the value must be 1 to 200 characters`;
  // no way out of the declaration, and nothing fetched from anywhere (a font or image from another server
  // would send every visitor's IP address to it)
  if (/[;{}<>\\]|\/\*|url\s*\(|@import|expression\s*\(/i.test(v)) return `${name}: "${v}" is not allowed (no ; { } < > \\, comments, url() or @import)`;
  if (name.startsWith('--color')) return COLOR.test(v) ? null : `${name}: "${v}" is not a colour (use #hex, rgb(), hsl(), oklch(), color-mix() or a colour name)`;
  if (name.startsWith('--font')) return FONT.test(v) ? null : `${name}: "${v}" is not a list of font names (installed or bundled fonts only, e.g. "Inter", Georgia, serif)`;
  if (/^--(radius|gap|max-width|space|text|tracking)/.test(name)) return LENGTH.test(v) ? null : `${name}: "${v}" is not a length (e.g. 12px, 1.5rem, -0.02em, clamp(16px, 2vw, 24px))`;
  if (name.startsWith('--weight')) return /^\d{3}$/.test(v) && +v >= 100 && +v <= 900 ? null : `${name}: "${v}" is not a font weight (100 to 900, e.g. 650)`;
  return null;
}

/**
 * Where a page's theme changes go: its own theme ('page'); the site's shared theme when the page is the
 * site's only page ('site': a new site's first page, whose theme every later page starts from); or this
 * page's own values over the shared theme when the site has other pages ('override': one page never
 * restyles the others). null when there is no theme at all.
 */
export function themeTarget(ws: Workspace): 'page' | 'site' | 'override' | null {
  if (hasTheme(ws.head())) return 'page';
  if (!hasTheme(ws.siteHead())) return null;
  return ws.site && ws.site.pageNames().length === 1 ? 'site' : 'override';
}

/** setTheme for a page on the site's shared theme: the site's theme, or the page's own values over it. */
function setSharedTheme(ws: Workspace, values: Record<string, string>, author: string, where: 'site' | 'override', preset?: string) {
  const site = readTheme(ws.siteHead());
  const unknown = Object.keys(values).filter((n) => !(n in site));
  if (unknown.length) throw new Error(`unknown theme variables: ${unknown.join(', ')} (the theme has ${Object.keys(site).join(', ')})`);
  const errors = Object.entries(values).map(([n, v]) => themeValueError(n, v)).filter(Boolean);
  if (errors.length) throw new Error(errors.join('; '));
  const label = (changed: Record<string, { to: string }>) => `theme: ${Object.entries(changed).map(([n, c]) => `${n} ${c.to}`).join(', ')}`;
  if (where === 'site') {
    const { head: values_, changed } = withThemeValues(ws.siteHead(), values);
    const next = preset ? withPresetName(values_, preset) : values_;
    if (next !== ws.siteHead()) ws.site!.setHead(next, Object.keys(changed).length ? label(changed) : `theme preset ${preset}`);
    return changed;
  }
  const own = readOverrides(ws.head());
  const changed: Record<string, { from: string; to: string }> = {};
  for (const [n, v] of Object.entries(values)) if ((own[n] ?? site[n]).trim() !== v.trim()) changed[n] = { from: own[n] ?? site[n], to: v.trim() };
  if (!Object.keys(changed).length) return changed;
  // only the values that differ from the site's are kept
  const kept = Object.fromEntries(Object.entries({ ...own, ...values }).filter(([n, v]) => v.trim() !== site[n]?.trim()));
  ws.setHead(withFonts(ws, withOverrides(ws.head(), kept)), author, label(changed));
  return changed;
}

/**
 * Change some theme variables (only ones the theme already has), keeping everything else in the head as it is.
 * Validated, logged and undoable like any change. Returns the variables that changed. With `preset` (a whole
 * preset's values), the theme also says it came from that preset, as the Page tab shows it; a page's own
 * values over a shared theme have no such name.
 */
export function setTheme(ws: Workspace, values: Record<string, string>, author = 'ai', preset?: string): Record<string, { from: string; to: string }> {
  const head = ws.head();
  const where = themeTarget(ws);
  if (where === 'site' || where === 'override') return setSharedTheme(ws, values, author, where, preset);
  const current = readTheme(head);
  if (!Object.keys(current).length) throw new Error('this page has no theme; the user can add one in the Page tab of the top block');
  const unknown = Object.keys(values).filter((n) => !(n in current));
  if (unknown.length) throw new Error(`unknown theme variables: ${unknown.join(', ')} (the theme has ${Object.keys(current).join(', ')})`);
  const errors = Object.entries(values).map(([n, v]) => themeValueError(n, v)).filter(Boolean);
  if (errors.length) throw new Error(errors.join('; '));
  const { head: values_, changed } = withThemeValues(head, values);
  const next = preset ? withPresetName(values_, preset) : values_;
  if (next !== head) ws.setHead(withFonts(ws, next), author, Object.keys(changed).length ? `theme: ${Object.entries(changed).map(([n, c]) => `${n} ${c.to}`).join(', ')}` : `theme preset ${preset}`);
  return changed;
}

/** A head with new values for theme variables it already has; everything else in it stays as it is. Not validated: see setTheme. */
export function withThemeValues(head: string, values: Record<string, string>): { head: string; changed: Record<string, { from: string; to: string }> } {
  const changed: Record<string, { from: string; to: string }> = {};
  // only the :root block holds the theme's values; rules after it (band tones) reuse the names and stay as they are
  const next = head.replace(THEME_BLOCK, (_m, open: string, css: string, close: string) =>
    open + css.replace(/:root\s*\{[^}]*\}/, (root) => root.replace(DECL, (d: string, name: string, sep: string, old: string) => {
      if (!Object.hasOwn(values, name) || values[name].trim() === old.trim()) return d;
      changed[name] = { from: old.trim(), to: values[name].trim() };
      return `${name}${sep}${values[name].trim()};`;
    })) + close);
  return { head: next, changed };
}
