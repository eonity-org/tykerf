// Tasks: what a person leaves on a spot of the page to be done (a change to make, a question, something
// to check), in .tykerf/tasks.json. A task names the block, the element inside it (an element path,
// as editing in place uses: editor/public/inline.js) and the window width it was written at, so
// whoever does it (Kaity, another agent through MCP, a person) knows exactly where and at which size.
// Tasks are not part of the page: no undo, not exported.

import { find } from './model.js';
import { inScope } from './scope.js';
import type { Workspace } from './workspace.js';

export interface Task {
  n: number; // shown on the task's tab; never reused on a page
  block: string; // the block's name when the task was written (current name: see tasks())
  since: string; // when `block` was last the block's name, to follow renames from
  path: number[] | null; // the element inside the block; null = the block itself
  label: string; // the element in words, as the person saw it: `h2 "First words…"`
  width: number | null; // the window width it was written at, in px
  text: string;
  by: string; // user | ai
  at: string;
  done?: { by: string; at: string; reply?: string };
}

/** A task as it reads now: its block under the block's current name, and whether the block is gone. */
export type TaskNow = Task & { gone?: true };

const FILE = '.tykerf/tasks.json';
const MAX_TEXT = 4000;

interface TasksFile { next: number; tasks: Task[] }

function load(ws: Workspace): TasksFile {
  try {
    const f = JSON.parse(ws.store.read(FILE) ?? '');
    if (Array.isArray(f?.tasks)) return { next: Number(f.next) || 1, tasks: f.tasks };
  } catch {}
  return { next: 1, tasks: [] };
}

const save = (ws: Workspace, f: TasksFile) => ws.store.write(FILE, JSON.stringify(f, null, 1));

/** The page's tasks in the order they were added, under their blocks' current names; `open` keeps the ones not done, `within` the ones inside that block. */
export function tasks(ws: Workspace, { open, within }: { open?: boolean; within?: string | null } = {}): TaskNow[] {
  const layout = ws.load();
  return load(ws).tasks
    .map((x): TaskNow => {
      const block = ws.followRenames(x.block, x.since);
      return find(layout.root, block) ? { ...x, block } : { ...x, block, gone: true };
    })
    .filter((x) => (!open || !x.done) && (!within || (!x.gone && inScope(layout, within, x.block))));
}

export interface NewTask { block: string; text: string; path?: number[] | null; label?: string; width?: number | null; by?: string }

export function addTask(ws: Workspace, a: NewTask): Task {
  const text = String(a.text ?? '').trim();
  if (!text) throw new Error('write the task first');
  if (text.length > MAX_TEXT) throw new Error(`a task is at most ${MAX_TEXT} characters`);
  const path = a.path == null ? null : a.path;
  if (path && (!Array.isArray(path) || path.length > 64 || !path.every((i) => Number.isInteger(i) && i >= 0))) throw new Error('bad element path');
  const width = a.width == null ? null : Math.round(Number(a.width));
  if (width !== null && !(width > 0 && width < 20000)) throw new Error('bad width');
  return ws.transaction(() => {
    if (!find(ws.load().root, a.block)) throw new Error(`no block "${a.block}"`);
    const f = load(ws);
    const at = new Date().toISOString();
    const task: Task = { n: f.next, block: a.block, since: at, path, label: String(a.label ?? '').slice(0, 200), width, text, by: a.by ?? 'user', at };
    f.tasks.push(task);
    f.next++;
    save(ws, f);
    return task;
  });
}

/** Change one task (found by its number) and save; the task as it is now, under its block's current name. */
function update(ws: Workspace, n: number, fn: (x: Task, f: TasksFile) => void, within?: string | null): TaskNow {
  return ws.transaction(() => {
    const f = load(ws);
    const x = f.tasks.find((y) => y.n === n);
    if (!x) throw new Error(`no task ${n}`);
    const now = tasks(ws).find((y) => y.n === n)!;
    if (within && (now.gone || !inScope(ws.load(), within, now.block))) throw new Error(`task ${n} is on "${now.block}", outside the scope "${within}"`);
    // remember the current name, so a later rename is followed from here
    if (!now.gone && now.block !== x.block) Object.assign(x, { block: now.block, since: new Date().toISOString() });
    fn(x, f);
    save(ws, f);
    return { ...x, ...(now.gone ? { gone: true as const } : {}) };
  });
}

export function closeTask(ws: Workspace, n: number, by = 'user', reply?: string, within?: string | null): TaskNow {
  const r = reply?.trim().slice(0, MAX_TEXT);
  return update(ws, n, (x) => {
    x.done = { by, at: new Date().toISOString(), ...(r ? { reply: r } : {}) };
  }, within);
}

export function reopenTask(ws: Workspace, n: number): TaskNow {
  return update(ws, n, (x) => {
    delete x.done;
  });
}

export function removeTask(ws: Workspace, n: number): void {
  update(ws, n, (x, f) => {
    f.tasks.splice(f.tasks.indexOf(x), 1);
  });
}

/** Remove the tasks that are done; how many went. */
export function clearDone(ws: Workspace): number {
  return ws.transaction(() => {
    const f = load(ws);
    const before = f.tasks.length;
    f.tasks = f.tasks.filter((x) => !x.done);
    if (f.tasks.length !== before) save(ws, f);
    return before - f.tasks.length;
  });
}

/** One task in words, for the model and for copying: number, place, width, text (and how it ended). */
export function sayTask(x: TaskNow): string {
  const where = `${x.block}${x.label ? ` › ${x.label}` : ''}${x.path?.length ? ` (element ${x.path.join('.')})` : ''}`;
  const seen = x.width ? `, seen ${x.width} px wide` : '';
  const end = x.done ? ` [done${x.done.reply ? `: ${x.done.reply}` : ''}]` : '';
  return `#${x.n} on ${where}${seen}${x.gone ? ' (that block is gone)' : ''}: ${x.text}${end}`;
}
