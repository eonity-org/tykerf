// Website importer: turn a rendered page into a slicing tree workspace.
//
// Recursive XY-cut (Nagy, 1984) over the *rendered* DOM: a container's visible children are split
// into horizontal bands (H) where a full-width gap separates them, else into vertical columns (V);
// containers that hold plain content (text, images, buttons) or whose children overlap become boxes.
//
//   npx tsx src/cli.ts import <url> <workspace-dir> [--structure-only]
//
// The look is kept by inlining each box's *computed* styles (the site's stylesheets depend on
// wrappers that no longer exist), section backgrounds/padding go to tags in head.html, fonts are
// copied from @font-face rules, and centered containers become `maxw`. Responsive behaviour is
// re-measured at narrower widths: rows that stack become `flip` rules, blocks that disappear `hide`.
// --structure-only keeps the boxes but not the content (for structure studies / sites you don't own).

import { type Browser, chromium } from 'playwright';
import { type Layout, type Leaf, type Node, type Op, type Rule, type Shape, assertValid, find, freshId, walk } from './model.js';
import * as M from './moves.js';
import { type Fetcher, copyFiles, filesIn, webFetcher } from './import-files.js';
import { serializeSlice } from './notation.js';
import { FolderStore, type Store } from './store.js';
import { NO_SITE_HEAD, type Workspace, splitStyle } from './workspace.js';

// ---------- what the page side returns ----------
interface XNode {
  kind: 'H' | 'V' | 'leaf';
  hint: string[]; // naming hints, best first
  role?: string;
  rect: { x: number; y: number; w: number; h: number };
  children?: XNode[];
  ratios?: number[];
  gap?: number;
  maxw?: number;
  decoKeys?: number[]; // its container elements, innermost first, re-read at each breakpoint (__swDeco)
  align?: 'start' | 'center' | 'end';
  spaceKey?: number; // (columns) the stacked groups, to measure the exact space before each child (__swSpace)
  html?: string;
  keys?: number[]; // style entries (elements / pseudo-elements) of this box, see __swStyles
  chars?: number;
  aspect?: number;
  mark: number; // index of the element(s) kept in the page for responsive re-measuring
}

interface Extract {
  root: XNode;
  fonts: string;
  keyframes: string[]; // @keyframes rules of the site's own stylesheets
  body: string;
  title: string;
  breakpoints: number[]; // "below" widths where the site's CSS changes (from its media queries), descending
}

// Runs inside the page. Self-contained.
function extractPage(o: { structureOnly: boolean }): Extract {
  const vw = document.documentElement.clientWidth;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'BASE']);
  const CONTENT = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A', 'IMG', 'SPAN', 'BUTTON', 'UL', 'OL', 'LI', 'PICTURE', 'SVG', 'svg',
    'FIGCAPTION', 'BLOCKQUOTE', 'TABLE', 'FORM', 'LABEL', 'INPUT', 'TEXTAREA', 'SELECT', 'B', 'STRONG', 'EM', 'I', 'SMALL', 'CODE', 'PRE',
    'BR', 'HR', 'VIDEO', 'IFRAME', 'CANVAS', 'DL', 'DT', 'DD', 'SUMMARY', 'DETAILS', 'TIME', 'ABBR', 'SUP', 'SUB', 'MARK', 'KBD', 'CITE', 'Q']);
  const SEMANTIC = new Set(['HEADER', 'NAV', 'MAIN', 'FOOTER', 'SECTION', 'ARTICLE', 'ASIDE']);
  const marks: Element[][] = [];
  (window as any).__swMarks = marks;

  const rect = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
  };
  const visible = (el: Element) => {
    if (SKIP.has(el.tagName)) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.bottom + scrollY <= 0 || r.right <= 0 || r.left >= vw) return false; // skip links, off-canvas menus
    return true;
  };
  // children that take part in the flow (absolutely positioned decoration stays inside its box)
  const flowKids = (el: Element) => [...el.children].filter((c) => visible(c) && !['absolute', 'fixed'].includes(getComputedStyle(c).position));
  const hasText = (el: Element) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());

  const isLeaf = (el: Element) => {
    const ks = flowKids(el);
    if (ks.length < 2 || hasText(el)) return true;
    if (ks.some((k) => getComputedStyle(k).display.startsWith('inline'))) return true;
    if (ks.every((k) => CONTENT.has(k.tagName))) return true;
    const r = rect(el);
    return r.h < 48 || r.w < 100;
  };

  const hints = (el: Element): string[] => {
    const h: string[] = [];
    if (el.id) h.push(el.id);
    const aria = el.getAttribute('aria-label');
    if (aria) h.push(aria);
    if (typeof el.className === 'string') {
      for (const c of el.className.trim().split(/\s+/)) if (c && !/^(container|row|col|wrapper|inner|section|grid|flex|block)$/i.test(c)) h.push(c);
    }
    if (SEMANTIC.has(el.tagName)) h.push(el.tagName.toLowerCase());
    const heading = el.querySelector('h1, h2, h3');
    if (heading?.textContent) h.push(heading.textContent.trim().split(/\s+/).slice(0, 3).join('-'));
    h.push(el.tagName.toLowerCase());
    return h;
  };

  // ---- XY-cut ----
  const bbox = (els: Element[]) => {
    const rs = els.map(rect);
    const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
    return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
  };
  const split = (els: Element[], axis: 'x' | 'y'): Element[][] => {
    const key = axis === 'y' ? (r: any) => [r.y, r.y + r.h] : (r: any) => [r.x, r.x + r.w];
    const sorted = [...els].sort((a, b) => key(rect(a))[0] - key(rect(b))[0]);
    const groups: Element[][] = [];
    let end = -Infinity;
    for (const el of sorted) {
      const [s, e] = key(rect(el));
      if (s >= end - 2 || !groups.length) groups.push([el]);
      else groups[groups.length - 1].push(el);
      end = Math.max(end, e);
    }
    return groups;
  };
  const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);

  // columns: the exact vertical space before each child, re-measured at every breakpoint
  const spaceGroups: Element[][][] = [];
  (window as any).__swSpace = () => spaceGroups.map((groups) => {
    const bb = groups.map((g) => {
      const rs = g.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
      return rs.length ? { top: Math.min(...rs.map((r) => r.top)), bottom: Math.max(...rs.map((r) => r.bottom)) } : null;
    });
    return bb.map((b, i) => {
      const prev = bb.slice(0, i).reverse().find(Boolean);
      return i === 0 || !b || !prev ? 0 : Math.max(0, Math.round(b.top - prev.bottom));
    });
  });

  const build = (els: Element[], depth: number): XNode => {
    if (els.length === 1) return node(els[0], depth);
    for (const axis of ['y', 'x'] as const) {
      const groups = split(els, axis);
      if (groups.length < 2) continue;
      const boxes = groups.map(bbox);
      const gaps = boxes.slice(1).map((b, i) => (axis === 'y' ? b.y - (boxes[i].y + boxes[i].h) : b.x - (boxes[i].x + boxes[i].w)));
      const children = groups.map((g) => build(g, depth + 1));
      const n: XNode = { kind: axis === 'y' ? 'H' : 'V', hint: [], rect: bbox(els), children, gap: Math.max(0, Math.round(median(gaps))), mark: marks.push(groups.map((g) => g[0])) - 1 };
      if (axis === 'y') n.spaceKey = spaceGroups.push(groups) - 1;
      else {
        const ai = els[0].parentElement ? getComputedStyle(els[0].parentElement).alignItems : 'normal';
        n.align = /center/.test(ai) ? 'center' : /^(flex-)?start$|baseline/.test(ai) ? 'start' : /^(flex-)?end$/.test(ai) ? 'end' : undefined;
      }
      if (axis === 'x') {
        // a huge gap is usually "push apart" (space-between): keep a normal gap and widen the boxes
        const extra = n.gap! > 64 ? ((n.gap! - 24) * (boxes.length - 1)) / boxes.length : 0;
        if (extra) n.gap = 24;
        const ws = boxes.map((b) => b.w + extra);
        const min = Math.min(...ws);
        n.ratios = ws.map((w) => Math.round((w / min) * 100) / 100);
      }
      return n;
    }
    return leaf(els);
  };

  // containers whose look (background, padding…) moves to an operator; re-read at every breakpoint
  const decoEls: Element[] = [];
  const decoOf = (el: Element, compact: boolean): Record<string, string> => {
    const cs = getComputedStyle(el);
    const d: Record<string, string> = {};
    const put = (k: string, v: string, empty: boolean) => { if (!compact || !empty) d[k] = v; };
    put('background-color', cs.backgroundColor, cs.backgroundColor === 'rgba(0, 0, 0, 0)');
    const img = cs.backgroundImage !== 'none';
    put('background-image', cs.backgroundImage, !img);
    if (img) Object.assign(d, { 'background-size': cs.backgroundSize, 'background-position': cs.backgroundPosition });
    put('color', cs.color, cs.color === getComputedStyle(document.body).color);
    for (const side of ['top', 'right', 'bottom', 'left']) put(`padding-${side}`, cs.getPropertyValue(`padding-${side}`), cs.getPropertyValue(`padding-${side}`) === '0px');
    put('border-radius', cs.borderRadius, cs.borderRadius === '0px');
    for (const side of ['top', 'bottom']) {
      const w = cs.getPropertyValue(`border-${side}-width`), st = cs.getPropertyValue(`border-${side}-style`);
      put(`border-${side}`, `${w} ${st} ${cs.getPropertyValue(`border-${side}-color`)}`, w === '0px' || st === 'none');
    }
    put('box-shadow', cs.boxShadow, cs.boxShadow === 'none');
    // a wrapper that clips (a carousel, a strip of logos) keeps its content inside
    put('overflow-x', cs.overflowX === 'visible' ? 'visible' : 'clip', cs.overflowX === 'visible');
    // a wrapper taller than its content + padding has a set height (e.g. a 96px header bar): keep it
    const kids = flowKids(el);
    const r = el.getBoundingClientRect();
    const content = kids.length ? Math.max(...kids.map((k) => k.getBoundingClientRect().bottom)) - Math.min(...kids.map((k) => k.getBoundingClientRect().top)) : 0;
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    put('min-height', `${Math.round(r.height)}px`, !kids.length || r.height <= content + padY + 2);
    return d;
  };
  (window as any).__swDeco = () => decoEls.map((el) => decoOf(el, false));

  /** The element's own look (section background, padding, centered width) goes on the operator. */
  const decorate = (res: XNode, el: Element): XNode => {
    const r = rect(el);
    // every wrapper with a look is kept: their paddings add up, backgrounds layer (node side)
    if (Object.keys(decoOf(el, true)).length) (res.decoKeys ??= []).push(decoEls.push(el) - 1);
    const centered = r.w < vw - 20 && Math.abs(r.x - (vw - r.x - r.w)) < 4;
    if (centered && !res.maxw) res.maxw = Math.round(r.w);
    res.hint = [...hints(el), ...res.hint];
    if (SEMANTIC.has(el.tagName) && !res.role) res.role = el.tagName.toLowerCase();
    return res;
  };

  const node = (el: Element, depth: number): XNode => {
    if (depth > 14) return leaf([el]);
    const ks = flowKids(el);
    // a wrapper around a single child is transparent: look through it, keep its look and name
    if (ks.length === 1 && !hasText(el)) {
      const inner = node(ks[0], depth + 1);
      if (inner.kind !== 'leaf') return decorate(inner, el);
      if (Object.keys(decoOf(el, true)).length) return leaf([el]); // its background/padding belongs to the box
      inner.hint = [...hints(el), ...inner.hint];
      if (SEMANTIC.has(el.tagName) && !inner.role) inner.role = el.tagName.toLowerCase();
      return inner;
    }
    if (isLeaf(el)) return leaf([el]);
    const res = build(ks, depth + 1);
    if (res.kind === 'leaf') return leaf([el]); // the children could not be cut apart: keep the whole element
    return decorate(res, el);
  };


  // ---- a box: the elements' HTML with computed styles inlined ----
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
  document.body.append(iframe);
  const sandbox = iframe.contentDocument!;
  const defaults = new Map<string, CSSStyleDeclaration>();
  const defaultOf = (tag: string) => {
    if (!defaults.has(tag)) {
      const e = sandbox.createElement(tag);
      if (tag === 'a') e.setAttribute('href', '#'); // only real links get the browser's link style
      sandbox.body.append(e);
      defaults.set(tag, sandbox.defaultView!.getComputedStyle(e));
    }
    return defaults.get(tag)!;
  };
  const INHERITED = ['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'white-space', 'word-spacing', 'list-style-type',
    'visibility', '-webkit-text-fill-color', 'text-indent'];
  const OWN = ['display', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'align-content', 'gap', 'row-gap', 'column-gap',
    'grid-template-columns', 'grid-template-rows', 'grid-template-areas', 'grid-auto-flow', 'grid-column', 'grid-row', 'justify-items', 'justify-self',
    'flex-grow', 'flex-shrink', 'flex-basis', 'order', 'float', 'clear',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top-width', 'border-top-style', 'border-top-color', 'border-right-width', 'border-right-style', 'border-right-color',
    'border-bottom-width', 'border-bottom-style', 'border-bottom-color', 'border-left-width', 'border-left-style', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat', 'box-shadow', 'opacity',
    // motion and 3D: animations (their @keyframes come along in the head), perspective
    'animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay', 'animation-iteration-count', 'animation-direction', 'animation-fill-mode',
    'transform-origin', 'transform-style', 'perspective', 'perspective-origin', 'backface-visibility',
    'max-width', 'min-height', 'text-decoration-line', 'text-decoration-color', 'vertical-align', 'object-fit', 'object-position', 'overflow-x', 'overflow-y', 'text-overflow', 'position',
    'top', 'right', 'bottom', 'left', 'z-index', 'transform', 'filter', 'clip', 'clip-path', 'background-clip', 'mix-blend-mode',
    // icons drawn with a CSS mask over a background colour
    'mask-image', 'mask-size', 'mask-position', 'mask-repeat', '-webkit-mask-image', '-webkit-mask-size', '-webkit-mask-position', '-webkit-mask-repeat'];
  const FLOW = new Set(['block', 'list-item', 'flow-root']);
  /** Grid tracks are computed in px at the width they were read at: as fr shares they follow the width instead. */
  const tracks = (v: string) => {
    const px = v.split(/\s+/).map((t) => (/^[\d.]+px$/.test(t) ? parseFloat(t) : NaN));
    if (!px.length || px.some((x) => !(x > 0))) return v;
    const min = Math.min(...px);
    return px.map((x) => `minmax(0,${Math.round((x / min) * 100) / 100}fr)`).join(' ');
  };
  const SIZED = new Set(['IMG', 'SVG', 'svg', 'VIDEO', 'IFRAME', 'CANVAS', 'PICTURE']);

  // One entry per copied element or pseudo-element. Its computed style is read at 1440 px and again
  // at each of the site's breakpoints, so each box gets real responsive CSS (see the node side).
  interface Entry { el: Element; pseudo?: '::before' | '::after'; root: boolean }
  const entries: Entry[] = [];

  /** Computed style of an entry as a map. compact: only what differs from defaults / the parent. */
  const styleOf = (en: Entry, compact: boolean): Record<string, string> => {
    const { el: e, pseudo: ps, root } = en;
    const cs = getComputedStyle(e, ps ?? null);
    const tag = ps ? 'span' : e.tagName.toLowerCase();
    const def = defaultOf(tag);
    const div = defaultOf('div');
    const parent = ps ? getComputedStyle(e) : e.parentElement ? getComputedStyle(e.parentElement) : null;
    const out: Record<string, string> = {};
    for (const p of INHERITED) {
      const v = cs.getPropertyValue(p);
      // also when the browser has its own default for this tag (a: blue + underline, button: font…)
      const uaOwn = def.getPropertyValue(p) !== div.getPropertyValue(p);
      if (!compact || root || uaOwn || !parent || parent.getPropertyValue(p) !== v) out[p] = v;
    }
    for (const p of OWN) {
      let v = cs.getPropertyValue(p);
      if (root && p.startsWith('margin')) continue; // spacing between boxes becomes the operator's gap
      if (root && p === 'position' && v !== 'relative') continue;
      if (p === 'position' && v === 'sticky') v = 'relative';
      if (p === 'grid-template-columns') v = tracks(v);
      if (p === 'grid-template-rows' && /^[\d.]+px( [\d.]+px)*$/.test(v)) v = 'none'; // rows follow their content
      if (!compact || v !== def.getPropertyValue(p)) out[p] = v;
    }
    // a border style without its width falls back to "medium" (3px): a 0px width set next to a style (Tailwind's
    // reset gives everything a solid border of 0) must come along, though 0px is also the default width
    for (const side of ['top', 'right', 'bottom', 'left']) {
      if (out[`border-${side}-style`] !== undefined) out[`border-${side}-width`] ??= cs.getPropertyValue(`border-${side}-width`);
    }
    // the box root's outer spacing is the operator's job: cancel the browser's default margins too
    // (h1, figure, p… would otherwise get theirs back)
    if (root && !ps) out.margin = '0';
    if (ps) {
      if (cs.width !== 'auto') out.width = cs.width;
      if (cs.height !== 'auto') out.height = cs.height;
      if (cs.display === 'inline' && (cs.width !== 'auto' || cs.backgroundColor !== 'rgba(0, 0, 0, 0)')) out.display = 'inline-block';
      return out;
    }
    const abs = !root && (cs.position === 'absolute' || cs.position === 'fixed');
    if (SIZED.has(e.tagName)) Object.assign(out, { width: cs.width, height: cs.height, 'max-width': '100%' });
    // an empty element (a dot, a divider, a bar) only has the size its CSS gives it: keep it
    else if (!e.children.length && !e.textContent?.trim()) Object.assign(out, { width: cs.width, height: cs.height, 'max-width': '100%' });
    // positioned (a badge, a visually hidden label) or floated: its size doesn't come from the flow
    else if (abs) Object.assign(out, { width: cs.width, height: cs.height });
    else if (cs.float !== 'none') Object.assign(out, { width: cs.width, 'max-width': '100%' });
    // a block narrower than its parent has a width of its own (a two-thirds column): keep it as a share
    // (a box's own root too: in a block parent its box is one of a column's, as wide as that parent)
    // a block centred in its parent with equal margins (margin: 0 auto): keep it centred at any width, with
    // its own width (read in px, the margins would only fit 1440 px; a box root's margins are dropped above)
    else if (FLOW.has(cs.display) && e.parentElement && FLOW.has(getComputedStyle(e.parentElement).display) &&
      parseFloat(cs.marginLeft) > 1 && Math.abs(parseFloat(cs.marginLeft) - parseFloat(cs.marginRight)) <= 1) {
      Object.assign(out, { 'margin-left': 'auto', 'margin-right': 'auto' });
      if (root) out.margin = '0 auto';
      if (cs.maxWidth === 'none') Object.assign(out, { 'box-sizing': 'border-box', width: `${Math.round(e.getBoundingClientRect().width)}px`, 'max-width': '100%' });
    }
    else if (FLOW.has(cs.display) && cs.maxWidth === 'none' && e.parentElement && FLOW.has(getComputedStyle(e.parentElement).display)) {
      const pc = getComputedStyle(e.parentElement);
      const inner = e.parentElement.clientWidth - parseFloat(pc.paddingLeft) - parseFloat(pc.paddingRight);
      const w = e.getBoundingClientRect().width;
      if (inner > 0 && w + parseFloat(cs.marginLeft) + parseFloat(cs.marginRight) < inner - 2) out.width = `${Math.round((w / inner) * 10000) / 100}%`;
    }
    if (cs.aspectRatio !== 'auto') out['aspect-ratio'] = cs.aspectRatio;
    // a box whose children are all absolutely positioned gets its height from CSS, not content: keep it
    else if (!SIZED.has(e.tagName) && e.children.length && !hasText(e) &&
      [...e.children].every((c) => ['absolute', 'fixed'].includes(getComputedStyle(c).position))) out.height = cs.height;
    return out;
  };
  (window as any).__swStyles = (compact: boolean) => entries.map((en) => styleOf(en, compact));

  /** A visible ::before/::after becomes a real <span> (pseudo-elements are not copied with the HTML). */
  const pseudo = (orig: Element, which: '::before' | '::after', keys: number[]): HTMLElement | null => {
    const cs = getComputedStyle(orig, which);
    const content = cs.content;
    if (!content || content === 'none' || content === 'normal' || cs.display === 'none') return null;
    const span = document.createElement('span');
    const text = /^["'](.*)["']$/s.exec(content)?.[1] ?? '';
    span.textContent = text.replace(/\\([0-9a-f]{1,6}) ?/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)));
    const k = entries.push({ el: orig, pseudo: which, root: false }) - 1;
    keys.push(k);
    span.setAttribute('class', `x${k}`);
    span.setAttribute('aria-hidden', 'true');
    return span;
  };

  /** Not drawn at all, though not display:none (a closed menu a web component never puts in a slot). */
  const BOXLESS = new Set(['OPTION', 'OPTGROUP', 'SOURCE', 'TRACK', 'AREA', 'MAP', 'PARAM', 'DATALIST']);
  const unrendered = (el: Element) =>
    !el.getClientRects().length && !BOXLESS.has(el.tagName) && getComputedStyle(el).display !== 'contents' &&
    !el.closest('details:not([open]), select, svg, template');

  /** The element's HTML with one short class per element (x<k>); its CSS is written on the node side. */
  const serialize = (el: Element, keys: number[]): string => {
    const clone = el.cloneNode(true) as Element;
    const walk = (orig: Element, copy: Element, root: boolean) => {
      for (const a of [...copy.attributes]) {
        if (/^(class|style|srcset|sizes|loading|decoding|on\w+|data-.*)$/i.test(a.name)) copy.removeAttribute(a.name);
      }
      const k = entries.push({ el: orig, root }) - 1;
      keys.push(k);
      copy.setAttribute('class', `x${k}`);
      const before = pseudo(orig, '::before', keys), after = pseudo(orig, '::after', keys);
      if (orig instanceof HTMLImageElement) copy.setAttribute('src', orig.currentSrc || orig.src);
      if (orig instanceof HTMLAnchorElement && orig.getAttribute('href')) copy.setAttribute('href', orig.href);
      if (orig.tagName.toLowerCase() !== 'svg') {
        // keep vector content as authored; everything else gets its own class
        const oc = [...orig.children], cc = [...copy.children];
        oc.forEach((o, i) => {
          const c = cc[i];
          if (!c) return;
          if (SKIP.has(o.tagName) || getComputedStyle(o).display === 'none' || unrendered(o)) c.remove();
          else walk(o, c, false);
        });
      }
      if (before) copy.prepend(before);
      if (after) copy.append(after);
    };
    walk(el, clone, true);
    return clone.outerHTML;
  };

  const leaf = (els: Element[]): XNode => {
    const el = els[0];
    const r = bbox(els);
    const imgs = els.length === 1 && el.tagName === 'IMG' ? [el as HTMLImageElement] : [];
    const n: XNode = { kind: 'leaf', hint: hints(el), rect: r, mark: marks.push(els) - 1, chars: els.map((e) => e.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim().length };
    if (imgs.length) n.aspect = Math.round((r.w / r.h) * 100) / 100;
    if (SEMANTIC.has(el.tagName)) n.role = el.tagName.toLowerCase();
    if (!o.structureOnly) {
      const keys: number[] = [];
      n.html = els.length === 1 ? serialize(el, keys) : `<div style="display:flex;flex-direction:column">${els.map((e) => serialize(e, keys)).join('')}</div>`;
      n.keys = keys;
    }
    return n;
  };

  const start = document.body;
  const root = build(flowKids(start), 0);
  // (the sandbox iframe stays: __swStyles needs the defaults at every width)

  // the site's own breakpoints, as "below" widths: max-width:X -> X+1, min-width:Y -> Y
  const bps = new Set<number>();
  const scan = (rules: CSSRuleList) => {
    for (const r of [...rules]) {
      if (r instanceof CSSMediaRule) {
        const c = r.conditionText ?? r.media.mediaText;
        for (const m of c.matchAll(/max-width\s*:\s*([\d.]+)px|width\s*<=\s*([\d.]+)px/g)) bps.add(Math.floor(+(m[1] ?? m[2])) + 1);
        for (const m of c.matchAll(/min-width\s*:\s*([\d.]+)px|width\s*>=\s*([\d.]+)px|width\s*<\s*([\d.]+)px/g)) bps.add(Math.ceil(+(m[1] ?? m[2] ?? m[3])));
      }
      if ('cssRules' in r && (r as CSSGroupingRule).cssRules) scan((r as CSSGroupingRule).cssRules);
    }
  };
  for (const sheet of [...document.styleSheets]) {
    try { scan(sheet.cssRules); } catch { /* cross-origin sheet */ }
  }
  const breakpoints = [...bps].filter((b) => b > 320 && b <= 1440).sort((a, b) => b - a);
  if (!breakpoints.length || breakpoints[breakpoints.length - 1] > 431) breakpoints.push(391); // always check a phone

  // fonts: same-origin @font-face rules with absolute URLs, plus linked font stylesheets
  const fonts: string[] = [];
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of [...rules]) {
      if (rule instanceof CSSFontFaceRule) {
        const base = sheet.href ?? location.href;
        fonts.push(rule.cssText.replace(/url\(["']?([^"')]+)["']?\)/g, (_m, u) => `url("${new URL(u, base).href}")`));
      }
    }
  }
  // animations: the @keyframes rules (the node side keeps those a copied element uses)
  const keyframes: string[] = [];
  const frames = (rs: CSSRuleList) => {
    for (const r of [...rs]) {
      if (r instanceof CSSKeyframesRule) keyframes.push(r.cssText);
      else if ('cssRules' in r && (r as CSSGroupingRule).cssRules) frames((r as CSSGroupingRule).cssRules);
    }
  };
  for (const sheet of [...document.styleSheets]) {
    try { frames(sheet.cssRules); } catch { /* cross-origin sheet */ }
  }
  const links = [...document.querySelectorAll('link[rel=stylesheet][href*="font"]')].map((l) => `<link rel="stylesheet" href="${(l as HTMLLinkElement).href}">`);
  const bcs = getComputedStyle(document.body);
  const hcs = getComputedStyle(document.documentElement);
  const bg = bcs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? bcs.backgroundColor : hcs.backgroundColor;
  return {
    root,
    fonts: links.join('\n') + (fonts.length ? `\n<style>\n${fonts.join('\n')}\n</style>` : ''),
    keyframes,
    body: `background-color:${bg};color:${bcs.color};font-family:${bcs.fontFamily};font-size:${bcs.fontSize};line-height:${bcs.lineHeight}`,
    title: document.title,
    breakpoints: breakpoints.length > 1 ? breakpoints : [1024, 768, ...breakpoints],
  };
}

// Runs inside the page: for each marked group of elements, are they still side by side / visible?
function measureMarks(): { visible: boolean[]; stacked: boolean[] } {
  const marks: Element[][] = (window as any).__swMarks ?? [];
  const vis = (el: Element) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 1 && r.height > 1;
  };
  return {
    visible: marks.map((g) => g.some(vis)),
    stacked: marks.map((g) => {
      const rs = g.filter(vis).map((e) => e.getBoundingClientRect());
      return rs.length > 1 && rs.slice(1).some((r, i) => r.top >= rs[i].bottom - 2);
    }),
  };
}

// ---------- node side: names, layout, rules, files ----------

const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const px = (v: string | undefined) => parseFloat(v ?? '0') || 0;

/**
 * One operator can stand for several nested wrappers (section > container > grid): their paddings
 * add up, the innermost background/border wins, and an outer background behind a centered column
 * (maxw) is kept full width with the full-bleed trick (box-shadow + clip-path).
 */
function combineDeco(layers: Record<string, string>[], centered: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const sum = layers.reduce((a, l) => a + px(l[`padding-${side}`]), 0);
    if (sum) out[`padding-${side}`] = `${sum}px`;
  }
  const pick = (k: string, empty: (v: string) => boolean) => {
    const l = layers.find((x) => x[k] !== undefined && !empty(x[k]));
    if (l) out[k] = l[k];
  };
  pick('background-color', (v) => v === TRANSPARENT);
  pick('background-image', (v) => v === 'none');
  for (const k of ['background-size', 'background-position']) pick(k, () => false);
  pick('color', () => false);
  pick('border-radius', (v) => v === '0px');
  for (const k of ['border-top', 'border-bottom']) pick(k, (v) => /^0px|none/.test(v));
  pick('box-shadow', (v) => v === 'none');
  pick('overflow-x', (v) => v === 'visible');
  const mh = Math.max(0, ...layers.map((l) => px(l['min-height'])));
  if (mh) out['min-height'] = `${mh}px`;
  // an outer band color around a centered column: paint it across the whole width
  const outer = layers[layers.length - 1]?.['background-color'];
  if (centered && outer && outer !== TRANSPARENT && layers.length > 1) {
    out['box-shadow'] = `0 0 0 100vmax ${outer}`;
    out['clip-path'] = 'inset(0 -100vmax)';
    if (out['background-color'] === undefined) out['background-color'] = outer;
  }
  return out;
}

function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^\w\s.-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/^[-.]+/, '').slice(0, 28).replace(/-+$/, '');
}

/** A part of the imported page that can be copied into a box on its own (see placeSection). */
export interface Section {
  id: string;
  width: number;
  height: number;
  shot?: string; // a JPEG of it at 1440 px, as a data: URL
}

/** CSS for one tag (an operator's look or the space between its children), at desktop or below a width. */
export interface TagStyle {
  tag: string;
  below?: number;
  rule: string;
}

export interface ImportResult {
  url: string;
  layout: Layout;
  boxes: Record<string, string>;
  head: string;
  fonts: string; // <link>s, @font-face and the @keyframes the copy uses, for head.html
  body: string; // the page's base look (background, colour, font) as declarations
  breakpoints: number[];
  styles: TagStyle[];
  sections?: Section[];
  /** images and fonts brought from the site's servers, by their path in the page (assets/…) */
  files: Record<string, Uint8Array>;
  /** addresses the copy still loads from other servers */
  remote: string[];
  stats: { boxes: number; operators: number; depth: number; rules: number; chars: number };
}

export interface ImportOptions {
  structureOnly?: boolean;
  browser?: Browser;
  /** Names (and tags) already used where the import goes: new names avoid them. */
  taken?: Iterable<string>;
  /** Also list the page's sections, with a picture of each (for "Import a section"). */
  sections?: boolean;
  /** Called at each stage, with an English sentence (the key the editor translates) and its values. */
  onStep?: (text: string, vars?: Record<string, string | number>) => void;
  /** Stops the copy between stages (it then throws "stopped"). */
  signal?: AbortSignal;
  /** How the site's images and fonts are downloaded into the copy (false: they stay linked). */
  fetchFiles?: Fetcher | false;
}

/** Addresses the importer opens: http and https only. */
export function importURL(url: string): string {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new Error(`"${url}" is not a web address (it should start with https://)`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('only http and https pages can be copied');
  return u.href;
}

// one import at a time: each one runs a browser and can take a minute
let importing = false;

/** The tallest block that still reads as one section; taller columns are opened up into their parts. */
function sectionNodes(root: XNode): XNode[] {
  const out: XNode[] = [];
  const visit = (n: XNode, d: number) => {
    if (n.kind === 'H' && d < 4 && (d === 0 || n.rect.h > 1300)) n.children!.forEach((c) => visit(c, d + 1));
    else if (n.rect.h >= 24 && n.rect.w >= 24) out.push(n);
  };
  visit(root, 0);
  return out;
}

export async function importPage(url: string, opts: ImportOptions = {}): Promise<ImportResult> {
  url = importURL(url);
  if (importing) throw new Error('another page is being copied; try again when it is done');
  importing = true;
  const step = (text: string, vars?: Record<string, string | number>) => {
    if (opts.signal?.aborted) throw new Error('stopped');
    opts.onStep?.(text, vars);
  };
  const browser = opts.browser ?? (await chromium.launch());
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    step('Opening {site} in a browser', { site: new URL(url).host });
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    } catch (e) {
      // a page that keeps loading (analytics, chat widgets) is copied as it is by then
      if (!/Timeout/i.test((e as Error).message)) throw new Error(`the page could not be opened: ${(e as Error).message.split('\n')[0]}`);
    }
    // trigger lazy content, then measure from the top
    step('Scrolling through the page so its pictures load');
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < Math.min(h, 30000); y += 700) {
      await page.evaluate((y) => scrollTo(0, y), y);
      await page.waitForTimeout(40);
    }
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.evaluate('window.__name = (f) => f'); // tsx wraps functions passed to the page
    step('Cutting the page into rows, columns and boxes');
    const x = await page.evaluate(extractPage, { structureOnly: !!opts.structureOnly });

    // responsive, at the site's own breakpoints (just below each one):
    //  - every copied element's full computed style, to write each box's @media rules
    //  - which rows stack (flip rule) and which blocks disappear (hide rule)
    const base = await page.evaluate((c) => (window as any).__swStyles(c), true) as Record<string, string>[];
    const full = [await page.evaluate((c) => (window as any).__swStyles(c), false) as Record<string, string>[]];
    const decoFull = [await page.evaluate(() => (window as any).__swDeco()) as Record<string, string>[]];
    const spaceAt = [await page.evaluate(() => (window as any).__swSpace()) as number[][]];
    step('Measuring it at {n} widths, down to a phone', { n: x.breakpoints.length + 1 });
    const flipAt = new Map<number, number>(); // mark -> "below" width where the row becomes stacked
    const hideAt = new Map<number, number>();
    for (const bp of x.breakpoints) {
      await page.setViewportSize({ width: bp - 1, height: 900 });
      await page.waitForTimeout(120);
      full.push(await page.evaluate((c) => (window as any).__swStyles(c), false));
      decoFull.push(await page.evaluate(() => (window as any).__swDeco()));
      spaceAt.push(await page.evaluate(() => (window as any).__swSpace()));
      const m = await page.evaluate(measureMarks);
      m.stacked.forEach((s, i) => { if (s && !flipAt.has(i)) flipAt.set(i, bp); });
      m.visible.forEach((v, i) => { if (!v && !hideAt.has(i)) hideAt.set(i, bp); });
    }
    // a picture of each section, back at desktop width
    const shots = new Map<XNode, string>();
    const parts = opts.sections ? sectionNodes(x.root) : [];
    if (parts.length) {
      step('Taking a picture of each section');
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForTimeout(250);
      for (const n of parts.slice(0, 40)) {
        const clip = { x: Math.max(0, n.rect.x), y: Math.max(0, n.rect.y), width: Math.min(n.rect.w, 1440), height: Math.min(n.rect.h, 1400) };
        try {
          const jpg = await page.screenshot({ clip, fullPage: true, type: 'jpeg', quality: 60, scale: 'css' });
          shots.set(n, `data:image/jpeg;base64,${jpg.toString('base64')}`);
        } catch { /* no picture: the section is still listed */ }
      }
    }
    await page.close();
    step('Copying the styles of each box');

    const decl = (m: Record<string, string>) => Object.entries(m).map(([k, v]) => `${k}:${v}`).join(';');
    /** A box's <style>: desktop rules, then per breakpoint only what changes. */
    const boxCSS = (keys: number[]) => {
      const out = keys.map((k) => `.x${k}{${decl(base[k])}}`);
      x.breakpoints.forEach((bp, i) => {
        const changed = keys.map((k) => {
          const now = full[i + 1][k], before = full[i][k];
          const d: Record<string, string> = {};
          for (const p of Object.keys(now)) if (now[p] !== before[p]) d[p] = now[p];
          for (const p of Object.keys(before)) if (!(p in now)) d[p] = 'initial'; // e.g. a width share that ends on phones
          return Object.keys(d).length ? `.x${k}{${decl(d)}}` : '';
        }).filter(Boolean);
        if (changed.length) out.push(`@media (width < ${bp}px){\n${changed.join('\n')}\n}`);
      });
      return out.join('\n');
    };

    // names: readable, unique, never operator-like, and new to the page they go into
    // (with the tags made from them: s-<name> and sp-<name>)
    const taken = new Set(opts.taken ?? []);
    const used = new Set<string>();
    const free = (name: string) => !used.has(name) && !taken.has(name) && !taken.has(`s-${name}`) && !taken.has(`sp-${name}`);
    const nameOf = (n: XNode, fallback: string) => {
      let base = '';
      for (const h of n.hint) {
        const s = slug(h);
        if (s && !/^[hvwp]\d*$/i.test(s) && /^[a-z0-9_]/.test(s)) { base = s; break; }
      }
      base ||= fallback;
      let name = base;
      for (let i = 2; !free(name); i++) name = `${base}-${i}`;
      used.add(name);
      return name;
    };

    const boxes: Record<string, string> = {};
    const styles: TagStyle[] = [];
    const rules: Rule[] = [];
    const idOf = new Map<XNode, string>();
    let depth = 0, nBoxes = 0, nOps = 0, chars = 0;
    const toNode = (n: XNode, d: number): Node => {
      depth = Math.max(depth, d);
      if (n.kind === 'leaf') {
        const id = nameOf(n, 'box');
        idOf.set(n, id);
        nBoxes++;
        chars += n.chars ?? 0;
        const shape: Shape = n.aspect ? { kind: 'image', aspect: n.aspect } : { kind: 'text', chars: Math.max(1, n.chars ?? 1) };
        const leaf: Leaf = { type: 'leaf', id, tags: [], variants: [shape], variant: 0, ...(n.role ? { role: n.role } : {}) };
        if (n.html !== undefined) boxes[id] = `<style>\n${boxCSS(n.keys ?? [])}\n</style>\n${n.html}`;
        if (hideAt.has(n.mark)) rules.push({ id: `r${rules.length + 1}`, below: hideAt.get(n.mark)!, action: 'hide', target: id });
        return leaf;
      }
      const id = d === 0 && free('page') ? (used.add('page'), 'page') : nameOf(n, n.kind === 'H' ? 'column' : 'row');
      idOf.set(n, id);
      nOps++;
      const op: Op = { type: 'op', id, named: true, kind: n.kind, tags: [], children: n.children!.map((c) => toNode(c, d + 1)) };
      if (n.ratios && !n.ratios.every((r) => r === n.ratios![0])) op.ratios = n.ratios;
      if (n.kind === 'H' && n.spaceKey !== undefined) {
        // exact space before each stacked child (sites use different margins between each pair)
        const tag = `sp-${id}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40);
        op.tags.push(tag);
        const rule = (sp: number[]) => sp.map((g, i) => (i ? `.t-${tag}>:nth-child(${i + 1}){margin-top:${g}px}` : '')).filter(Boolean);
        styles.push(...rule(spaceAt[0][n.spaceKey]).map((r) => ({ tag, rule: r })));
        x.breakpoints.forEach((bp, i) => {
          const now = spaceAt[i + 1][n.spaceKey!], before = spaceAt[i][n.spaceKey!];
          now.forEach((g, k) => { if (k && g !== before[k]) styles.push({ tag, below: bp, rule: `.t-${tag}>:nth-child(${k + 1}){margin-top:${g}px}` }); });
        });
      } else if (n.gap) op.gap = n.gap;
      if (n.maxw) op.maxW = n.maxw;
      if (n.role) op.tags.push(n.role);
      if (n.align) op.align = n.align;
      if (n.decoKeys?.length) {
        const tag = `s-${id}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40);
        op.tags.push(tag);
        const at = (w: number) => combineDeco(n.decoKeys!.map((k) => decoFull[w][k]), !!n.maxw);
        styles.push({ tag, rule: `.t-${tag}{${decl(at(0))}}` });
        // a min-height replaces a column item's content minimum: start it from its content, as render.ts does for minh
        if ([0, ...x.breakpoints.map((_, i) => i + 1)].some((w) => at(w)['min-height']))
          styles.push({ tag, rule: `.sw-H>.t-${tag}{flex-basis:auto!important;flex-shrink:0!important}` });
        x.breakpoints.forEach((bp, i) => {
          const now = at(i + 1), before = at(i);
          const d = Object.entries(now).filter(([k, v]) => v !== before[k]);
          for (const k of Object.keys(before)) if (!(k in now)) d.push([k, 'initial']);
          if (d.length) styles.push({ tag, below: bp, rule: `.t-${tag}{${d.map(([k, v]) => `${k}:${v}`).join(';')}}` });
        });
      }
      if (n.kind === 'V' && flipAt.has(n.mark)) rules.push({ id: `r${rules.length + 1}`, below: flipAt.get(n.mark)!, action: 'flip', target: id });
      if (hideAt.has(n.mark)) rules.push({ id: `r${rules.length + 1}`, below: hideAt.get(n.mark)!, action: 'hide', target: id });
      return op;
    };
    const root = toNode(x.root, 0);
    const layout = assertValid({ root, overlays: [], ...(rules.length ? { rules } : {}) });
    // the animations copied elements use
    const named = new Set([...Object.values(boxes), ...styles.map((s) => s.rule)].join('\n').match(/animation-name:[^;}]+/g)?.flatMap((d) => d.slice(15).split(',').map((n) => n.trim().replace(/^["']|["']$/g, ''))) ?? []);
    const motion = x.keyframes.filter((k) => named.has(/@keyframes\s+["']?([^\s"'{]+)/.exec(k)?.[1] ?? ''));
    // the site's images and fonts come into the copy's assets/
    let fonts = x.fonts + (motion.length ? `\n<style>\n${[...new Set(motion)].join('\n')}\n</style>` : '');
    let files: Record<string, Uint8Array> = {};
    let remote: string[] = [];
    if (opts.fetchFiles !== false) {
      step('Copying its images and fonts');
      const ids = Object.keys(boxes);
      const c = await copyFiles([fonts, ...ids.map((id) => boxes[id]), ...styles.map((s) => s.rule)], opts.fetchFiles ?? webFetcher(url), { signal: opts.signal });
      [fonts] = c.code;
      ids.forEach((id, i) => (boxes[id] = c.code[1 + i]));
      styles.forEach((s, i) => (s.rule = c.code[1 + ids.length + i]));
      files = c.files;
      remote = c.kept;
    }
    const head = [
      `<!-- imported from ${url} -->`,
      fonts,
      // after the base CSS: imported boxes bring their own spacing and look
      `<style>\nhtml{overflow-x:clip}\nbody{${x.body};overflow-x:clip}\n.sw-leaf{padding:0;outline:none;background:none}\n${tagCSS(styles, x.breakpoints)}\n</style>`,
    ].join('\n');
    const sections = opts.sections
      ? parts.map((n) => ({ id: idOf.get(n)!, width: Math.round(n.rect.w), height: Math.round(n.rect.h), ...(shots.has(n) ? { shot: shots.get(n) } : {}) }))
      : undefined;
    return {
      url, layout, boxes, head, fonts, body: x.body, breakpoints: x.breakpoints, styles, ...(sections ? { sections } : {}), files, remote,
      stats: { boxes: nBoxes, operators: nOps, depth, rules: rules.length, chars },
    };
  } finally {
    importing = false;
    if (!opts.browser) await browser.close();
  }
}

/** The CSS of some tags: desktop rules first, then one @media block per breakpoint, widest first. */
function tagCSS(styles: TagStyle[], breakpoints: number[], only?: Set<string>): string {
  const mine = only ? styles.filter((s) => only.has(s.tag)) : styles;
  return [
    ...mine.filter((s) => s.below === undefined).map((s) => s.rule),
    ...breakpoints.map((bp) => mine.filter((s) => s.below === bp).map((s) => s.rule)).map((rs, i) => (rs.length ? `@media (width < ${breakpoints[i]}px){\n${rs.join('\n')}\n}` : '')),
  ].filter(Boolean).join('\n');
}

// ---------- one section into a box of another page ----------

const IMPORT_BLOCK = /<!-- tykerf-import ([A-Za-z0-9_-]+) [^>]*-->[\s\S]*?<!-- \/tykerf-import \1 -->\n?/g;

/** head.html without the styles of imported sections whose block is gone (their tag is in no block). */
export function pruneImports(head: string, layout: Layout): string {
  const tags = new Set<string>();
  walk(layout.root, (n) => n.type !== 'empty' && n.tags.forEach((t) => tags.add(t)));
  return head.replace(IMPORT_BLOCK, (block, tag) => (tags.has(tag) ? block : ''));
}

/** Every name and tag in a page: what an import into it must not reuse. */
export function namesIn(ws: Workspace): string[] {
  const l = ws.load();
  const out = new Set<string>(ws.boxIds());
  walk(l.root, (n) => {
    out.add(n.id);
    if (n.type !== 'empty') n.tags.forEach((t) => out.add(t));
  });
  for (const o of l.overlays) out.add(o.id);
  for (const r of l.rules ?? []) out.add(r.id);
  return [...out];
}

/**
 * Put one section of an import in place of a box, as one undo step: the section's blocks replace
 * the box (its root takes the box's name, so the selection stays), their code becomes the new
 * boxes' code, its responsive rules come along, and its look goes into head.html as a block
 * marked with the section's tag. The page's base look (font, colours) applies to the section only.
 */
export function placeSection(ws: Workspace, r: ImportResult, sectionId: string, boxId: string, author = 'user'): string {
  const f = find(r.layout.root, sectionId);
  if (!f) throw new Error(`the copy has no section "${sectionId}"`);
  const sub = structuredClone(f.node) as Node;
  if (sub.type === 'empty') throw new Error('that section is empty');
  const l = ws.load();
  if (find(l.root, boxId)?.node.type !== 'leaf') throw new Error(`"${boxId}" is not a box; a section can only replace a box`);
  const inside = new Set<string>();
  walk(sub, (n) => inside.add(n.id));
  const taken = new Set(namesIn(ws));
  taken.delete(boxId);
  for (const id of inside) if (id !== sectionId && taken.has(id)) throw new Error('the page changed while it was being copied; copy the section again');

  const rename = (id: string) => (id === sectionId ? boxId : id);
  const leaves: string[] = [];
  walk(sub, (n) => n.type === 'leaf' && leaves.push(n.id));
  sub.id = boxId;
  if (sub.type === 'op') sub.named = true;
  // the page's base look, scoped to the section
  let tag = `in-${boxId}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40);
  for (let i = 2; taken.has(tag); i++) tag = `in-${boxId}-${i}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40);
  sub.tags = [tag, ...sub.tags];
  const used = new Set([...taken, ...inside]);
  const rules = (r.layout.rules ?? []).filter((x) => inside.has(x.target)).map((x) => {
    const id = freshId(l.root, 'r', used);
    used.add(id);
    return { ...x, id, target: rename(x.target) };
  });
  const tags = new Set<string>();
  walk(sub, (n) => n.type !== 'empty' && n.tags.forEach((t) => tags.add(t)));
  const block = [
    `<!-- tykerf-import ${tag} from ${r.url} -->`,
    r.fonts.trim(),
    `<style>\n.t-${tag}{${r.body};overflow-x:clip}\n.t-${tag} .sw-leaf,.sw-leaf.t-${tag}{padding:0;outline:none;background:none}\n${tagCSS(r.styles, r.breakpoints, tags)}\n</style>`,
    `<!-- /tykerf-import ${tag} -->`,
  ].filter(Boolean).join('\n');

  const label = `import ${sectionId} from ${new URL(r.url).host} into ${boxId}`;
  ws.group(label, author, () => {
    if (sub.type === 'op' && ws.content(boxId) !== null) ws.setContent(boxId, null, author);
    const next = M.graft(l, boxId, sub, rules);
    ws.save(next, label, author);
    for (const id of leaves) {
      const code = r.boxes[id];
      if (code !== undefined) ws.setContent(rename(id), code, author);
      else if (rename(id) === boxId) ws.setContent(boxId, null, author);
    }
    // the images and fonts the section uses (named by their content, so never overwritten)
    const used = [block, ...leaves.map((id) => r.boxes[id] ?? '')].join('\n');
    for (const f of filesIn(used, r.files ?? {})) if (!ws.store.exists(f)) ws.store.write(f, r.files[f]);
    const head = pruneImports(ws.head(), next);
    ws.setHead(`${head}${head && !head.endsWith('\n') ? '\n' : ''}${block}\n`, author, label);
  });
  return boxId;
}

/** Write an import as a workspace, in a folder or any store (replacing layout, boxes, head.html and history). */
export function writeWorkspace(where: string | Store, r: ImportResult, url: string) {
  const store = typeof where === 'string' ? new FolderStore(where) : where;
  for (const f of store.list('boxes')) store.remove(`boxes/${f}`);
  store.remove('.history.jsonl');
  store.write('layout.slice', `// imported from ${url}\n${serializeSlice(r.layout)}`);
  for (const [id, code] of Object.entries(r.boxes)) {
    const { html, css } = splitStyle(code); // content and style live in separate files
    store.write(`boxes/${id}.html`, html + '\n');
    if (css) store.write(`boxes/${id}.css`, css + '\n');
  }
  // a copy keeps its own look: a site's shared theme would restyle it
  store.write('head.html', `${NO_SITE_HEAD}\n${r.head}`);
  for (const [path, bytes] of Object.entries(r.files ?? {})) store.write(path, bytes);
}
