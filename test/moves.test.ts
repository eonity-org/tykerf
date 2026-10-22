import { describe, expect, it } from 'vitest';
import { type Layout, type OpKind, allIds, isOp, validate, walk } from '../src/model.js';
import * as M from '../src/moves.js';
import { parse, serialize } from '../src/notation.js';

const L = (s: string): Layout => ({ root: parse(s), overlays: [] });
const S = (l: Layout) => serialize(l.root);

describe('moves', () => {
  it('swap (M1) carries weights with the boxes', () => {
    expect(S(M.swap(L('a b c V3{1:2:3}'), 'a', 'c'))).toBe('c b a V3{3:2:1}');
    expect(() => M.swap(L('a b V c H'), 'o1', 'a')).toThrow(/ancestor/);
  });

  it('flip (M2) complements an operator', () => {
    expect(S(M.flip(L('a b V c H'), 'o1'))).toBe('a b H c H');
    expect(() => M.flip(L('a b c d e W'), 'o1')).toThrow(/only H\/V/);
  });

  it('wrap / unwrap are inverses and keep geometry', () => {
    const l = L('a b c d V4{1:2:3:4}');
    const w = M.wrap(l, ['b', 'c'], 'V', 'mid');
    expect(S(w)).toBe('a b c V@mid{2:3} d V3{1:5:4}');
    expect(S(M.unwrap(w, 'mid'))).toBe('a b c d V4{1:2:3:4}');
    expect(() => M.wrap(l, ['a', 'c'], 'H')).toThrow(/contiguous/);
  });

  it('split creates fresh leaves (P keeps the leaf in the center)', () => {
    expect(S(M.split(L('a b H'), 'b', 'V', 3))).toBe('a b b.1 b.2 V3 H');
    expect(S(M.split(L('a b H'), 'b', 'P', 0, ['n', 'w', 'e', 's']))).toBe('a n w b e s P H');
  });

  it('remove collapses single-child operators and empties W/P slots', () => {
    expect(S(M.remove(L('a b V c H'), 'a'))).toBe('b c H');
    expect(S(M.remove(L('n w c e s P'), 'w'))).toBe('n _ c e s P');
  });

  it('move re-parents a subtree, including into an empty P slot', () => {
    expect(S(M.move(L('a b V c H'), 'c', 'o1', 0))).toBe('c a b V3');
    expect(S(M.move(L('side x H n _ c e s P V'), 'side', 'o2', 1))).toBe('x n side c e s P V');
    expect(() => M.move(L('a b V c H'), 'o1', 'o1', 0)).toThrow(/own subtree/);
  });

  it('overlays attach to a box, a cut or a corner and disappear with their target', () => {
    let l = M.attachOverlay(L('a b V c H'), 'modal', 'o1', 'bottom-right', 30);
    expect(l.overlays).toEqual([{ id: 'modal', target: 'o1', anchor: 'bottom-right', z: 30 }]);
    l = M.remove(l, 'c'); // o2 collapses, o1 survives as root
    expect(l.overlays.length).toBe(1);
    l = M.remove(l, 'a'); // o1 collapses -> its overlay goes too
    expect(l.overlays).toEqual([]);
    expect(validate(l).ok).toBe(true);
  });

  it('every move result is valid and a failed move throws instead of corrupting', () => {
    expect(() => M.setRatios(L('a b V'), 'o1', [1, 2, 3])).toThrow(/invalid layout/);
    expect(() => M.addLeaf(L('a b V'), 'o1', 0, 'V2')).toThrow(/not a valid name/);
  });
});

// Property test: long random sequences of moves never produce an invalid layout.
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe('property: random move sequences stay valid', () => {
  it('1000 sequences x 30 moves', () => {
    const rand = rng(42);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
    let applied = 0;
    for (let seq = 0; seq < 1000; seq++) {
      let l = L('h1 h2 h3 V3 hero main1 main2 V{2:1} n w c e s P foot H5');
      let name = 0;
      for (let step = 0; step < 30; step++) {
        const ids = [...allIds(l.root)];
        const ops: string[] = [];
        const leaves: string[] = [];
        walk(l.root, (n) => (isOp(n) ? ops.push(n.id) : n.type === 'leaf' && leaves.push(n.id)));
        const kind = pick<OpKind>(['H', 'V', 'W', 'P']);
        const candidates: (() => Layout)[] = [
          () => M.swap(l, pick(ids), pick(ids)),
          () => M.flip(l, pick(ops)),
          () => M.wrap(l, [pick(ids), pick(ids)], pick(['H', 'V'] as const)),
          () => M.unwrap(l, pick(ops)),
          () => M.split(l, pick(leaves), kind, 2 + Math.floor(rand() * 3)),
          () => M.remove(l, pick(ids)),
          () => M.move(l, pick(ids), pick(ops), Math.floor(rand() * 5)),
          () => M.addLeaf(l, pick(ops), Math.floor(rand() * 5), `n${name++}`),
          () => M.setRatios(l, pick(ops), [1 + rand(), 1 + rand()]),
          () => M.tag(l, pick(ids), 'dark'),
          () => M.attachOverlay(l, `ov${name++}`, pick(ids), 'top-left'),
          () => M.addRule(l, pick([400, 600, 900]), pick(['flip', 'hide', 'ratios'] as const), pick(ids), [1 + rand(), 1 + rand()]),
        ];
        try {
          l = pick(candidates)();
          applied++;
        } catch (e) {
          if (!(e instanceof M.MoveError) && !/invalid layout/.test((e as Error).message)) throw e;
        }
        const v = validate(l);
        if (!v.ok) throw new Error(`invalid after seq ${seq} step ${step}: ${v.errors.join('; ')}\n${serialize(l.root)}`);
        // The serialized form always parses back to the same tree.
        expect(serialize(parse(serialize(l.root)))).toBe(serialize(l.root));
      }
    }
    expect(applied).toBeGreaterThan(5000);
  });
});

describe('insertNext', () => {
  it('joins a parent that runs the same way', () => {
    const r = M.insertNext(L('a b V c H'), 'a', 'V', 'n');
    expect(serialize(r.root)).toBe('a n b V3 c H');
  });
  it('wraps the block when the parent runs the other way', () => {
    const r = M.insertNext(L('a b V c H'), 'c', 'V', 'n', true);
    expect(serialize(r.root)).toBe('a b V n c V H');
  });
  it('wraps the root only when it runs the other way', () => {
    const l = L('a b V');
    expect(serialize(M.insertNext(l, l.root.id, 'H', 'n').root)).toBe('a b V n H');
  });
  it('adds to the end (or start) of a root that runs the same way, instead of wrapping the page', () => {
    const l = L('nav text H@page');
    const end = M.insertNext(l, 'page', 'H', 'n');
    expect(serialize(end.root, { ids: true })).toBe('nav text n H3@page');
    expect(serialize(M.insertNext(l, 'page', 'H', 'n', true).root, { ids: true })).toBe('n nav text H3@page');
  });
});

describe('minh (min height)', () => {
  it('round-trips and renders, and never makes a block shorter', async () => {
    const { cost } = await import('../src/shape.js');
    const { toHTML } = await import('../src/render.js');
    const l = M.setLeaf(M.setOp(L('a b H'), L('a b H').root.id, { minH: 900 }), 'a', { minH: 120.4 });
    expect(S(l)).toBe('a[minh=120] b H{minh=900}');
    expect(serialize(parse(S(l)))).toBe(S(l));
    expect(toHTML(l)).toContain('min-height:120px');
    expect(cost(l, 1000).height).toBe(900);
    expect(() => M.setLeaf(l, 'a', { minH: -1 })).toThrow(/minh/);
  });
});
