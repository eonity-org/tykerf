// One check for a whole site: what a page's check (check.ts) can't see from one page, and what every page has
// left that matters before publishing. People see it in the site manager (Check the site), Kaity through MCP
// check_site, and an export or Publish in its report.

import { unmarkCurrentPage, kitFonts, kitList, kitRead } from './kit.js';
import { missingFiles } from './check.js';
import { pageFileRefs } from './assets.js';
import { remoteLoads } from './export.js';
import { derivedTitle, pageLinks, pageTitle, pageWorkspace, readSite, siteFileRefs, siteMedia, sitePages } from './site.js';
import { siteStore } from './site/history.js';
import { walk } from './model.js';

export type SiteFindingKind = 'link' | 'file' | 'orphan' | 'title' | 'shared-file' | 'copy' | 'font' | 'alt' | 'lang' | 'remote';

export interface SiteFinding {
  kind: SiteFindingKind;
  page?: string;
  box?: string;
  /** What is wrong, in a sentence. */
  detail: string;
  /** What to do about it, naming the tool when there is one. */
  fix?: string;
}

/** The kinds in the order they are told, with a heading each. */
export const FINDING_KINDS: [SiteFindingKind, string][] = [
  ['link', 'links to pages the site doesn\'t have'], ['file', 'files that aren\'t there'], ['shared-file', 'shared blocks using a page\'s file'],
  ['alt', 'pictures without alt text'], ['title', 'page titles'], ['orphan', 'pages no other page links to'], ['copy', 'copies of a shared block'],
  ['font', 'fonts without a licence noted'], ['remote', 'files loaded from other servers'], ['lang', 'the site\'s language'],
];

/** Pictures without a text alternative: no alt at all, or alt="" on a picture that isn't decoration or a link's. */
function picturesWithoutAlt(html: string): string[] {
  const out: string[] = [];
  // the parts of the code inside a link that has words of its own: a picture there may have alt=""
  const linked = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].filter((m) => m[1].replace(/<[^>]*>/g, '').trim()).map((m) => [m.index!, m.index! + m[0].length]);
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = /\bsrc\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? '?';
    const alt = /\balt\s*=\s*(["'])(.*?)\1/i.exec(tag);
    if (!alt) out.push(src);
    else if (!alt[2].trim() && !/\brole\s*=\s*["']presentation["']|\baria-hidden\s*=\s*["']true["']/i.test(tag) && !linked.some(([a, b]) => m.index! > a && m.index! < b)) out.push(src);
  }
  return out;
}

/** Everything the site should look at before it is published, page by page. */
export function checkSite(dir: string): SiteFinding[] {
  const out: SiteFinding[] = [];
  const pages = sitePages(dir);
  const settings = readSite(dir);
  const site = siteStore(dir);
  const siteFiles = new Set(siteMedia(dir).filter((f) => f.where === 'site').map((f) => f.file));

  // links between pages, and the pages no other page links to
  const links = pageLinks(dir);
  for (const l of links.filter((x) => x.broken)) out.push({ kind: 'link', page: l.page, ...(l.box ? { box: l.box } : {}), detail: `the link ${l.href} goes to "${l.to}", a page the site doesn't have`, fix: 'point it at one of the site\'s pages (list_pages), or make that page (new_page)' });
  const linkedTo = new Set(links.filter((l) => !l.broken && l.to !== l.page).map((l) => l.to));
  for (const p of pages) if (p !== settings.home && !linkedTo.has(p)) out.push({ kind: 'orphan', page: p, detail: 'no other page links to it: visitors reach it only from the list of pages or a search', fix: 'link to it from the navigation (the shared block nav), or from a page about it' });

  // titles: computed once for every page
  const titles = new Map(pages.map((p) => [p, pageTitle(dir, p, settings)]));
  const derived = new Map(pages.filter((p) => !settings.titles[p]).map((p) => [p, derivedTitle(dir, p)]));
  for (const p of pages) {
    const title = titles.get(p)!;
    // a title from its heading that another page has too (a copy, a shared banner)
    const twin = derived.has(p) ? pages.find((o) => o !== p && titles.get(o) === title) : undefined;
    if (twin) out.push({ kind: 'title', page: p, detail: `its title "${title}" is ${twin}'s too`, fix: `set_title page ${p}` });
    else if (derived.get(p) === p) out.push({ kind: 'title', page: p, detail: `it has no title and no heading: its name, "${p}", stands in`, fix: `set_title page ${p}` });
    else if (title.length > 70) out.push({ kind: 'title', page: p, detail: `its title is ${title.length} characters ("${title.slice(0, 40)}…"); search results show about 60`, fix: `set_title page ${p}, shorter` });
  }

  // the kit: shared blocks using a page's file, and the site's files its code names that aren't there
  const kit = kitList(dir);
  const blocks = new Map(kit.blocks.map((b) => [b, kitRead(dir, 'blocks', b) ?? '']));
  for (const [b, code] of blocks) for (const f of pageFileRefs(code)) out.push({ kind: 'shared-file', detail: `the shared block ${b} uses assets/${f}, a page's file, so pages at other addresses show it broken`, fix: `add_file to the site, and write /assets/${f} in the block` });
  for (const [where, code] of [...[...blocks].map(([b, c]) => [`the shared block ${b}`, c]), ...kit.styles.map((s) => [`the kit style ${s}`, kitRead(dir, 'styles', s) ?? '']), ['the site\'s head', site.read('head.html') ?? '']] as [string, string][]) {
    for (const f of siteFileRefs(code)) if (!siteFiles.has(f)) out.push({ kind: 'file', detail: `${where} uses /assets/${f}, which the site's files don't have`, fix: `add_file to the site as ${f}` });
  }
  for (const [family, f] of Object.entries(kitFonts(dir))) if (!f.licence?.trim()) out.push({ kind: 'font', detail: `the font "${family}" has no licence noted`, fix: 'note its licence in the kit\'s Fonts (kit/fonts.json), once you know the site may publish it' });

  // each page: its files, its pictures' alt text, own copies of a shared block, what it loads from elsewhere
  for (const p of pages) {
    const ws = pageWorkspace(dir, p);
    const l = ws.load();
    const shown = ws.contents();
    walk(l.root, (n) => {
      if (n.type !== 'leaf') return;
      const code = shown[n.id] ?? '';
      for (const ref of missingFiles(ws, code)) out.push({ kind: 'file', page: p, box: n.id, detail: `${ref} is not one of the files, so it shows broken`, fix: `add_file brings it in (the ${ref.startsWith('/') ? 'site' : 'page'}'s)` });
      if (!n.use) for (const src of picturesWithoutAlt(code)) out.push({ kind: 'alt', page: p, box: n.id, detail: `a picture (${src}) has no text alternative`, fix: 'write what it shows in alt, or role="presentation" when it is only decoration' });
      // a box named like a shared block, with the block's code as it is: it could follow the block
      const block = !n.use ? blocks.get(n.id) : undefined;
      if (block !== undefined && unmarkCurrentPage(ws.ownContent(n.id) ?? '').replace(/\s+/g, ' ').trim() === unmarkCurrentPage(block).replace(/\s+/g, ' ').trim()) {
        out.push({ kind: 'copy', page: p, box: n.id, detail: `its own copy of the shared block ${n.id} is the same as the block`, fix: `link_block ${n.id} ${n.id}, so it follows the block` });
      }
    });
    for (const url of remoteLoads(ws.page())) out.push({ kind: 'remote', page: p, detail: `it loads ${url} from another server, which sees every visitor's address`, fix: 'add_file brings it into the site, then point the page at it' });
  }
  // the shared blocks' pictures, once (not on every page that shows them)
  for (const [b, code] of blocks) for (const src of picturesWithoutAlt(code)) out.push({ kind: 'alt', detail: `the shared block ${b} has a picture (${src}) without a text alternative`, fix: `write what it shows in its alt (set_kit_file blocks ${b})` });

  // the site's language: English unless someone said otherwise
  let langSet = false;
  try {
    langSet = typeof JSON.parse(site.read('site.json') ?? '{}').lang === 'string';
  } catch {}
  if (!langSet && pages.length) out.push({ kind: 'lang', detail: 'the site\'s language was never set, so every page says it is English', fix: 'set_site lang (es, en, pt-BR…), even for English' });

  const order = new Map(FINDING_KINDS.map(([k], i) => [k, i]));
  return out.sort((a, b) => order.get(a.kind)! - order.get(b.kind)!);
}

/** How many findings of each kind, for a report: { link: 2, alt: 5 } (none: {}). */
export function findingCounts(findings: SiteFinding[]): Partial<Record<SiteFindingKind, number>> {
  const out: Partial<Record<SiteFindingKind, number>> = {};
  for (const f of findings) out[f.kind] = (out[f.kind] ?? 0) + 1;
  return out;
}

/** The findings as text, counts first, then grouped by kind. */
export function sayFindings(findings: SiteFinding[]): string {
  if (!findings.length) return 'the site has nothing to fix';
  const counts = findingCounts(findings);
  const lines = [`${findings.length} things to look at: ${FINDING_KINDS.filter(([k]) => counts[k]).map(([k, h]) => `${counts[k]} ${h}`).join(', ')}`];
  for (const [k, heading] of FINDING_KINDS) {
    const of = findings.filter((f) => f.kind === k);
    if (!of.length) continue;
    lines.push('', `${heading} (${of.length}):`);
    for (const f of of) lines.push(`- ${f.page ? `${f.page}${f.box ? `/${f.box}` : ''}: ` : ''}${f.detail}${f.fix ? ` → ${f.fix}` : ''}`);
  }
  return lines.join('\n');
}
