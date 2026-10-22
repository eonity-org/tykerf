// Box types (spec §7), after schema-driven component editors: a semantic grammar on top of the
// structural one. A type says where a block may be placed and what its code may contain.
//
//   types/<type>.json
//   {
//     "label":    { "en": "FAQ list", "es": "Lista de preguntas" },
//     "within":   ["main-area"],          // must have an ancestor of one of these types
//     "notWithin":["site-header"],        // must not have an ancestor of these types
//     "children": ["widget", "faq-list"], // (containers) typed blocks inside must be of these types
//     "max": 1,                           // at most this many in the page
//     "content":  { "tags": ["h3","details","summary","p"], "scripts": false, "styles": true },
//     "template": "templates/faq-list.html"
//   }
//
// Untyped blocks are not checked (gradual typing); untyped rows/columns are transparent for
// "children", so arranging typed blocks in rows and columns never breaks a container's grammar.

import { type Layout, type Node, isOp, walk } from './model.js';
import type { Store } from './store.js';

export interface TypeDef {
  label?: Record<string, string>;
  within?: string[];
  notWithin?: string[];
  children?: string[];
  max?: number;
  content?: { tags?: string[]; scripts?: boolean; styles?: boolean };
  template?: string;
}

export type Registry = Record<string, TypeDef>;

const KEYS = new Set(['label', 'within', 'notWithin', 'children', 'max', 'content', 'template']);

export function loadTypes(store: Store): Registry {
  const reg: Registry = {};
  for (const f of store.list('types')) {
    if (!f.endsWith('.json')) continue;
    const name = f.slice(0, -5);
    const def = JSON.parse(store.read(`types/${f}`) ?? '{}') as TypeDef;
    for (const k of Object.keys(def)) if (!KEYS.has(k)) throw new Error(`types/${f}: unknown key "${k}" (allowed: ${[...KEYS].join(', ')})`);
    reg[name] = def;
  }
  return reg;
}

const typeOf = (n: Node) => (n.type === 'empty' ? undefined : n.boxType);

/** Every violation of the type grammar in a layout (empty = valid). */
export function typeErrors(layout: Layout, reg: Registry): string[] {
  const errors: string[] = [];
  const counts = new Map<string, number>();
  const visit = (n: Node, ancestors: string[]) => {
    const t = typeOf(n);
    if (t) {
      const def = reg[t];
      if (!def) errors.push(`"${n.id}": unknown type "${t}" (known: ${Object.keys(reg).join(', ') || 'none'})`);
      else {
        counts.set(t, (counts.get(t) ?? 0) + 1);
        if (def.within?.length && !ancestors.some((a) => def.within!.includes(a)))
          errors.push(`"${n.id}" (${t}) must be inside a ${def.within.join(' or ')}`);
        const bad = ancestors.find((a) => def.notWithin?.includes(a));
        if (bad) errors.push(`"${n.id}" (${t}) cannot be inside a ${bad}`);
        if (def.children && isOp(n)) {
          for (const d of typedFrontier(n)) {
            const dt = typeOf(d)!;
            if (!def.children.includes(dt)) errors.push(`"${d.id}" (${dt}) is not allowed in "${n.id}" (${t}); allowed: ${def.children.join(', ')}`);
          }
        }
      }
    }
    if (isOp(n)) n.children.forEach((c) => visit(c, t ? [...ancestors, t] : ancestors));
  };
  visit(layout.root, []);
  for (const [t, c] of counts) {
    const max = reg[t]?.max;
    if (max !== undefined && c > max) errors.push(`type "${t}" appears ${c} times, at most ${max} allowed`);
  }
  return errors;
}

/** Typed blocks inside a container, looking through untyped rows/columns. */
function typedFrontier(op: Extract<Node, { type: 'op' }>): Node[] {
  const out: Node[] = [];
  const rec = (n: Node) => {
    if (n.type === 'empty') return;
    if (n.boxType) out.push(n);
    else if (isOp(n)) n.children.forEach(rec);
  };
  op.children.forEach(rec);
  return out;
}

/** Violations of a type's content grammar by a block's code. */
export function contentErrors(html: string, t: string, def: TypeDef): string[] {
  const c = def.content;
  if (!c) return [];
  const errors: string[] = [];
  if (c.scripts === false && /<script\b/i.test(html)) errors.push(`type "${t}" does not allow <script>`);
  if (c.styles === false && (/<style\b/i.test(html) || /\sstyle\s*=/i.test(html))) errors.push(`type "${t}" does not allow styles`);
  if (c.tags) {
    const allowed = new Set([...c.tags.map((x) => x.toLowerCase()), 'style', 'script']);
    const used = new Set([...html.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)/g)].map((m) => m[1].toLowerCase()));
    const bad = [...used].filter((x) => !allowed.has(x));
    if (bad.length) errors.push(`type "${t}" does not allow <${bad.join('>, <')}> (allowed: ${c.tags.join(', ')})`);
  }
  return errors;
}

/** Errors in `next` that were not already in `prev`: a move may not introduce violations. */
export function newTypeErrors(prev: Layout, next: Layout, reg: Registry): string[] {
  if (!Object.keys(reg).length && !hasTypes(next)) return [];
  const before = new Set(typeErrors(prev, reg));
  return typeErrors(next, reg).filter((e) => !before.has(e));
}

function hasTypes(l: Layout): boolean {
  let any = false;
  walk(l.root, (n) => {
    if (n.type !== 'empty' && n.boxType) any = true;
  });
  return any;
}
