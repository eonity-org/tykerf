// The site's shared head: one theme for every page, and its code (Head code: meta tags, scripts; styles are the kit's).

import { hasTheme, theme, themes, withFonts, withPresetName, withThemeValues } from '../library.js';
import { NO_SITE_HEAD } from '../workspace.js';
import { sitePages } from './pages.js';
import { pageWorkspace } from './index.js';
import { SiteHistory, siteStore } from './history.js';
import { kitFonts, kitRead, kitWrite } from '../kit.js';

// ---------- the site's shared head: one theme for every page ----------
// <site>/head.html comes before each page's own head.html, so a page can still add or override
// styles. Its fonts live in the site's assets/, which the editor and an export serve at /assets/.
// Each change is a step of the site's history (history.ts).

export const SITE_HEAD = 'head.html';

/** The head every page of the site shares ('' when the site has none). */
export function siteHead(dir: string): string {
  return siteStore(dir).read(SITE_HEAD) ?? '';
}


/** Replace the site's shared head (its fonts come along): one step of the site's history. */
export function setSiteHead(dir: string, html: string, label = 'edit the site theme', author = 'user') {
  const store = siteStore(dir);
  store.lock(() => new SiteHistory(dir).change('head', SITE_HEAD, withFonts(store, html, '/assets/', kitFonts(dir)), label, author));
}

/** The last change to the site's head (in the site's history), or null. */
export function lastSiteHeadChange(dir: string): { label: string; at: string; author: string } | null {
  const e = new SiteHistory(dir).last('head');
  return e && { label: e.label, at: e.at, author: e.author };
}

// The site head's own code: what the person writes for every page (styles, scripts, meta tags), apart from
// the theme and fonts blocks TYKERF keeps (they change in the Page tab, through the theme).
const KEPT = /(?:<!-- TYKERF theme:[\s\S]*?-->|<style\b[^>]*\bdata-tykerf-(?:theme|fonts)\b[^>]*>[\s\S]*?<\/style>)\s*/gi;

/** The site head without its theme and fonts blocks. */
export function siteCode(dir: string): string {
  return siteHead(dir).replace(KEPT, '').trim();
}

/** The <style> blocks of some head code, each with what follows it up to the next tag. */
const STYLE_BLOCK = /<style\b[^>]*>[\s\S]*?<\/style>\s*/gi;

/** The <style> blocks of the site head's own code (Head code): the kit's styles are the place for them now. */
export function headStyles(dir: string): string[] {
  return (siteCode(dir).match(STYLE_BLOCK) ?? []).map((b) => b.trim());
}

/**
 * Replace the site head's own code, keeping its theme and fonts blocks; one step of the site's history. A new
 * <style> is refused: styles for every page are the kit's (kit/styles). The ones it already has may stay, until
 * migrateHeadStyles moves them.
 */
export function setSiteCode(dir: string, code: string) {
  if (new RegExp(KEPT.source, 'i').test(code)) throw new Error('the theme and its fonts are changed in the Page tab, not here; leave them out of this code');
  const had = new Set(headStyles(dir));
  if ((code.match(STYLE_BLOCK) ?? []).some((b) => !had.has(b.trim()))) throw new Error('styles for every page go in the site kit (kit/styles); keep only what isn\'t CSS here: meta tags, scripts, a stylesheet link');
  writeSiteCode(dir, code);
}

function writeSiteCode(dir: string, code: string, label = 'edit the head code of every page') {
  const kept = (siteHead(dir).match(KEPT) ?? []).map((b) => b.trim()).join('\n');
  setSiteHead(dir, [kept, code.trim()].filter(Boolean).join('\n') + '\n', label);
}

/**
 * Move the <style> blocks of the site head's code to the kit: kit/styles/head.css (after what it has, each with a
 * comment saying where it came from), and out of the head. One step of the site's history. Returns how many moved.
 */
export function migrateHeadStyles(dir: string, author = 'user'): number {
  const blocks = headStyles(dir);
  if (!blocks.length) return 0;
  const css = blocks.map((b) => {
    const [, attrs, inner] = /<style\b([^>]*)>([\s\S]*?)<\/style>/i.exec(b)!;
    const media = /\bmedia\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    // a style for some media only keeps that condition
    return `/* from the site head's code${attrs.trim() ? `: <style ${attrs.trim()}>` : ''} */\n${media && media !== 'all' ? `@media ${media} {\n${inner.trim()}\n}` : inner.trim()}`;
  }).join('\n\n');
  new SiteHistory(dir).group(`move ${blocks.length} ${blocks.length === 1 ? 'style' : 'styles'} from the head code to the kit`, author, () => {
    const before = kitRead(dir, 'styles', 'head');
    kitWrite(dir, 'styles', 'head', `${before ? `${before.trimEnd()}\n\n` : ''}${css}\n`, undefined, author);
    writeSiteCode(dir, siteCode(dir).replace(STYLE_BLOCK, '').trim(), 'move the head code\'s styles to the kit');
  });
  return blocks.length;
}

/**
 * Undo the site's last step (the head's, the kit's or the settings': the site has one history). Returns its label.
 * @deprecated the site has one history now: use new Site(dir).undo(). Kept for one release.
 */
export function undoSiteHead(dir: string): string {
  return new SiteHistory(dir).undo();
}

/** A new site's theme: the full theme with a preset's values, shared by every page. */
export function startSiteTheme(dir: string, themeName: string) {
  const p = themes().find((t) => t.name === themeName) ?? themes()[0];
  setSiteHead(dir, withPresetName(withThemeValues(theme(), p.values).head, p.name), `site theme ${p.name}`);
}

const THEME_PARTS = /<!-- TYKERF theme[^>]*-->\n?|<style[^>]*\bdata-tykerf-(?:theme|fonts)\b[^>]*>[\s\S]*?<\/style>\n?/g;

/**
 * Make one page's theme the theme of every page: it becomes the site's shared head, and the pages'
 * own theme blocks are removed (each one undo step in that page). Pages that keep their own look
 * (imported copies) are left alone. Returns the pages that changed.
 */
export function shareTheme(dir: string, from: string, author = 'user'): string[] {
  const src = pageWorkspace(dir, from);
  const blocks = src.head().match(THEME_PARTS)?.filter((b) => !b.includes('data-tykerf-fonts')) ?? [];
  if (!blocks.some((b) => b.includes('data-tykerf-theme'))) throw new Error(`the page "${from}" has no theme of its own to share`);
  setSiteHead(dir, blocks.join(''), `use the theme of ${from} for every page`, author);
  const changed: string[] = [];
  for (const page of sitePages(dir)) {
    const ws = pageWorkspace(dir, page);
    const head = ws.head();
    if (head.includes(NO_SITE_HEAD) || !hasTheme(head)) continue;
    ws.transaction(() => ws.setHead(head.replace(THEME_PARTS, ''), author, 'the theme is now the site\'s'));
    changed.push(page);
  }
  return changed;
}

/** The pages with a theme of their own (an older site's, or one the site doesn't share yet), not counting copies of websites. */
export function pagesWithOwnTheme(dir: string): string[] {
  return sitePages(dir).filter((p) => {
    try {
      const head = pageWorkspace(dir, p).head();
      return hasTheme(head) && !head.includes(NO_SITE_HEAD);
    } catch {
      return false;
    }
  });
}
