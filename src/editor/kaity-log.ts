// Kaity's work across a site: every run, on any page or on the whole site, in one log at the site
// (.tykerf/kaity.jsonl), so the site manager shows what she did and what she is doing now. Each run writes
// a line when it starts and one when it ends; a run with no end that isn't running any more was cut
// short (the editor stopped while she worked).

import { FolderStore } from '../store.js';

const LOG = '.tykerf/kaity.jsonl';
/** The log keeps about this many runs: past twice as many lines, the oldest go. */
const KEEP = 500;

export type RunEnd = 'done' | 'failed' | 'stopped';

export interface RunStart {
  run: string;
  at: string;
  /** The page she works on; null for a run on the whole site. */
  page: string | null;
  block: string | null;
  request: string;
  tasks?: number[];
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
}

export interface KaityRun extends RunStart {
  state: RunEnd | 'working' | 'cut short';
  ended?: string;
  answer?: string;
  error?: string;
  steps?: number;
  /** While she works: what she is doing right now. */
  step?: string;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A new run's id: sortable by time, unique enough for one site. */
export const runId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function write(site: string, line: RunStart | RunFinish) {
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
    let e: RunStart | RunFinish;
    try {
      if (!l) continue;
      e = JSON.parse(l);
    } catch {
      continue;
    }
    if ('end' in e) {
      const r = runs.get(e.run);
      if (r) Object.assign(r, { state: e.end, ended: e.at, block: e.block ?? r.block, answer: e.answer, error: e.error, steps: e.steps });
    } else runs.set(e.run, { ...e, state: 'cut short' });
  }
  for (const r of runs.values()) {
    const now = live.get(r.run);
    if (r.state === 'cut short' && now) Object.assign(r, { state: 'working', step: now.step, steps: now.steps, block: now.block ?? r.block });
  }
  return [...runs.values()].reverse().slice(0, limit);
}
