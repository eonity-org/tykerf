import { describe, expect, it } from 'vitest';
import type { Layout } from '../src/model.js';
import { parse, parseSlice } from '../src/notation.js';
import { LEAF_PAD, cost, optimize, shapeHeight } from '../src/shape.js';
import { readFileSync, readdirSync } from 'node:fs';

const L = (s: string): Layout => ({ root: parse(s), overlays: [] });
const P2 = 2 * LEAF_PAD;

describe('shape functions', () => {
  it('leaf shapes', () => {
    // 16px font -> 8px/char, 24px lines. Content width 400 -> 50 chars/line -> 400 chars = 8 lines.
    expect(shapeHeight({ kind: 'text', chars: 400 }, 400 + P2).h).toBe(8 * 24 + P2);
    expect(shapeHeight({ kind: 'image', aspect: 2 }, 600 + P2).h).toBe(300 + P2);
    expect(shapeHeight({ kind: 'fixed', w: 100, h: 50 }, 50).pen).toBeGreaterThan(0);
  });

  it('H sums, V takes the max (and counts the waste)', () => {
    const img = (w: number) => w - P2; // image:1 content height at width w
    const h = cost(L('a[shape=image:1] b[shape=image:1] H'), 300);
    expect(h.height).toBeCloseTo(2 * (img(300) + P2));
    const v = cost(L('a[shape=image:1] b[shape=image:2] V'), 600);
    expect(v.height).toBeCloseTo(img(300) + P2);
    expect(v.waste).toBeCloseTo((img(300) - img(300) / 2) * 300); // slack beside the shorter image
  });

  it('maxw caps the width the subtree is laid out in', () => {
    const wide = cost(L('a[shape=text:2400] b H'), 1440);
    const capped = cost(L('a[shape=text:2400] b H{maxw=720}'), 1440);
    expect(capped.height).toBeGreaterThan(wide.height); // narrower column -> more lines
    expect(capped.penalty).toBeLessThan(wide.penalty); // ...but readable line length
  });

  it('P: north + middle row + south', () => {
    const c = cost(L('n[shape=fixed:10:10] _ c[shape=fixed:10:100] _ s[shape=fixed:10:20] P{1:1:1 gap=10}'), 500);
    expect(c.height).toBeCloseTo(10 + P2 + 10 + 100 + P2 + 10 + 20 + P2);
  });
});

describe('optimize', () => {
  it('balances a row of text and image to cut height and waste', () => {
    const l = L('copy[shape=text:900] pic[shape=image:1] V');
    const r = optimize(l, 1200);
    expect(r.after.cost).toBeLessThan(r.before.cost);
    expect(r.changes.length).toBeGreaterThan(0);
  });

  it('picks a shape variant (C_SH) and respects #lock / #equal', () => {
    const r = optimize(L('side[shape=image:0.5|image:2] body[shape=text:600] V'), 1000);
    expect(r.changes).toContain('side variant -> 1');
    const locked = optimize(L('a[shape=text:900] b[shape=image:1] V{#lock}'), 1200);
    expect(locked.changes).toEqual([]);
    const eq = optimize(L('a[shape=text:900] b[shape=image:1] V{1:5 #equal}'), 1200);
    expect(eq.layout.root.type === 'op' && eq.layout.root.ratios).toBeUndefined();
  });

  it('never makes the example pages worse', () => {
    for (const ex of readdirSync('examples')) {
      const l = parseSlice(readFileSync(`examples/${ex}/layout.slice`, 'utf8'));
      for (const w of [375, 768, 1440]) {
        const r = optimize(l, w);
        expect(r.after.cost).toBeLessThanOrEqual(r.before.cost + 1);
      }
    }
  });
});
