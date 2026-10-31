// Pure moves on a layout: (layout, args) -> new layout. Every move validates its result and
// throws on bad arguments, so a sequence of successful moves can never produce an invalid tree.
//
// VLSI correspondence (Wong & Liu): swap = M1, flip = M2 (operator complement / block rotation),
// wrap/unwrap/move = M3-style re-nesting.

import {
  type Align, type Anchor, type Layout, type Leaf, type Node, type Op, type OpKind, type Rule, type RuleAction, type Shape,
  ANCHORS, FIXED_ARITY, assertValid, validate, clone, contains, find, freshId, isOp, walk, weights,
} from './model.js';
import { normalize } from './notation.js';

export class MoveError extends Error {}

function mustFind(layout: Layout, id: string) {
  const f = find(layout.root, id);
  if (!f) throw new MoveError(`no node with id "${id}"`);
  return f;
}

function mustOp(layout: Layout, id: string): Op {
  const n = mustFind(layout, id).node;
  if (!isOp(n)) throw new MoveError(`"${id}" is not an operator`);
  return n;
}

function mustLeaf(layout: Layout, id: string): Leaf {
  const n = mustFind(layout, id).node;
  if (n.type !== 'leaf') throw new MoveError(`"${id}" is not a leaf`);
  return n;
}

const isCut = (k: OpKind) => k === 'H' || k === 'V';

function checkNewId(layout: Layout, id: string) {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(id) || /^[HVWP]\d*$/.test(id))
    throw new MoveError(`"${id}" is not a valid name (letters, digits, _ . -; must not look like an operator)`);
  if (find(layout.root, id) || layout.overlays.some((o) => o.id === id)) throw new MoveError(`id "${id}" already exists`);
}

function replaceNode(layout: Layout, id: string, by: Node) {
  const f = mustFind(layout, id);
  if (f.parent) f.parent.children[f.index] = by;
  else layout.root = by;
}

/** Collapse H/V operators left with a single child (keeps the slot's weight in the grandparent). */
function collapse(layout: Layout) {
  const rec = (n: Node): Node => {
    if (!isOp(n)) return n;
    n.children = n.children.map(rec);
    if (isCut(n.kind) && n.children.length === 1) return n.children[0];
    return n;
  };
  layout.root = rec(layout.root);
}

function finish(layout: Layout): Layout {
  layout.overlays = layout.overlays.filter((o) => find(layout.root, o.target));
  // Rules follow their target: dropped when it vanishes, a ratios rule when its arity no longer matches.
  if (layout.rules) {
    layout.rules = layout.rules.filter((r) => {
      const n = find(layout.root, r.target)?.node;
      if (!n) return false;
      if (r.action === 'ratios') return isOp(n) && r.ratios!.length === (FIXED_ARITY[n.kind] === undefined ? n.children.length : 3);
      if (r.action === 'flip') return isOp(n);
      return true;
    });
    if (!layout.rules.length) delete layout.rules;
  }
  return assertValid(layout);
}

function mutate(layout: Layout, fn: (l: Layout) => void): Layout {
  const l = clone(layout);
  fn(l);
  return finish(l);
}

/** M1: exchange two subtrees (their weights travel with them). */
export function swap(layout: Layout, a: string, b: string): Layout {
  return mutate(layout, (l) => {
    if (a === b) throw new MoveError('cannot swap a node with itself');
    const fa = mustFind(l, a);
    const fb = mustFind(l, b);
    if (contains(fa.node, b) || contains(fb.node, a)) throw new MoveError('cannot swap a node with its own ancestor/descendant');
    const pa = fa.parent!;
    const pb = fb.parent!;
    pa.children[fa.index] = fb.node;
    pb.children[fb.index] = fa.node;
    if (pa === pb) {
      if (pa.ratios && isCut(pa.kind)) [pa.ratios[fa.index], pa.ratios[fb.index]] = [pa.ratios[fb.index], pa.ratios[fa.index]];
    } else if (pa.ratios && pb.ratios && isCut(pa.kind) && isCut(pb.kind)) {
      [pa.ratios[fa.index], pb.ratios[fb.index]] = [pb.ratios[fb.index], pa.ratios[fa.index]];
    }
  });
}

/** M2: complement an operator (H <-> V); the block-rotation / responsive flip. */
export function flip(layout: Layout, opId: string): Layout {
  return mutate(layout, (l) => {
    const op = mustOp(l, opId);
    if (!isCut(op.kind)) throw new MoveError(`only H/V can be flipped, "${opId}" is ${op.kind}`);
    op.kind = op.kind === 'H' ? 'V' : 'H';
  });
}

/** Group contiguous siblings under a new H/V operator. */
export function wrap(layout: Layout, ids: string[], kind: 'H' | 'V', newId?: string): Layout {
  return mutate(layout, (l) => {
    if (ids.length < 2) throw new MoveError('wrap needs at least 2 sibling ids');
    if (newId) checkNewId(l, newId);
    const fs = ids.map((id) => mustFind(l, id));
    const parent = fs[0].parent;
    if (!parent || fs.some((f) => f.parent !== parent)) throw new MoveError('wrap ids must be siblings');
    if (!isCut(parent.kind)) throw new MoveError('wrap works inside H/V operators only');
    const idx = fs.map((f) => f.index).sort((x, y) => x - y);
    if (idx.some((v, i) => i > 0 && v !== idx[i - 1] + 1)) throw new MoveError('wrap ids must be contiguous siblings');
    if (idx.length === parent.children.length) throw new MoveError('wrapping all children of an operator changes nothing; use flip or wrap fewer');
    const pw = weights(parent);
    const group: Op = {
      type: 'op', id: newId ?? freshId(l.root, 'o'), named: newId !== undefined, kind, tags: [],
      children: parent.children.slice(idx[0], idx[0] + idx.length),
    };
    const gw = idx.map((i) => pw[i]);
    if (kind === parent.kind && parent.ratios) group.ratios = gw;
    parent.children.splice(idx[0], idx.length, group);
    if (parent.ratios) parent.ratios.splice(idx[0], idx.length, gw.reduce((a, b) => a + b, 0));
  });
}

/** Dissolve an operator into its parent (inverse of wrap). */
export function unwrap(layout: Layout, opId: string): Layout {
  return mutate(layout, (l) => {
    const f = mustFind(l, opId);
    const op = f.node;
    if (!isOp(op) || !isCut(op.kind)) throw new MoveError(`"${opId}" must be an H/V operator`);
    const parent = f.parent;
    if (!parent) throw new MoveError('cannot unwrap the root');
    if (!isCut(parent.kind)) throw new MoveError('cannot unwrap into a W/P slot (fixed arity)');
    const cw = weights(op);
    const sum = cw.reduce((a, b) => a + b, 0);
    if (parent.ratios) parent.ratios.splice(f.index, 1, ...cw.map((w) => (parent.ratios![f.index] * w) / sum));
    else if (op.ratios) {
      parent.ratios = parent.children.flatMap((_, i) => (i === f.index ? cw.map((w) => w / sum) : [1]));
    }
    parent.children.splice(f.index, 1, ...op.children);
  });
}

/** Turn a leaf into an operator: the leaf becomes the first child (P: the center) plus new leaves. */
export function split(layout: Layout, leafId: string, kind: OpKind, n = 2, names?: string[]): Layout {
  return mutate(layout, (l) => {
    const leaf = mustLeaf(l, leafId);
    const fixed = FIXED_ARITY[kind];
    const count = fixed ?? n;
    if (count < 2) throw new MoveError('split needs n >= 2');
    const newNames = names ?? [];
    if (newNames.length && newNames.length !== count - 1) throw new MoveError(`split into ${count} blocks keeps "${leafId}" as the first and makes ${count - 1} new ones, so it needs ${count - 1} new names, not ${newNames.length} (leave n out to use names.length + 1)`);
    const fresh: Leaf[] = [];
    for (let i = 0; i < count - 1; i++) {
      const id = newNames[i] ?? freshId(l.root, `${leafId}.`, fresh.map((x) => x.id));
      checkNewId(l, id);
      if (fresh.some((x) => x.id === id)) throw new MoveError(`duplicate new name "${id}"`);
      fresh.push({ type: 'leaf', id, tags: [], variants: [], variant: 0 });
    }
    const op: Op = { type: 'op', id: freshId(l.root, 'o'), named: false, kind, tags: [], children: [] };
    // P keeps the original in the center slot (index 2), W in the center slot (index 4).
    const centerAt = kind === 'P' ? 2 : kind === 'W' ? 4 : 0;
    op.children = [...fresh];
    op.children.splice(centerAt, 0, leaf);
    replaceNode(l, leafId, op);
  });
}

/** Insert a new leaf into an H/V operator at index (0-based), or into an empty W/P slot. */
export function addLeaf(layout: Layout, parentId: string, index: number, name: string, attrs: LeafAttrs = {}): Layout {
  return mutate(layout, (l) => {
    checkNewId(l, name);
    const parent = mustOp(l, parentId);
    const leaf: Leaf = { type: 'leaf', id: name, tags: [], variants: [], variant: 0 };
    applyLeafAttrs(leaf, attrs);
    insertInto(parent, index, leaf);
  });
}

/**
 * Replace a leaf with a whole subtree (a section copied from another page), plus the responsive
 * rules that target it. The subtree's root may keep the leaf's name; every other name must be new.
 */
export function graft(layout: Layout, leafId: string, sub: Node, rules: Rule[] = []): Layout {
  return mutate(layout, (l) => {
    mustLeaf(l, leafId);
    walk(sub, (n) => {
      if (n.type !== 'empty' && !(n === sub && n.id === leafId)) checkNewId(l, n.id);
    });
    replaceNode(l, leafId, clone(sub));
    if (rules.length) l.rules = [...(l.rules ?? []), ...clone(rules)];
  });
}

/**
 * A new empty leaf next to any block, in direction `kind` (V = beside, H = below/above). If the
 * block's parent already runs that way the leaf joins it as a sibling (the tree stays flat);
 * otherwise the block is replaced by a new `kind` operator holding the block and the leaf.
 * The root has no siblings: when it runs that way itself the leaf goes at its end (or start),
 * instead of wrapping the whole page in a new operator.
 */
export function insertNext(layout: Layout, id: string, kind: 'H' | 'V', name: string, before = false): Layout {
  return mutate(layout, (l) => {
    checkNewId(l, name);
    const f = mustFind(l, id);
    const leaf: Leaf = { type: 'leaf', id: name, tags: [], variants: [], variant: 0 };
    if (f.parent?.kind === kind) return insertInto(f.parent, f.index + (before ? 0 : 1), leaf);
    if (!f.parent && isOp(f.node) && f.node.kind === kind) return insertInto(f.node, before ? 0 : f.node.children.length, leaf);
    const op: Op = { type: 'op', id: freshId(l.root, 'o'), named: false, kind, tags: [], children: before ? [leaf, f.node] : [f.node, leaf] };
    replaceNode(l, id, op);
  });
}

function insertInto(parent: Op, index: number, node: Node) {
  if (isCut(parent.kind)) {
    if (index < 0 || index > parent.children.length) throw new MoveError(`index ${index} out of range 0..${parent.children.length}`);
    parent.children.splice(index, 0, node);
    if (parent.ratios) {
      const avg = parent.ratios.reduce((a, b) => a + b, 0) / parent.ratios.length;
      parent.ratios.splice(index, 0, Number(avg.toFixed(4)));
    }
  } else {
    if (parent.children[index]?.type !== 'empty') throw new MoveError(`slot ${index} of ${parent.kind} "${parent.id}" is not empty`);
    parent.children[index] = node;
  }
}

/** Delete a subtree. H/V parents left with one child collapse; in W/P the slot becomes empty. */
export function remove(layout: Layout, id: string): Layout {
  return mutate(layout, (l) => {
    const f = mustFind(l, id);
    if (!f.parent) throw new MoveError('cannot remove the root');
    detach(l, f.parent, f.index);
    collapse(l);
  });
}

function detach(l: Layout, parent: Op, index: number): Node {
  const node = parent.children[index];
  if (isCut(parent.kind)) {
    parent.children.splice(index, 1);
    parent.ratios?.splice(index, 1);
  } else {
    parent.children[index] = { type: 'empty', id: freshId(l.root, '_') };
  }
  return node;
}

/** Move a subtree to another operator (index 0-based; for W/P the index is an empty slot). */
export function move(layout: Layout, id: string, newParentId: string, index: number): Layout {
  return mutate(layout, (l) => {
    const f = mustFind(l, id);
    if (!f.parent) throw new MoveError('cannot move the root');
    const target = mustOp(l, newParentId);
    if (contains(f.node, newParentId)) throw new MoveError('cannot move a node into its own subtree');
    let at = index;
    if (target === f.parent && isCut(target.kind) && f.index < index) at -= 1;
    const node = detach(l, f.parent, f.index);
    insertInto(target, at, node);
    collapse(l);
  });
}

export function setRatios(layout: Layout, opId: string, ratios: number[] | null): Layout {
  return mutate(layout, (l) => {
    const op = mustOp(l, opId);
    if (ratios === null) delete op.ratios;
    else op.ratios = [...ratios];
  });
}

export function setOp(layout: Layout, opId: string, attrs: { gap?: number | null; align?: Align | null; maxW?: number | null; minH?: number | null; boxType?: string | null }): Layout {
  return mutate(layout, (l) => {
    const op = mustOp(l, opId);
    if (attrs.boxType === null) delete op.boxType;
    else if (attrs.boxType !== undefined) op.boxType = attrs.boxType;
    if (attrs.maxW === null) delete op.maxW;
    else if (attrs.maxW !== undefined) op.maxW = attrs.maxW;
    if (attrs.minH === null) delete op.minH;
    else if (attrs.minH !== undefined) op.minH = checkMinH(attrs.minH);
    if (attrs.gap === null) delete op.gap;
    else if (attrs.gap !== undefined) op.gap = attrs.gap;
    if (attrs.align === null) delete op.align;
    else if (attrs.align !== undefined) op.align = attrs.align;
  });
}

export interface LeafAttrs {
  role?: string | null;
  shapes?: Shape[];
  minW?: number | null;
  maxW?: number | null;
  minH?: number | null;
  boxType?: string | null;
  /** a shared block of the site to show instead of the box's own code; null unlinks */
  use?: string | null;
}

function checkMinH(h: number): number {
  if (!(h >= 0 && h <= 10000)) throw new MoveError(`minh must be between 0 and 10000 px, got ${h}`);
  return Math.round(h);
}

function applyLeafAttrs(leaf: Leaf, a: LeafAttrs) {
  if (a.role === null) delete leaf.role;
  else if (a.role !== undefined) leaf.role = a.role;
  if (a.shapes) {
    leaf.variants = a.shapes;
    if (leaf.variant >= a.shapes.length) leaf.variant = 0;
  }
  if (a.minW === null) delete leaf.minW;
  else if (a.minW !== undefined) leaf.minW = a.minW;
  if (a.maxW === null) delete leaf.maxW;
  else if (a.maxW !== undefined) leaf.maxW = a.maxW;
  if (a.minH === null) delete leaf.minH;
  else if (a.minH !== undefined) leaf.minH = checkMinH(a.minH);
  if (a.boxType === null) delete leaf.boxType;
  else if (a.boxType !== undefined) leaf.boxType = a.boxType;
  if (a.use === null) delete leaf.use;
  else if (a.use !== undefined) {
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(a.use)) throw new MoveError(`bad shared block name "${a.use}"`);
    leaf.use = a.use;
  }
}

export function setLeaf(layout: Layout, leafId: string, attrs: LeafAttrs): Layout {
  return mutate(layout, (l) => applyLeafAttrs(mustLeaf(l, leafId), attrs));
}

export function setVariant(layout: Layout, leafId: string, variant: number): Layout {
  return mutate(layout, (l) => {
    mustLeaf(l, leafId).variant = variant;
  });
}

export function tag(layout: Layout, id: string, t: string): Layout {
  return mutate(layout, (l) => {
    const n = mustFind(l, id).node;
    if (n.type === 'empty') throw new MoveError('cannot tag an empty slot');
    if (!/^[A-Za-z0-9_-]+$/.test(t)) throw new MoveError(`bad tag "${t}"`);
    if (!n.tags.includes(t)) n.tags.push(t);
  });
}

export function untag(layout: Layout, id: string, t: string): Layout {
  return mutate(layout, (l) => {
    const n = mustFind(l, id).node;
    if (n.type !== 'empty') n.tags = n.tags.filter((x) => x !== t);
  });
}

export function attachOverlay(layout: Layout, overlayId: string, target: string, anchor: Anchor = 'box', z = 10): Layout {
  return mutate(layout, (l) => {
    checkNewId(l, overlayId);
    mustFind(l, target);
    if (!ANCHORS.includes(anchor)) throw new MoveError(`bad anchor "${anchor}"`);
    l.overlays.push({ id: overlayId, target, anchor, z });
  });
}

/**
 * Rename a node or overlay and rewrite every reference to it (rules, overlay targets) in the same
 * step. The box's code file is moved by Workspace.rename, which calls this.
 */
export function rename(layout: Layout, id: string, newName: string): Layout {
  return mutate(layout, (l) => {
    if (id === newName) throw new MoveError(`"${id}" already has that name`);
    checkNewId(l, newName);
    const ov = l.overlays.find((o) => o.id === id);
    if (ov) {
      ov.id = newName;
      return;
    }
    const n = mustFind(l, id).node;
    if (n.type === 'empty') throw new MoveError('an empty slot has no name');
    n.id = newName;
    if (isOp(n)) n.named = true;
    for (const o of l.overlays) if (o.target === id) o.target = newName;
    for (const r of l.rules ?? []) if (r.target === id) r.target = newName;
  });
}

export function detachOverlay(layout: Layout, overlayId: string): Layout {
  return mutate(layout, (l) => {
    const before = l.overlays.length;
    l.overlays = l.overlays.filter((o) => o.id !== overlayId);
    if (l.overlays.length === before) throw new MoveError(`no overlay "${overlayId}"`);
  });
}

/** Responsive rule: while the viewport is narrower than `below` px, flip / re-ratio / hide `target`. */
export function addRule(layout: Layout, below: number, action: RuleAction, target: string, ratios?: number[], id?: string): Layout {
  return mutate(layout, (l) => {
    const rid = id ?? freshId(l.root, 'r', (l.rules ?? []).map((r) => r.id));
    if ((l.rules ?? []).some((r) => r.id === rid)) throw new MoveError(`rule "${rid}" already exists`);
    mustFind(l, target);
    if (action === 'ratios' && !ratios) throw new MoveError('a ratios rule needs ratios');
    const rule = { id: rid, below, action, target, ...(action === 'ratios' ? { ratios: [...ratios!] } : {}) };
    // finish() silently drops stale rules, so a *new* invalid rule must be rejected here.
    const v = validate({ root: l.root, overlays: [], rules: [rule] });
    if (!v.ok) throw new MoveError(v.errors.join('; '));
    l.rules = [...(l.rules ?? []), rule];
  });
}

export function removeRule(layout: Layout, id: string): Layout {
  return mutate(layout, (l) => {
    const before = l.rules?.length ?? 0;
    l.rules = (l.rules ?? []).filter((r) => r.id !== id);
    if (l.rules.length === before) throw new MoveError(`no rule "${id}"`);
  });
}

/** Canonical form: nested operators of the same kind merged into one (see notation.normalize). */
export function normalizeLayout(layout: Layout): Layout {
  return mutate(layout, (l) => {
    l.root = normalize(l.root);
  });
}
