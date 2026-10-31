// Core data model: a page layout is a slicing tree plus overlays.
//
// Operators (floorplanning convention: the letter names the *cut*):
//   H  horizontal cut  -> children stacked top to bottom (flex column), n-ary
//   V  vertical cut    -> children side by side (flex row), n-ary
//   W  wheel/pinwheel  -> 5 children: top, right, bottom, left, center (non-slicing, 3x3 grid)
//   P  periphery       -> 5 slots in reading order: N, W, C, E, S ("_" = empty slot)

export type OpKind = 'H' | 'V' | 'W' | 'P';
export type Align = 'start' | 'center' | 'end' | 'stretch';

export type Shape =
  | { kind: 'text'; chars: number; fontPx?: number; lineHeight?: number }
  | { kind: 'image'; aspect: number }
  | { kind: 'fixed'; w: number; h: number };

export interface Leaf {
  type: 'leaf';
  id: string; // stable identity == the name written in postfix
  role?: string; // semantic tag: header, nav, main, aside, footer, section, article
  tags: string[];
  variants: Shape[]; // alternative shapes (multi-shape cells); empty = unknown content
  variant: number;
  minW?: number; // optimizer hint only (not rendered)
  boxType?: string; // box type (spec §7): placement + content grammar from types/<type>.json
  use?: string; // a shared block of the site (kit/blocks/<use>.html) shown instead of the box's own code
  maxW?: number; // rendered: max-width + centered
  minH?: number; // rendered: min-height in px (taller than its content, never shorter)
}

export interface Empty {
  type: 'empty';
  id: string;
}

export interface Op {
  type: 'op';
  id: string;
  named: boolean; // id given explicitly (op ids are otherwise auto-generated)
  kind: OpKind;
  children: Node[];
  // H/V: one weight per child. P: 3 column weights (west:center:east). W: 3 column weights.
  ratios?: number[];
  gap?: number;
  align?: Align;
  maxW?: number; // rendered: max-width + centered (e.g. a readable centered page column)
  minH?: number; // rendered: min-height in px
  boxType?: string; // a typed container (e.g. "pricing-section"), see types.ts
  tags: string[];
}

export type Node = Leaf | Empty | Op;

export type Anchor =
  | 'box'
  | 'top' | 'bottom' | 'left' | 'right' // a cut (edge)
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'; // an intersection (corner)

export const ANCHORS: Anchor[] = [
  'box', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right',
];

export interface Overlay {
  id: string;
  target: string;
  anchor: Anchor;
  z: number;
}

/**
 * Responsive rewrite rule (block rotation, per breakpoint): applies while viewport width < below.
 *   flip   H<->V; on W/P: stack all slots top to bottom in reading order
 *   ratios override the operator's ratios
 *   hide   remove the node from the layout
 * Several active rules on the same target: the one with the smallest `below` wins (CSS order).
 */
export type RuleAction = 'flip' | 'ratios' | 'hide';
export const RULE_ACTIONS: RuleAction[] = ['flip', 'ratios', 'hide'];

export interface Rule {
  id: string;
  below: number;
  action: RuleAction;
  target: string;
  ratios?: number[];
}

export interface Layout {
  root: Node;
  overlays: Overlay[];
  rules?: Rule[];
}

export const FIXED_ARITY: Partial<Record<OpKind, number>> = { W: 5, P: 5 };
export const SLOT_NAMES: Partial<Record<OpKind, string[]>> = {
  P: ['north', 'west', 'center', 'east', 'south'],
  W: ['top', 'right', 'bottom', 'left', 'center'],
};

/** AI-facing names: the letters name the cut, which models misread (H read as "horizontal row"). */
export const KIND_WORD: Record<OpKind, string> = { H: 'column', V: 'row', W: 'wheel', P: 'periphery' };

export function isOp(n: Node): n is Op {
  return n.type === 'op';
}

export function walk(n: Node, fn: (n: Node, parent: Op | null, index: number) => void, parent: Op | null = null, index = 0): void {
  fn(n, parent, index);
  if (isOp(n)) n.children.forEach((c, i) => walk(c, fn, n, i));
}

export interface Found {
  node: Node;
  parent: Op | null;
  index: number;
  path: number[];
}

export function find(root: Node, id: string): Found | null {
  const rec = (n: Node, parent: Op | null, index: number, path: number[]): Found | null => {
    if (n.id === id) return { node: n, parent, index, path };
    if (isOp(n)) {
      for (let i = 0; i < n.children.length; i++) {
        const r = rec(n.children[i], n, i, [...path, i + 1]);
        if (r) return r;
      }
    }
    return null;
  };
  return rec(root, null, 0, []);
}

export function contains(n: Node, id: string): boolean {
  return find(n, id) !== null;
}

export function allIds(root: Node): Set<string> {
  const s = new Set<string>();
  walk(root, (n) => s.add(n.id));
  return s;
}

export function freshId(root: Node, prefix: string, extra: Iterable<string> = []): string {
  const used = allIds(root);
  for (const e of extra) used.add(e);
  for (let i = 1; ; i++) {
    const id = `${prefix}${i}`;
    if (!used.has(id)) return id;
  }
}

export function clone<T>(x: T): T {
  return structuredClone(x);
}

export function weights(op: Op): number[] {
  return op.ratios ?? op.children.map(() => 1);
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validate(layout: Layout): ValidationResult {
  const errors: string[] = [];
  const seen = new Set<string>();
  walk(layout.root, (n) => {
    if (seen.has(n.id)) errors.push(`duplicate id "${n.id}"`);
    seen.add(n.id);
    if (n.type === 'leaf') {
      if (n.variants.length && (n.variant < 0 || n.variant >= n.variants.length))
        errors.push(`leaf "${n.id}": variant ${n.variant} out of range`);
    } else if (n.type === 'op') {
      const fixed = FIXED_ARITY[n.kind];
      if (fixed !== undefined && n.children.length !== fixed)
        errors.push(`op "${n.id}" (${n.kind}) needs exactly ${fixed} children, has ${n.children.length}`);
      if (fixed === undefined && n.children.length < 2)
        errors.push(`op "${n.id}" (${n.kind}) needs at least 2 children, has ${n.children.length}`);
      if (fixed === undefined && n.children.some((c) => c.type === 'empty'))
        errors.push(`op "${n.id}" (${n.kind}): empty slots are only allowed in W/P`);
      if (n.ratios) {
        const want = fixed === undefined ? n.children.length : 3;
        if (n.ratios.length !== want) errors.push(`op "${n.id}": ${n.ratios.length} ratios, expected ${want}`);
        if (n.ratios.some((r) => !(r >= 0) || !Number.isFinite(r))) errors.push(`op "${n.id}": ratios must be finite and >= 0`);
        if (fixed === undefined && n.ratios.some((r) => r <= 0)) errors.push(`op "${n.id}": H/V ratios must be > 0`);
      }
    }
  });
  if (layout.root.type === 'empty') errors.push('root cannot be empty');
  const ovIds = new Set<string>();
  for (const o of layout.overlays) {
    if (ovIds.has(o.id) || seen.has(o.id)) errors.push(`overlay id "${o.id}" is not unique`);
    ovIds.add(o.id);
    if (!seen.has(o.target)) errors.push(`overlay "${o.id}" targets missing node "${o.target}"`);
    if (!ANCHORS.includes(o.anchor)) errors.push(`overlay "${o.id}": bad anchor "${o.anchor}"`);
  }
  const ruleIds = new Set<string>();
  for (const r of layout.rules ?? []) {
    if (ruleIds.has(r.id)) errors.push(`rule id "${r.id}" is not unique`);
    ruleIds.add(r.id);
    if (!(r.below > 0)) errors.push(`rule "${r.id}": below must be > 0`);
    if (!RULE_ACTIONS.includes(r.action)) errors.push(`rule "${r.id}": bad action "${r.action}"`);
    const f = find(layout.root, r.target);
    if (!f) {
      errors.push(`rule "${r.id}" targets missing node "${r.target}"`);
      continue;
    }
    if (r.action === 'hide' && !f.parent) errors.push(`rule "${r.id}": cannot hide the root`);
    if (r.action === 'flip' && !isOp(f.node)) errors.push(`rule "${r.id}": flip needs an operator, "${r.target}" is a leaf`);
    if (r.action === 'ratios') {
      const n = f.node;
      if (!isOp(n)) errors.push(`rule "${r.id}": ratios needs an operator`);
      else {
        const want = FIXED_ARITY[n.kind] === undefined ? n.children.length : 3;
        if (!r.ratios || r.ratios.length !== want) errors.push(`rule "${r.id}": ${r.ratios?.length ?? 0} ratios, expected ${want}`);
        else if (r.ratios.some((x) => !(x > 0))) errors.push(`rule "${r.id}": ratios must be > 0`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Rules active at viewport width W, in CSS cascade order (largest `below` first). */
export function activeRules(layout: Layout, W: number): Rule[] {
  return (layout.rules ?? []).filter((r) => W < r.below).sort((a, b) => b.below - a.below);
}

/** The layout as it is at viewport width W: active rules applied, rules removed. */
export function effective(layout: Layout, W: number): Layout {
  const l = clone(layout);
  const base = new Map<string, OpKind>();
  walk(layout.root, (n) => isOp(n) && base.set(n.id, n.kind));
  const hidden = new Set<string>();
  for (const r of activeRules(layout, W)) {
    const n = find(l.root, r.target)?.node;
    if (!n) continue;
    if (r.action === 'hide') hidden.add(r.target);
    else if (isOp(n) && r.action === 'ratios') n.ratios = [...r.ratios!];
    else if (isOp(n) && r.action === 'flip') {
      const k = base.get(n.id)!;
      if (k === 'H' || k === 'V') n.kind = k === 'H' ? 'V' : 'H';
      else {
        // stacked W/P: a column of the non-empty slots in reading (DOM) order
        n.kind = 'H';
        n.children = n.children.filter((c) => c.type !== 'empty');
        delete n.ratios;
      }
    }
  }
  const prune = (n: Node): Node => {
    if (!isOp(n)) return n;
    const keep: Node[] = [];
    const ws: number[] = [];
    const w = n.ratios;
    n.children.forEach((c, i) => {
      if (hidden.has(c.id)) {
        if (FIXED_ARITY[n.kind] !== undefined) keep.push({ type: 'empty', id: `${c.id}~hidden` }), ws.push(w?.[i] ?? 1);
      } else keep.push(prune(c)), ws.push(w?.[i] ?? 1);
    });
    n.children = keep;
    if (w && FIXED_ARITY[n.kind] === undefined) n.ratios = ws;
    return n;
  };
  l.root = prune(l.root);
  delete l.rules;
  return l;
}

export function assertValid(layout: Layout): Layout {
  const v = validate(layout);
  if (!v.ok) throw new Error(`invalid layout: ${v.errors.join('; ')}`);
  return layout;
}
