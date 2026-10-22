// References: how people and AIs point at a node (spec §5).
//
//   faq              by name
//   page/row2/faq    path of names from the root (each step verified)
//   row2/2           path from any named node; a number is a 1-based child index
//   #4.2             position from the root (Dewey), "#" so numeric names like "29" stay names
//   /                the root
//
// A path step that is a child's name is a name; otherwise a number is an index.

import { type Layout, type Node, find, isOp } from './model.js';

export class RefError extends Error {}

const childStep = (n: Node, step: string, where: string): Node => {
  if (!isOp(n)) throw new RefError(`"${where}" is a box, it has no children (at "${step}")`);
  const byName = n.children.find((c) => c.id === step);
  if (byName) return byName;
  if (/^\d+$/.test(step)) {
    const i = Number(step);
    if (i < 1 || i > n.children.length) throw new RefError(`"${where}" has ${n.children.length} children, there is no #${i}`);
    return n.children[i - 1];
  }
  const names = n.children.map((c) => c.id).join(', ');
  throw new RefError(`"${step}" is not a child of "${where}" (children: ${names})`);
};

/** Resolve a reference to a node id. Throws a RefError with a helpful message. */
export function resolveRef(layout: Layout, ref: string): string {
  const r = ref.trim().replace(/^@/, '');
  if (!r) throw new RefError('empty reference');
  if (r === '/') return layout.root.id;
  if (r.startsWith('#')) {
    let n = layout.root;
    let where = '/';
    for (const step of r.slice(1).split('.')) {
      if (!/^\d+$/.test(step)) throw new RefError(`bad position "${r}" (use #4.2)`);
      n = childStep(n, step, where);
      where = n.id;
    }
    return n.id;
  }
  const steps = r.replace(/^\//, '').split('/');
  // The first step is a name anywhere in the tree (usually the root's).
  const first = find(layout.root, steps[0]);
  if (!first) throw new RefError(`no node named "${steps[0]}"`);
  let n = first.node;
  for (const step of steps.slice(1)) n = childStep(n, step, n.id);
  return n.id;
}

/** Canonical reference: the path of names from the root, e.g. "page/row2/faq". */
export function pathOf(layout: Layout, id: string): string {
  const f = find(layout.root, id);
  if (!f) throw new RefError(`no node named "${id}"`);
  const names: string[] = [];
  let n: Node = layout.root;
  names.push(n.id);
  for (const i of f.path) {
    n = (n as Extract<Node, { type: 'op' }>).children[i - 1];
    names.push(n.id);
  }
  return names.join('/');
}

/** Position from the root, e.g. "#4.2" ("/" for the root). */
export function positionOf(layout: Layout, id: string): string {
  const f = find(layout.root, id);
  if (!f) throw new RefError(`no node named "${id}"`);
  return f.path.length ? `#${f.path.join('.')}` : '/';
}
