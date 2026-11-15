// Kaity working through tasks one at a time (src/editor/task-run.ts), and what it stands on: task changes as
// steps of the page's history, questions, history entries tagged with the task that made them, taking one
// task's work back on its own (Workspace.revertTagged), and the MCP tools' tag, read-only mode and ask_person.

import { describe, expect, it, vi } from 'vitest';
import { AI, type RunEvents, type RunRequest, type Runner } from '../src/editor/ai.js';
import { TaskRun } from '../src/editor/task-run.js';
import { type Tools, openTools } from '../src/editor/tools-client.js';
import { createPage } from '../src/library.js';
import * as M from '../src/moves.js';
import { addTask, closeTask, editTask, looksLikeQuestion, removeTask, sayTask, tasks } from '../src/tasks.js';
import { MemoryStore } from '../src/store.js';
import { Workspace } from '../src/workspace.js';

vi.setConfig({ testTimeout: 30_000 });

let n = 0;
const landing = () => {
  const ws = new Workspace(new MemoryStore(`memory:task-run-${n++}`));
  createPage(ws, 'launch');
  return ws;
};

describe('tasks in the page history', () => {
  it('are undo steps: adding, closing and removing one, with labels; numbers are never used again', () => {
    const ws = landing();
    addTask(ws, { block: 'hero', text: 'Shorter' });
    expect(ws.peekUndo()).toMatchObject({ label: 'add task 1', tasks: true });
    ws.undo();
    expect(tasks(ws)).toEqual([]);
    ws.redo();
    expect(tasks(ws).map((x) => x.text)).toEqual(['Shorter']);
    closeTask(ws, 1, 'user', 'did it');
    expect(ws.peekUndo()?.label).toBe('close task 1');
    ws.undo();
    expect(tasks(ws)[0].done).toBeUndefined();
    removeTask(ws, 1);
    ws.undo();
    expect(tasks(ws).map((x) => x.n)).toEqual([1]);
    // undone, a task's number stays taken
    ws.undo();
    expect(tasks(ws)).toEqual([]);
    expect(addTask(ws, { block: 'cta', text: 'Bigger' }).n).toBe(2);
  });

  it('only take back the task they changed, with the page changes around them as they were', () => {
    const ws = landing();
    addTask(ws, { block: 'hero', text: 'one' });
    ws.setContent('cta', '<p>new cta</p>', 'user');
    addTask(ws, { block: 'cta', text: 'two' });
    ws.undo(); // task 2 goes, the box change stays
    expect(tasks(ws).map((x) => x.n)).toEqual([1]);
    expect(ws.content('cta')).toContain('new cta');
    ws.undo(); // then the box change
    expect(ws.content('cta')).not.toContain('new cta');
    expect(tasks(ws).map((x) => x.n)).toEqual([1]);
  });

  it('can be questions: marked, suggested by a question mark, said as one, and changed back', () => {
    const ws = landing();
    expect(looksLikeQuestion('Is this the same on second? ')).toBe(true);
    expect(looksLikeQuestion('Make it blue')).toBe(false);
    const q = addTask(ws, { block: 'hero', text: 'Is this the same on second?', question: true });
    expect(q.kind).toBe('question');
    expect(ws.peekUndo()?.label).toBe('add question 1');
    expect(sayTask(tasks(ws)[0])).toBe('question #1 on hero: Is this the same on second?');
    editTask(ws, 1, { question: false, text: 'Make it the same as on second' });
    expect(tasks(ws)[0]).toMatchObject({ text: 'Make it the same as on second' });
    expect(tasks(ws)[0].kind).toBeUndefined();
    ws.undo();
    expect(tasks(ws)[0]).toMatchObject({ kind: 'question', text: 'Is this the same on second?' });
    expect(() => editTask(ws, 1, { text: ' ' })).toThrow(/write the task/);
  });
});

describe('taking back one task\'s work', () => {
  it('reverts what the tag changed as one new step, and keeps what others did in between', () => {
    const ws = landing();
    const hero = ws.content('hero');
    ws.tag = 'r#1';
    ws.setContent('hero', '<h1>Kaity\'s hero</h1>', 'ai');
    ws.tag = null;
    ws.setContent('cta', '<p>the person\'s cta</p>', 'user'); // another box, in between
    ws.tag = 'r#2';
    ws.setContent('footer', '<p>Kaity\'s footer</p>', 'ai');
    ws.tag = null;
    expect(ws.revertTagged(['r#1'], 'undo Kaity\'s work on task 1')).toBe(1);
    expect(ws.content('hero')).toBe(hero);
    expect(ws.content('cta')).toContain('the person\'s cta');
    expect(ws.content('footer')).toContain('Kaity\'s footer');
    expect(ws.peekUndo()?.label).toBe('undo Kaity\'s work on task 1');
    // the revert is a step like any other: Undo brings her work back
    ws.undo();
    expect(ws.content('hero')).toContain('Kaity\'s hero');
  });

  it('is refused when a later step changed the same part of the page, and says which', () => {
    const ws = landing();
    ws.tag = 'r#1';
    ws.setContent('hero', '<h1>Kaity</h1>', 'ai');
    ws.tag = null;
    ws.setContent('hero', '<h1>Person</h1>', 'user');
    expect(() => ws.revertTagged(['r#1'], 'undo')).toThrow(/what came after it changed the same part of the page \("set content of hero"|undo that first/);
    expect(ws.content('hero')).toContain('Person');
    expect(() => ws.revertTagged(['nope'], 'undo')).toThrow(/nothing of that is left/);
  });

  it('takes back layout changes, renames and closed tasks too', () => {
    const ws = landing();
    addTask(ws, { block: 'cta', text: 'rename it' });
    const before = ws.load();
    ws.tag = 'r#1';
    ws.rename('cta', 'action', 'ai');
    ws.save(M.insertNext(ws.load(), 'action', 'H', 'note'), 'add note', 'ai');
    closeTask(ws, 1, 'ai', 'Renamed it and added a note.');
    ws.tag = null;
    ws.revertTagged(['r#1'], 'undo Kaity\'s work on task 1');
    expect(ws.load()).toEqual(before);
    expect(tasks(ws)[0]).toMatchObject({ block: 'cta' });
    expect(tasks(ws)[0].done).toBeUndefined();
  });
});

describe('the MCP tools in a task run', () => {
  it('tag every change, keep to the tools that look for a question, and let Kaity ask the person', async () => {
    const ws = landing();
    addTask(ws, { block: 'hero', text: 'a price?' });
    const t = await openTools(ws, 'hero', undefined, { tag: 'k#1' });
    expect(t.list.map((x) => x.name)).toContain('ask_person');
    await t.call('set_content', { id: 'hero', html: '<h1>Tagged</h1>' });
    expect(await t.call('ask_person', { question: 'Which price?' })).toMatchObject({ isError: false });
    await t.close();
    expect(ws.store.read('.tykerf/asks/k%231.json')).toContain('Which price?');
    expect(ws.revertTagged(['k#1'], 'undo')).toBe(1);

    const q = await openTools(ws, 'hero', undefined, { tag: 'k#2', readOnly: true });
    const names = q.list.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(['get_layout', 'get_content', 'screenshot', 'list_tasks', 'close_task', 'ask_person']));
    expect(names).not.toEqual(expect.arrayContaining(['set_content']));
    expect(names.some((x) => ['set_content', 'edit_content', 'remove', 'set_theme', 'undo'].includes(x))).toBe(false);
    await q.close();

    // outside a task run there is no ask_person
    const plain = await openTools(ws, 'hero');
    expect(plain.list.map((x) => x.name)).not.toContain('ask_person');
    // and a run limited to a block can't undo the person's change to the tasks
    addTask(ws, { block: 'hero', text: 'the person\'s' });
    expect((await plain.call('undo', {})).text).toMatch(/the person's change to the page's tasks/);
    await plain.close();
  });
});

/**
 * A runner that does what the script says for each request ("Task 1:", "Question 3:"…), through the real tools of
 * the run (its scope, tag and read-only mode), then answers. A script that waits for `stopped` runs until cancelled.
 */
function scripted(scripts: Record<string, (t: Tools, stopped: Promise<void>) => Promise<string | void>>) {
  const reqs: RunRequest[] = [];
  const runner: Runner = {
    start(req: RunRequest, on: RunEvents) {
      reqs.push(req);
      let stop!: () => void;
      const stopped = new Promise<void>((ok) => (stop = ok));
      let cancelled = false;
      void (async () => {
        const tools = await openTools(req.ws, req.scope, req.home, { tag: req.tag, readOnly: req.readOnly });
        try {
          const key = Object.keys(scripts).find((k) => req.prompt.startsWith(k));
          on.step('get layout');
          const answer = key ? await scripts[key](tools, stopped) : undefined;
          if (cancelled) on.error('stopped');
          else on.answer(answer || 'done');
        } finally {
          await tools.close();
          on.end();
        }
      })();
      return { cancel: () => ((cancelled = true), stop()) };
    },
  };
  return { runner, reqs };
}

const until = (fn: () => boolean) => expect.poll(fn, { timeout: 20_000 }).toBe(true);

describe('Kaity working through the tasks', () => {
  it('does them one at a time in each task\'s block, questions last, and waits for the person\'s answers', async () => {
    const ws = landing();
    const hero = ws.content('hero');
    addTask(ws, { block: 'hero', text: 'Is hero the same on second?', question: true });
    addTask(ws, { block: 'hero', path: [0], label: 'h1 "The short promise"', width: 375, text: 'Make the headline shorter' });
    addTask(ws, { block: 'pricing', text: 'Add a yearly price' });
    const { runner, reqs } = scripted({
      'Task 2:': async (t) => {
        await t.call('set_content', { id: 'hero', html: '<h1>Short</h1>' });
        await t.call('close_task', { n: 2, reply: 'Shortened the headline. Nothing else in hero moved.' });
      },
      'Task 3:': async (t) => {
        if (/Their answer: \$90/.test((reqs.at(-1) as RunRequest).prompt)) {
          await t.call('close_task', { n: 3, reply: 'Added $90 a year.' });
          return;
        }
        await t.call('ask_person', { question: 'What is the yearly price?' });
        return 'I need the yearly price.';
      },
      'Question 1:': async (t) => {
        const set = await t.call('set_content', { id: 'hero', html: '<h1>no</h1>' });
        expect(set.isError).toBe(true); // a question can't change anything
        await t.call('close_task', { n: 1, reply: 'Yes, hero is the same on both pages.' });
      },
    });
    const events: unknown[] = [];
    const ai = new AI(ws, () => {}, runner);
    const run = new TaskRun(ws, ai, (e, d) => e === 'taskrun' && events.push(d));
    run.start([1, 2, 3]);
    expect(() => ai.ask('cta', 'something else')).toThrow(/working through the tasks/);
    expect(ai.running()).not.toBeNull(); // between her requests too: undo and other runs wait
    await until(() => !run.state()!.running);

    // one request per task, in the task's block, tagged; the question last and read-only
    expect(reqs.map((r) => [r.prompt.split('\n')[0], r.scope, r.tag?.replace(/^.*#/, '#'), !!r.readOnly])).toEqual([
      ['Task 2: Make the headline shorter', 'hero', '#2', false],
      ['Task 3: Add a yearly price', 'pricing', '#3', false],
      ['Question 1: Is hero the same on second?', 'hero', '#1', true],
    ]);
    expect(reqs[0].prompt).toContain('seen 375 px wide');
    expect(run.state()!.tasks.map((t) => [t.n, t.state, t.summary ?? t.asked])).toEqual([
      [2, 'done', 'Shortened the headline. Nothing else in hero moved.'],
      [3, 'needs-you', 'What is the yearly price?'],
      [1, 'answered', 'Yes, hero is the same on both pages.'],
    ]);
    // pictures of the block before and after, for the review
    const done = run.state()!.tasks[0];
    expect([done.before, done.after]).toEqual(['2-before.png', '2-after.png']);
    expect(run.picture('2-after.png')?.length).toBeGreaterThan(1000);
    expect(run.picture('../2-after.png')).toBeNull();
    expect(events.length).toBeGreaterThan(5);

    // the person answers: she goes on with that task, with her question and the answer
    run.answer(3, '$90');
    await until(() => !run.state()!.running);
    expect(reqs.at(-1)!.prompt).toMatch(/You asked the person: What is the yearly price\?\nTheir answer: \$90/);
    expect(run.state()!.tasks.find((t) => t.n === 3)).toMatchObject({ state: 'done', summary: 'Added $90 a year.' });

    // one task's work taken back on its own: hero as it was, task 2 open again
    run.undoTask(2);
    expect(ws.content('hero')).toBe(hero);
    expect(tasks(ws, { open: true }).map((x) => x.n)).toContain(2);
    expect(ws.peekUndo()?.label).toBe('undo Kaity\'s work on task 2');
    expect(() => run.undoTask(2)).toThrow(/undone already/);
    // then the rest of what she did
    run.undoAll();
    expect(tasks(ws, { open: true }).map((x) => x.n).sort()).toEqual([1, 2, 3]);
    // keeping the result closes the review and drops its pictures
    run.keep();
    expect(run.state()).toBeNull();
    expect(ws.store.read('.tykerf/taskrun.json')).toBeNull();
    expect(ws.store.list('.tykerf/runs')).toEqual([]);
  });

  it('stops: the task she is on waits again, and taking a waiting one off her list leaves it open', async () => {
    const ws = landing();
    addTask(ws, { block: 'hero', text: 'slow one' });
    addTask(ws, { block: 'cta', text: 'next one' });
    const { runner } = scripted({ 'Task 1:': async (_t, stopped) => stopped });
    const ai = new AI(ws, () => {}, runner);
    const run = new TaskRun(ws, ai, () => {}, { shots: false });
    run.start([1, 2]);
    await until(() => run.state()!.tasks[0].state === 'now' && ai.running()?.id === 'hero');
    run.skip(2);
    expect(() => run.keep()).toThrow(/working through the tasks/);
    run.stop();
    await until(() => !run.state()!.running);
    expect(run.state()!.tasks.map((t) => [t.n, t.state])).toEqual([[1, 'waiting'], [2, 'off']]);
    expect(tasks(ws, { open: true }).map((x) => x.n)).toEqual([1, 2]);
    expect(ai.running()).toBeNull();
    // given again, the waiting task and the one taken off go on
    const { runner: r2, reqs } = scripted({ 'Task 1:': async (t) => void (await t.call('close_task', { n: 1 })), 'Task 2:': async (t) => void (await t.call('close_task', { n: 2 })) });
    const run2 = new TaskRun(ws, new AI(ws, () => {}, r2), () => {}, { shots: false });
    expect(run2.state()!.tasks.map((t) => t.state)).toEqual(['waiting', 'off']); // kept across a restart
    run2.start([1, 2]);
    await until(() => !run2.state()!.running);
    expect(reqs.map((r) => r.prompt.split(':')[0])).toEqual(['Task 1', 'Task 2']);
    expect(tasks(ws, { open: true })).toEqual([]);
  });

  it('marks a task she neither closed nor asked about as needing the person, with what she said', async () => {
    const ws = landing();
    addTask(ws, { block: 'hero', text: 'Use our real logo' });
    const { runner } = scripted({ 'Task 1:': async () => 'There is no logo file on the page: can you add one?' });
    const run = new TaskRun(ws, new AI(ws, () => {}, runner), () => {}, { shots: false });
    run.start([1]);
    await until(() => !run.state()!.running);
    expect(run.state()!.tasks[0]).toMatchObject({ state: 'needs-you', asked: 'There is no logo file on the page: can you add one?' });
    run.leave(1);
    expect(run.state()!.tasks[0].state).toBe('off');
    expect(() => run.start([9])).toThrow(/no task 9/);
  });

  it('closes the review once the person has seen everything in it', async () => {
    const ws = landing();
    addTask(ws, { block: 'hero', text: 'How tall is it?', question: true });
    const { runner } = scripted({ 'Question 1:': async (t) => void (await t.call('close_task', { n: 1, reply: '71 px.' })) });
    const run = new TaskRun(ws, new AI(ws, () => {}, runner), () => {}, { shots: false });
    run.start([1]);
    await until(() => !run.state()!.running);
    run.seen(1);
    expect(run.state()).toBeNull();
    // one an older editor left behind closes when the page opens
    ws.store.write('.tykerf/taskrun.json', JSON.stringify({ key: 'k', since: '', running: false, tasks: [{ n: 1, state: 'answered', block: 'hero', text: 'x', steps: 0, seen: true }] }));
    expect(new TaskRun(ws, new AI(ws, () => {}, runner), () => {}, { shots: false }).state()).toBeNull();
  });
});
