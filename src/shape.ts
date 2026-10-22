// Shape functions (VLSI floorplanning style): every leaf has height = f(width); operators combine
// them bottom-up. optimize() tunes operator ratios and leaf variants (multi-shape cells) at a given
// viewport width, minimizing page height + wasted space + penalties (line length, min widths).

import { type Layout, type Node, type Op, type Shape, clone, effective, isOp, walk, weights } from './model.js';

// Shared with render.ts so the model and the rendered page agree.
export const LEAF_PAD = 12;
export const DEFAULT_FONT_PX = 16;
export const DEFAULT_LINE_HEIGHT = 1.5;
export const CHAR_W_EM = 0.5; // average glyph advance of system-ui text, in em

const ALPHA = 0.5; // weight of wasted space (px² / page width -> px of height)
const LINE_K = 1; // px per char outside the 45–75 chars/line band, per line
const MINW_K = 4; // px per px of min-width violation

export interface Cost {
  height: number;
  waste: number; // px²: page area not used by content
  penalty: number;
  cost: number;
}

interface Ev {
  h: number;
  used: number; // px² of the allotted area actually covered by content
  pen: number;
}

export function shapeHeight(s: Shape, w: number): { h: number; used: number; pen: number } {
  const wc = Math.max(1, w - 2 * LEAF_PAD);
  if (s.kind === 'image') {
    const h = wc / s.aspect + 2 * LEAF_PAD;
    return { h, used: w * h, pen: 0 };
  }
  if (s.kind === 'fixed') {
    const h = s.h + 2 * LEAF_PAD;
    return { h, used: Math.min(w, s.w + 2 * LEAF_PAD) * h, pen: Math.max(0, s.w - wc) * MINW_K };
  }
  const font = s.fontPx ?? DEFAULT_FONT_PX;
  const lineH = font * (s.lineHeight ?? DEFAULT_LINE_HEIGHT);
  const charW = font * CHAR_W_EM;
  const cpl = Math.max(1, Math.floor(wc / charW));
  const lines = Math.ceil(s.chars / cpl);
  const eff = Math.min(cpl, s.chars);
  let dev = Math.max(0, eff - 75);
  if (s.chars > 45) dev += Math.max(0, 45 - eff);
  const h = lines * lineH + 2 * LEAF_PAD;
  // A short text doesn't use the whole box width: only the inked width counts as used.
  return { h, used: (Math.min(wc, s.chars * charW) + 2 * LEAF_PAD) * h, pen: dev * lines * LINE_K };
}

/** Column weights used for P/W ([west, center, east] / three grid columns). */
export function columnWeights(op: Op): number[] {
  if (op.kind === 'P') {
    const r = op.ratios ?? [1, 3, 1];
    return [op.children[1].type === 'empty' ? 0 : r[0], r[1], op.children[3].type === 'empty' ? 0 : r[2]];
  }
  return op.ratios ?? [1, 1, 1];
}

function split(total: number, ws: number[], gap: number): number[] {
  const present = ws.filter((w) => w > 0).length;
  const avail = Math.max(0, total - gap * Math.max(0, present - 1));
  const sum = ws.reduce((a, b) => a + b, 0) || 1;
  return ws.map((w) => (avail * w) / sum);
}

function ev(n: Node, W: number): Ev {
  if (n.type === 'empty') return { h: 0, used: 0, pen: 0 };
  const e = evContent(n, W);
  return n.minH !== undefined && n.minH > e.h ? { ...e, h: n.minH } : e; // min-height: taller, never shorter
}

function evContent(n: Exclude<Node, { type: 'empty' }>, W: number): Ev {
  if (n.maxW !== undefined && n.maxW < W) W = n.maxW; // centered column: the side margins count as waste
  if (n.type === 'leaf') {
    const pen = n.minW !== undefined ? Math.max(0, n.minW - W) * MINW_K : 0;
    if (!n.variants.length) {
      const h = 3 * DEFAULT_FONT_PX * DEFAULT_LINE_HEIGHT;
      return { h, used: W * h, pen };
    }
    const r = shapeHeight(n.variants[n.variant], W);
    return { h: r.h, used: r.used, pen: pen + r.pen };
  }
  const gap = n.gap ?? 0;
  if (n.kind === 'H') {
    const cs = n.children.map((c) => ev(c, W));
    return sum(cs, cs.reduce((a, c) => a + c.h, 0) + gap * (cs.length - 1));
  }
  if (n.kind === 'V') {
    const ws = split(W, weights(n), gap);
    const cs = n.children.map((c, i) => ev(c, ws[i]));
    return sum(cs, Math.max(...cs.map((c) => c.h)));
  }
  if (n.kind === 'P') {
    const [north, west, center, east, south] = n.children;
    const ws = split(W, columnWeights(n), gap);
    const eN = ev(north, W), eS = ev(south, W);
    const mid = [ev(west, ws[0]), ev(center, ws[1]), ev(east, ws[2])];
    const rows = [eN.h, Math.max(...mid.map((c) => c.h)), eS.h].filter((h) => h > 0);
    return sum([eN, eS, ...mid], rows.reduce((a, b) => a + b, 0) + gap * Math.max(0, rows.length - 1));
  }
  // W (pinwheel), grid areas: "a a b" / "d e b" / "d c c"; children = top(a), right(b), bottom(c), left(d), center(e)
  const [c1, c2, c3] = split(W, columnWeights(n), gap);
  const [a, b, c, d, e] = [ev(n.children[0], c1 + gap + c2), ev(n.children[1], c3), ev(n.children[2], c2 + gap + c3), ev(n.children[3], c1), ev(n.children[4], c2)];
  const r2 = Math.max(e.h, b.h - a.h - gap, d.h - c.h - gap, 0);
  return sum([a, b, c, d, e], a.h + r2 + c.h + 2 * gap);
}

function sum(cs: Ev[], h: number): Ev {
  return { h, used: cs.reduce((a, c) => a + c.used, 0), pen: cs.reduce((a, c) => a + c.pen, 0) };
}

export function cost(layout: Layout, W: number): Cost {
  const r = ev(effective(layout, W).root, W);
  const waste = Math.max(0, W * r.h - r.used);
  return { height: r.h, waste, penalty: r.pen, cost: r.h + (ALPHA * waste) / W + r.pen };
}

export interface OptimizeResult {
  layout: Layout;
  before: Cost;
  after: Cost;
  changes: string[];
}

const FACTORS = [0.5, 0.8, 1.25, 2];
const MIN_FRAC = 0.08;

/**
 * Coordinate descent over (a) ratios of every V/P/W operator and (b) variants of every leaf.
 * Constraints: `#lock` freezes a node, `#equal` forces equal ratios (matching constraint).
 */
export function optimize(layout: Layout, W: number, maxRounds = 60): OptimizeResult {
  const l = clone(layout);
  const before = cost(l, W);
  const ops: Op[] = [];
  const leaves: { id: string; n: number; set: (v: number) => void; get: () => number }[] = [];
  walk(l.root, (n) => {
    if (n.type === 'empty' || n.tags.includes('lock')) return;
    if (isOp(n)) {
      if (n.tags.includes('equal')) delete n.ratios;
      else if (n.kind !== 'H') ops.push(n);
    } else if (n.variants.length > 1) {
      leaves.push({ id: n.id, n: n.variants.length, set: (v) => (n.variant = v), get: () => n.variant });
    }
  });

  let best = cost(l, W).cost;
  const tryState = (apply: () => void, undo: () => void): boolean => {
    apply();
    const c = cost(l, W).cost;
    if (c < best - 1e-6) {
      best = c;
      return true;
    }
    undo();
    return false;
  };

  for (let round = 0; round < maxRounds; round++) {
    let improved = false;
    for (const op of ops) {
      const base = op.kind === 'V' ? weights(op) : columnWeights(op);
      let cur = [...base];
      for (let i = 0; i < cur.length; i++) {
        if (cur[i] === 0) continue;
        for (const f of FACTORS) {
          const next = [...cur];
          next[i] *= f;
          const s = next.reduce((a, b) => a + b, 0);
          if (next.some((x) => x > 0 && x / s < MIN_FRAC)) continue;
          const prev = op.ratios;
          if (tryState(() => (op.ratios = next), () => (op.ratios = prev))) {
            cur = next;
            improved = true;
          }
        }
      }
    }
    for (const lf of leaves) {
      for (let v = 0; v < lf.n; v++) {
        const prev = lf.get();
        if (v !== prev && tryState(() => lf.set(v), () => lf.set(prev))) improved = true;
      }
    }
    if (!improved) break;
  }

  // Tidy ratios: relative to the smallest positive weight, 2 decimals.
  const changes: string[] = [];
  const orig = new Map<string, Node>();
  walk(layout.root, (n) => orig.set(n.id, n));
  for (const op of ops) {
    if (!op.ratios) continue;
    const min = Math.min(...op.ratios.filter((x) => x > 0));
    op.ratios = op.ratios.map((x) => Number((x / min).toFixed(2)));
    if (op.kind === 'P') {
      // keep 0 placeholders out of the stored form: empty side slots are ignored anyway
      op.ratios = op.ratios.map((x) => (x === 0 ? 1 : x));
    }
    const o = orig.get(op.id) as Op;
    if (JSON.stringify(o.ratios) !== JSON.stringify(op.ratios)) changes.push(`${op.id} ratios -> ${op.ratios.join(':')}`);
  }
  for (const lf of leaves) {
    const o = orig.get(lf.id);
    if (o?.type === 'leaf' && o.variant !== lf.get()) changes.push(`${lf.id} variant -> ${lf.get()}`);
  }
  return { layout: l, before, after: cost(l, W), changes };
}
