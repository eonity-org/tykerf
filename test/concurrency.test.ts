import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI, type RunEvents, type RunRequest, type Runner } from '../src/editor/ai.js';
import * as M from '../src/moves.js';
import { FolderStore, MemoryStore } from '../src/store.js';
import { Workspace } from '../src/workspace.js';

function folder(): Workspace {
  const dir = mkdtempSync(join(tmpdir(), 'tykerf-conc-'));
  cpSync('examples/widgets', dir, { recursive: true });
  return new Workspace(dir);
}

function memory(): Workspace {
  const files: Record<string, string> = { 'layout.slice': readFileSync('examples/widgets/layout.slice', 'utf8') };
  for (const f of readdirSync('examples/widgets/boxes')) files[`boxes/${f}`] = readFileSync(`examples/widgets/boxes/${f}`, 'utf8');
  return new Workspace(new MemoryStore('memory:widgets', files));
}

describe('the folder lock', () => {
  it('waits for another process holding it, then runs', async () => {
    const ws = folder();
    const lock = join(ws.dir, '.tykerf.lock');
    // another process takes the lock for 300 ms
    const child = spawn(process.execPath, ['-e', `require('fs').mkdirSync(${JSON.stringify(lock)}); setTimeout(() => require('fs').rmSync(${JSON.stringify(lock)}, { recursive: true }), 300)`]);
    await new Promise((r) => child.on('spawn', r));
    for (let i = 0; i < 200 && !existsSync(lock); i++) await new Promise((r) => setTimeout(r, 5));
    expect(existsSync(lock)).toBe(true);
    const t0 = Date.now();
    ws.setContent('footer', '<p>after the other process</p>', 'user');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(150);
    expect(ws.content('footer')).toBe('<p>after the other process</p>\n');
    expect(existsSync(lock)).toBe(false);
  });

  it('clears a lock left by a process that died', () => {
    const ws = folder();
    const lock = join(ws.dir, '.tykerf.lock');
    mkdirSync(lock);
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    ws.setContent('footer', '<p>x</p>', 'user');
    expect(existsSync(lock)).toBe(false);
  });

  it('is reentrant', () => {
    const store = new FolderStore(folder().dir);
    expect(store.lock(() => store.lock(() => 42))).toBe(42);
  });
});

describe('groups', () => {
  it('undo everything they did when they fail', () => {
    const ws = memory();
    const before = { slice: ws.store.read('layout.slice'), footer: ws.content('footer'), history: ws.history() };
    expect(() =>
      ws.group('half done', 'user', () => {
        ws.setContent('footer', '<p>new</p>', 'user');
        ws.save(M.flip(ws.load(), 'row1'), 'flip', 'user');
        throw new Error('second half failed');
      })).toThrow('second half failed');
    expect({ slice: ws.store.read('layout.slice'), footer: ws.content('footer'), history: ws.history() }).toEqual(before);
    expect(ws.peekRedo()).toBeNull();
  });

  it('inside a group are part of it (one undo step)', () => {
    const ws = memory();
    ws.group('outer', 'user', () => {
      ws.setContent('footer', '<p>a</p>', 'user');
      ws.group('inner', 'user', () => {
        ws.setContent('faq', '<p>b</p>', 'user');
        ws.setContent('title', '<p>c</p>', 'user');
      });
    });
    ws.setContent('signup', '<p>later</p>', 'user');
    ws.undo();
    expect(ws.undo()).toBe('outer');
    expect(ws.peekUndo()).toBeNull();
  });
});

describe('history', () => {
  it('keeps the newest 200 steps and archives the rest without their snapshots', () => {
    const ws = memory();
    for (let i = 0; i < 300; i++) {
      if (i % 7 === 0) {
        ws.group(`pair ${i}`, 'user', () => {
          ws.setContent('faq', `<p>faq ${i}</p>`, 'user');
          ws.setContent('signup', `<p>signup ${i}</p>`, 'user');
        });
      } else ws.setContent('footer', `<p>${i}</p>`, 'user');
    }
    const archived = ws.store.read('.history-archive.jsonl')!.trim().split('\n').map((l) => JSON.parse(l));
    // a group's entries come before its marker
    expect(archived.slice(0, 3).map((e) => e.label)).toEqual(['set_content faq (12 chars)', 'set_content signup (15 chars)', 'pair 0']);
    expect(archived[2]).toEqual({ label: 'pair 0', author: 'user', at: expect.any(String), kind: 'group' });
    expect(archived.every((e) => !('prev' in e) && !('slice' in e))).toBe(true);
    // the history starts on a step boundary: every remaining step undoes cleanly
    let steps = 0;
    while (ws.peekUndo()) ws.undo(), steps++;
    expect(steps).toBeGreaterThanOrEqual(200);
    expect(steps).toBeLessThan(250);
  });
});

describe('box code reads', () => {
  it('content(id) and boxIds() agree with contents()', () => {
    const ws = memory();
    ws.store.write('contents.json', JSON.stringify({ legacy: '<p>old</p>', footer: '<p>shadowed</p>' }));
    const all = ws.contents();
    expect(new Set(ws.boxIds())).toEqual(new Set(Object.keys(all)));
    for (const id of Object.keys(all)) expect(ws.content(id)).toBe(all[id]);
    expect(ws.content('constructor')).toBeNull();
    expect(ws.content('../x')).toBeNull();
  });
});

/** A runner that does nothing until the test says so. */
class FakeRunner implements Runner {
  req?: RunRequest;
  on?: RunEvents;
  start(req: RunRequest, on: RunEvents) {
    this.req = req;
    this.on = on;
    return { cancel: () => on.end() };
  }
}

describe('an AI run', () => {
  it('gets its block as its own scope and locks that block for the editor until it ends', () => {
    const ws = folder();
    const runner = new FakeRunner();
    const ai = new AI(ws, () => {}, runner);
    ws.setScope('page', 'user');
    ai.ask('row2', 'make it nicer');
    expect(runner.req).toMatchObject({ scope: 'row2', dir: ws.dir, prompt: 'make it nicer' });
    expect(ws.store.read('.scope')).toBe('page user\n'); // the shared scope is left alone
    expect(ai.running()).toEqual({ id: 'row2' });

    // inside the block: refused
    expect(() => ws.setContent('faq', '<p>x</p>', 'user')).toThrow(/locked while Kaity works/);
    expect(() => ws.save(M.flip(ws.load(), 'row2'), 'flip', 'user')).toThrow(/locked/);
    expect(() => ws.save(M.remove(ws.load(), 'row2'), 'remove', 'user')).toThrow(/locked/);
    expect(() => ws.rename('signup', 'join', 'user')).toThrow(/locked/);
    // elsewhere: fine, also moving the block as a whole
    ws.setContent('footer', '<p>y</p>', 'user');
    ws.save(M.flip(ws.load(), 'row1'), 'flip row1', 'user');
    ws.save(M.swap(ws.load(), 'row2', 'title'), 'swap', 'user');

    // the AI's own changes come from its MCP process (another Workspace object), which the lock doesn't hold back
    new Workspace(ws.dir).setContent('faq', '<p>by the AI</p>', 'ai');
    ws.setContent('footer', '<p>still fine</p>', 'user');

    runner.on!.answer('done');
    runner.on!.end();
    expect(ai.running()).toBeNull();
    ws.setContent('faq', '<p>mine again</p>', 'user');
    expect(ai.chat('row2').messages.map((m) => m.role)).toEqual(['user', 'ai']);
  });

  it('follows the block when the AI renames it: the lock and the conversation go with it', () => {
    const ws = folder();
    const runner = new FakeRunner();
    const ai = new AI(ws, () => {}, runner);
    ai.ask('row2', 'better names');
    runner.on!.step('rename row2 lower');
    new Workspace(ws.dir).rename('row2', 'lower', 'ai'); // the AI's MCP process
    expect(ai.running()).toEqual({ id: 'lower' });
    // still locked under its new name; the rest of the page isn't
    expect(() => ws.setContent('faq', '<p>x</p>', 'user')).toThrow(/"lower" is locked/);
    expect(() => ws.save(M.flip(ws.load(), 'lower'), 'flip', 'user')).toThrow(/locked/);
    ws.setContent('footer', '<p>fine</p>', 'user');
    runner.on!.answer('renamed');
    runner.on!.end();
    expect(ws.store.exists('.tykerf/chats/row2.json')).toBe(false);
    expect(ai.chat('lower').messages.map((m) => m.text)).toEqual(['better names', 'rename row2 lower', 'renamed']);
    ws.setContent('faq', '<p>unlocked</p>', 'user');
  });

  it('records the session to resume and unlocks when cancelled', () => {
    const ws = folder();
    const runner = new FakeRunner();
    const ai = new AI(ws, () => {}, runner);
    ai.ask('faq', 'shorter');
    runner.on!.session('s-1');
    expect(ai.chat('faq').session).toBe('s-1');
    expect(ai.cancel()).toBe(true);
    expect(ai.running()).toBeNull();
    ws.setContent('faq', '<p>x</p>', 'user');
    ai.ask('faq', 'again');
    expect(runner.req!.session).toBe('s-1');
  });
});
