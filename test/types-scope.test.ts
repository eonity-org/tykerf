import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as M from '../src/moves.js';
import { parseSlice } from '../src/notation.js';
import { scopeViolation } from '../src/scope.js';
import { Workspace } from '../src/workspace.js';

function ws() {
  const dir = mkdtempSync(join(tmpdir(), 'sw-types-'));
  cpSync('examples/widgets', dir, { recursive: true });
  return new Workspace(dir);
}

describe('box types (spec §7)', () => {
  it('allows moves that respect the grammar', () => {
    const w = ws();
    w.save(M.swap(w.load(), 'tabs', 'chart'), 'swap', 'user');
    w.save(M.flip(w.load(), 'row2'), 'flip', 'user');
    // untyped rows/columns are transparent: grouping widgets inside a widget-row is fine
    w.save(M.split(w.load(), 'signup', 'H', 2, ['signup_extra']), 'split', 'user');
    expect(readFileSync(w.slicePath, 'utf8')).toContain('signup_extra');
  });

  it('refuses placements the types forbid', () => {
    const w = ws();
    const l = w.load();
    expect(() => w.save(M.move(l, 'pricing', 'row2', 0), 'x', 'user')).toThrow(/"pricing" \(pricing-table\) is not allowed in "row2" \(widget-row\); allowed: widget, faq-list/);
    expect(() => w.save(M.move(l, 'signup', 'page', 0), 'x', 'user')).toThrow(/"signup" \(widget\) must be inside a widget-row/);
    expect(() => w.save(M.addLeaf(l, 'page', 5, 'footer2', { boxType: 'site-footer' }), 'x', 'user')).toThrow(/"site-footer" appears 2 times, at most 1/);
    expect(() => w.save(M.setLeaf(l, 'faq', { boxType: 'nonsense' }), 'x', 'user')).toThrow(/unknown type "nonsense"/);
  });

  it('refuses box code the type does not allow', () => {
    const w = ws();
    expect(() => w.setContent('faq', '<h3>Q</h3><script>alert(1)</script>', 'ai')).toThrow(/does not allow <script>/);
    expect(() => w.setContent('footer', '<small>x</small><img src="a.png">', 'ai')).toThrow(/does not allow <img>/);
    w.setContent('footer', '<small>© 2027 <a href="/terms">Terms</a></small>', 'ai'); // allowed tags
    expect(w.content('footer')).toContain('2027');
  });

  it('gives new boxes their type template', () => {
    expect(ws().template('faq-list')).toContain('<details');
  });
});

describe('scope (the AI may only change one block)', () => {
  const L = parseSlice(readFileSync('examples/widgets/layout.slice', 'utf8'));
  const check = (next: typeof L, scope = 'row2') => scopeViolation(L, next, scope);

  it('changes inside the scope are allowed', () => {
    expect(check(M.swap(L, 'signup', 'faq'))).toBeNull();
    expect(check(M.flip(L, 'row2'))).toBeNull(); // the scope block itself may change
    expect(check(M.setRatios(L, 'row2', [2, 1]))).toBeNull();
    expect(check(M.addRule(L, 700, 'flip', 'row2'))).toBeNull();
    expect(check(M.attachOverlay(L, 'tip', 'faq', 'top-right'))).toBeNull();
  });

  it('changes outside the scope are refused, whatever the move', () => {
    expect(check(M.swap(L, 'tabs', 'chart'))).toMatch(/outside the scope "row2"/);
    expect(check(M.swap(L, 'row2', 'pricing'))).toMatch(/outside/); // moving the scope block itself
    expect(check(M.addRule(L, 700, 'flip', 'row1'))).toMatch(/outside/);
    expect(check(M.setRatios(L, 'page', [1, 2, 1, 1, 1]))).toMatch(/outside/);
    expect(check(M.remove(L, 'signup'))).toMatch(/remove the scope block "row2" itself/); // row2 would dissolve
  });
});
