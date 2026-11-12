// The site kit: what every page of a site shares besides its theme, in the site's kit/ folder, one
// small named file per thing (docs/plans/site-sharing.md):
//
//   kit/styles/<name>.css    site CSS, in every page after the theme and before the page's own styles
//   kit/scripts/<name>.js    behaviours: an ES module whose default export gets each element marked
//                            data-use="<name>" (and may return a function that undoes it)
//   kit/blocks/<name>.html   shared blocks: a box with use=<name> shows this code, on every page
//   kit/types/<name>.json    box types every page has (a page's own types/ wins for the same name)
//   kit/tags.json            the site's own tags: { "<tag>": { "label": "…", "description": "…" } },
//                            styled in kit/styles as .t-<tag>
//
// Every change is a step of the site's history (site/history.ts), with the head's and the settings'.

import { createHash } from 'node:crypto';
import { pageFileRefs } from './assets.js';
import { SiteHistory, siteStore } from './site/history.js';
import { parseType } from './types.js';
import { type FontRegistry, behaviourCode, withFonts } from './library.js';

export type KitKind = 'styles' | 'scripts' | 'blocks' | 'types' | 'tags' | 'fonts';
export const KIT_KINDS: KitKind[] = ['styles', 'scripts', 'blocks', 'types', 'tags', 'fonts'];

/** File names in the kit: they become addresses (/kit/scripts/<name>.js) and data-use values. */
export const KIT_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
const EXT: Record<KitKind, string> = { styles: '.css', scripts: '.js', blocks: '.html', types: '.json', tags: '.json', fonts: '.json' };
const MAX = 400_000;

/** Tags the library's theme already gives every page; the site's own tags can't take these names. */
const LIBRARY_TAGS = new Set(['tone-alt', 'tone-soft', 'tone-dark', 'dense', 'reverse', 'priority']);

const store = (dir: string) => siteStore(dir);

/** Where a kit file lives in the site folder. */
export function kitPath(kind: KitKind, name: string): string {
  if (kind === 'tags') return 'kit/tags.json';
  if (kind === 'fonts') return 'kit/fonts.json';
  if (!KIT_KINDS.includes(kind)) throw new Error(`unknown kind of kit file "${kind}" (${KIT_KINDS.join(', ')})`);
  if (!KIT_NAME.test(name)) throw new Error(`"${name}" can't be a kit file name: lowercase letters, digits and -, up to 41`);
  return `kit/${kind}/${name}${EXT[kind]}`;
}

/** The kit's files, by kind, names without their extension (tags: whether kit/tags.json exists). */
export function kitList(dir: string): Record<Exclude<KitKind, 'tags' | 'fonts'>, string[]> & { tags: boolean; fonts: boolean } {
  const s = store(dir);
  const names = (kind: Exclude<KitKind, 'tags' | 'fonts'>) => s.list(`kit/${kind}`).filter((f) => f.endsWith(EXT[kind])).map((f) => f.slice(0, -EXT[kind].length)).filter((n) => KIT_NAME.test(n)).sort();
  return { styles: names('styles'), scripts: names('scripts'), blocks: names('blocks'), types: names('types'), tags: s.exists('kit/tags.json'), fonts: s.exists('kit/fonts.json') };
}

export function kitRead(dir: string, kind: KitKind, name = 'tags'): string | null {
  return store(dir).read(kitPath(kind, name));
}

/** Why some text can't be this kit file, or null when it can. */
export function kitError(kind: KitKind, name: string, text: string): string | null {
  if (text.length > MAX) return `a kit file is at most ${MAX / 1000} KB`;
  if (kind === 'styles') {
    // a style for a class is scoped to the class of its own name: kit/styles/card.css to .k-card
    const scoped = /^(?:\s|\/\*[\s\S]*?\*\/)*@scope\s*\(\s*([^)]*?)\s*\)/.exec(text);
    if (scoped && /^\.k-/.test(scoped[1]) && scoped[1] !== `.k-${name}`) return `${name}.css: a style for a class is scoped to the class of the file's name, .k-${name}, not ${scoped[1]} (rename the file, or the class)`;
    // nothing fetched from another server (it would send every visitor's address there), no way out of the <style>
    if (/@import/i.test(text)) return `${name}.css: no @import (put the other file in the kit too)`;
    if (/<\/style/i.test(text)) return `${name}.css: no </style> in CSS`;
    for (const m of text.matchAll(/url\(\s*["']?([^"')]+)/gi)) if (/^([a-z]+:|\/\/)/i.test(m[1].trim()) && !/^data:/i.test(m[1].trim())) return `${name}.css: url(${m[1].trim()}) loads from another server; put the file in the site's assets/ and write url(/assets/<file>)`;
  }
  if (kind === 'scripts') {
    // a behaviour is a module whose default export the loader calls with each element: without one it does nothing
    if (!/\bexport\s+default\b/.test(text)) return `${name}.js: a behaviour exports a function as default: export default function (el) { … }`;
    // its syntax, checked without running it: the module as a function body (a file with imports can't be one: skipped)
    if (!/^\s*import\b/m.test(text)) {
      try {
        new Function(text.replace(/\bexport\s+default\b/, 'return'));
      } catch (e) {
        return `${name}.js: ${(e as Error).message} (a mistake in the code: it would fail on every page)`;
      }
    }
  }
  if (kind === 'types') {
    try {
      parseType(text, `kit/types/${name}.json`);
    } catch (e) {
      return (e as Error).message;
    }
  }
  if (kind === 'fonts') {
    let fonts: unknown;
    try {
      fonts = JSON.parse(text);
    } catch {
      return 'kit/fonts.json is not JSON';
    }
    const shape = 'kit/fonts.json is an object: { "<Family>": { "files": [{ "file": "<in the site\'s assets/>", "weight": "400" or "100 900", "style": "normal" or "italic" }], "display": "swap", "licence": "…" } }';
    if (!fonts || typeof fonts !== 'object' || Array.isArray(fonts)) return shape;
    for (const [family, v] of Object.entries(fonts as Record<string, unknown>)) {
      if (!/^[A-Za-z0-9 .'-]{1,60}$/.test(family)) return `"${family}" can't be a font's name: letters, digits, spaces and . ' -`;
      const f = v as { files?: unknown; display?: unknown; licence?: unknown };
      if (!f || typeof f !== 'object' || !Array.isArray(f.files) || !f.files.length) return `${family}: ${shape}`;
      for (const x of f.files as { file?: unknown; weight?: unknown; style?: unknown }[]) {
        if (typeof x?.file !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.(woff2|woff|ttf|otf)$/i.test(x.file)) return `${family}: a font file is a name in the site's assets/ ending in .woff2, .woff, .ttf or .otf`;
        if (typeof x.weight !== 'string' || !/^\d{3}( \d{3})?$/.test(x.weight)) return `${family}: the weight of ${x.file} is "400", or a range for a variable font, "100 900"`;
        if (x.style !== 'normal' && x.style !== 'italic') return `${family}: the style of ${x.file} is "normal" or "italic"`;
      }
      if (f.display !== undefined && !['auto', 'block', 'swap', 'fallback', 'optional'].includes(f.display as string)) return `${family}: display is auto, block, swap, fallback or optional`;
      if (f.licence !== undefined && typeof f.licence !== 'string') return `${family}: the licence is text, such as "SIL OFL 1.1"`;
    }
  }
  if (kind === 'tags') {
    let tags: unknown;
    try {
      tags = JSON.parse(text);
    } catch {
      return 'kit/tags.json is not JSON';
    }
    if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return 'kit/tags.json is an object: { "<tag>": { "label": "…", "description": "…" } }';
    for (const [t, v] of Object.entries(tags as Record<string, unknown>)) {
      if (!/^[a-z][a-z0-9-]{0,30}$/.test(t)) return `"${t}" can't be a tag: lowercase letters, digits and -, starting with a letter`;
      if (LIBRARY_TAGS.has(t)) return `"${t}" is one of TYKERF's own tags; choose another name`;
      if (!v || typeof v !== 'object' || typeof (v as { label?: unknown }).label !== 'string') return `the tag "${t}" needs a label`;
    }
  }
  return null;
}

/**
 * What may not work in a kit file that can still be saved, or null. A shared block that uses a page's own
 * file (assets/<file>) shows it only on the page that has it: on every page it should be the site's (/assets/<file>).
 */
export function kitWarning(kind: KitKind, name: string, text: string): string | null {
  if (kind !== 'blocks') return null;
  const files = pageFileRefs(text);
  if (!files.length) return null;
  return `${name}: ${files.map((f) => `assets/${f}`).join(', ')} ${files.length === 1 ? 'is a page\'s file' : 'are a page\'s files'}, so ${files.length === 1 ? 'it shows' : 'they show'} only on that page; a shared block uses the site's files: put ${files.length === 1 ? 'it' : 'them'} in the site's assets/ and write ${files.map((f) => `/assets/${f}`).join(', ')}`;
}

/**
 * Create, replace (text) or remove (null) a kit file: one step of the site's history. Returns the step's
 * time, or null when the file didn't change.
 */
export function kitWrite(dir: string, kind: KitKind, name: string, text: string | null, label?: string, author = 'user'): string | null {
  const path = kitPath(kind, name);
  if (text !== null) {
    const err = kitError(kind, name, text);
    if (err) throw new Error(err);
  }
  const s = store(dir);
  if (kind === 'styles') hashes.delete(s.location); // (the files' times also tell; a same-size edit in the same millisecond might not)
  if (kind === 'fonts') return writeFonts(dir, text, label, author);
  return s.lock(() => {
    const prev = s.read(path);
    return new SiteHistory(dir).change('kit', path, text, label ?? `${text === null ? 'remove' : prev === null ? 'add' : 'edit'} kit/${path.slice(4)}`, author);
  });
}

/**
 * Change the site's fonts (kit/fonts.json): its files must be in the site's assets/. The site head's fonts block
 * follows (withFonts), in the same step of the site's history.
 */
function writeFonts(dir: string, text: string | null, label: string | undefined, author: string): string | null {
  const s = store(dir);
  const registry: FontRegistry = text === null ? {} : JSON.parse(text);
  const missing = Object.values(registry).flatMap((f) => f.files.map((x) => x.file)).filter((file) => !s.exists(`assets/${file}`));
  if (missing.length) throw new Error(`${missing.map((f) => `assets/${f}`).join(', ')} ${missing.length === 1 ? 'is' : 'are'} not in the site's assets/: put the font's files there first`);
  const history = new SiteHistory(dir);
  return history.group(label ?? 'the site\'s fonts', author, () => {
    const at = history.change('kit', 'kit/fonts.json', text, label ?? `${text === null ? 'remove' : s.exists('kit/fonts.json') ? 'edit' : 'add'} kit/fonts.json`, author);
    const head = s.read('head.html');
    if (head !== null) history.change('head', 'head.html', withFonts(s, head, '/assets/', registry), 'the site\'s fonts block', author);
    return at;
  });
}

/**
 * The kit's behaviours that came from the library (library/behaviours/): 'same' while the site's copy is the
 * library's, 'changed' when they differ (the library's was updated, or the copy edited); the manager offers to
 * take the library's again.
 */
export function kitLibraryScripts(dir: string): Record<string, 'same' | 'changed'> {
  const out: Record<string, 'same' | 'changed'> = {};
  for (const name of kitList(dir).scripts) {
    const lib = behaviourCode(name);
    if (lib !== null) out[name] = kitRead(dir, 'scripts', name) === lib ? 'same' : 'changed';
  }
  return out;
}

/** The fonts the site registers (kit/fonts.json), by family; {} when there are none or the file is broken. */
export function kitFonts(dir: string): FontRegistry {
  const raw = kitRead(dir, 'fonts');
  return raw && !kitError('fonts', 'fonts', raw) ? JSON.parse(raw) : {};
}

/** The last change to the kit (in the site's history), or null. */
export function lastKitChange(dir: string): { label: string; at: string; author?: string } | null {
  const e = new SiteHistory(dir).last('kit');
  return e && { label: e.label, at: e.at, author: e.author };
}

/**
 * Undo the site's last step; its label, or null when there's nothing to undo.
 * @deprecated the site has one history now: use new Site(dir).undo(). Kept for one release.
 */
export function undoKit(dir: string): string | null {
  const h = new SiteHistory(dir);
  return h.peekUndo() ? h.undo() : null;
}

/** The site's own tags, from kit/tags.json ({} when there are none or the file is broken). */
export function kitTags(dir: string): Record<string, { label: string; description?: string }> {
  const raw = kitRead(dir, 'tags');
  if (!raw || kitError('tags', 'tags', raw)) return {};
  return JSON.parse(raw);
}

/** The site's box types, from kit/types/ (a broken file is left out; the manager shows why). */
export function kitTypes(dir: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of kitList(dir).types) {
    const raw = kitRead(dir, 'types', name) ?? '';
    if (!kitError('types', name, raw)) out[name] = JSON.parse(raw);
  }
  return out;
}

/**
 * The kit's styles for a class: a styles file whose code starts with @scope (.k-<its name>) applies to any element
 * with the class k-<name>, on any page (a box takes it whole with the tag #k-<name>). Their names, sorted.
 */
export function kitClasses(dir: string): string[] {
  return kitList(dir).styles.filter((n) => classOf(kitRead(dir, 'styles', n) ?? '') === `k-${n}`);
}

/** The class a style is scoped to when it is a style for a class (@scope (.k-…) first), else null. */
export function classOf(css: string): string | null {
  return /^(?:\s|\/\*[\s\S]*?\*\/)*@scope\s*\(\s*\.(k-[a-z0-9][a-z0-9-]*)\s*\)/.exec(css)?.[1] ?? null;
}

/** The site's styles as one stylesheet, in file-name order, each after a comment naming its file; '' without any. */
export function kitCSS(dir: string): string {
  const files = kitList(dir).styles;
  if (!files.length) return '';
  // in the kit's cascade layer (render.ts LAYERS): above the theme, below a page's head and a box's own styles
  return `@layer kit {\n${files.map((n) => `/* kit/styles/${n}.css */\n${kitRead(dir, 'styles', n) ?? ''}`).join('\n')}\n}\n`;
}

// the stylesheet's hash by site, with the files' times and sizes it was made from: a change by anyone (this
// process, Kaity's MCP process, an undo) changes those, so the hash is made again only then
const hashes = new Map<string, { stamp: string; hash: string }>();

/** A short hash of the site's stylesheet (kitCSS), for its address (/kit/site.css?v=<hash>); '' without styles. */
export function kitStylesHash(dir: string): string {
  const s = store(dir);
  const files = kitList(dir).styles;
  if (!files.length) return '';
  // (a store that can't tell a file's time, as one in memory, makes it again each time: its files are few and near)
  const stamp = s.stamp ? files.map((n) => `${n}=${s.stamp!(kitPath('styles', n))}`).join('|') : null;
  const known = hashes.get(s.location);
  if (stamp !== null && known?.stamp === stamp) return known.hash;
  const hash = createHash('sha1').update(kitCSS(dir)).digest('hex').slice(0, 12);
  if (stamp !== null) hashes.set(s.location, { stamp, hash });
  return hash;
}

/** The link every page of the site gets to its stylesheet (/kit/site.css, cached by its hash); '' without styles. */
export function kitStyles(dir: string): string {
  const hash = kitStylesHash(dir);
  return hash ? `<link rel="stylesheet" href="/kit/site.css?v=${hash}" data-tykerf-kit>\n` : '';
}

/** The site's styles inlined, for an export that wants no extra request (ExportOptions.inlineKit); '' without any. */
export function kitStylesInline(dir: string): string {
  const css = kitCSS(dir);
  return css ? `<style data-tykerf-kit>\n${css.replace(/<\/style/gi, '')}\n</style>\n` : '';
}

/**
 * The behaviours' loader, served at /kit/loader.js. It runs each behaviour once per element marked
 * data-use="<name>", loads only the modules a page uses, and runs again when the editor re-renders
 * the page (the tykerf:render event), first undoing what ran on elements that are gone.
 */
export const KIT_LOADER = `// TYKERF site kit: runs kit/scripts/<name>.js for each element with data-use="<name>"
const running = new Map();
async function run() {
  for (const [el, stops] of running) if (!el.isConnected) { for (const stop of stops) try { stop(); } catch {} running.delete(el); }
  for (const el of document.querySelectorAll('[data-use]')) {
    if (running.has(el)) continue;
    const stops = [];
    running.set(el, stops);
    for (const name of el.getAttribute('data-use').split(/\\s+/)) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) continue;
      import(new URL('./scripts/' + name + '.js', import.meta.url).href)
        .then((m) => { const stop = typeof m.default === 'function' ? m.default(el) : null; if (typeof stop === 'function') stops.push(stop); })
        .catch((e) => {
          console.warn('kit behaviour "' + name + '" failed on', el, e);
          // the editor shows it (tykerf.js): a behaviour that fails, fails on every page that uses it; kept too,
          // for an editor that starts listening later
          const detail = { name, message: String(e && e.message || e) };
          (window.tykerfBehaviourErrors = window.tykerfBehaviourErrors || []).push(detail);
          dispatchEvent(new CustomEvent('tykerf:behaviour-error', { detail }));
        });
    }
  }
}
document.addEventListener('tykerf:render', run);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
`;

/** The <script> every page of a site with behaviours gets; '' without any. */
export function kitLoaderTag(dir: string): string {
  return kitList(dir).scripts.length ? '<script type="module" src="/kit/loader.js"></script>\n' : '';
}

/** A shared block's code (kit/blocks/<name>.html), or null. */
export function kitBlock(dir: string, name: string): string | null {
  return KIT_NAME.test(name) ? kitRead(dir, 'blocks', name) : null;
}

/**
 * A shared block's code without its current-page marks (aria-current="page", "true" or bare, on any element;
 * other values such as "step" mean something else and stay). The renderer marks each page's own link
 * (markCurrentPage), so a block keeps none: two pages' copies of one navigation differ only by them.
 * Tags only: a style's a[aria-current] selector and a script are left as they are.
 */
export function unmarkCurrentPage(code: string): string {
  return code.replace(/<(style|script)\b[\s\S]*?<\/\1\s*>|<[a-z][^>]*>/gi, (tag, inside?: string) =>
    inside ? tag : tag.replace(/\s+aria-current(?:\s*=\s*(?:"(?:page|true)?"|'(?:page|true)?'|page|true))?(?=[\s/>])/gi, ''));
}

/**
 * Mark the links to the page being rendered in a shared block (aria-current="page"), so a site menu shows
 * where you are: /<page>/ (also without the slash, or with index.html) and, on the site's home page, / and
 * /index.html. The block's own marks go first, so only this page's links are marked.
 */
export function markCurrentPage(code: string, page: string | undefined, home = false): string {
  const plain = unmarkCurrentPage(code);
  if (!page) return plain;
  const here = [`/${page.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?(?:index\\.html)?`, ...(home ? ['/', '/index\\.html'] : [])];
  return plain.replace(new RegExp(`(<a\\b[^>]*\\bhref\\s*=\\s*["'](?:${here.join('|')})["'])`, 'gi'), '$1 aria-current="page"');
}

// ---------- slots: a shared block differs per page through its box's own code ----------
// In a block, an element with data-slot="<name>" is a slot; its content is the fallback. A page that shows the
// block fills a slot with <template data-slot="<name>">…</template> in its box's own file (boxes/<id>.html).
// Plain text and regular expressions, no DOM: the same on the server and in tests.

export const SLOT_NAME = /^[a-z][a-z0-9-]*$/;
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** Where an element's content ends: the index of its matching close tag, counting nested elements of the same name. */
function closeOf(html: string, tag: string, from: number): number {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = from;
  let depth = 1;
  for (let m: RegExpExecArray | null; (m = re.exec(html)); ) {
    if (m[1]) depth--;
    else if (!m[0].endsWith('/>')) depth++;
    if (!depth) return m.index;
  }
  return -1;
}

/**
 * The slot elements of some HTML, in order: name, and where their content starts and ends. With `tagFilter`, only
 * elements of that tag (a page's <template>s); without, every slot element but templates (a block's, a page's code).
 */
function slotSpans(html: string, tagFilter?: string): { name: string; start: number; end: number; after: number }[] {
  const out: { name: string; start: number; end: number; after: number }[] = [];
  const open = /<([a-z][a-z0-9-]*)\b[^>]*?\bdata-slot\s*=\s*(["'])([^"']*)\2[^>]*>/gi;
  for (let m: RegExpExecArray | null; (m = open.exec(html)); ) {
    const tag = m[1].toLowerCase();
    if ((tagFilter ? tag !== tagFilter : tag === 'template') || VOID.has(tag) || m[0].endsWith('/>') || !SLOT_NAME.test(m[3])) continue;
    const start = m.index + m[0].length;
    const end = closeOf(html, tag, start);
    if (end < 0) continue;
    out.push({ name: m[3], start, end, after: html.indexOf('>', end) + 1 });
    open.lastIndex = html.indexOf('>', end) + 1; // a slot inside a slot is part of its content
  }
  return out;
}

/** A block's slots, in order: name and fallback (the element's content). The first of a name counts. */
export function blockSlots(block: string): { name: string; fallback: string }[] {
  const seen = new Set<string>();
  return slotSpans(block).filter((s) => !seen.has(s.name) && seen.add(s.name)).map((s) => ({ name: s.name, fallback: block.slice(s.start, s.end) }));
}

/** The slots a box's own file fills: { name: content } from its <template data-slot="name"> elements. */
export function slotValues(own: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of slotSpans(own, 'template')) if (!(s.name in out)) out[s.name] = own.slice(s.start, s.end);
  return out;
}

/** The content of each slot element in some HTML (a page's code as it shows the block): { name: content }. */
export function slotContents(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of slotSpans(html)) if (!(s.name in out)) out[s.name] = html.slice(s.start, s.end);
  return out;
}

/** Some HTML with its slot elements' content replaced: `value(name)` gives the new content, or null to keep it. */
function replaceSlots(html: string, value: (name: string) => string | null, tagFilter?: string): string {
  let out = '', at = 0;
  for (const s of slotSpans(html, tagFilter)) {
    const v = value(s.name);
    if (v === null) continue;
    out += html.slice(at, s.start) + v;
    at = s.end;
  }
  return out + html.slice(at);
}

/** A block as a page shows it: each slot the page fills (`own`'s templates) in place of its fallback. */
export function fillSlots(block: string, own: string): string {
  const values = slotValues(own);
  return Object.keys(values).length ? replaceSlots(block, (n) => (Object.hasOwn(values, n) ? values[n] : null)) : block;
}

/** A page's code for a block, with every slot back to the block's fallback: what the block itself is. */
export function unfillSlots(html: string, block: string): string {
  const fallback = Object.fromEntries(blockSlots(block).map((s) => [s.name, s.fallback]));
  return replaceSlots(html, (n) => (Object.hasOwn(fallback, n) ? fallback[n] : null));
}

/**
 * A box's own file with these slots filled (a value) or back to the fallback (null): the other templates and
 * anything else in the file stay. Templates are written one per line, in name order.
 */
export function withSlotValues(own: string, values: Record<string, string | null>): string {
  const merged = { ...slotValues(own), ...values };
  // what isn't a slot template (an older page's copy of the block, say) stays as it was
  let rest = '', at = 0;
  for (const s of slotSpans(own, 'template')) {
    const begin = own.lastIndexOf('<', s.start - 1);
    rest += own.slice(at, begin);
    at = s.after;
  }
  rest = (rest + own.slice(at)).trim();
  const templates = Object.keys(merged).sort().filter((n) => merged[n] !== null && SLOT_NAME.test(n)).map((n) => `<template data-slot="${n}">${merged[n]}</template>`);
  return [rest, ...templates].filter(Boolean).join('\n');
}
