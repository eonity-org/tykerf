// check_design: how a page reads and looks, in a real browser at desktop and phone width. Two groups:
// "fix" (readability and access: contrast, small text, tap targets, heading order, sideways scroll, long or
// cramped lines, stretched pictures) and "style" (signs of a generic page: eyebrow labels, a chip over the
// headline, icon-tile grids, the same section again and again…), each with a one-line hint of its rule.
// The style rules follow ideas from impeccable (github.com/pbakaus/impeccable, Apache 2.0; see NOTICE),
// written here from scratch.

import type { Browser } from 'playwright';
import { type PageFiles, launchChromium, openPage } from './screenshot.js';

export type DesignGroup = 'fix' | 'style';
export interface DesignRule {
  group: DesignGroup;
  label: string;
  /** The rule in one line, for people and for Kaity. */
  hint: string;
}

/** Every rule, in the order findings are listed. */
export const DESIGN_RULES = {
  contrast: { group: 'fix', label: 'Text too faint on its background', hint: 'Text needs a contrast of at least 4.5:1 with what is behind it (3:1 when large), or many people can\'t read it.' },
  'small-text': { group: 'fix', label: 'Text too small on a phone', hint: 'Running text under 14 px is hard to read on a phone.' },
  'tap-target': { group: 'fix', label: 'Buttons or links too small to tap', hint: 'On a phone, a button or a link on its own needs about 40 px to be tapped without missing.' },
  headings: { group: 'fix', label: 'Headings out of order', hint: 'One main title (h1), and no skipped levels (h2 then h4): screen readers and search engines use them as the page\'s outline.' },
  'sideways-scroll': { group: 'fix', label: 'The page scrolls sideways on a phone', hint: 'Something is wider than a phone screen, so the whole page slides left and right.' },
  'long-lines': { group: 'fix', label: 'Lines too long to read', hint: 'Lines of running text over about 80 characters tire the eye; keep them near 60–75.' },
  'tight-lines': { group: 'fix', label: 'Lines too close together', hint: 'Running text needs a line height of at least 1.3 to be read comfortably.' },
  'stretched-image': { group: 'fix', label: 'A stretched or squashed picture', hint: 'The picture is shown in another shape than its own; crop it (object-fit: cover) instead of stretching it.' },
  eyebrow: { group: 'style', label: 'A small label over every section title', hint: 'Small capital labels above each heading are a common sign of a generic page; keep one only where it helps.' },
  'hero-chip': { group: 'style', label: 'A badge above the main headline', hint: 'A little pill over the headline ("New", a date) is a stock opening; say it in the text, or drop it.' },
  'icon-tiles': { group: 'style', label: 'A grid of identical icon cards', hint: 'Four or more cards of icon, title and line, all alike, read as filler; vary them, or say it in a list or a sentence.' },
  'same-sections': { group: 'style', label: 'The same section again and again', hint: 'Three or more sections in a row built the same way make a page monotonous; vary their shape.' },
  'big-headline': { group: 'style', label: 'A headline that fills the screen', hint: 'A main headline taking most of the first screen pushes everything else out of sight; make it shorter or smaller.' },
  effects: { group: 'style', label: 'Gradient text, glows or coloured shadows', hint: 'Text filled with a gradient, glowing text and heavy coloured shadows are decoration that dates fast and reads as generic.' },
  'nested-cards': { group: 'style', label: 'Cards inside cards', hint: 'A framed box inside another framed box adds noise; one frame is enough.' },
  'side-stripe': { group: 'style', label: 'Cards with a coloured stripe down one side', hint: 'A thick coloured edge on one side of a card is a stock look; use space, a heading or a tone instead.' },
  'centred-text': { group: 'style', label: 'Long centred paragraphs', hint: 'Centred text over three or four lines is hard to read; align long text to the left.' },
  'all-caps': { group: 'style', label: 'Long text in capitals', hint: 'Whole sentences in capitals are slow to read; keep capitals for a word or two.' },
  'plain-fonts': { group: 'style', label: 'Only the most common fonts', hint: 'Inter, Roboto, Arial or the system font for both headings and text give the page no voice of its own.' },
} as const satisfies Record<string, DesignRule>;
export type DesignRuleId = keyof typeof DESIGN_RULES;

/** One thing check_design found: which rule, in which box (null: the whole page), at which widths, and an example. */
export interface DesignFinding {
  rule: DesignRuleId;
  group: DesignGroup;
  box: string | null;
  widths: number[];
  detail: string;
}

export const DESIGN_WIDTHS = [1440, 375];
const VIEWPORT_H = 900;

interface Raw { rule: string; box: string | null; detail: string }

// Runs inside the page: self-contained, no imports. Returns what it found at this width.
function audit(arg: { width: number; vh: number }): Raw[] {
  const { width, vh } = arg;
  const out: Raw[] = [];
  const boxOf = (el: Element | null) => el?.closest('[data-sw]')?.getAttribute('data-sw') ?? null;
  const add = (rule: string, el: Element | null, detail: string) => out.push({ rule, box: boxOf(el), detail });
  const short = (s: string | null | undefined, n = 40) => {
    const t = (s ?? '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };
  const shown = (el: Element) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const ownText = (el: Element) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim();
  const all = [...document.body.querySelectorAll('*')].filter(shown);
  const phone = width < 600;

  // ---- colours ----
  const rgb = (c: string) => {
    const n = (c.match(/[\d.]+/g) ?? []).map(Number);
    return c.startsWith('color(') ? [...n.slice(0, 3).map((v) => v * 255), ...n.slice(3)] : n;
  };
  const lum = ([r, g, b]: number[]) => {
    const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const background = (el: Element | null): number[] | null => {
    for (; el; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.backgroundImage !== 'none' && !/gradient/.test(cs.backgroundImage)) return null; // text over a picture: not measurable here
      const c = rgb(cs.backgroundColor);
      if (c.length === 3 || (c.length === 4 && c[3] > 0.5)) return c.slice(0, 3);
    }
    return [255, 255, 255];
  };
  const opacity = (el: Element | null) => {
    let o = 1;
    for (; el; el = el.parentElement) o *= Number(getComputedStyle(el).opacity);
    return o;
  };
  const saturated = (c: string) => {
    const [r, g, b] = rgb(c);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    return max > 0 && (max - min) / max > 0.35;
  };

  // ---- fix: contrast, small text, long and tight lines, centred and capital text ----
  for (const el of all) {
    const text = ownText(el);
    if (!text || el.closest('svg')) continue;
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize), weight = Number(cs.fontWeight);
    const bg = background(el);
    if (bg) {
      const [r0, g0, b0, a0 = 1] = rgb(cs.color);
      const a = a0 * opacity(el);
      const fg = [r0, g0, b0].map((v, i) => v * a + bg[i] * (1 - a));
      const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      const ratio = (hi + 0.05) / (lo + 0.05);
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      if (ratio < (large ? 3 : 4.5)) add('contrast', el, `"${short(text, 30)}" ${ratio.toFixed(1)}:1`);
    }
    if (phone && text.length >= 20 && size < 14) add('small-text', el, `"${short(text, 30)}" ${Math.round(size)} px`);
    const block = /^(P|LI|DD|BLOCKQUOTE)$/.test(el.tagName);
    if (block && text.length >= 60) {
      const lh = parseFloat(cs.lineHeight) || size * 1.2;
      const lines = Math.max(1, Math.round(el.getBoundingClientRect().height / lh));
      const full = (el.textContent ?? '').replace(/\s+/g, ' ').trim().length;
      if (lines >= 2 && full / lines > 85) add('long-lines', el, `about ${Math.round(full / lines)} characters a line`);
      if (lines >= 2 && lh / size < 1.3) add('tight-lines', el, `line height ${(lh / size).toFixed(2)}`);
      if (lines >= 4 && cs.textAlign === 'center') add('centred-text', el, `${lines} centred lines`);
    }
    const caps = cs.textTransform === 'uppercase' || (/[A-Z]/.test(text) && text === text.toUpperCase());
    if (caps && text.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 40) add('all-caps', el, `"${short(text, 30)}"`);
    if (/text/.test(cs.getPropertyValue('-webkit-background-clip') + cs.backgroundClip) && /gradient/.test(cs.backgroundImage)) add('effects', el, 'text filled with a gradient');
    // a text shadow blurred 8 px or more: a glow (computed as "<colour> <x>px <y>px <blur>px", one per shadow)
    if (cs.textShadow !== 'none' && [...cs.textShadow.matchAll(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/g)].some((m) => Number(m[3]) >= 8)) add('effects', el, 'glowing text');
  }

  // ---- fix: tap targets on a phone (a link inside running text is exempt) ----
  if (phone) {
    for (const el of all.filter((e) => e.matches('a[href], button, input:not([type=hidden]), select, textarea, [role=button]'))) {
      const r = el.getBoundingClientRect();
      const parent = el.parentElement;
      const inline = el.tagName === 'A' && parent && /^(P|LI|SPAN|EM|STRONG|SMALL|TD|DD|FIGCAPTION|LABEL)$/.test(parent.tagName) && (parent.textContent ?? '').trim().length > (el.textContent ?? '').trim().length + 10;
      if (!inline && (r.height < 40 || r.width < 40)) add('tap-target', el, `"${short(el.textContent || el.getAttribute('aria-label') || el.tagName.toLowerCase(), 24)}" ${Math.round(r.width)}×${Math.round(r.height)} px`);
    }
  }

  // ---- fix: headings, sideways scroll, stretched pictures ----
  const hs = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter(shown);
  const h1s = hs.filter((h) => h.tagName === 'H1');
  if (h1s.length > 1) add('headings', h1s[1], `${h1s.length} main titles (h1)`);
  if (!h1s.length && hs.length) add('headings', hs[0], 'no main title (h1)');
  for (let i = 1; i < hs.length; i++) {
    const a = Number(hs[i - 1].tagName[1]), b = Number(hs[i].tagName[1]);
    if (b > a + 1) add('headings', hs[i], `h${a} then h${b} ("${short(hs[i].textContent, 24)}")`);
  }
  if (phone && document.documentElement.scrollWidth > innerWidth + 1) add('sideways-scroll', null, `${document.documentElement.scrollWidth - innerWidth} px too wide`);
  for (const img of [...document.images].filter(shown)) {
    if (!img.naturalWidth || !img.naturalHeight || /\.svg(\?|$)|^data:image\/svg/.test(img.currentSrc || img.src)) continue;
    const fit = getComputedStyle(img).objectFit;
    if (fit !== 'fill' && fit !== '') continue;
    const r = img.getBoundingClientRect();
    const want = img.naturalWidth / img.naturalHeight, got = r.width / r.height;
    if (Math.abs(got / want - 1) > 0.05) add('stretched-image', img, `${img.getAttribute('src')?.split('/').pop() ?? 'a picture'}: ${Math.round((got / want - 1) * 100)}%`);
  }

  // ---- style: eyebrows, the hero chip, the headline's size ----
  const eyebrows = hs.filter((h) => /^H[23]$/.test(h.tagName)).filter((h) => {
    const prev = h.previousElementSibling;
    if (!prev || !shown(prev)) return false;
    const t = (prev.textContent ?? '').trim(), cs = getComputedStyle(prev);
    return t.length > 0 && t.length <= 40 && parseFloat(cs.fontSize) <= 15 && (cs.textTransform === 'uppercase' || parseFloat(cs.letterSpacing) >= 1);
  });
  if (eyebrows.length >= 2) for (const h of eyebrows) add('eyebrow', h, `"${short(h.previousElementSibling!.textContent, 24)}" over "${short(h.textContent, 24)}"`);
  const h1 = h1s[0];
  if (h1) {
    let prev: Element | null = h1.previousElementSibling;
    for (let up = h1.parentElement; !prev && up && up !== document.body; up = up.parentElement) prev = up.previousElementSibling;
    if (prev && shown(prev)) {
      const cs = getComputedStyle(prev), r = prev.getBoundingClientRect();
      const pill = parseFloat(cs.borderRadius) >= r.height / 2 - 1 && (cs.borderStyle !== 'none' || rgb(cs.backgroundColor)[3] !== 0);
      if (pill && r.height <= 48 && (prev.textContent ?? '').trim().length <= 60) add('hero-chip', prev, `"${short(prev.textContent, 30)}"`);
    }
    if (!phone && h1.getBoundingClientRect().height > vh * 0.35) add('big-headline', h1, `${Math.round((h1.getBoundingClientRect().height / vh) * 100)}% of the first screen`);
  }

  // ---- style: cards ----
  const isCard = (el: Element) => {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (r.width < 120 || r.height < 80 || /^(IMG|PICTURE|FIGURE|INPUT|TEXTAREA|SELECT|BUTTON|IFRAME|VIDEO)$/.test(el.tagName)) return false;
    const framed = parseFloat(cs.borderTopWidth) >= 1 || parseFloat(cs.borderLeftWidth) >= 1 || cs.boxShadow !== 'none';
    const filled = (rgb(cs.backgroundColor)[3] ?? 1) > 0.5 && cs.backgroundColor !== getComputedStyle(el.parentElement ?? el).backgroundColor;
    return (framed || filled) && parseFloat(cs.borderTopLeftRadius) >= 4 && parseFloat(cs.paddingTop) >= 12;
  };
  const cards = all.filter(isCard);
  for (const c of cards) {
    const inner = cards.find((d) => d !== c && c.contains(d));
    if (inner && !cards.some((o) => o !== c && o.contains(c))) add('nested-cards', c, 'a framed box inside another');
    const cs = getComputedStyle(c);
    const left = parseFloat(cs.borderLeftWidth), others = Math.max(parseFloat(cs.borderTopWidth), parseFloat(cs.borderRightWidth), parseFloat(cs.borderBottomWidth));
    if (left >= 3 && others <= 1) add('side-stripe', c, `${Math.round(left)} px edge`);
    const sh = /rgba?\([^)]*\)[^,]*?(\d+)px\s+(-?\d+)px\s+(\d+)px/.exec(cs.boxShadow);
    if (sh && Number(sh[3]) >= 24 && saturated(sh[0])) add('effects', c, 'a heavy coloured shadow');
  }

  // ---- style: icon tiles (4+ siblings, each an icon, a heading and a line, alike) ----
  const sig = (el: Element) => [...el.querySelectorAll('*')].map((d) => d.tagName).join(',');
  for (const parent of all) {
    const kids = [...parent.children].filter(shown);
    if (kids.length < 4) continue;
    const tiles = kids.filter((k) => {
      const icon = [...k.querySelectorAll('svg, img')].find((i) => { const r = i.getBoundingClientRect(); return r.width <= 64 && r.height <= 64; });
      return icon && k.querySelector('h2, h3, h4, strong') && k.querySelector('p');
    });
    if (tiles.length >= 4 && new Set(tiles.map(sig)).size === 1) add('icon-tiles', parent, `${tiles.length} alike`);
  }

  // ---- style: three or more sections in a row with the same shape ----
  if (!phone) {
    const boxes = [...document.querySelectorAll('[data-sw]')].filter((b) => shown(b) && !b.querySelector('[data-sw]') && b.getBoundingClientRect().height > 120);
    const shape = (b: Element) => {
      const walk = (el: Element, depth: number): string => {
        if (depth > 3) return '';
        const kids = [...el.children].filter((k) => !/^(STYLE|SCRIPT|SVG)$/i.test(k.tagName));
        const parts = kids.map((k) => k.tagName.toLowerCase() + (k.children.length ? `(${walk(k, depth + 1)})` : ''));
        return parts.filter((p, i) => p !== parts[i - 1]).join(',');
      };
      return walk(b, 0);
    };
    let run = 1;
    for (let i = 1; i < boxes.length; i++) {
      run = shape(boxes[i]) === shape(boxes[i - 1]) && shape(boxes[i]).length > 10 ? run + 1 : 1;
      if (run === 3) add('same-sections', boxes[i], `${boxes[i - 2].getAttribute('data-sw')}, ${boxes[i - 1].getAttribute('data-sw')} and ${boxes[i].getAttribute('data-sw')}`);
    }
  }

  // ---- style: only the most common fonts ----
  if (!phone) {
    const first = (el: Element | null) => (el ? getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase() : '');
    const plain = new Set(['inter', 'roboto', 'arial', 'helvetica', 'helvetica neue', 'system-ui', '-apple-system', 'blinkmacsystemfont', 'sans-serif', 'open sans', 'segoe ui']);
    const body = first(document.querySelector('p') ?? document.body), head = first(hs[0] ?? null);
    if (plain.has(body) && (!head || plain.has(head))) add('plain-fonts', null, `${body}${head && head !== body ? ` and ${head}` : ''}`);
  }
  return out;
}

/**
 * Check a page's design at each width: the findings, one per rule and box (the widths it was seen at, and the
 * first example), in the rules' order. `files` lets the page's pictures and fonts load, as the MCP tools do.
 */
export async function checkDesign(html: string, opts: { files?: PageFiles | null; browser?: Browser; widths?: number[] } = {}): Promise<DesignFinding[]> {
  const browser = opts.browser ?? (await launchChromium());
  try {
    const found = new Map<string, DesignFinding>();
    for (const width of opts.widths ?? DESIGN_WIDTHS) {
      const page = await browser.newPage({ viewport: { width, height: VIEWPORT_H } });
      if (opts.files) await openPage(page, html, opts.files);
      else await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate('window.__name = (f) => f'); // tsx may wrap named functions in __name()
      const raw = await page.evaluate(audit, { width, vh: VIEWPORT_H });
      await page.close();
      for (const r of raw) {
        if (!(r.rule in DESIGN_RULES)) continue;
        const rule = r.rule as DesignRuleId;
        const key = `${rule} ${r.box ?? ''}`;
        const f = found.get(key);
        if (f) { if (!f.widths.includes(width)) f.widths.push(width); }
        else found.set(key, { rule, group: DESIGN_RULES[rule].group, box: r.box, widths: [width], detail: r.detail });
      }
    }
    const order = Object.keys(DESIGN_RULES);
    return [...found.values()].sort((a, b) => order.indexOf(a.rule) - order.indexOf(b.rule));
  } finally {
    if (!opts.browser) await browser.close();
  }
}

/** The findings as Kaity and the command line read them: must fix first, then the style notes, each with its rule's hint. */
export function sayDesign(findings: DesignFinding[]): string {
  if (!findings.length) return 'nothing to fix and no style notes: the page reads well at 1440 and 375 px';
  const part = (group: DesignGroup, title: string) => {
    const mine = findings.filter((f) => f.group === group);
    if (!mine.length) return [];
    const rules = [...new Set(mine.map((f) => f.rule))];
    return [title, ...rules.flatMap((r) => [
      `- ${DESIGN_RULES[r].label} (${DESIGN_RULES[r].hint})`,
      ...mine.filter((f) => f.rule === r).map((f) => `  - ${f.box ?? 'the page'}: ${f.detail} (at ${f.widths.join(' and ')} px)`),
    ])];
  };
  return [
    ...part('fix', `Must fix (${findings.filter((f) => f.group === 'fix').length}):`),
    ...part('style', `Style notes (${findings.filter((f) => f.group === 'style').length}): fix each, or say in your answer why it stays.`),
  ].join('\n');
}
