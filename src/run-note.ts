// What a run of Kaity's in the editor leaves for the editor besides her changes and her answer: that she couldn't do
// what was asked (the cant_do tool, or a change the tools refused because it was outside her scope), or that the
// request needs a shared block that reaches other pages, which waits for the person's OK. The tools write it (they may
// run in another process: the Claude Code runner), under the run's tag, and the editor takes it when the run ends
// (ai.ts), so the run's outcome is what happened, not what her words suggest.

import type { Store } from './store.js';

export interface RunNote {
  /** She couldn't do it: why, and the scope that would let her (the thread offers "Widen to this page"). */
  cant?: { reason: string; widen?: 'page' | 'site' };
  /** The tools refused a change outside the scope (the first refusal's words). */
  refused?: string;
  /** A change to a shared block waits for the person's OK: the block and the pages that show it. */
  shared?: { block: string; pages: string[] };
}

export const noteFile = (tag: string) => `.tykerf/notes/${encodeURIComponent(tag)}.json`;

/** Add to a run's note (what is there stays: the first refusal, the first shared block). */
export function addNote(store: Store, tag: string, note: RunNote) {
  let was: RunNote = {};
  try {
    was = JSON.parse(store.read(noteFile(tag)) ?? '{}');
  } catch {}
  store.write(noteFile(tag), JSON.stringify({ ...note, ...was, ...(note.cant ? { cant: note.cant } : {}) }));
}

/** The run's note, once: it goes with the read. */
export function takeNote(store: Store, tag: string): RunNote | null {
  const raw = store.read(noteFile(tag));
  if (raw === null) return null;
  store.remove(noteFile(tag));
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
