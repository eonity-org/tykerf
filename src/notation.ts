// Postfix (Polish expression) notation for slicing trees.
//
//   leaf     name[attrs]          e.g.  hero[role=main #priority shape=text:400|image:1.5 minw=320]
//   empty    _                    (only inside W/P)
//   operator K[n][@id][{attrs}]   e.g.  V   V3   H@page   V3{1:2:1 gap=16 align=center #dark}
//
// Binary floorplanning strings (`29 20 21 H 24 V`) parse unchanged. Leaf names may not look like an
// operator (`H`, `V3`, `P`...). Auto-generated op ids look like `o12` and stay "unnamed".

import {
  type Align, type Anchor, type Empty, type Layout, type Leaf, type Node, type Op, type OpKind, type Overlay, type Rule, type RuleAction, type Shape,
  ANCHORS, FIXED_ARITY, KIND_WORD, SLOT_NAMES, assertValid, isOp, weights,
} from './model.js';

const OP_RE = /^([HVWP])(\d+)?(?:@([A-Za-z0-9_.-]+))?(\{.*\})?$/s;
const LEAF_RE = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)(\[.*\])?$/s;
const AUTO_OP_ID = /^o\d+$/;
const ALIGNS: Align[] = ['start', 'center', 'end', 'stretch'];

export class NotationError extends Error {}

export function tokenize(src: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let depth = 0;
  for (const ch of src) {
    if (ch === '[' || ch === '{') depth++;
    if (ch === ']' || ch === '}') depth--;
    if (depth < 0) throw new NotationError(`unbalanced "${ch}" in: ${src}`);
    if (/\s/.test(ch) && depth === 0) {
      if (cur) tokens.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (depth !== 0) throw new NotationError(`unclosed bracket in: ${src}`);
  if (cur) tokens.push(cur);
  return tokens;
}

function num(s: string, what: string): number {
  const v = s.includes('/') ? s.split('/').map(Number).reduce((a, b) => a / b) : Number(s);
  if (!Number.isFinite(v)) throw new NotationError(`bad number "${s}" in ${what}`);
  return v;
}

function typeName(s: string, tok: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(s)) throw new NotationError(`bad type "${s}" in "${tok}" (lowercase letters, digits, -)`);
  return s;
}

export function parseShape(s: string): Shape {
  const [kind, ...a] = s.split(':');
  if (kind === 'text' && a.length >= 1) {
    const sh: Shape = { kind: 'text', chars: num(a[0], s) };
    if (a[1]) sh.fontPx = num(a[1], s);
    if (a[2]) sh.lineHeight = num(a[2], s);
    return sh;
  }
  if (kind === 'image' && a.length === 1) return { kind: 'image', aspect: num(a[0], s) };
  if (kind === 'fixed' && a.length === 2) return { kind: 'fixed', w: num(a[0], s), h: num(a[1], s) };
  throw new NotationError(`bad shape "${s}" (use text:chars[:fontPx[:lineHeight]] | image:aspect | fixed:w:h)`);
}

export function shapeToString(s: Shape): string {
  if (s.kind === 'text') return ['text', s.chars, s.fontPx, s.lineHeight].filter((x) => x !== undefined).join(':');
  if (s.kind === 'image') return `image:${fmt(s.aspect)}`;
  return `fixed:${fmt(s.w)}:${fmt(s.h)}`;
}

function parseLeaf(tok: string): Leaf {
  const m = LEAF_RE.exec(tok);
  if (!m) throw new NotationError(`bad token "${tok}"`);
  const leaf: Leaf = { type: 'leaf', id: m[1], tags: [], variants: [], variant: 0 };
  if (m[2]) {
    for (const a of tokenize(m[2].slice(1, -1))) {
      if (a.startsWith('#')) leaf.tags.push(a.slice(1));
      else if (a.startsWith('role=')) leaf.role = a.slice(5);
      else if (a.startsWith('shape=')) leaf.variants = a.slice(6).split('|').map(parseShape);
      else if (a.startsWith('variant=')) leaf.variant = num(a.slice(8), tok);
      else if (a.startsWith('minw=')) leaf.minW = num(a.slice(5), tok);
      else if (a.startsWith('maxw=')) leaf.maxW = num(a.slice(5), tok);
      else if (a.startsWith('minh=')) leaf.minH = num(a.slice(5), tok);
      else if (a.startsWith('type=')) leaf.boxType = typeName(a.slice(5), tok);
      else throw new NotationError(`unknown leaf attribute "${a}" in "${tok}"`);
    }
  }
  return leaf;
}

function applyOpAttrs(op: Op, body: string, tok: string) {
  for (const a of tokenize(body)) {
    if (a.startsWith('#')) op.tags.push(a.slice(1));
    else if (a.startsWith('gap=')) op.gap = num(a.slice(4), tok);
    else if (a.startsWith('maxw=')) op.maxW = num(a.slice(5), tok);
    else if (a.startsWith('minh=')) op.minH = num(a.slice(5), tok);
    else if (a.startsWith('type=')) op.boxType = typeName(a.slice(5), tok);
    else if (a.startsWith('align=')) {
      const v = a.slice(6) as Align;
      if (!ALIGNS.includes(v)) throw new NotationError(`bad align "${v}" in "${tok}"`);
      op.align = v;
    } else if (/^[\d.]+(:[\d./]+)+$/.test(a)) op.ratios = a.split(':').map((x) => num(x, tok));
    else throw new NotationError(`unknown operator attribute "${a}" in "${tok}"`);
  }
}

/** Parse a postfix expression into a tree (no normalization). */
export function parse(src: string): Node {
  const tokens = tokenize(src);
  if (!tokens.length) throw new NotationError('empty expression');
  // Reserve every explicit name first so auto ids never collide with later tokens.
  const reserved = new Set<string>();
  for (const t of tokens) {
    const om = OP_RE.exec(t);
    if (om) {
      if (om[3]) reserved.add(om[3]);
    } else {
      const lm = LEAF_RE.exec(t);
      if (lm) reserved.add(lm[1]);
    }
  }
  let opN = 0;
  let emptyN = 0;
  const nextId = (prefix: string, counter: () => number) => {
    let id: string;
    do id = `${prefix}${counter()}`; while (reserved.has(id));
    reserved.add(id);
    return id;
  };

  const stack: Node[] = [];
  tokens.forEach((t, i) => {
    const om = OP_RE.exec(t);
    if (om) {
      const kind = om[1] as OpKind;
      const fixed = FIXED_ARITY[kind];
      const n = om[2] ? Number(om[2]) : (fixed ?? 2);
      if (fixed !== undefined && n !== fixed) throw new NotationError(`${kind} takes exactly ${fixed} operands (token ${i + 1} "${t}")`);
      if (n < 2) throw new NotationError(`operator needs at least 2 operands (token ${i + 1} "${t}")`);
      if (stack.length < n)
        throw new NotationError(`operator "${t}" (token ${i + 1}) needs ${n} operands but only ${stack.length} are available`);
      const op: Op = {
        type: 'op',
        id: om[3] ?? nextId('o', () => ++opN),
        named: om[3] !== undefined && !AUTO_OP_ID.test(om[3]),
        kind,
        children: stack.splice(stack.length - n, n),
        tags: [],
      };
      if (om[4]) applyOpAttrs(op, om[4].slice(1, -1), t);
      stack.push(op);
    } else if (t === '_') {
      stack.push({ type: 'empty', id: nextId('_', () => ++emptyN) } satisfies Empty);
    } else {
      stack.push(parseLeaf(t));
    }
  });
  if (stack.length !== 1)
    throw new NotationError(`expression leaves ${stack.length} subtrees; add ${stack.length - 1} operator(s) to join them`);
  return stack[0];
}

export function fmt(n: number): string {
  return String(Number(n.toFixed(3)));
}

export interface SerializeOptions {
  ids?: boolean; // write every op id (file format), not just named ones
}

export function serialize(n: Node, opts: SerializeOptions = {}): string {
  const out: string[] = [];
  const rec = (n: Node) => {
    if (n.type === 'empty') return out.push('_');
    if (n.type === 'leaf') {
      const attrs: string[] = [];
      if (n.role) attrs.push(`role=${n.role}`);
      for (const t of n.tags) attrs.push(`#${t}`);
      if (n.variants.length) attrs.push(`shape=${n.variants.map(shapeToString).join('|')}`);
      if (n.variant) attrs.push(`variant=${n.variant}`);
      if (n.minW !== undefined) attrs.push(`minw=${fmt(n.minW)}`);
      if (n.maxW !== undefined) attrs.push(`maxw=${fmt(n.maxW)}`);
      if (n.minH !== undefined) attrs.push(`minh=${fmt(n.minH)}`);
      if (n.boxType) attrs.push(`type=${n.boxType}`);
      return out.push(attrs.length ? `${n.id}[${attrs.join(' ')}]` : n.id);
    }
    n.children.forEach(rec);
    let tok: string = n.kind;
    if (FIXED_ARITY[n.kind] === undefined && n.children.length !== 2) tok += n.children.length;
    if (n.named || opts.ids) tok += `@${n.id}`;
    const attrs: string[] = [];
    if (n.ratios) attrs.push(n.ratios.map(fmt).join(':'));
    if (n.gap !== undefined) attrs.push(`gap=${fmt(n.gap)}`);
    if (n.align) attrs.push(`align=${n.align}`);
    if (n.maxW !== undefined) attrs.push(`maxw=${fmt(n.maxW)}`);
    if (n.minH !== undefined) attrs.push(`minh=${fmt(n.minH)}`);
    if (n.boxType) attrs.push(`type=${n.boxType}`);
    for (const t of n.tags) attrs.push(`#${t}`);
    if (attrs.length) tok += `{${attrs.join(' ')}}`;
    out.push(tok);
  };
  rec(n);
  return out.join(' ');
}

/**
 * Canonical form (Wong–Liu normalization, n-ary flavor): a chain of the same H/V operator is
 * merged into one n-ary node. Without ratios an operator only states topology, so an unratioed
 * chain becomes an equal split (`1 2 3 4 V V V` -> `1 2 3 4 V4`). If any member has ratios the
 * weights are composed so the geometry is preserved. Named/tagged ops or ops with a different
 * gap/align are boundaries and are never merged.
 */
export function normalize(n: Node): Node {
  if (!isOp(n)) return n;
  const children = n.children.map(normalize);
  if (n.kind !== 'H' && n.kind !== 'V') return { ...n, children };

  const pw = n.ratios ?? children.map(() => 1);
  const mergeable = (c: Node): c is Op =>
    isOp(c) && c.kind === n.kind && !c.named && c.tags.length === 0 &&
    (c.gap === undefined || c.gap === n.gap) && (c.align === undefined || c.align === n.align) && c.maxW === undefined && c.minH === undefined && !c.boxType;
  const anyRatios = n.ratios !== undefined || children.some((c) => mergeable(c) && c.ratios !== undefined);
  const outC: Node[] = [];
  const outW: number[] = [];
  children.forEach((c, i) => {
    if (mergeable(c)) {
      const cw = weights(c);
      const sum = cw.reduce((a, b) => a + b, 0);
      c.children.forEach((g, j) => {
        outC.push(g);
        outW.push(anyRatios ? (pw[i] * cw[j]) / sum : 1);
      });
    } else {
      outC.push(c);
      outW.push(pw[i]);
    }
  });
  const res: Op = { ...n, children: outC };
  if (anyRatios && !outW.every((w) => Math.abs(w - outW[0]) < 1e-9)) {
    const min = Math.min(...outW);
    res.ratios = outW.map((w) => Number((w / min).toFixed(4)));
  } else delete res.ratios;
  return res;
}

/** Human/LLM-readable outline: id, kind, attributes and path address of every node. */
export function outline(layout: Layout): string {
  const lines: string[] = [];
  const rec = (n: Node, prefix: string, childPrefix: string, path: string, slot?: string) => {
    const where = `(${path ? `#${path}` : 'root'})${slot ? ` slot=${slot}` : ''}`;
    if (n.type === 'empty') lines.push(`${prefix}_ empty ${where}`);
    else if (n.type === 'leaf') {
      const bits = [n.role && `role=${n.role}`, ...n.tags.map((t) => `#${t}`),
        n.variants.length && `shape=${n.variants.map(shapeToString).join('|')}${n.variants.length > 1 ? ` (variant ${n.variant})` : ''}`,
        n.minW !== undefined && `minw=${n.minW}`, n.maxW !== undefined && `maxw=${n.maxW}`, n.minH !== undefined && `minh=${n.minH}`, n.boxType && `type=${n.boxType}`].filter(Boolean);
      lines.push(`${prefix}${[n.id, 'leaf', ...bits, where].join(' ')}`);
    } else {
      const bits = [n.ratios && `ratios=${n.ratios.map(fmt).join(':')}`, n.gap !== undefined && `gap=${n.gap}`,
        n.align && `align=${n.align}`, n.maxW !== undefined && `maxw=${n.maxW}`, n.minH !== undefined && `minh=${n.minH}`, n.boxType && `type=${n.boxType}`, ...n.tags.map((t) => `#${t}`)].filter(Boolean);
      lines.push(`${prefix}${[n.id, `${KIND_WORD[n.kind]}(${n.kind}${n.children.length})`, ...bits, where].join(' ')}`);
      const slots = SLOT_NAMES[n.kind];
      n.children.forEach((c, i) => {
        const last = i === n.children.length - 1;
        rec(c, childPrefix + (last ? '└─ ' : '├─ '), childPrefix + (last ? '   ' : '│  '),
          path ? `${path}.${i + 1}` : `${i + 1}`, slots?.[i]);
      });
    }
  };
  rec(layout.root, '', '', '');
  for (const o of layout.overlays) lines.push(`overlay ${o.id} on ${o.target} anchor=${o.anchor} z=${o.z}`);
  for (const r of layout.rules ?? []) lines.push(ruleToString(r));
  return lines.join('\n');
}

export function ruleToString(r: Rule): string {
  return `rule ${r.id} below=${fmt(r.below)} ${r.action} ${r.target}${r.ratios ? ` ${r.ratios.map(fmt).join(':')}` : ''}`;
}

// ---- .slice files: postfix lines + overlay lines + // comments ----

export function parseSlice(text: string): Layout {
  const expr: string[] = [];
  const overlays: Overlay[] = [];
  const rules: Rule[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    const rm = /^rule\s+(\S+)\s+below=(\d+(?:\.\d+)?)\s+(flip|ratios|hide)\s+(\S+)(?:\s+([\d.:/]+))?$/.exec(line);
    if (rm) {
      const r: Rule = { id: rm[1], below: Number(rm[2]), action: rm[3] as RuleAction, target: rm[4] };
      if (rm[5]) r.ratios = rm[5].split(':').map((x) => num(x, line));
      rules.push(r);
      continue;
    }
    if (line.startsWith('rule ')) throw new NotationError(`bad rule line "${line}" (use: rule <id> below=<px> flip|hide <target> | ratios <target> a:b:c)`);
    const m = /^overlay\s+(\S+)\s+on\s+(\S+)(.*)$/.exec(line);
    if (m) {
      const o: Overlay = { id: m[1], target: m[2], anchor: 'box', z: 10 };
      for (const a of m[3].trim().split(/\s+/).filter(Boolean)) {
        if (a.startsWith('anchor=')) o.anchor = a.slice(7) as Anchor;
        else if (a.startsWith('z=')) o.z = num(a.slice(2), line);
        else throw new NotationError(`unknown overlay attribute "${a}"`);
      }
      if (!ANCHORS.includes(o.anchor)) throw new NotationError(`bad anchor "${o.anchor}" (use ${ANCHORS.join(', ')})`);
      overlays.push(o);
    } else expr.push(line);
  }
  return assertValid({ root: parse(expr.join(' ')), overlays, ...(rules.length ? { rules } : {}) });
}

export function serializeSlice(layout: Layout): string {
  const lines = [serialize(layout.root, { ids: true })];
  for (const o of layout.overlays) lines.push(`overlay ${o.id} on ${o.target} anchor=${o.anchor} z=${o.z}`);
  for (const r of layout.rules ?? []) lines.push(ruleToString(r));
  return lines.join('\n') + '\n';
}
