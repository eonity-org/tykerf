import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as M from '../src/moves.js';
import { FolderStore, MemoryStore, type Store, checkPath } from '../src/store.js';
import { Workspace } from '../src/workspace.js';

/** Every file under a folder, as store paths. */
function folderFiles(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(root, p).split('\\').join('/')] = readFileSync(p, 'utf8');
    }
  };
  walk(root);
  return out;
}

/** The widgets example loaded into a memory store. */
function memoryWidgets(): MemoryStore {
  return new MemoryStore('memory:widgets', folderFiles('examples/widgets'));
}

function tempWidgets(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tykerf-store-'));
  cpSync('examples/widgets', dir, { recursive: true });
  return dir;
}

/** The same edits, whatever the store: moves, box code, rename, a grouped change, undo. */
function edit(ws: Workspace) {
  ws.save(M.split(ws.load(), 'title', 'V', 2), 'split title', 'user');
  ws.setContent('footer', '<style>small{color:red}</style><small>new footer</small>', 'user');
  ws.rename('pricing', 'plans', 'user');
  ws.group('two changes', 'user', () => {
    ws.setContent('faq', '<p>one</p>', 'user');
    ws.setContent('signup', '<p>two</p>', 'user');
  });
  ws.undo(); // the group, as one step
  ws.setScope('chart', 'user');
  ws.render('Widgets');
}

describe('store paths', () => {
  it('accepts relative paths and refuses ones that could leave the store', () => {
    expect(checkPath('boxes/title.html')).toBe('boxes/title.html');
    expect(checkPath('.tykerf/chats/a.json')).toBe('.tykerf/chats/a.json');
    for (const bad of ['', '/etc/passwd', '../x', 'boxes/../../x', 'a//b', './a', 'a\\b']) expect(() => checkPath(bad)).toThrow(/bad store path/);
  });

  it('a folder store never touches files outside its folder', () => {
    const s = new FolderStore(mkdtempSync(join(tmpdir(), 'tykerf-store-')));
    expect(() => s.write('../outside.txt', 'x')).toThrow(/bad store path/);
    expect(() => s.read('../../etc/hosts')).toThrow(/bad store path/);
  });

  it('a type template can only come from inside the page', () => {
    const store = memoryWidgets();
    store.write('types/widget.json', JSON.stringify({ template: '../secret.html' }));
    expect(() => new Workspace(store).template('widget')).toThrow(/bad store path/);
  });
});

describe('folder store writes', () => {
  it('never lets another process read a file empty or half written', async () => {
    const store = new FolderStore(mkdtempSync(join(tmpdir(), 'tykerf-atomic-')));
    const a = 'a'.repeat(400_000), b = 'b'.repeat(300_000);
    store.write('layout.slice', a);
    // another process reads the file as fast as it can, and counts what is neither version
    const reader = spawn(process.execPath, ['-e', `
      const fs = require('node:fs'); const f = process.argv[1]; let reads = 0, bad = 0; const until = Date.now() + 1500;
      while (Date.now() < until) { const t = fs.readFileSync(f, 'utf8'); reads++; if (t.length !== 400000 && t.length !== 300000) bad++; }
      console.log(JSON.stringify({ reads, bad }));`, store.abs('layout.slice')]);
    let out = '';
    reader.stdout.on('data', (d) => (out += d));
    const done = new Promise((ok) => reader.on('exit', ok));
    const until = Date.now() + 1500;
    for (let i = 0; Date.now() < until; i++) store.write('layout.slice', i % 2 ? a : b);
    await done;
    const r = JSON.parse(out);
    expect(r.reads).toBeGreaterThan(50);
    expect(r.bad).toBe(0);
    // no temporary file is left, nor listed
    expect(readdirSync(store.root)).toEqual(['layout.slice']);
    expect(store.list('')).toEqual(['layout.slice']);
  });
});

describe('memory store', () => {
  it('lists only the files directly in a folder', () => {
    const s = new MemoryStore('memory:', { 'a.txt': '1', 'boxes/x.html': '2', 'boxes/sub/y.html': '3' });
    expect(s.list('')).toEqual(['a.txt']);
    expect(s.list('boxes')).toEqual(['x.html']);
    expect(s.list('missing')).toEqual([]);
  });

  it('keeps bytes as bytes and text as text', () => {
    const s = new MemoryStore();
    s.write('img.png', new Uint8Array([137, 80, 78, 71]));
    s.append('log.txt', 'a\n');
    s.append('log.txt', 'b\n');
    expect([...s.readBytes('img.png')!]).toEqual([137, 80, 78, 71]);
    expect(s.read('log.txt')).toBe('a\nb\n');
    s.remove('log.txt');
    expect(s.exists('log.txt')).toBe(false);
  });

  it('tells watchers about changes from outside, not about its own writes', () => {
    const s = new MemoryStore();
    const seen: string[] = [];
    const stop = s.watch((p) => seen.push(p));
    s.write('mine.txt', 'x');
    s.external('layout.slice', 'a b V');
    stop();
    s.external('boxes/a.html', '<p>');
    expect(seen).toEqual(['layout.slice']);
  });
});

describe('a workspace in any store', () => {
  it('starts a page and refuses to overwrite one', () => {
    const ws = new Workspace(new MemoryStore());
    expect(ws.exists()).toBe(false);
    ws.create('header main H\n', { header: '<h1>Hi</h1>', main: '<style>p{margin:0}</style><p>Body</p>' });
    expect(ws.load().root.type).toBe('op');
    expect(ws.parts('main')).toEqual({ html: '<p>Body</p>', css: 'p{margin:0}' });
    expect(() => ws.create('x')).toThrow(/already a page/);
  });

  it('reads box types from the store', () => {
    expect(Object.keys(new Workspace(memoryWidgets()).types())).toContain('pricing-table');
  });

  it('gives the same files in memory as in a folder for the same edits', () => {
    const dir = tempWidgets();
    const memory = memoryWidgets();
    edit(new Workspace(dir));
    edit(new Workspace(memory));
    const onDisk = folderFiles(dir);
    const inMemory = Object.fromEntries(Object.entries(memory.snapshot()).map(([p, b]) => [p, new TextDecoder().decode(b)]));
    // history and redo entries carry the time of the change; compare them without it
    const noTimes = (files: Record<string, string>) =>
      Object.fromEntries(Object.entries(files).map(([p, t]) => [p, p.endsWith('.jsonl') ? t.replace(/"at":"[^"]+"/g, '"at":""') : t]));
    expect(noTimes(inMemory)).toEqual(noTimes(onDisk));
    expect(Object.keys(inMemory)).toEqual(expect.arrayContaining(['boxes/plans.html', 'boxes/footer.css', 'out/index.html', '.scope', '.redo.jsonl']));
  });

  it('undoes everything back to the original page in memory', () => {
    const store = memoryWidgets();
    const before = new Workspace(store).page();
    const ws = new Workspace(store);
    edit(ws);
    while (ws.peekUndo()) ws.undo();
    expect(ws.page()).toBe(before);
    expect(ws.history()).toEqual([]);
  });

  it('only a folder workspace has a folder', () => {
    expect(new Workspace(tempWidgets()).dir).toMatch(/tykerf-store-/);
    expect(() => new Workspace(new MemoryStore('memory:x')).dir).toThrow(/not a folder \(memory:x\)/);
    expect(new Workspace(new MemoryStore('memory:x', { 'layout.slice': 'a b V\n' })).render()).toBe('memory:x/out/index.html');
  });

  it('works with any object that implements Store', () => {
    // the interface is all a workspace needs: wrap a memory store and count the calls
    const inner = memoryWidgets();
    let writes = 0;
    const counting: Store = {
      location: 'counting:',
      read: (p) => inner.read(p),
      readBytes: (p) => inner.readBytes(p),
      write: (p, d) => (writes++, inner.write(p, d)),
      append: (p, t) => (writes++, inner.append(p, t)),
      remove: (p) => inner.remove(p),
      exists: (p) => inner.exists(p),
      list: (d) => inner.list(d),
    };
    const ws = new Workspace(counting);
    ws.setContent('footer', '<small>x</small>', 'user');
    expect(writes).toBe(2); // the history entry and the box file
    expect(ws.content('footer')).toBe('<small>x</small>\n');
  });
});
