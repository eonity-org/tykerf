// Where a workspace's files live. Workspace, box types, the editor and the AI runner read and
// write only through a Store, so a page can live in a folder (FolderStore), in memory
// (MemoryStore: tests, previews, imports in progress) or, later, in S3 and Tydal.
//
// Paths are relative and '/'-separated: 'layout.slice', 'boxes/title.html', '.tykerf/chats/x.json'.
// The interface is synchronous on purpose: every caller (moves, undo, the MCP server) stays simple.
// A remote store keeps a local snapshot of the page (pages are small) and syncs it outside these calls.

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

export interface Store {
  /** Where the files are, for people and child processes: a folder path, or a URL-like name. */
  readonly location: string;
  /** The file's text, or null when it doesn't exist. */
  read(path: string): string | null;
  /** The file's bytes, or null when it doesn't exist. */
  readBytes(path: string): Uint8Array | null;
  /** Create or replace a file (parent folders are implied). */
  write(path: string, data: string | Uint8Array): void;
  /** Add text at the end of a file, creating it if needed. */
  append(path: string, text: string): void;
  /** Delete a file; nothing happens when it doesn't exist. */
  remove(path: string): void;
  exists(path: string): boolean;
  /** Names of the files directly inside a folder ('' = the top), sorted; [] when the folder doesn't exist. */
  list(dir: string): string[];
  /** Call `onChange` with the path of each file changed from outside this object. Returns a stop function. */
  watch?(onChange: (path: string) => void): () => void;
  /**
   * Run `fn` while no other process changes the store (a read-modify-write stays whole). Reentrant.
   * Stores that only one process uses can leave it out.
   */
  lock?<T>(fn: () => T): T;
}

/** Throw on paths that could leave the store: absolute, empty segments, '.' or '..'. */
export function checkPath(path: string): string {
  const parts = path.split('/');
  if (!path || path.startsWith('/') || path.includes('\\') || parts.some((p) => !p || p === '.' || p === '..')) {
    throw new Error(`bad store path "${path}"`);
  }
  return path;
}

const checkDir = (dir: string) => (dir === '' ? '' : checkPath(dir));

// The editor and the AI's MCP server are separate processes that change the same folder.
const LOCK = '.tykerf.lock'; // a folder: mkdir is atomic, so only one process can create it
const LOCK_STALE_MS = 5000; // changes take milliseconds; an older lock was left by a process that died
const LOCK_WAIT_MS = 8000; // longer than LOCK_STALE_MS, so a stale lock is always cleared before giving up
const SLEEP = new Int32Array(new SharedArrayBuffer(4));
// A file is written whole under a temporary name next to it, then renamed over the old one (atomic on the
// same disk): another process reading it meanwhile (the editor, Kaity's MCP server, a file watcher) gets
// the old file or the new one, never an empty or half-written one.
const TMP = '.tykerf-tmp-';
const isTmp = (name: string) => name.includes(TMP);
let tmpCount = 0;

/** A workspace folder on disk. */
export class FolderStore implements Store {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  get location() {
    return this.root;
  }
  /** The absolute path of a store path (only for code that must hand a real file to another program). */
  abs(path: string): string {
    return join(this.root, ...checkPath(path).split('/'));
  }
  read(path: string) {
    const f = this.abs(path);
    return existsSync(f) ? readFileSync(f, 'utf8') : null;
  }
  readBytes(path: string) {
    const f = this.abs(path);
    return existsSync(f) ? new Uint8Array(readFileSync(f)) : null;
  }
  write(path: string, data: string | Uint8Array) {
    const f = this.abs(path);
    mkdirSync(dirname(f), { recursive: true });
    const tmp = `${f}${TMP}${process.pid}-${++tmpCount}`;
    try {
      writeFileSync(tmp, data);
      renameSync(tmp, f);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
  }
  append(path: string, text: string) {
    const f = this.abs(path);
    mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, text);
  }
  remove(path: string) {
    rmSync(this.abs(path), { force: true });
  }
  exists(path: string) {
    return existsSync(this.abs(path));
  }
  list(dir: string) {
    const d = checkDir(dir) ? this.abs(dir) : this.root;
    if (!existsSync(d)) return [];
    return readdirSync(d).filter((f) => !isTmp(f) && statSync(join(d, f)).isFile()).sort();
  }
  private held = 0;
  lock<T>(fn: () => T): T {
    if (this.held) {
      this.held++;
      try {
        return fn();
      } finally {
        this.held--;
      }
    }
    const dir = join(this.root, LOCK);
    mkdirSync(this.root, { recursive: true });
    const until = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try {
        mkdirSync(dir);
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
      let age = 0;
      try {
        age = Date.now() - statSync(dir).mtimeMs;
      } catch {
        continue; // released in the meantime
      }
      if (age > LOCK_STALE_MS) rmSync(dir, { recursive: true, force: true });
      else if (Date.now() > until) throw new Error('the page is busy: another process is changing it; try again');
      else Atomics.wait(SLEEP, 0, 0, 10);
    }
    this.held = 1;
    try {
      return fn();
    } finally {
      this.held = 0;
      rmSync(dir, { recursive: true, force: true });
    }
  }
  watch(onChange: (path: string) => void) {
    const w = watch(this.root, { recursive: true }, (_event, file) => {
      if (file && !isTmp(String(file))) onChange(String(file).split(sep).join('/'));
    });
    return () => w.close();
  }
}

/** A workspace held in memory: for tests, previews and pages that aren't saved anywhere yet. */
export class MemoryStore implements Store {
  private files = new Map<string, Uint8Array>();
  private listeners = new Set<(path: string) => void>();
  constructor(readonly location = 'memory:', files: Record<string, string | Uint8Array> = {}) {
    for (const [p, d] of Object.entries(files)) this.files.set(checkPath(p), bytes(d));
  }
  read(path: string) {
    const b = this.files.get(checkPath(path));
    return b ? new TextDecoder().decode(b) : null;
  }
  readBytes(path: string) {
    const b = this.files.get(checkPath(path));
    return b ? b.slice() : null;
  }
  write(path: string, data: string | Uint8Array) {
    this.files.set(checkPath(path), bytes(data));
  }
  append(path: string, text: string) {
    this.write(path, (this.read(path) ?? '') + text);
  }
  remove(path: string) {
    this.files.delete(checkPath(path));
  }
  exists(path: string) {
    return this.files.has(checkPath(path));
  }
  list(dir: string) {
    const prefix = checkDir(dir) ? `${dir}/` : '';
    return [...this.files.keys()]
      .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
      .map((p) => p.slice(prefix.length))
      .sort();
  }
  /** Every file, for copying the page elsewhere (export, sync to a remote store). */
  snapshot(): Record<string, Uint8Array> {
    return Object.fromEntries([...this.files].map(([p, b]) => [p, b.slice()]));
  }
  /** Simulate a change from outside (another process, a remote sync): writes and notifies watchers. */
  external(path: string, data: string | Uint8Array | null) {
    if (data === null) this.remove(path);
    else this.write(path, data);
    for (const f of this.listeners) f(path);
  }
  watch(onChange: (path: string) => void) {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }
}

const bytes = (d: string | Uint8Array) => (typeof d === 'string' ? new TextEncoder().encode(d) : d.slice());
