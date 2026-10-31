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
// Every change keeps the file's previous version in .tykerf/kit.jsonl, for the manager's Undo.

import { FolderStore } from './store.js';
import { parseType } from './types.js';

export type KitKind = 'styles' | 'scripts' | 'blocks' | 'types' | 'tags';
export const KIT_KINDS: KitKind[] = ['styles', 'scripts', 'blocks', 'types', 'tags'];

/** File names in the kit: they become addresses (/kit/scripts/<name>.js) and data-use values. */
export const KIT_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
const EXT: Record<KitKind, string> = { styles: '.css', scripts: '.js', blocks: '.html', types: '.json', tags: '.json' };
const MAX = 400_000;
const HISTORY = '.tykerf/kit.jsonl';

/** Tags the library's theme already gives every page; the site's own tags can't take these names. */
const LIBRARY_TAGS = new Set(['tone-alt', 'tone-soft', 'tone-dark', 'dense', 'reverse', 'priority']);

const store = (dir: string) => new FolderStore(dir);

/** Where a kit file lives in the site folder. */
export function kitPath(kind: KitKind, name: string): string {
  if (kind === 'tags') return 'kit/tags.json';
  if (!KIT_KINDS.includes(kind)) throw new Error(`unknown kind of kit file "${kind}" (${KIT_KINDS.join(', ')})`);
  if (!KIT_NAME.test(name)) throw new Error(`"${name}" can't be a kit file name: lowercase letters, digits and -, up to 41`);
  return `kit/${kind}/${name}${EXT[kind]}`;
}

/** The kit's files, by kind, names without their extension (tags: whether kit/tags.json exists). */
export function kitList(dir: string): Record<Exclude<KitKind, 'tags'>, string[]> & { tags: boolean } {
  const s = store(dir);
  const names = (kind: Exclude<KitKind, 'tags'>) => s.list(`kit/${kind}`).filter((f) => f.endsWith(EXT[kind])).map((f) => f.slice(0, -EXT[kind].length)).filter((n) => KIT_NAME.test(n)).sort();
  return { styles: names('styles'), scripts: names('scripts'), blocks: names('blocks'), types: names('types'), tags: s.exists('kit/tags.json') };
}

export function kitRead(dir: string, kind: KitKind, name = 'tags'): string | null {
  return store(dir).read(kitPath(kind, name));
}

/** Why some text can't be this kit file, or null when it can. */
export function kitError(kind: KitKind, name: string, text: string): string | null {
  if (text.length > MAX) return `a kit file is at most ${MAX / 1000} KB`;
  if (kind === 'styles') {
    // nothing fetched from another server (it would send every visitor's address there), no way out of the <style>
    if (/@import/i.test(text)) return `${name}.css: no @import (put the other file in the kit too)`;
    if (/<\/style/i.test(text)) return `${name}.css: no </style> in CSS`;
    for (const m of text.matchAll(/url\(\s*["']?([^"')]+)/gi)) if (/^([a-z]+:|\/\/)/i.test(m[1].trim()) && !/^data:/i.test(m[1].trim())) return `${name}.css: url(${m[1].trim()}) loads from another server; put the file in the site's assets/ and write url(/assets/<file>)`;
  }
  if (kind === 'types') {
    try {
      parseType(text, `kit/types/${name}.json`);
    } catch (e) {
      return (e as Error).message;
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

/** Create, replace (text) or remove (null) a kit file, keeping the previous version for undo. */
export function kitWrite(dir: string, kind: KitKind, name: string, text: string | null, label?: string, author = 'user') {
  const path = kitPath(kind, name);
  if (text !== null) {
    const err = kitError(kind, name, text);
    if (err) throw new Error(err);
  }
  const s = store(dir);
  s.lock(() => {
    const prev = s.read(path);
    if (prev === text) return;
    s.append(HISTORY, JSON.stringify({ path, prev, label: label ?? `${text === null ? 'remove' : prev === null ? 'add' : 'edit'} kit/${path.slice(4)}`, author, at: new Date().toISOString() }) + '\n');
    if (text === null) s.remove(path);
    else s.write(path, text);
  });
}

/** The last change to the kit, or null. */
export function lastKitChange(dir: string): { label: string; at: string; author?: string } | null {
  const lines = (store(dir).read(HISTORY) ?? '').trim().split('\n').filter(Boolean);
  if (!lines.length) return null;
  const { label, at, author } = JSON.parse(lines.at(-1)!);
  return { label, at, author };
}

/** Undo the last kit change; its label, or null when there's nothing to undo. */
export function undoKit(dir: string): string | null {
  const s = store(dir);
  return s.lock(() => {
    const lines = (s.read(HISTORY) ?? '').trim().split('\n').filter(Boolean);
    if (!lines.length) return null;
    const e = JSON.parse(lines.pop()!) as { path: string; prev: string | null; label: string };
    if (e.prev === null) s.remove(e.path);
    else s.write(e.path, e.prev);
    s.write(HISTORY, lines.length ? `${lines.join('\n')}\n` : '');
    return e.label;
  });
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

/** The site's styles as one <style> for every page's head, in file-name order; '' without any. */
export function kitStyles(dir: string): string {
  const files = kitList(dir).styles;
  if (!files.length) return '';
  const css = files.map((n) => `/* kit/styles/${n}.css */\n${(kitRead(dir, 'styles', n) ?? '').replace(/<\/style/gi, '')}`).join('\n');
  return `<style data-tykerf-kit>\n${css}\n</style>\n`;
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
        .catch((e) => console.warn('kit behaviour "' + name + '":', e));
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

/** Mark the links to the page being rendered in a shared block (aria-current="page"), so a site menu shows where you are. */
export function markCurrentPage(code: string, page: string | undefined): string {
  if (!page) return code;
  const here = new RegExp(`(<a\\b(?![^>]*\\baria-current=)[^>]*\\bhref\\s*=\\s*["']/${page}/?(?:index\\.html)?["'])`, 'gi');
  return code.replace(here, '$1 aria-current="page"');
}
