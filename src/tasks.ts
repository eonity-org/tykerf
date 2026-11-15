// Tasks: what a person leaves on a spot of the page to be done (a change to make, a question, something
// to check), in .tykerf/tasks.json. A task names the block, the element inside it (an element path,
// as editing in place uses: editor/public/inline.js) and the window width it was written at, so
// whoever does it (Kaity, another agent through MCP, a person) knows exactly where and at which size.
// Tasks are not part of the page and are never exported, but each change to them is a step of the page's
// history (Workspace.writeTasks), so Undo takes back a task just added, closed or removed like any other change.

import { find } from './model.js';
import { inScope } from './scope.js';
import { TASKS, type Workspace } from './workspace.js';

export interface Task {
  n: number; // shown on the task's tab; never reused on a page
  block: string; // the block's name when the task was written (current name: see tasks())
  since: string; // when `block` was last the block's name, to follow renames from
  path: number[] | null; // the element inside the block; null = the block itself
  label: string; // the element in words, as the person saw it: `h2 "First words…"`
  width: number | null; // the window width it was written at, in px
  text: string;
  /** A question: Kaity answers it (close_task's reply) and changes nothing. Absent for a task. */
  kind?: 'question';
  /** Pictures the person attached (up to 5), file names in .tykerf/images (editor/ai.ts keeps them). */
  images?: string[];
  by: string; // user | ai
  at: string;
  done?: { by: string; at: string; reply?: string };
}

/** A task as it reads now: its block under the block's current name, and whether the block is gone. */
export type TaskNow = Task & { gone?: true };

const MAX_TEXT = 4000;
const MAX_IMAGES = 5;
const IMAGE_NAME = /^[a-f0-9]{40}\.(png|jpg|gif|webp)$/;

/** A task's pictures, checked: kept file names, at most five. */
function imageList(images: unknown): string[] {
  if (images == null) return [];
  if (!Array.isArray(images) || !images.every((x) => typeof x === 'string' && IMAGE_NAME.test(x))) throw new Error('bad picture names');
  if (images.length > MAX_IMAGES) throw new Error(`at most ${MAX_IMAGES} pictures per task`);
  return [...new Set(images as string[])];
}

interface TasksFile { next: number; tasks: Task[] }

function load(ws: Workspace): TasksFile {
  try {
    const f = JSON.parse(ws.store.read(TASKS) ?? '');
    if (Array.isArray(f?.tasks)) return { next: Number(f.next) || 1, tasks: f.tasks };
  } catch {}
  return { next: 1, tasks: [] };
}

const save = (ws: Workspace, f: TasksFile, label: string, author: string) => ws.writeTasks(f, label, author);

/** What a person writes ends as a question: the task box suggests "This is a question" for it. */
export const looksLikeQuestion = (text: string) => /\?\s*$/.test(text);

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

/** The number the next task will get (numbers are never used again). */
export const nextTask = (ws: Workspace) => load(ws).next;

export interface NewTask { block: string; text: string; path?: number[] | null; label?: string; width?: number | null; by?: string; question?: boolean; images?: string[] }

export function addTask(ws: Workspace, a: NewTask): Task {
  const text = String(a.text ?? '').trim();
  if (!text) throw new Error('write the task first');
  if (text.length > MAX_TEXT) throw new Error(`a task is at most ${MAX_TEXT} characters`);
  const path = a.path == null ? null : a.path;
  if (path && (!Array.isArray(path) || path.length > 64 || !path.every((i) => Number.isInteger(i) && i >= 0))) throw new Error('bad element path');
  const width = a.width == null ? null : Math.round(Number(a.width));
  if (width !== null && !(width > 0 && width < 20000)) throw new Error('bad width');
  const images = imageList(a.images);
  return ws.transaction(() => {
    if (!find(ws.load().root, a.block)) throw new Error(`no block "${a.block}"`);
    const f = load(ws);
    const at = new Date().toISOString();
    const task: Task = { n: f.next, block: a.block, since: at, path, label: String(a.label ?? '').slice(0, 200), width, text, ...(a.question ? { kind: 'question' as const } : {}), ...(images.length ? { images } : {}), by: a.by ?? 'user', at };
    f.tasks.push(task);
    f.next++;
    save(ws, f, `add ${a.question ? 'question' : 'task'} ${task.n}`, task.by);
    return task;
  });
}

/** Change one task (found by its number) and save; the task as it is now, under its block's current name. */
function update(ws: Workspace, n: number, label: string, by: string, fn: (x: Task, f: TasksFile) => void, within?: string | null): TaskNow {
  return ws.transaction(() => {
    const f = load(ws);
    const x = f.tasks.find((y) => y.n === n);
    if (!x) throw new Error(`no task ${n}`);
    const now = tasks(ws).find((y) => y.n === n)!;
    if (within && (now.gone || !inScope(ws.load(), within, now.block))) throw new Error(`task ${n} is on "${now.block}", outside the scope "${within}"`);
    // remember the current name, so a later rename is followed from here
    if (!now.gone && now.block !== x.block) Object.assign(x, { block: now.block, since: new Date().toISOString() });
    fn(x, f);
    save(ws, f, label.replace('#', String(n)), by);
    return { ...x, ...(now.gone ? { gone: true as const } : {}) };
  });
}

export function closeTask(ws: Workspace, n: number, by = 'user', reply?: string, within?: string | null): TaskNow {
  const r = reply?.trim().slice(0, MAX_TEXT);
  return update(ws, n, 'close task #', by, (x) => {
    x.done = { by, at: new Date().toISOString(), ...(r ? { reply: r } : {}) };
  }, within);
}

export function reopenTask(ws: Workspace, n: number, by = 'user'): TaskNow {
  return update(ws, n, 'reopen task #', by, (x) => {
    delete x.done;
  });
}

export function removeTask(ws: Workspace, n: number, by = 'user'): void {
  update(ws, n, 'remove task #', by, (x, f) => {
    f.tasks.splice(f.tasks.indexOf(x), 1);
  });
}

/** Change what a task says, whether it is a question, or its pictures. */
export function editTask(ws: Workspace, n: number, change: { text?: string; question?: boolean; images?: string[] }, by = 'user'): TaskNow {
  const text = change.text === undefined ? undefined : String(change.text).trim();
  const images = change.images === undefined ? undefined : imageList(change.images);
  if (text === '') throw new Error('write the task first');
  if (text && text.length > MAX_TEXT) throw new Error(`a task is at most ${MAX_TEXT} characters`);
  return update(ws, n, 'change task #', by, (x) => {
    if (text !== undefined) x.text = text;
    if (change.question === true) x.kind = 'question';
    if (change.question === false) delete x.kind;
    if (images?.length) x.images = images;
    else if (images) delete x.images;
  });
}

/** Remove the tasks that are done; how many went. */
export function clearDone(ws: Workspace): number {
  return ws.transaction(() => {
    const f = load(ws);
    const before = f.tasks.length;
    f.tasks = f.tasks.filter((x) => !x.done);
    const gone = before - f.tasks.length;
    if (gone) save(ws, f, `clear ${gone} done task${gone === 1 ? '' : 's'}`, 'user');
    return gone;
  });
}

/** One task in words, for the model and for copying: number, place, width, text (and how it ended). */
export function sayTask(x: TaskNow): string {
  const where = `${x.block}${x.label ? ` › ${x.label}` : ''}${x.path?.length ? ` (element ${x.path.join('.')})` : ''}`;
  const seen = x.width ? `, seen ${x.width} px wide` : '';
  const end = x.done ? ` [done${x.done.reply ? `: ${x.done.reply}` : ''}]` : '';
  const pics = x.images?.length ? ` (${x.images.length === 1 ? '1 picture' : `${x.images.length} pictures`} attached: ${x.images.join(', ')})` : '';
  return `${x.kind === 'question' ? 'question ' : ''}#${x.n} on ${where}${seen}${x.gone ? ' (that block is gone)' : ''}: ${x.text}${pics}${end}`;
}
