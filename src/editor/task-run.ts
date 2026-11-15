// Kaity working through the page's tasks one at a time (the v3 editor's main loop: leave tasks, hand them over,
// review). Each task is one request to Kaity limited to the task's block, with only that task in it; her changes
// carry the task's tag in the page's history (Workspace.tag), so one task's work can be undone on its own
// (Workspace.revertTagged) and all of it together. Questions come after the tasks and run read-only. When she
// needs something only the person knows she asks (MCP ask_person) and the task waits for the answer.
//
// The run's state is kept in .tykerf/taskrun.json, so a reload or a restart shows the same review, and goes to
// the open pages as the SSE event `taskrun` on every change. Before and after pictures of each task's block,
// at the width the task was written at, are kept in .tykerf/runs/<run>/ until the person keeps the result.

import { askFile } from '../mcp/tools.js';
import { type Suggestion, type TaskNow, sayTask, tasks } from '../tasks.js';
import type { AI, Attachment, RunEnd } from './ai.js';
import { runId } from './kaity-log.js';
import type { Workspace } from '../workspace.js';

export type TaskState = 'waiting' | 'now' | 'done' | 'answered' | 'needs-you' | 'failed' | 'off';

export interface RunTask {
  n: number;
  state: TaskState;
  block: string; // the task's block when it was last looked at
  text: string;
  question?: true;
  summary?: string; // what she changed (her close_task reply), her answer to a question, or why it failed
  next?: Suggestion[]; // what she suggests the person does next (close_task's suggest): buttons on the card
  asked?: string; // her question to the person (needs-you)
  answer?: string; // the person's answer, given to her with the task again
  step?: string; // what she is doing now
  steps: number;
  before?: string; // picture files in .tykerf/runs/<run>/
  after?: string;
  undone?: true; // her work on it was taken back
  /** What she left unfinished in it (src/check.ts), as the block's conversation has it: Fix them / Leave them. */
  left?: { at: string; items: { key: string; text: string }[]; state: 'open' | 'fixing' | 'left' };
  fix?: true; // waiting to fix what she left (Fix them): the task is done already
  seen?: true; // the person has seen the result (Got it): the review doesn't show it any more
}

export interface TaskRunState {
  key: string; // the run's id; her changes are tagged `<key>#<n>`
  since: string;
  running: boolean;
  stopping?: true;
  stopped?: true; // it ended because the person stopped her (a site-wide queue stops too)
  tasks: RunTask[];
}

const FILE = '.tykerf/taskrun.json';
export const SHOT_FILE = /^\d+-(before|after)\.png$/;

/** What Kaity is told about the one task she works on now. */
export function taskPrompt(x: TaskNow, t: RunTask): string {
  const asked = t.asked && t.answer ? [`You asked the person: ${t.asked}`, `Their answer: ${t.answer}`] : [];
  if (x.kind === 'question') {
    return [
      `A person asked this question about the page in the editor: ${sayTask(x)}`,
      ...asked,
      'Answer it. You can look at the page (get_layout, get_content, screenshot at the width it was asked at) but change nothing.',
      `Then close it with close_task (n: ${x.n}) and your answer as the reply, in two or three sentences. If you can't answer without something only the person knows, use ask_person.`,
      'When your answer points at something the person can then do in one click (share a box with every page, open a box to fix it by hand, go to another page), add it as close_task\'s suggest.',
    ].join('\n');
  }
  return [
    `A person left this task on the page in the editor: ${sayTask(x)}`,
    ...asked,
    `Do what it asks in ${x.block}, looking at the page at the width it was written at (screenshot with that width). Work only on this task.`,
    `When it is done, close it with close_task (n: ${x.n}) and one or two sentences for the person: what you changed, and what you left alone (for example "Changed the heading's size at phone width. Nothing else in hero moved.").`,
    'If you need something only the person can tell you (a price, a name, which of two options), call ask_person with one short question and end your turn without changing anything more.',
  ].join('\n');
}

export class TaskRun {
  private cur: TaskRunState | null;

  /** `shots`: take before and after pictures (a browser page per task; TYKERF_TASK_SHOTS=off turns them off). */
  constructor(private ws: Workspace, private ai: AI, private emit: (event: string, data: unknown) => void, private opts: { shots?: boolean } = {}) {
    this.cur = this.load();
    // a run that was going when the editor stopped: its task is waiting again, and nothing runs until asked
    if (this.cur?.running) {
      for (const t of this.cur.tasks) if (t.state === 'now') (t.state = 'waiting'), delete t.step;
      this.cur.running = false;
      delete this.cur.stopping;
      this.save();
    }
    ai.taskRun = { active: () => !!this.cur?.running, block: () => this.cur?.tasks.find((t) => t.state === 'now')?.block ?? null };
    // a review with nothing left to see (an older editor kept those) is closed
    if (this.cur && this.cur.tasks.every((x) => x.seen || x.state === 'off')) this.keep();
  }

  private load(): TaskRunState | null {
    try {
      return JSON.parse(this.ws.store.read(FILE) ?? '') as TaskRunState;
    } catch {
      return null;
    }
  }

  private save() {
    if (this.cur) this.ws.store.write(FILE, JSON.stringify(this.cur, null, 1));
    else this.ws.store.remove(FILE);
    this.emit('taskrun', this.cur);
  }

  /** The run as the page shows it (null: none, or kept). */
  state(): TaskRunState | null {
    return this.cur;
  }

  private tag(n: number) {
    return `${this.cur!.key}#${n}`;
  }

  private task(n: number): RunTask {
    const t = this.cur?.tasks.find((x) => x.n === n);
    if (!t) throw new Error(`task ${n} is not in Kaity's list`);
    return t;
  }

  private idle(what: string) {
    if (this.cur?.running) throw new Error(`Kaity is working through the tasks; ${what} when she is done, or stop her`);
  }

  /**
   * Give Kaity these open tasks: questions after the others. While she works they join the end of her list; a run
   * she finished (not kept yet) takes them on, so its review stays; a task taken off her list comes back.
   */
  start(ns: number[]) {
    const going = !!this.cur?.running;
    if (!going && this.ai.running()) throw new Error(`Kaity is working on "${this.ai.running()!.id}"; wait until she is done`);
    const all = tasks(this.ws);
    const given = [...new Set(ns.map(Number))].map((n) => {
      const x = all.find((y) => y.n === n);
      if (!x) throw new Error(`no task ${n}`);
      if (x.done) throw new Error(`task ${n} is done already`);
      if (x.gone) throw new Error(`task ${n} is on "${x.block}", which is gone`);
      return x;
    });
    if (!given.length) throw new Error('no tasks to give her');
    given.sort((a, b) => Number(a.kind === 'question') - Number(b.kind === 'question'));
    const run = this.cur ?? { key: runId(), since: new Date().toISOString(), running: false, tasks: [] };
    for (const x of given) {
      const t = run.tasks.find((y) => y.n === x.n);
      if (t && t.state !== 'off' && t.state !== 'failed' && !t.undone) continue;
      const fresh: RunTask = { n: x.n, state: 'waiting', block: x.block, text: x.text, ...(x.kind === 'question' ? { question: true as const } : {}), steps: 0 };
      if (t) run.tasks.splice(run.tasks.indexOf(t), 1);
      run.tasks.push(fresh);
    }
    // the waiting ones in order: tasks, then questions
    const waiting = run.tasks.filter((t) => t.state === 'waiting').sort((a, b) => Number(!!a.question) - Number(!!b.question));
    run.tasks = [...run.tasks.filter((t) => t.state !== 'waiting'), ...waiting];
    run.running = true;
    delete run.stopped;
    this.cur = run;
    this.save();
    if (!going) void this.next();
    return run;
  }

  /** The next waiting task, or the end of the run. */
  private async next(): Promise<void> {
    const run = this.cur;
    if (!run?.running) return;
    const t = run.tasks.find((x) => x.state === 'waiting');
    if (!t || run.stopping) {
      run.running = false;
      if (run.stopping) run.stopped = true;
      delete run.stopping;
      return this.save();
    }
    const x = tasks(this.ws).find((y) => y.n === t.n);
    if (t.fix) return this.fixLeft(t, x);
    if (!x || x.done || x.gone) {
      Object.assign(t, { state: x?.done ? (t.question ? 'answered' : 'done') : 'failed', summary: x?.done?.reply ?? (x ? `the block ${x.block} is gone` : 'the task was removed'), ...(x?.done?.next ? { next: x.done.next } : {}) });
      this.save();
      return this.next();
    }
    Object.assign(t, { state: 'now', block: x.block, text: x.text, steps: 0 });
    delete t.step;
    this.save();
    if (!t.question) t.before = (await this.shot(x, 'before')) ?? undefined;
    if (run.stopping) {
      t.state = 'waiting';
      return this.next();
    }
    const tag = this.tag(t.n);
    this.ws.store.remove(askFile(tag));
    try {
      this.ai.ask(x.block, `${t.question ? 'Question' : 'Task'} ${x.n}: ${x.text}${t.answer ? `\n\n${t.answer}` : ''}`, undefined, this.pictures(x), undefined, taskPrompt(x, t), {
        tag,
        readOnly: !!t.question,
        queued: true,
        onStep: (text) => {
          t.step = text;
          t.steps++;
          this.save();
        },
        // on a fresh tick: the runner is still inside its own end when it reports it
        onEnd: (r) => void setTimeout(() => this.ended(t, r).catch((e) => this.fail(t, e))),
      });
    } catch (e) {
      return this.fail(t, e);
    }
  }

  /** The task's pictures, for her request (one that is gone is left out). */
  private pictures(x: TaskNow): Attachment[] {
    return (x.images ?? []).map((name) => this.ai.attachment(name)).filter((a): a is Attachment => !!a);
  }

  /** Fix them: she finishes what she left in a done task, under the task's tag (Undo this one takes it too). */
  private fixLeft(t: RunTask, x: TaskNow | undefined) {
    const back = (summary?: string) => {
      delete t.fix;
      t.state = 'done';
      if (t.left) t.left.state = 'open';
      if (summary) t.summary = summary;
      this.save();
      return this.next();
    };
    if (!x || x.gone || !t.left) return back();
    if (this.cur!.stopping) return back();
    Object.assign(t, { state: 'now', steps: 0 });
    t.left.state = 'fixing';
    this.save();
    try {
      this.ai.fix(x.block, t.left.at, {
        tag: this.tag(t.n),
        queued: true,
        onStep: (text) => {
          t.step = text;
          t.steps++;
          this.save();
        },
        onEnd: (r) => void setTimeout(() => this.fixed(t, x, r).catch((e) => this.fail(t, e))),
      });
    } catch (e) {
      return back((e as Error).message);
    }
  }

  private async fixed(t: RunTask, x: TaskNow, r: RunEnd) {
    delete t.fix;
    delete t.step;
    t.state = 'done';
    if (r.stopped) this.cur!.stopping = true;
    if (r.check) t.left = { ...r.check, state: 'open' };
    else if (r.failed || r.stopped) t.left!.state = 'open';
    else delete t.left;
    t.after = (await this.shot(x, 'after')) ?? t.after;
    this.save();
    return this.next();
  }

  private fail(t: RunTask, e: unknown) {
    Object.assign(t, { state: 'failed', summary: (e as Error).message });
    delete t.step;
    this.save();
    return this.next();
  }

  /** Her request for one task ended: done, answered, waiting for the person, stopped or failed. */
  private async ended(t: RunTask, r: RunEnd) {
    const file = askFile(this.tag(t.n));
    const asked = (() => {
      try {
        return (JSON.parse(this.ws.store.read(file) ?? '') as { question?: string }).question ?? null;
      } catch {
        return null;
      }
    })();
    this.ws.store.remove(file);
    delete t.step;
    const x = tasks(this.ws).find((y) => y.n === t.n);
    if (x) t.block = x.block;
    if (r.stopped) {
      t.state = 'waiting'; // what she changed so far stays, and can be undone with the rest
      this.cur!.stopping = true;
    } else if (x?.done) {
      Object.assign(t, { state: t.question ? 'answered' : 'done', summary: x.done.reply || r.answer, ...(x.done.next ? { next: x.done.next } : {}) });
      delete t.asked;
      delete t.answer;
    } else if (asked) Object.assign(t, { state: 'needs-you', asked });
    else if (r.failed || !x) Object.assign(t, { state: 'failed', summary: r.error || 'the task was removed' });
    // she neither closed it nor asked: what she said is what she needs from the person
    else Object.assign(t, { state: 'needs-you', asked: r.answer });
    if (t.state === 'done' && r.check) t.left = { ...r.check, state: 'open' };
    if (t.state === 'done' && x) t.after = (await this.shot(x, 'after')) ?? undefined;
    this.save();
    return this.next();
  }

  /** A picture of the task's block at its width, kept for the review; null when it can't be taken. */
  private async shot(x: TaskNow, when: 'before' | 'after'): Promise<string | null> {
    if ((this.opts.shots ?? process.env.TYKERF_TASK_SHOTS !== 'off') === false) return null;
    try {
      const { screenshot, pageFiles } = await import('../screenshot.js');
      const s = await screenshot(this.ws.page(), { width: x.width ?? 1440, id: x.block, files: pageFiles(this.ws) });
      const name = `${x.n}-${when}.png`;
      this.ws.store.write(`.tykerf/runs/${this.cur!.key}/${name}`, new Uint8Array(s.png));
      return name;
    } catch {
      return null; // no browser here, or the block is hidden at that width: the review goes without it
    }
  }

  /** A before or after picture of this run. */
  picture(name: string): Uint8Array | null {
    return this.cur && SHOT_FILE.test(name) ? this.ws.store.readBytes(`.tykerf/runs/${this.cur.key}/${name}`) : null;
  }

  /** Stop Kaity: the task she is on goes back to waiting (what she changed in it stays), and the run ends. */
  stop() {
    if (!this.cur?.running) throw new Error('Kaity is not working through tasks');
    this.cur.stopping = true;
    this.save();
    this.ai.cancel();
  }

  /** Take a waiting task off her list (a fix still waiting: the task stays done, its check open). */
  skip(n: number) {
    const t = this.task(n);
    if (t.state !== 'waiting') throw new Error(`task ${n} is not waiting`);
    if (t.fix) {
      delete t.fix;
      t.state = 'done';
    } else t.state = 'off';
    this.save();
  }

  /** Fix them: she finishes what she left unfinished in a done task (at the end of her list, if she is working). */
  fix(n: number) {
    const t = this.task(n);
    if (t.state !== 'done' || t.undone || t.left?.state !== 'open') throw new Error(`nothing is waiting to be fixed in task ${n}`);
    if (!this.cur!.running && this.ai.running()) throw new Error(`Kaity is working on "${this.ai.running()!.id}"; wait until she is done`);
    Object.assign(t, { state: 'waiting', fix: true });
    delete t.seen;
    if (this.cur!.running) return this.save();
    this.cur!.running = true;
    delete this.cur!.stopped;
    this.save();
    void this.next();
  }

  /** Leave them: what she left in a task stays as it is, and isn't reported again (.tykerf/kept.json). */
  leaveLeft(n: number) {
    const t = this.task(n);
    if (t.left?.state !== 'open') throw new Error(`nothing is waiting in task ${n}`);
    this.ai.leave(t.block, t.left.at);
    t.left.state = 'left';
    this.save();
  }

  /** The person answers her question: the task waits for her again, and she goes on if she had stopped. */
  answer(n: number, text: string) {
    const t = this.task(n);
    if (t.state !== 'needs-you') throw new Error(`Kaity is not waiting for an answer on task ${n}`);
    const a = String(text ?? '').trim();
    if (!a) throw new Error('write the answer first');
    Object.assign(t, { state: 'waiting', answer: a.slice(0, 4000) });
    if (this.cur!.running) return this.save();
    this.cur!.running = true;
    this.save();
    void this.next();
  }

  /** Leave her question for later: the task stays open, off her list. */
  leave(n: number) {
    const t = this.task(n);
    if (t.state !== 'needs-you') throw new Error(`Kaity is not waiting for an answer on task ${n}`);
    t.state = 'off';
    this.save();
  }

  /** The person has seen how a task ended (Got it): the review leaves it out. */
  seen(n: number) {
    const t = this.task(n);
    if (t.state === 'waiting' || t.state === 'now') throw new Error(`Kaity hasn't finished task ${n} yet`);
    t.seen = true;
    // nothing left to review: the review closes, as Keep would
    if (!this.cur!.running && this.cur!.tasks.every((x) => x.seen || x.state === 'off')) return this.keep();
    this.save();
  }

  /** Take back her work on one task (one undoable step); the task opens again. */
  undoTask(n: number) {
    this.idle('undo it');
    const t = this.task(n);
    if (t.undone) throw new Error(`Kaity's work on task ${n} was undone already`);
    this.ws.revertTagged([this.tag(n)], `undo Kaity's work on task ${n}`, 'user');
    Object.assign(t, { undone: true, state: 'off' });
    this.save();
  }

  /** Take back everything she did in this run (one undoable step). */
  undoAll() {
    this.idle('undo it');
    const mine = this.cur?.tasks.filter((t) => !t.undone) ?? [];
    if (!mine.length) throw new Error('Kaity has nothing to undo here');
    this.ws.revertTagged(mine.map((t) => this.tag(t.n)), 'undo all Kaity did', 'user');
    for (const t of mine) Object.assign(t, { undone: true, state: 'off' });
    this.save();
  }

  /** Keep what she did: the review closes, and its pictures go. */
  keep() {
    this.idle('keep it');
    if (!this.cur) return;
    for (const f of this.ws.store.list(`.tykerf/runs/${this.cur.key}`)) this.ws.store.remove(`.tykerf/runs/${this.cur.key}/${f}`);
    this.cur = null;
    this.save();
  }
}
