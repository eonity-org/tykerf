import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as M from '../src/moves.js';
import { MemoryStore } from '../src/store.js';
import { Workspace } from '../src/workspace.js';

/** The widgets example in memory. */
function widgets(): Workspace {
  const files: Record<string, string> = { 'layout.slice': readFileSync('examples/widgets/layout.slice', 'utf8') };
  for (const f of readdirSync('examples/widgets/boxes')) files[`boxes/${f}`] = readFileSync(`examples/widgets/boxes/${f}`, 'utf8');
  for (const f of readdirSync('examples/widgets/types')) files[`types/${f}`] = readFileSync(`examples/widgets/types/${f}`, 'utf8');
  return new Workspace(new MemoryStore('memory:widgets', files));
}

/** What a person sees and what undo needs: the page, the box code and the undo labels. */
const state = (ws: Workspace) => ({ page: ws.page(), contents: ws.contents(), history: ws.history(100).map((h) => h.label) });

/** A mix of every kind of step: layout, box code, rename and a group. */
function changes(ws: Workspace) {
  ws.save(M.split(ws.load(), 'title', 'V', 2), 'split title', 'user');
  ws.setContent('footer', '<style>small{color:red}</style><small>new footer</small>', 'user');
  ws.rename('pricing', 'plans', 'user');
  ws.group('two boxes', 'user', () => {
    ws.setContent('faq', '<p>one</p>', 'user');
    ws.setContent('signup', '<p>two</p>', 'user');
  });
}

describe('redo', () => {
  it('brings back every undone step, in order, to exactly the same page', () => {
    const ws = widgets();
    changes(ws);
    const after = state(ws);
    const labels: string[] = [];
    while (ws.peekUndo()) labels.push(ws.undo());
    expect(labels).toEqual(['two boxes', 'rename pricing plans', 'set_content footer (56 chars)', 'split title']);
    const redone: string[] = [];
    while (ws.peekRedo()) redone.push(ws.redo());
    expect(redone).toEqual([...labels].reverse());
    expect(state(ws)).toEqual(after);
  });

  it('redoes a group as one step', () => {
    const ws = widgets();
    changes(ws);
    ws.undo();
    expect(ws.content('faq')).not.toBe('<p>one</p>\n');
    expect(ws.peekRedo()).toMatchObject({ label: 'two boxes', box: 'faq' });
    expect(ws.redo()).toBe('two boxes');
    expect(ws.content('faq')).toBe('<p>one</p>\n');
    expect(ws.content('signup')).toBe('<p>two</p>\n');
    expect(ws.peekUndo()?.label).toBe('two boxes'); // and undo takes the group back as one step
  });

  it('moves a renamed box back to its new name', () => {
    const ws = widgets();
    ws.rename('pricing', 'plans', 'user');
    const code = ws.content('plans');
    ws.undo();
    expect(ws.content('plans')).toBeNull();
    expect(ws.peekRedo()).toMatchObject({ label: 'rename pricing plans', box: 'plans' });
    ws.redo();
    expect(ws.content('plans')).toBe(code);
    expect(ws.content('pricing')).toBeNull();
  });

  it('forgets the undone steps when a new change is made, by anyone', () => {
    const ws = widgets();
    changes(ws);
    ws.undo();
    ws.undo();
    expect(ws.peekRedo()).not.toBeNull();
    ws.setContent('title', '<h1>new</h1>', 'ai');
    expect(ws.peekRedo()).toBeNull();
    expect(() => ws.redo()).toThrow(/nothing to redo/);
  });

  it('keeps the rest of the redo list while redoing', () => {
    const ws = widgets();
    changes(ws);
    ws.undo();
    ws.undo();
    ws.undo();
    ws.redo();
    expect(ws.peekRedo()?.label).toBe('rename pricing plans');
    ws.redo();
    expect(ws.peekRedo()?.label).toBe('two boxes');
  });

  it('shows the layout redo would restore, for scope checks', () => {
    const ws = widgets();
    const before = ws.load();
    ws.save(M.split(ws.load(), 'title', 'V', 2), 'split title', 'user');
    const after = ws.load();
    ws.undo();
    expect(ws.load()).toEqual(before);
    expect(ws.peekRedo()?.layout).toEqual(after);
  });
});
