// The site's icon (favicon).

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readTheme } from '../library.js';
import { Workspace } from '../workspace.js';
import { sitePages } from './pages.js';
import { readSite } from './settings.js';
import { siteHead } from './head.js';

// ---------- the site's icon (favicon) ----------
// A site's icon is its own file at the site's root (favicon.svg, .png or .ico: uploaded in the site manager),
// or else one made from it: the home page's first letter on the theme's accent colour. It's served and
// exported at /favicon.<ext>, and every page links to it. TYKERF's own screens use TYKERF's mark instead.

const ICON_TYPES: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon' };
const OWN_ICONS = Object.keys(ICON_TYPES).map((ext) => `favicon.${ext}`);

/** Why an SVG can't be used as it is (scripts, event attributes, files from elsewhere), or null. */
export function unsafeSVG(code: string): string | null {
  if (!/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg\b[\s\S]*<\/svg>\s*$/i.test(code.trim())) return 'it is not SVG code, from <svg> to </svg>';
  if (/<script\b|<foreignObject\b|\son\w+\s*=|javascript:|\b(?:href|src)\s*=\s*["']\s*(?:[a-z]+:)?\/\//i.test(code))
    return 'it has scripts, event attributes, foreignObject or links to other files';
  return null;
}

/** A plain colour an SVG can use (the theme's may be var() or color-mix()), else the fallback. */
const plainColor = (v: string | undefined, fallback: string) => (v && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i.test(v.trim()) ? v.trim() : fallback);

/** The icon made from the site: its home page's first letter (else its first page's) on the theme's accent. */
export function madeIcon(dir: string): string {
  const s = readSite(dir);
  const pages = sitePages(dir);
  const page = s.home ?? pages[0];
  const letter = ((page ?? basename(dir)).match(/[a-z0-9]/i)?.[0] ?? 'T').toUpperCase();
  // the theme: the site's shared one, else the home page's own
  const theme = { ...(page ? readTheme(new Workspace(join(dir, page)).head()) : {}), ...readTheme(siteHead(dir)) };
  const bg = plainColor(theme['--color-accent'], '#0A5475');
  const fg = plainColor(theme['--color-on-accent'], '#ffffff');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${bg}"/>` +
    `<text x="32" y="45" text-anchor="middle" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-size="38" font-weight="700" fill="${fg}">${letter}</text></svg>\n`;
}

/** The site's icon: its own file, or the one made from it. */
export function siteIcon(dir: string): { file: string; type: string; bytes: Uint8Array; own: boolean } {
  for (const file of OWN_ICONS) {
    const p = join(dir, file);
    if (existsSync(p)) return { file, type: ICON_TYPES[file.split('.').pop()!], bytes: readFileSync(p), own: true };
  }
  return { file: 'favicon.svg', type: ICON_TYPES.svg, bytes: new TextEncoder().encode(madeIcon(dir)), own: false };
}

/** The link every page of the site gets to its icon (root-absolute: an export makes it relative). */
export function iconLink(dir: string): string {
  const { file, type } = siteIcon(dir);
  return `<link rel="icon" href="/${file}" type="${type}">\n`;
}

/** Give the site an icon of its own (SVG, PNG or ICO, up to 512 KB), or go back to the made one (null). */
export function setSiteIcon(dir: string, icon: { type: string; bytes: Uint8Array } | null) {
  if (icon) {
    const ext = Object.keys(ICON_TYPES).find((e) => ICON_TYPES[e] === icon.type || (e === 'ico' && icon.type === 'image/vnd.microsoft.icon'));
    if (!ext) throw new Error('the icon must be SVG, PNG or ICO');
    if (icon.bytes.length > 512 * 1024) throw new Error('the icon is larger than 512 KB');
    const b = icon.bytes;
    if (ext === 'png' && !(b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)) throw new Error('this file is not a PNG');
    if (ext === 'ico' && !(b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0)) throw new Error('this file is not an ICO');
    if (ext === 'svg') {
      const why = unsafeSVG(new TextDecoder().decode(b));
      if (why) throw new Error(`this SVG can't be the site's icon: ${why}`);
    }
    for (const f of OWN_ICONS) rmSync(join(dir, f), { force: true });
    writeFileSync(join(dir, `favicon.${ext}`), b);
  } else for (const f of OWN_ICONS) rmSync(join(dir, f), { force: true });
}
