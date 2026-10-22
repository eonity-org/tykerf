import { cpSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Layout } from '../src/model.js';
import * as M from '../src/moves.js';
import { parse, parseSlice, serializeSlice } from '../src/notation.js';
import { RefError, pathOf, positionOf, resolveRef } from '../src/refs.js';
import { Workspace } from '../src/workspace.js';

const W = parseSlice(readFileSync('examples/widgets/layout.slice', 'utf8'));

describe('references (spec §5)', () => {
  it('name, path, positions and root all resolve to the same nodes', () => {
    expect(resolveRef(W, 'faq')).toBe('faq');
    expect(resolveRef(W, 'page/row2/faq')).toBe('faq');
    expect(resolveRef(W, '/page/row2/faq')).toBe('faq');
    expect(resolveRef(W, 'row2/2')).toBe('faq');
    expect(resolveRef(W, 'page/4/2')).toBe('faq');
    expect(resolveRef(W, '#4.2')).toBe('faq');
    expect(resolveRef(W, '@faq')).toBe('faq');
    expect(resolveRef(W, '/')).toBe('page');
  });

  it('canonical forms', () => {
    expect(pathOf(W, 'faq')).toBe('page/row2/faq');
    expect(positionOf(W, 'faq')).toBe('#4.2');
    expect(positionOf(W, 'page')).toBe('/');
    for (const id of ['title', 'tabs', 'chart', 'row2', 'footer']) {
      expect(resolveRef(W, pathOf(W, id))).toBe(id);
      expect(resolveRef(W, positionOf(W, id))).toBe(id);
    }
  });

  it('numeric names (floorplanning style) stay names; positions need #', () => {
    const L: Layout = { root: parse('29 20 21 H@a 24 V3@top'), overlays: [] };
    expect(resolveRef(L, '29')).toBe('29');
    expect(resolveRef(L, 'top/2')).toBe('a'); // index: no child named "2"
    expect(resolveRef(L, 'top/29')).toBe('29'); // a child's name wins over an index
    expect(resolveRef(L, '#2.1')).toBe('20');
  });

  it('wrong references fail with a helpful message', () => {
    expect(() => resolveRef(W, 'nope')).toThrow(/no node named "nope"/);
    expect(() => resolveRef(W, 'page/faq')).toThrow(/"faq" is not a child of "page" \(children: title, row1, pricing, row2, footer\)/);
    expect(() => resolveRef(W, 'row2/3')).toThrow(/has 2 children/);
    expect(() => resolveRef(W, 'faq/1')).toThrow(/is a box/);
    expect(() => resolveRef(W, '#9')).toThrow(RefError);
  });
});

describe('rename', () => {
  it('rewrites rules and overlays in the same move', () => {
    let l = M.addRule(W, 700, 'flip', 'row2');
    l = M.attachOverlay(l, 'badge', 'row2', 'top-right');
    l = M.rename(l, 'row2', 'signup_row');
    expect(serializeSlice(l)).toContain('V@signup_row{1:2 gap=16 type=widget-row}');
    expect(l.rules?.[0].target).toBe('signup_row');
    expect(l.overlays[0].target).toBe('signup_row');
    expect(() => M.rename(l, 'faq', 'title')).toThrow(/already exists/);
    expect(() => M.rename(l, 'faq', 'V3')).toThrow(/not a valid name/);
  });

  it('auto ids become named: o<n> -> meaningful name', () => {
    const l = M.rename({ root: parse('a b V c H'), overlays: [] }, 'o1', 'hero');
    expect(serializeSlice(l)).toContain('V@hero');
  });

  it('workspace rename moves the box code too, logged and undoable as one step', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sw-rename-'));
    cpSync('examples/widgets', dir, { recursive: true });
    const ws = new Workspace(dir);
    const code = ws.parts('faq');
    ws.rename('faq', 'questions', 'user');
    expect(ws.parts('questions')).toEqual(code);
    expect(existsSync(join(dir, 'boxes/faq.html'))).toBe(false);
    expect(readFileSync(ws.slicePath, 'utf8')).toContain('questions[shape=text:500 type=faq-list]');
    expect(ws.undo()).toBe('rename faq questions');
    expect(ws.parts('faq')).toEqual(code);
    expect(existsSync(join(dir, 'boxes/questions.html'))).toBe(false);
  });
});
