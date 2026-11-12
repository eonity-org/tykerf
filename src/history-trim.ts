// How a history (one JSON entry per line, undo from the end) stays short: once it has `at` steps it is cut
// back to its newest `keep`, on a step boundary, and the older entries go to an archive with their label,
// author, time and kind only (no snapshots). A group entry ({ kind: 'group', count }) closes a step made of
// the `count` entries before it. A page's history (workspace.ts) and a site's (site/history.ts) use it.

/** Undo steps kept in a history; it is trimmed back to this once it has HISTORY_TRIM steps. */
export const HISTORY_STEPS = 200;
export const HISTORY_TRIM = 250;

interface Line {
  kind?: string;
  label?: string;
  author?: string;
  at?: string;
  count?: number;
}

/** The lines to keep and the archive's lines (each ending in \n), or null when the history is short enough. */
export function trimSteps(lines: string[], keep = HISTORY_STEPS, at = HISTORY_TRIM): { kept: string; archived: string } | null {
  if (lines.length < at) return null; // a step is at least one line
  // where each step starts, newest first (a group takes its marker plus the entries before it)
  const starts: number[] = [];
  for (let i = lines.length; i > 0 && starts.length < at; ) {
    const e = JSON.parse(lines[i - 1]) as Line;
    i -= e.kind === 'group' ? (e.count ?? 0) + 1 : 1;
    starts.push(i);
  }
  if (starts.length < at) return null;
  const start = starts[keep - 1];
  if (start <= 0) return null;
  const archived = lines.slice(0, start).map((l) => {
    const { label, author, at: when, kind } = JSON.parse(l) as Line;
    return JSON.stringify({ label, author, at: when, kind }) + '\n';
  });
  return { kept: lines.slice(start).map((l) => l + '\n').join(''), archived: archived.join('') };
}
