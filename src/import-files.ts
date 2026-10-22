// The files a copied website loads from its servers (images, fonts, font stylesheets), brought into
// the copy's assets/ so the page stops loading them from there (importer.ts runs it on each copy).
//
// Only images and fonts, recognised by their bytes, are kept. An SVG is kept only when it carries no
// script or embedded content (an export serves it from the user's own site). Whatever can't be
// downloaded, or isn't one of those, stays linked; the export report lists it.

import { createHash } from 'node:crypto';
import { MAX_IMAGE_BYTES, imageType } from './assets.js';

/** Most a copy brings along, all files together. */
export const MAX_COPY_BYTES = 80 * 1024 * 1024;

/** Downloads one address (a stand-in in tests). */
export type Fetcher = (url: string, signal?: AbortSignal) => Promise<Uint8Array>;

const ascii = (b: Uint8Array, at: number, s: string) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));

/** The file extension of a font, from its first bytes. */
export function fontType(b: Uint8Array): 'woff2' | 'woff' | 'ttf' | 'otf' | 'eot' | null {
  if (b.length < 4) return null;
  if (ascii(b, 0, 'wOF2')) return 'woff2';
  if (ascii(b, 0, 'wOFF')) return 'woff';
  if (ascii(b, 0, 'OTTO')) return 'otf';
  if ((b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) || ascii(b, 0, 'true')) return 'ttf';
  if (b.length > 36 && b[34] === 0x4c && b[35] === 0x50) return 'eot'; // old Internet Explorer fonts, still listed by many sites
  return null;
}

/** An SVG with nothing in it that runs or loads other content. */
export function plainSVG(b: Uint8Array): boolean {
  const s = new TextDecoder().decode(b.subarray(0, 512 * 1024));
  return /<svg[\s>]/i.test(s) && !/<script|<foreignObject|<iframe|<embed|<object|\son[a-z]+\s*=|javascript:/i.test(s);
}

/** Where a downloaded file goes in assets/, or null when it isn't an image or a font. */
export function assetPath(b: Uint8Array, family?: string): string | null {
  const ext = imageType(b) ?? fontType(b) ?? (plainSVG(b) ? 'svg' : null);
  if (!ext) return null;
  // a font is named after its family when it has one (font-manrope-<hash>.woff2), so the folder reads
  const name = family?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  const kind = ['woff2', 'woff', 'ttf', 'otf', 'eot'].includes(ext) ? (name ? `font-${name}` : 'font') : 'img';
  return `assets/${kind}-${createHash('sha1').update(b).digest('hex').slice(0, 12)}.${ext}`;
}

/** The family of each font address in some CSS's @font-face rules. */
function fontFamilies(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [rule] of css.matchAll(/@font-face\s*\{[^}]*\}/gi)) {
    const family = /font-family\s*:\s*(["']?)([^;"'}]+)\1/i.exec(rule)?.[2].trim();
    if (family) for (const m of rule.matchAll(CSS_URL)) out.set(m[2], family);
  }
  return out;
}

const remote = (u: string) => /^https?:\/\//i.test(u);
const unescape = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// url(...) in CSS, and src/poster attributes in HTML
const CSS_URL = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;
const ATTR_URL = /\s(?:src|poster)\s*=\s*"([^"]+)"/gi;
const FONT_LINK = /<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/gi;

/** CSS with each url() made absolute against the stylesheet's own address. */
const absoluteCSS = (css: string, base: string) =>
  css.replace(CSS_URL, (all, _q, u) => {
    try {
      return /^data:/i.test(u) ? all : `url("${new URL(u, base).href}")`;
    } catch {
      return all;
    }
  });

/** Download with a browser's name (font services pick the format by it) and the page as referrer, within a size limit. */
export function webFetcher(page: string): Fetcher {
  return async (url, signal) => {
    const r = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', referer: page },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (Number(r.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) throw new Error('too large');
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('too large');
    return bytes;
  };
}

/** What a copy's code becomes with its files brought along. */
export interface CopiedFiles {
  /** each piece of code given, with remote addresses replaced by assets/… */
  code: string[];
  /** the new files, by their path in the page */
  files: Record<string, Uint8Array>;
  /** remote addresses that stay (couldn't be downloaded, or aren't images or fonts) */
  kept: string[];
}

/**
 * Bring the files some code loads into assets/. Font stylesheets linked with <link> become <style>
 * blocks first (their fonts then come along too). Addresses are matched exactly as they are written,
 * so everything a box, the head or a style rule loads is rewritten the same way.
 */
export async function copyFiles(code: string[], fetcher: Fetcher, opts: { signal?: AbortSignal; limit?: number } = {}): Promise<CopiedFiles> {
  const text = (b: Uint8Array) => new TextDecoder().decode(b);
  // 1. linked font stylesheets become inline <style> blocks with absolute url()s
  const sheets = new Map<string, string | null>();
  for (const c of code) for (const m of c.matchAll(FONT_LINK)) if (remote(unescape(m[1]))) sheets.set(unescape(m[1]), null);
  await Promise.all([...sheets.keys()].map(async (u) => {
    try {
      const css = text(await fetcher(u, opts.signal));
      if (!/<\/?(style|script)/i.test(css)) sheets.set(u, absoluteCSS(css, u));
    } catch { /* stays linked */ }
  }));
  code = code.map((c) => c.replace(FONT_LINK, (all, href) => {
    const css = sheets.get(unescape(href));
    return css ? `<style>\n${css.trim()}\n</style>` : all;
  }));

  // 2. every remote address, as written, and what it points to
  const written = new Map<string, string>(); // as written -> address
  for (const c of code) {
    for (const m of c.matchAll(CSS_URL)) if (remote(m[2])) written.set(m[2], m[2]);
    for (const m of c.matchAll(ATTR_URL)) if (remote(unescape(m[1]))) written.set(m[1], unescape(m[1]));
  }
  const urls = [...new Set(written.values())];
  const family = new Map<string, string>();
  for (const c of code) for (const [w, f] of fontFamilies(c)) family.set(written.get(w) ?? w, f);

  // 3. download them, a few at a time, within the total limit
  const limit = opts.limit ?? MAX_COPY_BYTES;
  const files: Record<string, Uint8Array> = {};
  const pathOf = new Map<string, string>();
  let total = 0, next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const u = urls[next++];
      if (opts.signal?.aborted) return;
      try {
        const bytes = await fetcher(u, opts.signal);
        const path = assetPath(bytes, family.get(u));
        if (!path || total + bytes.length > limit) continue;
        if (!files[path]) {
          files[path] = bytes;
          total += bytes.length;
        }
        pathOf.set(u, path);
      } catch { /* stays linked */ }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (opts.signal?.aborted) throw new Error('stopped');

  // 4. the code points at the copies
  const swap = (w: string) => pathOf.get(written.get(w) ?? w);
  code = code.map((c) =>
    c.replace(CSS_URL, (all, _q, u) => (swap(u) ? `url("${swap(u)}")` : all))
      .replace(ATTR_URL, (all, u) => (swap(u) ? all.replace(u, swap(u)!) : all)));
  const kept = urls.filter((u) => !pathOf.has(u));
  return { code, files, kept };
}

/** The new files some code refers to (for a part of a copy placed in a page). */
export function filesIn(code: string, files: Record<string, Uint8Array>): string[] {
  return Object.keys(files).filter((p) => code.includes(p));
}
