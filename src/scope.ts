// Scope (spec §5/§8): when a request names a block, the AI may change only that block's subtree.
// Enforced by comparing everything *outside* the scope before and after a change, so no move,
// present or future, can slip past it.

import { type Layout, type Node, clone, find, isOp, walk } from './model.js';
import { serialize } from './notation.js';

const PLACEHOLDER = '__scope__';

function idsIn(n: Node): Set<string> {
  const s = new Set<string>();
  walk(n, (x) => s.add(x.id));
  return s;
}

/** Text form of everything outside the scope: the tree with the scope as one opaque box, plus the
 *  rules and overlays that target nodes outside it. */
export function outsideSignature(layout: Layout, scopeId: string): string | null {
  const f = find(layout.root, scopeId);
  if (!f) return null;
  const inside = idsIn(f.node);
  const l = clone(layout);
  const g = find(l.root, scopeId)!;
  const ph: Node = { type: 'leaf', id: PLACEHOLDER, tags: [], variants: [], variant: 0 };
  if (g.parent) g.parent.children[g.index] = ph;
  else l.root = ph;
  const rules = (layout.rules ?? []).filter((r) => !inside.has(r.target)).map((r) => `${r.id} ${r.below} ${r.action} ${r.target} ${r.ratios ?? ''}`).sort();
  const overlays = layout.overlays.filter((o) => !inside.has(o.target)).map((o) => `${o.id} ${o.target} ${o.anchor} ${o.z}`).sort();
  return [serialize(l.root, { ids: true }), ...rules, ...overlays].join('\n');
}

/** Text form of everything inside a block: its subtree plus the rules and overlays that target it
 *  (the counterpart of outsideSignature, for keeping others off a block while the AI works on it). */
export function insideSignature(layout: Layout, id: string): string | null {
  const f = find(layout.root, id);
  if (!f) return null;
  const inside = idsIn(f.node);
  const rules = (layout.rules ?? []).filter((r) => inside.has(r.target)).map((r) => `${r.id} ${r.below} ${r.action} ${r.target} ${r.ratios ?? ''}`).sort();
  const overlays = layout.overlays.filter((o) => inside.has(o.target)).map((o) => `${o.id} ${o.target} ${o.anchor} ${o.z}`).sort();
  return [serialize(f.node, { ids: true }), ...rules, ...overlays].join('\n');
}

/** Why a change would touch something outside the scope, or null if it stays inside. */
export function scopeViolation(prev: Layout, next: Layout, scopePrev: string, scopeNext = scopePrev): string | null {
  const a = outsideSignature(prev, scopePrev);
  if (a === null) return `the scope "${scopePrev}" no longer exists; set a new scope`;
  const b = outsideSignature(next, scopeNext);
  if (b === null) return `this change would remove the scope block "${scopePrev}" itself (e.g. by dissolving it); focus on its parent instead`;
  if (a !== b) return `this change would modify the page outside the scope "${scopePrev}"`;
  return null;
}

export function inScope(layout: Layout, scopeId: string, id: string): boolean {
  const f = find(layout.root, scopeId);
  return !!f && (f.node.id === id || (isOp(f.node) && find(f.node, id) !== null));
}
