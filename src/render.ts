// Tree -> standalone HTML/CSS. DOM order == tree order (so visual order == reading order).
// H/V -> flexbox, P/W -> CSS grid areas, overlays -> CSS anchor positioning.

import { type Layout, type Node, type Op, type Overlay, effective, isOp, walk, weights } from './model.js';
import { DEFAULT_FONT_PX, DEFAULT_LINE_HEIGHT, LEAF_PAD, columnWeights } from './shape.js';

export type Contents = Record<string, string>; // leaf/overlay id -> HTML snippet

const SEMANTIC = new Set(['header', 'nav', 'main', 'aside', 'footer', 'section', 'article']);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const cssId = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_');
const anchorName = (id: string) => `--a-${cssId(id)}`;

const LOREM =
  'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ';

function placeholder(n: Extract<Node, { type: 'leaf' }>): string {
  const s = n.variants[n.variant];
  const label = `<div class="sw-label">${esc(n.id)}</div>`;
  if (!s) return label;
  if (s.kind === 'image') return `${label}<div class="sw-img" style="aspect-ratio:${s.aspect}"></div>`;
  if (s.kind === 'fixed') return `${label}<div class="sw-img" style="width:${s.w}px;height:${s.h}px"></div>`;
  const text = LOREM.repeat(Math.ceil(s.chars / LOREM.length)).slice(0, s.chars);
  const style = s.fontPx || s.lineHeight ? ` style="font-size:${s.fontPx ?? DEFAULT_FONT_PX}px;line-height:${s.lineHeight ?? DEFAULT_LINE_HEIGHT}"` : '';
  return `${label}<p${style}>${text}</p>`;
}

/**
 * A box's own <style> blocks apply only inside that box (CSS @scope), so box code can use plain
 * selectors (h3, .card) without restyling the rest of the page. `:scope` is the box itself.
 * Scripts are left as-is; to find its own box a script uses document.currentScript.closest('[data-sw]').
 */
export function scopeStyles(html: string, id: string): string {
  return html.replace(/<style(\s[^>]*)?>([\s\S]*?)<\/style>/gi, (_m, attrs = '', css: string) =>
    /@scope\b/.test(css) ? `<style${attrs}>${css}</style>` : `<style${attrs}>@scope ([data-sw="${esc(id)}"]) {${css}}</style>`);
}

const fr = (w: number) => (w > 0 ? `minmax(0,${w}fr)` : '0px');

function opStyle(n: Op): string {
  const gap = n.gap !== undefined ? `gap:${n.gap}px;` : '';
  if (n.kind === 'H' || n.kind === 'V') {
    const align = n.align ? `align-items:${n.align === 'start' || n.align === 'end' ? `flex-${n.align}` : n.align};` : '';
    return `${gap}${align}`;
  }
  const [c1, c2, c3] = columnWeights(n);
  if (n.kind === 'W') {
    return `${gap}grid-template-columns:${fr(c1)} ${fr(c2)} ${fr(c3)};grid-template-areas:'a a b' 'd e b' 'd c c';`;
  }
  // P: drop empty rows/columns so they take no space.
  const [north, west, , east, south] = n.children;
  const cols = [west.type !== 'empty' && 'w', 'c', east.type !== 'empty' && 'e'].filter(Boolean) as string[];
  const tracks = cols.map((c) => fr(c === 'w' ? c1 : c === 'c' ? c2 : c3)).join(' ');
  const rows: string[] = [];
  const sizes: string[] = [];
  if (north.type !== 'empty') rows.push(cols.map(() => 'n').join(' ')), sizes.push('auto');
  rows.push(cols.join(' ')), sizes.push('1fr');
  if (south.type !== 'empty') rows.push(cols.map(() => 's').join(' ')), sizes.push('auto');
  // single quotes: this CSS lives inside a double-quoted style attribute
  return `${gap}grid-template-columns:${tracks};grid-template-rows:${sizes.join(' ')};grid-template-areas:${rows.map((r) => `'${r}'`).join(' ')};`;
}

const P_AREAS = ['n', 'w', 'c', 'e', 's'];
const W_AREAS = ['a', 'b', 'c', 'd', 'e'];

function renderNode(n: Node, contents: Contents, anchored: Set<string>, itemStyle: string, depth: number): string {
  if (n.type === 'empty') return '';
  // A flex/grid item with max-width gives its leftover space to its siblings. Keep the slot the
  // parent assigned (what the shape model assumes) and center the capped box inside it.
  if (n.maxW !== undefined && itemStyle)
    return `<div class="sw-slot" data-slot="${esc(n.id)}" style="${itemStyle}display:flex;flex-direction:column;min-width:0">${renderNode(n, contents, anchored, '', depth)}</div>`;
  // Leaves get their element from `role`; operators from a semantic tag (e.g. #main).
  const semantic = n.type === 'leaf' ? n.role : n.tags.find((t) => SEMANTIC.has(t));
  const tag = semantic && SEMANTIC.has(semantic) ? semantic : 'div';
  const classes = [n.type === 'leaf' ? 'sw-leaf' : `sw-op sw-${n.kind}`, `sw-d${depth % 4}`, ...n.tags.map((t) => `t-${t}`)];
  let style = itemStyle;
  if (anchored.has(n.id)) style += `anchor-name:${anchorName(n.id)};`;
  if (n.maxW !== undefined) style += `max-width:${n.maxW}px;margin-inline:auto;width:100%;`;
  if (n.minH !== undefined) style += `min-height:${n.minH}px;`;
  if (n.type === 'leaf') {
    const body = n.id in contents ? scopeStyles(contents[n.id], n.id) : placeholder(n);
    // The shape model assumes an image leaf fills its slot width; make the content agree.
    if (n.variants[n.variant]?.kind === 'image') classes.push('sw-fill');
    return `<${tag} id="sw-${cssId(n.id)}" data-sw="${esc(n.id)}" class="${classes.join(' ')}" style="${style}">${body}</${tag}>`;
  }
  style += opStyle(n);
  const ws = weights(n);
  const kids = n.children
    .map((c, i) => {
      let s = '';
      if (n.kind === 'V') s = `flex:${ws[i]} 1 0;`;
      else if (n.kind === 'H') s = columnFlex(ws[i], !!n.ratios, depth === 0, minHOf(c));
      else s = `grid-area:${(n.kind === 'P' ? P_AREAS : W_AREAS)[i]};`;
      return renderNode(c, contents, anchored, s, depth + 1);
    })
    .join('\n');
  return `<${tag} id="sw-${cssId(n.id)}" data-sw="${esc(n.id)}" class="${classes.join(' ')}" style="${style}">\n${kids}\n</${tag}>`;
}

// Overlays sit INSIDE their target, aligned to the chosen corner/edge (box = centered). An earlier
// version straddled the anchor point, which pushed badges on full-width boxes half off-screen and
// made models avoid corner anchors.
const ANCHOR_CSS: Record<Overlay['anchor'], string> = {
  box: 'left:anchor(center);top:anchor(center);translate:-50% -50%;',
  top: 'left:anchor(center);top:anchor(top);translate:-50% 0;',
  bottom: 'left:anchor(center);bottom:anchor(bottom);translate:-50% 0;',
  left: 'left:anchor(left);top:anchor(center);translate:0 -50%;',
  right: 'right:anchor(right);top:anchor(center);translate:0 -50%;',
  'top-left': 'left:anchor(left);top:anchor(top);',
  'top-right': 'right:anchor(right);top:anchor(top);',
  'bottom-left': 'left:anchor(left);bottom:anchor(bottom);',
  'bottom-right': 'right:anchor(right);bottom:anchor(bottom);',
};

export const BASE_CSS = `
*{box-sizing:border-box}
html,body{margin:0}
body{font:${DEFAULT_FONT_PX}px/${DEFAULT_LINE_HEIGHT} system-ui,sans-serif;color:#1d1d1f;background:#fff}
#sw--page>.sw-op,#sw--page>.sw-leaf{min-height:100vh}
.sw-H{display:flex;flex-direction:column;min-width:0}
.sw-V{display:flex;flex-direction:row;min-width:0}
.sw-W,.sw-P{display:grid;min-width:0}
.sw-slot>*{flex:1 1 auto}
.sw-leaf{padding:${LEAF_PAD}px;min-width:0;overflow-wrap:break-word}
:where(.sw-leaf>:first-child){margin-top:0}:where(.sw-leaf>:last-child){margin-bottom:0}
:where(.sw-leaf p){margin:0 0 .6em}
:where(.sw-leaf img){max-width:100%;height:auto;display:block}
:where(.sw-fill img){width:100%}
/* default look of boxes: zero specificity so a box's own scoped CSS always wins */
:where(.sw-d0.sw-leaf){background:#eef3ff}:where(.sw-d1.sw-leaf){background:#f2fbf4}:where(.sw-d2.sw-leaf){background:#fff7ec}:where(.sw-d3.sw-leaf){background:#f8f0ff}
:where(.sw-leaf){outline:1px solid #0001}
.sw-label{font:600 11px/1.2 ui-monospace,monospace;color:#0008;margin-bottom:4px}
.sw-img{background:repeating-linear-gradient(45deg,#0001 0 8px,#0002 8px 16px);max-width:100%}
.t-dark,.t-dark .sw-leaf{background:#1d1d1f;color:#f5f5f7}
.sw-overlay{position:absolute;background:#fff;border:1px solid #0003;border-radius:8px;padding:8px 12px;box-shadow:0 4px 16px #0002}
`;

// ---- responsive rules -> media queries ----

const important = (css: string) => css.split(';').filter(Boolean).map((d) => `${d} !important`).join(';');

/**
 * A column shares its height like a row shares its width: equally, or by its ratios, and never
 * below the content (flex items keep min-height:auto). It only matters when the column has spare
 * height (inside a row, or a fixed height). The page root is the exception: it follows normal page
 * flow, so a short page does not stretch its sections to fill the screen.
 */
function columnFlex(w: number, ratios: boolean, root: boolean, minH = false): string {
  if (root) return ratios ? `flex:${w} 0 auto;` : '';
  // An explicit min-height replaces the flex item's automatic minimum (its content height), so a
  // block with minh would be squeezed below its content from a zero basis. Start it from its
  // content (basis auto, no shrinking): its height is max(content, minh), plus its share of spare.
  return minH ? `flex:${w} 0 auto;` : `flex:${w} 1 0;`;
}

const minHOf = (n: Node) => n.type !== 'empty' && n.minH !== undefined;

function childFlex(op: Op, i: number, root: boolean): string {
  const w = weights(op)[i];
  if (op.kind === 'V') return `flex:${w} 1 0;min-width:0`;
  return columnFlex(w, !!op.ratios, root, minHOf(op.children[i])) || 'flex:0 0 auto';
}

/**
 * For every breakpoint, diff the effective layout against the base layout and restyle only the
 * operators that changed (direction, ratios, children). Generated from the same effective() the
 * shape model uses, so CSS and cost model cannot drift apart.
 */
function rulesCSS(layout: Layout): string {
  if (!layout.rules?.length) return '';
  const base = new Map<string, Node>();
  walk(layout.root, (n) => base.set(n.id, n));
  const kids = (n: Node) => (isOp(n) ? n.children.map((c) => c.id).join(',') : '');
  const breakpoints = [...new Set(layout.rules.map((r) => r.below))].sort((a, b) => b - a);
  const out: string[] = [];
  for (const b of breakpoints) {
    const e = effective(layout, b - 0.5);
    const blocks: string[] = [];
    const present = new Set<string>();
    walk(e.root, (n) => present.add(n.id));
    for (const [id, n] of base) {
      if (!present.has(id) && n.type !== 'empty') blocks.push(`#sw-${cssId(id)},[data-slot="${id}"]{display:none !important}`);
    }
    walk(e.root, (n) => {
      if (!isOp(n)) return;
      const o = base.get(n.id) as Op;
      if (o.kind === n.kind && JSON.stringify(o.ratios) === JSON.stringify(n.ratios) && kids(o) === kids(n)) return;
      const sel = `#sw-${cssId(n.id)}`;
      if (n.kind === 'H' || n.kind === 'V') {
        blocks.push(`${sel}{display:flex !important;flex-direction:${n.kind === 'V' ? 'row' : 'column'} !important}`);
        n.children.forEach((c, i) => {
          if (c.type === 'empty') return;
          blocks.push(`${sel}>#sw-${cssId(c.id)},${sel}>[data-slot="${c.id}"]{${important(childFlex(n, i, n.id === e.root.id))}}`);
        });
      } else blocks.push(`${sel}{${important(opStyle(n))}}`);
    });
    if (blocks.length) out.push(`@media (width < ${b}px){\n${blocks.join('\n')}\n}`);
  }
  return out.join('\n');
}

/** The page split into its generated CSS and body markup (the editor swaps these in place). */
// Wrapper ids start with "sw--": node ids can't start with "-", so cssId() never produces them.
export function renderParts(layout: Layout, contents: Contents = {}): { css: string; body: string } {
  const anchored = new Set(layout.overlays.map((o) => o.target));
  const tree = renderNode(layout.root, contents, anchored, '', 0);
  const overlays = layout.overlays
    .map((o) => `<div id="sw-${cssId(o.id)}" data-sw="${esc(o.id)}" class="sw-overlay" style="position-anchor:${anchorName(o.target)};${ANCHOR_CSS[o.anchor]}z-index:${o.z}">${o.id in contents ? scopeStyles(contents[o.id], o.id) : esc(o.id)}</div>`)
    .join('\n');
  return { css: `${BASE_CSS}${rulesCSS(layout)}`, body: `${tree}\n${overlays}` };
}

export function toHTML(layout: Layout, contents: Contents = {}, opts: { title?: string; css?: string; head?: string; bodyEnd?: string } = {}): string {
  const { css, body } = renderParts(layout, contents);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title ?? 'TYKERF')}</title>
<style id="sw--style">${css}${opts.css ?? ''}</style>
${opts.head ?? ''}
</head>
<body>
<div id="sw--page">
${body}
</div>
${opts.bodyEnd ?? ''}
</body>
</html>
`;
}
