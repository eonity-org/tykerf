// Kaity's work across a site: every run, on any page or on the whole site, in one log at the site
// (.tykerf/kaity.jsonl), so the site manager shows what she did and what she is doing now. Each run writes
// a line when it starts and one when it ends; a run with no end that isn't running any more was cut
// short (the editor stopped while she worked).

import { FolderStore } from '../store.js';
import type { RunNote } from '../run-note.js';

const LOG = '.tykerf/kaity.jsonl';
/** The log keeps about this many runs: past twice as many lines, the oldest go. */
const KEEP = 500;

export type RunEnd = 'done' | 'failed' | 'stopped' | 'unfinished';

export interface RunStart {
  run: string;
  at: string;
  /** The page she works on; null for a run on the whole site. */
  page: string | null;
  block: string | null;
  /** What she may change: the whole site, one page, or one block of it. */
  scope?: 'site' | 'page' | 'box';
  /** The tag her changes carry in the pages' history (Workspace.tag): Undo takes the run back by it. */
  tag?: string;
  request: string;
  /** A run Kaity was not asked for in words: finishing what a run left (`fix`), going on after a stop (`continue`). */
  origin?: 'fix' | 'continue';
  /** Files attached to the request: their kept names (`.tykerf/images/`, the page's or the site's) and own names. */
  files?: { file: string; name?: string }[];
  tasks?: number[];
  /** A question: she answers it and changes nothing (no change is no failure). */
  onlyAsked?: true;
  /** The run this one sends again: wider (Widen to this page) or with the person's OK for a shared block. */
  again?: string;
  /** The shared blocks the person OK'd changing on every page. */
  sharedOk?: string[];
}

export interface RunFinish {
  run: string;
  at: string;
  end: RunEnd;
  /** The block's name at the end (she may rename it). */
  block: string | null;
  answer?: string;
  error?: string;
  steps: number;
  /** How many of her steps changed something (a run on the whole site changes its kit, which no page's history has). */
  acted?: number;
  /** What the tools noted (run-note.ts): she couldn't do it, a change was refused, a shared block waits for an OK. */
  note?: RunNote;
}

/** A run taken back afterwards (the thread's Undo): its changes left the pages, its record stays. */
export interface RunUndo {
  run: string;
  at: string;
  undone: true;
}

export interface KaityRun extends RunStart {
  state: RunEnd | 'working' | 'cut short';
  /** When the person took it back. */
  undone?: string;
  ended?: string;
  answer?: string;
  error?: string;
  steps?: number;
  acted?: number;
  note?: RunNote;
  /** While she works: what she is doing right now. */
  step?: string;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A new run's id: sortable by time, unique enough for one site. */
export const runId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function write(site: string, line: RunStart | RunFinish | RunUndo) {
  const store = new FolderStore(site);
  try {
    store.lock(() => {
      store.append(LOG, `${JSON.stringify(line)}\n`);
      const lines = (store.read(LOG) ?? '').split('\n').filter(Boolean);
      if (lines.length > KEEP * 4) store.write(LOG, `${lines.slice(-KEEP * 2).join('\n')}\n`);
    });
  } catch (e) {
    // the log is a record, never a reason for Kaity's run to fail
    console.error(`TYKERF: Kaity's log in ${site}: ${(e as Error).message}`);
  }
}

export function logStart(site: string, s: Omit<RunStart, 'at'>) {
  write(site, { ...s, request: clip(s.request, 4000), at: new Date().toISOString() });
}

/** The person took a run back. */
export function logUndo(site: string, run: string) {
  write(site, { run, undone: true, at: new Date().toISOString() });
}

export function logEnd(site: string, f: Omit<RunFinish, 'at'>) {
  write(site, { ...f, ...(f.answer ? { answer: clip(f.answer, 4000) } : {}), ...(f.error ? { error: clip(f.error, 1000) } : {}), at: new Date().toISOString() });
}

/**
 * The site's runs, newest first. `live` maps the runs going on now to what Kaity is doing in each;
 * a run that has no end and isn't among them was cut short.
 */
export function kaityRuns(site: string, live: Map<string, { step?: string; steps?: number; block?: string }> = new Map(), limit = 200): KaityRun[] {
  const raw = new FolderStore(site).read(LOG) ?? '';
  const runs = new Map<string, KaityRun>();
  for (const l of raw.split('\n')) {
    let e: RunStart | RunFinish | RunUndo;
    try {
      if (!l) continue;
      e = JSON.parse(l);
    } catch {
      continue;
    }
    if ('undone' in e) {
      const r = runs.get(e.run);
      if (r) r.undone = e.at;
    } else if ('end' in e) {
      const r = runs.get(e.run);
      if (r) Object.assign(r, { state: e.end, ended: e.at, block: e.block ?? r.block, answer: e.answer, error: e.error, steps: e.steps, ...(e.acted ? { acted: e.acted } : {}), ...(e.note ? { note: e.note } : {}) });
    } else runs.set(e.run, { ...e, state: 'cut short' });
  }
  for (const r of runs.values()) {
    const now = live.get(r.run);
    if (r.state === 'cut short' && now) Object.assign(r, { state: 'working', step: now.step, steps: now.steps, block: now.block ?? r.block });
  }
  return [...runs.values()].reverse().slice(0, limit);
}

/**
 * How a run came out, for the thread: `changed` (her changes are in the pages' history, or were and were undone),
 * `asks` (a shared block's change waits for the person's OK), `declined` (she couldn't do it: she said so, or the tools
 * refused what she tried, and nothing changed), `answered` (nothing changed, nothing refused: an answer or a question),
 * `failed` (an error, or cut short), `stopped` (the person stopped her), `working`. Only `changed` gets ✓ and Undo.
 */
export type RunOutcome = 'working' | 'changed' | 'asks' | 'declined' | 'answered' | 'failed' | 'stopped';
export function outcomeOf(r: KaityRun, changed: boolean): RunOutcome {
  if (r.state === 'working') return 'working';
  if (r.state === 'failed' || r.state === 'cut short' || r.state === 'unfinished') return 'failed';
  if (r.state === 'stopped') return 'stopped';
  if (changed) return 'changed';
  if (r.note?.shared) return 'asks';
  if (r.note?.cant || r.note?.refused) return 'declined';
  return 'answered';
}
