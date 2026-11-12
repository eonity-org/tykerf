// What a page still has to be finished: the placeholders that layouts and components bring (their
// sample text and pictures) and links without a real target. Kaity runs it on her own work
// (MCP check_page), and the editor runs it after each of her requests (editor/ai.ts), reporting only
// what that request left: what the person had left that way before is theirs.

import { find, isOp, walk } from './model.js';
import { derivedTitle, linkedPage, pageTitle, readSite, sitePages } from './site.js';
import { pageFileRefs } from './assets.js';
import { blockSlots, slotValues } from './kit.js';
import { componentCode, components } from './library.js';
import type { Workspace } from './workspace.js';

export interface Leftover {
  box: string;
  kind: 'text' | 'picture' | 'link' | 'missing' | 'block' | 'shared-file' | 'title' | 'slot';
  /**
   * What is left: the placeholder text, the picture's file, the address of a file that isn't there, the link's
   * address and words, (shared-file) the shared block's name and the page's file it uses ("nav logo.png"),
   * (title, on the page's top block) the page's title, or (slot) the shared block's name and a slot the page
   * fills that the block doesn't have ("banner subtitle").
   */
  detail: string;
  /** For a link: why it has no target. */
  why?: 'nowhere' | 'section' | 'page';
  /** For a link to a section: the address that works, when it names a block (`#faq` → `#sw-faq`, the block's own element). */
  target?: string;
  /** For a title: this page, and the other page that has the same title. */
  page?: string;
  other?: string;
}

/** One leftover as a stable key, to compare a page before and after a request and to remember what the person keeps. */
export const leftoverKey = (l: Leftover) => `${l.box}|${l.kind}|${l.detail}`;

/** One leftover in words, for the model and for the person. */
export function say(l: Leftover): string {
  if (l.kind === 'text') return `${l.box}: placeholder text "${l.detail}"`;
  if (l.kind === 'picture') return `${l.box}: a placeholder picture (${l.detail})`;
  if (l.kind === 'missing') return `${l.box}: ${l.detail} is not one of the page's files, so it shows broken`;
  if (l.kind === 'slot') {
    const [name, slot] = l.detail.split(' ');
    return `${l.box}: it fills the slot "${slot}", which the shared block ${name} doesn't have, so the page doesn't show it (set_slot fills one it has)`;
  }
  if (l.kind === 'title') return `${l.page}: its title "${l.detail}" is the same as ${l.other}'s; give it a title of its own (set_title)`;
  if (l.kind === 'shared-file') {
    const [name, ...file] = l.detail.split(' ');
    const f = file.join(' ');
    return `${l.box}: the shared block ${name} uses assets/${f}, a page's file; shared blocks use /assets/${f} (the site's)`;
  }
  if (l.kind === 'block') return `${l.box}: it shows the shared block "${l.detail}", which the site's kit doesn't have (kit/blocks/${l.detail}.html), so it shows its own code`;
  const [href, ...words] = l.detail.split(' ');
  const label = words.join(' ') || href;
  if (l.why === 'nowhere') return `${l.box}: the link "${label}" goes nowhere`;
  if (l.why === 'section') return `${l.box}: the link "${label}" points at ${href}, which is not on the page${l.target ? `; the block "${href.slice(1)}" is ${l.target}` : ''}`;
  return `${l.box}: the link "${label}" points at ${href}, a page the site doesn't have (yet)`;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m);

/** The text pieces of some HTML (between tags, outside style and script), trimmed, with entities decoded. */
function texts(html: string): string[] {
  return html.replace(/<(style|script|template)\b[\s\S]*?<\/\1>/gi, '').split(/<[^>]*>/)
    .map((s) => decode(s).replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** Components' words a finished page keeps as they are: buttons, labels and headings that fit any site. */
const KEEP = new Set([
  'Show more', 'Read more', 'See all →', 'All stories →', 'Open it', 'Latest news', 'Most read', 'Lead story', 'What we do', 'How it works',
  'Selected work', 'Most popular', 'Get started', 'Get started free', 'Start free', 'Book a demo', 'Talk to us', 'Write to us', "Let's talk",
  'Send message', 'Questions, answered', "Can't find yours?", 'Getting started', 'First steps', 'Next steps', 'Made with care', '/ month',
  'Average rating', 'Human support', 'Community help', 'Priority support',
  'surprising detail', 'about it.', // pieces of a sentence around <em>: the sentence itself is reported
]);
/** Plain figures and reading times: a page's own numbers look the same. */
const FIGURE = /^[\d\s≈.,%+–-]+$|^\d+ (min read|hours? ago|days? ago)$/;

let phrases: Set<string> | null = null;
/** The components' sample text: every piece of two words or more (a single word, like Privacy, can stay as it is). */
function placeholderText(): Set<string> {
  phrases ??= new Set(components().flatMap((c) => texts(componentCode(c.name))).filter((s) => s.includes(' ') && !KEEP.has(s) && !FIGURE.test(s)));
  return phrases;
}

const PICTURE = /(?:^|\/)assets\/((?:placeholder|mockup)-[\w-]+\.svg)$/;

/**
 * The page's own files a box's code uses (src, href, poster, srcset, url()) that aren't there: assets/<file>
 * is the page's, /assets/<file> the site's. Addresses on other servers and data: URLs aren't checked.
 */
export function missingFiles(ws: Workspace, html: string): string[] {
  const own = new Set(ws.assets());
  const site = new Set(ws.site?.files() ?? []);
  const refs = [
    ...[...html.matchAll(/\b(?:src|href|poster)\s*=\s*(["'])(.*?)\1/gi)].map((m) => m[2]),
    ...[...html.matchAll(/\bsrcset\s*=\s*(["'])(.*?)\1/gi)].flatMap((m) => m[2].split(',').map((c) => c.trim().split(/\s+/)[0])),
    ...[...html.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)].map((m) => m[2]),
  ];
  const out = new Set<string>();
  for (const raw of refs) {
    const ref = decode(raw.trim()).replace(/[?#].*$/, '');
    const m = /^(\.\/|\/)?assets\/(.+)$/.exec(ref);
    if (!m) continue;
    let file = m[2];
    try { file = decodeURIComponent(file); } catch {}
    if (!(m[1] === '/' ? site : own).has(file)) out.add(ref);
  }
  return [...out];
}

/** The boxes of a block (all boxes for the whole page). */
function boxesIn(ws: Workspace, within?: string | null): string[] {
  const layout = ws.load();
  const root = within ? find(layout.root, within)?.node ?? null : layout.root;
  if (!root) return [];
  const out: string[] = [];
  walk(root, (n) => {
    if (!isOp(n) && n.type === 'leaf') out.push(n.id);
  });
  const code = new Set(ws.boxIds());
  return out.filter((id) => code.has(id));
}

/** What is left unfinished in a block's boxes (the whole page without one). */
export function leftovers(ws: Workspace, opts: { within?: string | null } = {}): Leftover[] {
  const boxes = boxesIn(ws, opts.within);
  if (!boxes.length) return [];
  const ids = new Set([...ws.page().matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]));
  const pages = ws.site?.pageNames() ?? null;
  const known = placeholderText();
  const out: Leftover[] = [];
  const add = (l: Leftover) => out.some((o) => leftoverKey(o) === leftoverKey(l)) || out.push(l);
  const layout = ws.load();
  // a page of a site whose title comes from its first heading, and is another page's title too (copies, a shared banner)
  const site = ws.site?.dir, page = ws.pageName;
  if (site && page && (!opts.within || opts.within === layout.root.id)) {
    const settings = readSite(site);
    if (!settings.titles[page]) {
      const mine = derivedTitle(site, page);
      const other = sitePages(site).find((p) => p !== page && pageTitle(site, p, settings) === mine);
      if (other) add({ box: layout.root.id, kind: 'title', detail: mine, page, other });
    }
  }
  for (const box of boxes) {
    const use = ws.sharedBlock(box, layout);
    const block = use && ws.site ? ws.site.block(use) : null;
    if (use && ws.site && block === null) add({ box, kind: 'block', detail: use });
    // a shared block shows on pages at other addresses: a page's own file (assets/…) is there only on one of them
    if (use && block) for (const f of pageFileRefs(block)) add({ box, kind: 'shared-file', detail: `${use} ${f}` });
    // a slot this page fills that the block doesn't have (renamed or removed in the block since)
    if (use && block) {
      const has = new Set(blockSlots(block).map((s) => s.name));
      for (const slot of Object.keys(slotValues(ws.ownContent(box) ?? ''))) if (!has.has(slot)) add({ box, kind: 'slot', detail: `${use} ${slot}` });
    }
    const html = ws.content(box) ?? '';
    for (const s of texts(html)) if (known.has(s)) add({ box, kind: 'text', detail: s });
    for (const [img] of html.matchAll(/<img\b[^>]*>/gi)) {
      const file = PICTURE.exec(/\bsrc\s*=\s*["']([^"']*)["']/i.exec(img)?.[1] ?? '')?.[1];
      if (file) add({ box, kind: 'picture', detail: file });
    }
    for (const ref of missingFiles(ws, html)) add({ box, kind: 'missing', detail: ref });
    for (const [, attrs, inner] of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const href = /\bhref\s*=\s*(["'])(.*?)\1/i.exec(attrs)?.[2].trim();
      if (href === undefined) continue;
      const words = texts(inner).join(' ').slice(0, 60);
      const page = linkedPage(href);
      const why = href === '' || href === '#' ? 'nowhere'
        : href.startsWith('#') && !ids.has(decode(href.slice(1))) ? 'section'
        : page && pages && !pages.includes(page) && !['_tykerf', 'assets', 'out', 'kit'].includes(page) ? 'page'
        : null;
      // a link written with a block's name (#faq) reaches it at the block's own element, #sw-faq
      const target = why === 'section' && ids.has(`sw-${decode(href.slice(1))}`) ? `#sw-${decode(href.slice(1))}` : undefined;
      if (why) add({ box, kind: 'link', detail: `${href || '#'} ${words}`.trim(), why, ...(target ? { target } : {}) });
    }
  }
  return out;
}
