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
import { find } from './model.js';
import { parseSlice } from './notation.js';
import type { Store } from './store.js';
import type { Workspace } from './workspace.js';

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
  boxes: Record<string, string>; // box name -> component name
}

const json = <T>(file: string): T => JSON.parse(readFileSync(join(DIR, file), 'utf8'));

export function components(): ComponentInfo[] {
  return Object.entries(json<Record<string, Omit<ComponentInfo, 'name'>>>('components.json')).map(([name, c]) => ({ name, ...c }));
}

export interface ThemePreset extends ComponentInfo {
  values: Record<string, string>; // theme variable -> value; the variables left out keep the theme's own
}

/** Theme presets, each with the full set of values it gives the theme (its own over the theme's defaults). */
export function themes(): ThemePreset[] {
  const base = readTheme(theme());
  return Object.entries(json<Record<string, Omit<ThemePreset, 'name'>>>('themes.json')).map(([name, p]) => ({ name, ...p, values: { ...base, ...p.values } }));
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
};

const FONTS_BLOCK = /<style[^>]*\bdata-tykerf-fonts\b[^>]*>[\s\S]*?<\/style>\n?/;

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
export function withFonts(ws: Workspace | Store, head: string, base = 'assets/'): string {
  const store = 'store' in ws ? ws.store : ws;
  const families = themeFonts(head);
  for (const f of families) for (const { file } of FONTS[f]) {
    if (!store.exists(`assets/${file}`)) store.write(`assets/${file}`, new Uint8Array(readFileSync(join(DIR, 'fonts', file))));
  }
  const block = families.length
    ? `<style data-tykerf-fonts>\n${families.flatMap((f) => FONTS[f].map(({ file, style }) => `@font-face { font-family: "${f}"; src: url("${base}${file}") format("woff2"); font-weight: 100 900; font-style: ${style}; font-display: swap; }`)).join('\n')}\n</style>\n`
    : '';
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
export function useLayout(ws: Workspace, name: string, author = 'user') {
  const t = pageLayouts().find((p) => p.name === name);
  if (!t) throw new Error(`unknown layout "${name}" (known: ${pageLayouts().map((p) => p.name).join(', ')})`);
  ws.group(`use layout ${name}`, author, () => {
    // the code of boxes the layout doesn't have goes, so an old box can't come back under a new block's name
    for (const id of ws.boxIds()) if (!(id in t.boxes)) ws.setContent(id, null, author);
    // the top block keeps its name (it is the block the user, and Kaity's scope, know the page by)
    const next = parseSlice(t.layout + '\n');
    const top = ws.load().root.id;
    if (next.root.type === 'op' && top !== next.root.id && !find(next.root, top)) Object.assign(next.root, { id: top, named: true });
    ws.save(next, `use layout ${name}`, author);
    for (const [box, c] of Object.entries(t.boxes)) {
      const code = componentCode(c);
      copyAssets(ws, code);
      ws.setContent(box, code, author);
    }
    if (!hasTheme(ws.siteHead() + ws.head())) ws.setHead(withFonts(ws, themeVariables() + ws.head()), author);
  });
}

/** Fill a box with a component: its code, its images and, if the page lacks them, the theme variables. One undo step. */
export function useComponent(ws: Workspace, id: string, name: string, author = 'user') {
  const code = componentCode(name);
  if (find(ws.load().root, id)?.node.type !== 'leaf') throw new Error(`"${id}" is not a box`);
  ws.group(`use component ${name} in ${id}`, author, () => {
    if (!hasTheme(ws.siteHead() + ws.head())) ws.setHead(withFonts(ws, themeVariables() + ws.head()), author);
    copyAssets(ws, code);
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

export function createPage(ws: Workspace, name = 'blank', themeName = 'clean', opts: { ownTheme?: boolean } = {}) {
  const t = name === EMPTY_LAYOUT ? EMPTY : pageLayouts().find((p) => p.name === name);
  if (!t) throw new Error(`unknown layout "${name}" (known: ${pageLayouts().map((p) => p.name).join(', ')})`);
  const values = preset(themeName).values;
  // the empty page's boxes hold empty code, so they show nothing (not their names)
  const boxes = Object.fromEntries(Object.entries(t.boxes).map(([box, c]) => [box, c ? componentCode(c) : '']));
  ws.create(t.layout + '\n', boxes);
  // a page of a site that shares its theme has none of its own (the site's head comes first)
  if (opts.ownTheme !== false) ws.store.write('head.html', withFonts(ws, withPresetName(withThemeValues(theme(), values).head, themeName === BASE_THEME ? null : themeName)));
  for (const code of Object.values(boxes)) copyAssets(ws, code);
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
  return ws.site?.setHead && ws.site.pages?.() === 1 ? 'site' : 'override';
}

/** setTheme for a page on the site's shared theme: the site's theme, or the page's own values over it. */
function setSharedTheme(ws: Workspace, values: Record<string, string>, author: string, where: 'site' | 'override') {
  const site = readTheme(ws.siteHead());
  const unknown = Object.keys(values).filter((n) => !(n in site));
  if (unknown.length) throw new Error(`unknown theme variables: ${unknown.join(', ')} (the theme has ${Object.keys(site).join(', ')})`);
  const errors = Object.entries(values).map(([n, v]) => themeValueError(n, v)).filter(Boolean);
  if (errors.length) throw new Error(errors.join('; '));
  const label = (changed: Record<string, { to: string }>) => `theme: ${Object.entries(changed).map(([n, c]) => `${n} ${c.to}`).join(', ')}`;
  if (where === 'site') {
    const { head: next, changed } = withThemeValues(ws.siteHead(), values);
    if (Object.keys(changed).length) ws.site!.setHead!(next, label(changed));
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
 * Validated, logged and undoable like any change. Returns the variables that changed.
 */
export function setTheme(ws: Workspace, values: Record<string, string>, author = 'ai'): Record<string, { from: string; to: string }> {
  const head = ws.head();
  const where = themeTarget(ws);
  if (where === 'site' || where === 'override') return setSharedTheme(ws, values, author, where);
  const current = readTheme(head);
  if (!Object.keys(current).length) throw new Error('this page has no theme; the user can add one in the Page tab of the top block');
  const unknown = Object.keys(values).filter((n) => !(n in current));
  if (unknown.length) throw new Error(`unknown theme variables: ${unknown.join(', ')} (the theme has ${Object.keys(current).join(', ')})`);
  const errors = Object.entries(values).map(([n, v]) => themeValueError(n, v)).filter(Boolean);
  if (errors.length) throw new Error(errors.join('; '));
  const { head: next, changed } = withThemeValues(head, values);
  if (Object.keys(changed).length) ws.setHead(withFonts(ws, next), author, `theme: ${Object.entries(changed).map(([n, c]) => `${n} ${c.to}`).join(', ')}`);
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
