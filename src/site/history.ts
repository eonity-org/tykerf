// The site's one history: every change to its shared head, its kit and its settings is a step, with undo,
// redo and groups, as a page's history has (workspace.ts). One file per site:
//
//   .tykerf/site.jsonl          the steps, oldest first: { kind, label, author, at, path, prev }, where prev is
//                               the file's text before the change (null: it didn't exist); a group entry
//                               { kind: 'group', count } makes the `count` entries before it one step
//   .tykerf/site-redo.jsonl     undone steps, with the text undo replaced, until a new change
//   .tykerf/site-archive.jsonl  steps trimmed off the history (history-trim.ts), without their text
//
// Sites from before kept two: .tykerf/site-head.jsonl (the head) and .tykerf/kit.jsonl (the kit). The first
// change, undo or read folds them in, in time order, and removes them.
//
// Every write goes through the site's one FolderStore (siteStore): its lock is reentrant within a store, so a
// group can hold it while the changes inside take it again.

import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { FolderStore, type Store, SubStore } from '../store.js';
import { trimSteps } from '../history-trim.js';

export type SiteChangeKind = 'head' | 'kit' | 'settings' | 'file';

/** A change to one file of the site. */
export interface SiteFileEntry {
  kind: SiteChangeKind;
  label: string;
  author: string;
  at: string;
  /** The step's own name (two steps may come in the same millisecond); older entries have none: their time stands in. */
  id?: string;
  /** The file, relative to the site folder (head.html, kit/styles/base.css, site.json). */
  path: string;
  /** Its text before the change; null when it didn't exist. */
  prev: string | null;
  /** A file added to the site's assets/ (kind file): a hash of its bytes, kept in .tykerf/trash/<hash> while it is undone. */
  hash?: string;
  /** A file taken out of the site's assets/ (kind file): its bytes wait in .tykerf/trash/<hash>, and undo puts it back. */
  removed?: true;
}
export interface SiteGroupEntry {
  kind: 'group';
  label: string;
  author: string;
  at: string;
  id?: string;
  count: number;
}
export type SiteEntry = SiteFileEntry | SiteGroupEntry;
type SiteRedo = { entry: SiteFileEntry; next: string | null } | { group: SiteGroupEntry };

/** One step as people see it: a group shows as its own label. */
export interface SiteStep {
  label: string;
  author: string;
  at: string;
  kind: SiteChangeKind | 'group';
  /** For a group: the kinds of the changes in it. */
  kinds?: SiteChangeKind[];
}

const HISTORY = '.tykerf/site.jsonl';
const REDO = '.tykerf/site-redo.jsonl';
const ARCHIVE = '.tykerf/site-archive.jsonl';
const OLD_HEAD = '.tykerf/site-head.jsonl';
const OLD_KIT = '.tykerf/kit.jsonl';

/** A store a site lives in: any Store with a lock (a FolderStore's is the folder's; a MemoryStore's is a no-op). */
export type SiteStore = Store & { lock<T>(fn: () => T): T; folders(dir: string): string[] };

const stores = new Map<string, SiteStore>();
// sites that aren't folders (in memory: tests, previews; later remote), by their store's location
const registered = new Map<string, SiteStore>();

/**
 * Make a site of a store that isn't a folder (new Site(store)): every site function given its location as the
 * site's "dir" works on it. Returns that location.
 */
export function registerSite(store: SiteStore): string {
  registered.set(store.location, store);
  return store.location;
}

/** Whether a site's "dir" is a site in a store of its own (registerSite), not a folder. */
export const isRegistered = (dir: string) => registered.has(dir);

/** The site's one store in this process (its lock is reentrant within it): the folder's, or a registered one. */
export function siteStore(dir: string): SiteStore {
  const known = registered.get(dir);
  if (known) return known;
  // a folder inside a site in a store of its own (memory:shop/home): that store's files under its name
  for (const [at, store] of registered) if (dir.startsWith(`${at}/`)) return new SubStore(store, dir.slice(at.length + 1));
  const root = resolve(dir);
  let s = stores.get(root);
  if (!s) stores.set(root, (s = new FolderStore(root)));
  return s;
}

/** Sites with a group open in this process: their changes join it, and trimming waits for it to close. */
const grouping = new Set<string>();

const lines = (text: string | null) => (text ?? '').split('\n').filter(Boolean);
const jsonl = (rows: string[]) => rows.map((l) => l + '\n').join('');

export class SiteHistory {
  readonly store: SiteStore;

  constructor(readonly dir: string) {
    this.store = siteStore(dir);
  }

  private lines(): string[] {
    this.migrate();
    return lines(this.store.read(HISTORY));
  }

  private write(rows: string[]) {
    if (rows.length) this.store.write(HISTORY, jsonl(rows));
    else this.store.remove(HISTORY);
  }

  /** Fold the two histories of older sites (head, kit) into this one, once. */
  private migrate() {
    if (!this.store.exists(OLD_HEAD) && !this.store.exists(OLD_KIT)) return;
    this.store.lock(() => {
      const head = lines(this.store.read(OLD_HEAD)).map((l) => {
        const e = JSON.parse(l) as { label: string; at: string; prev: string | null; author?: string };
        return { kind: 'head', label: e.label, author: e.author ?? 'user', at: e.at, path: 'head.html', prev: e.prev } as SiteFileEntry;
      });
      const kit = lines(this.store.read(OLD_KIT)).map((l) => {
        const e = JSON.parse(l) as { label: string; at: string; prev: string | null; author?: string; path: string };
        return { kind: 'kit', label: e.label, author: e.author ?? 'user', at: e.at, path: e.path, prev: e.prev } as SiteFileEntry;
      });
      // in time order (a stable sort keeps each file's own order for steps made in the same millisecond)
      const old = [...head, ...kit].sort((a, b) => a.at.localeCompare(b.at)).map((e) => JSON.stringify(e));
      this.write([...old, ...lines(this.store.read(HISTORY))]);
      this.store.remove(OLD_HEAD);
      this.store.remove(OLD_KIT);
    });
  }

  /**
   * Change one file of the site as a step: `text` replaces it (null removes it). Nothing is logged when it
   * doesn't change. Returns the step's id (what a page's history points at), or null when nothing changed.
   */
  change(kind: SiteChangeKind, path: string, text: string | null, label: string, author = 'user'): string | null {
    return this.store.lock(() => {
      const prev = this.store.read(path);
      if (prev === text) return null;
      const id = randomUUID();
      this.log({ kind, label, author, at: new Date().toISOString(), id, path, prev });
      if (text === null) this.store.remove(path);
      else this.store.write(path, text);
      return id;
    });
  }

  /**
   * Add a file to the site's assets/ as a step (files.ts chose the name and checked the bytes): undo removes it,
   * keeping its bytes in .tykerf/trash/<hash> for redo. Returns the step's id, or null when it was there already.
   */
  addFile(path: string, bytes: Uint8Array, label: string, author = 'user', hash = createHash('sha1').update(bytes).digest('hex')): string | null {
    return this.store.lock(() => {
      if (this.store.exists(path)) return null;
      const id = randomUUID();
      this.log({ kind: 'file', label, author, at: new Date().toISOString(), id, path, prev: null, hash });
      this.store.write(path, bytes);
      return id;
    });
  }

  /** Take a file out of the site's assets/ as a step (its bytes in .tykerf/trash/<hash>; undo puts it back). */
  removeFile(path: string, label: string, author = 'user'): string | null {
    return this.store.lock(() => {
      const bytes = this.store.readBytes(path);
      if (!bytes) return null;
      const hash = createHash('sha1').update(bytes).digest('hex');
      const id = randomUUID();
      this.log({ kind: 'file', label, author, at: new Date().toISOString(), id, path, prev: null, hash, removed: true });
      this.trash(path, hash);
      return id;
    });
  }

  private trash(path: string, hash: string) {
    const bytes = this.store.readBytes(path);
    if (bytes && !this.store.exists(`.tykerf/trash/${hash}`)) this.store.write(`.tykerf/trash/${hash}`, bytes);
    this.store.remove(path);
  }

  private untrash(path: string, hash: string) {
    const bytes = this.store.readBytes(`.tykerf/trash/${hash}`);
    if (!bytes) throw new Error(`the file ${path} can't be brought back: its copy is gone`);
    this.store.write(path, bytes);
  }

  /** Record a new step. A new change makes the undone steps unreachable, so redo starts over. */
  private log(e: SiteEntry) {
    this.migrate();
    this.store.append(HISTORY, JSON.stringify(e) + '\n');
    const hadRedo = this.store.exists(REDO);
    this.store.remove(REDO);
    if (grouping.has(this.store.location)) return;
    const cut = trimSteps(lines(this.store.read(HISTORY)));
    if (cut) {
      this.store.append(ARCHIVE, cut.archived);
      this.store.write(HISTORY, cut.kept);
    }
    if (cut || hadRedo) this.sweepTrash();
  }

  /** The bytes kept in .tykerf/trash/ for undo and redo that no step names any more go. */
  private sweepTrash() {
    const kept = this.store.list('.tykerf/trash');
    if (!kept.length) return;
    const named = (this.store.read(HISTORY) ?? '') + (this.store.read(REDO) ?? '');
    for (const h of kept) if (!named.includes(`"${h}"`)) this.store.remove(`.tykerf/trash/${h}`);
  }

  /**
   * Run several changes as one step: if `fn` makes more than one, a group entry closes them, so undo
   * reverts them together. If `fn` throws, what it changed is undone. A group inside a group is part of it.
   */
  group<T>(label: string, author: string, fn: () => T): T {
    const root = this.store.location;
    if (grouping.has(root)) return fn();
    return this.store.lock(() => {
      const before = this.lines().length;
      grouping.add(root);
      let r: T;
      try {
        r = fn();
      } catch (e) {
        const made = this.lines().length - before;
        for (let i = 0; i < made; i++) this.undoStep();
        if (made) this.store.remove(REDO); // what was rolled back is not something to redo
        throw e;
      } finally {
        grouping.delete(root);
      }
      const count = this.lines().length - before;
      if (count > 1) this.log({ kind: 'group', label, author, at: new Date().toISOString(), id: randomUUID(), count });
      return r;
    });
  }

  /** The step undo would revert, or null. */
  peekUndo(): SiteStep | null {
    const all = this.lines().map((l) => JSON.parse(l) as SiteEntry);
    return stepAt(all, all.length);
  }

  /** The step redo would bring back, or null. */
  peekRedo(): SiteStep | null {
    const rows = lines(this.store.read(REDO));
    const last = rows.pop();
    if (!last) return null;
    const top = JSON.parse(last) as SiteRedo;
    if ('group' in top) {
      const inner = rows.slice(-top.group.count).map((l) => JSON.parse(l) as SiteRedo);
      const kinds = [...new Set(inner.flatMap((r) => ('entry' in r ? [r.entry.kind] : [])))];
      const { label, author, at } = top.group;
      return { label, author, at, kind: 'group', kinds };
    }
    const { label, author, at, kind } = top.entry;
    return { label, author, at, kind };
  }

  /** Revert the last step; returns its label. Redo can bring it back. */
  undo(): string {
    return this.store.lock(() => {
      if (!this.lines().length) throw new Error('there is no change to the site to undo');
      return this.undoStep();
    });
  }

  private undoStep(): string {
    const rows = this.lines();
    const last = rows.pop();
    if (!last) throw new Error('there is no change to the site to undo');
    const e = JSON.parse(last) as SiteEntry;
    this.write(rows);
    if (e.kind === 'group') {
      for (let i = 0; i < e.count; i++) this.undoStep();
      this.store.append(REDO, JSON.stringify({ group: e } satisfies SiteRedo) + '\n');
      return e.label;
    }
    if (e.kind === 'file') {
      // a file's bytes aren't text: they wait in .tykerf/trash/<hash> (an added file goes, a removed one comes back)
      if (e.removed) this.untrash(e.path, e.hash!);
      else this.trash(e.path, e.hash!);
      this.store.append(REDO, JSON.stringify({ entry: e, next: null } satisfies SiteRedo) + '\n');
      return e.label;
    }
    this.store.append(REDO, JSON.stringify({ entry: e, next: this.store.read(e.path) } satisfies SiteRedo) + '\n');
    if (e.prev === null) this.store.remove(e.path);
    else this.store.write(e.path, e.prev);
    return e.label;
  }

  /** Bring back the last undone step; returns its label. */
  redo(): string {
    return this.store.lock(() => {
      if (!lines(this.store.read(REDO)).length) throw new Error('there is no change to the site to redo');
      return this.redoStep();
    });
  }

  private redoStep(): string {
    const rows = lines(this.store.read(REDO));
    const last = rows.pop();
    if (!last) throw new Error('there is no change to the site to redo');
    if (rows.length) this.store.write(REDO, jsonl(rows));
    else this.store.remove(REDO);
    const r = JSON.parse(last) as SiteRedo;
    if ('group' in r) {
      for (let i = 0; i < r.group.count; i++) this.redoStep();
      this.store.append(HISTORY, JSON.stringify(r.group) + '\n');
      return r.group.label;
    }
    if (r.entry.kind === 'file') {
      if (r.entry.removed) this.trash(r.entry.path, r.entry.hash!);
      else this.untrash(r.entry.path, r.entry.hash!);
    } else if (r.next === null) this.store.remove(r.entry.path);
    else this.store.write(r.entry.path, r.next);
    // back on the history as it was (not through log(), which would drop the rest of the redo list)
    this.store.append(HISTORY, JSON.stringify(r.entry) + '\n');
    return r.entry.label;
  }

  /** The latest steps, newest first (a group as one step). */
  steps(limit = 30): SiteStep[] {
    const all = this.lines().map((l) => JSON.parse(l) as SiteEntry);
    const out: SiteStep[] = [];
    for (let end = all.length; end > 0 && out.length < limit; ) {
      const e = all[end - 1];
      out.push(stepAt(all, end)!);
      end -= e.kind === 'group' ? e.count + 1 : 1;
    }
    return out;
  }

  /** The id of every step undo would take, in the order it would take them (a group's own for a group; an older entry's time). */
  undoAts(): string[] {
    const all = this.lines().map((l) => JSON.parse(l) as SiteEntry);
    const out: string[] = [];
    for (let end = all.length; end > 0; ) {
      const e = all[end - 1];
      out.push(e.id ?? e.at);
      end -= e.kind === 'group' ? e.count + 1 : 1;
    }
    return out;
  }

  /** The id of every step redo would bring back, in the order it would. */
  redoAts(): string[] {
    const rows = lines(this.store.read(REDO)).map((l) => JSON.parse(l) as SiteRedo);
    const out: string[] = [];
    for (let end = rows.length; end > 0; ) {
      const r = rows[end - 1];
      const e = 'group' in r ? r.group : r.entry;
      out.push(e.id ?? e.at);
      end -= 'group' in r ? r.group.count + 1 : 1;
    }
    return out;
  }

  /** The last change of a kind (inside a group too), or null. */
  last(kind: SiteChangeKind): SiteFileEntry | null {
    const all = this.lines().map((l) => JSON.parse(l) as SiteEntry);
    for (let i = all.length - 1; i >= 0; i--) if (all[i].kind === kind) return all[i] as SiteFileEntry;
    return null;
  }

  /**
   * Rewrite the text a kind of step keeps (before and after), so undo and redo stay right after something
   * outside the history changed what it names: a page rename renames it in the settings' snapshots.
   */
  rewrite(kind: SiteChangeKind, fn: (text: string) => string) {
    this.store.lock(() => {
      const map = (t: string | null) => (t === null ? null : fn(t));
      this.write(this.lines().map((l) => {
        const e = JSON.parse(l) as SiteEntry;
        return e.kind === kind ? JSON.stringify({ ...e, prev: map(e.prev) }) : l;
      }));
      const redo = lines(this.store.read(REDO)).map((l) => {
        const r = JSON.parse(l) as SiteRedo;
        return 'entry' in r && r.entry.kind === kind ? JSON.stringify({ entry: { ...r.entry, prev: map(r.entry.prev) }, next: map(r.next) }) : l;
      });
      if (redo.length) this.store.write(REDO, jsonl(redo));
    });
  }
}

/** The step that ends at entry `end` (exclusive index), as people see it. */
function stepAt(all: SiteEntry[], end: number): SiteStep | null {
  const e = all[end - 1];
  if (!e) return null;
  if (e.kind !== 'group') return { label: e.label, author: e.author, at: e.at, kind: e.kind };
  const kinds = [...new Set(all.slice(end - 1 - e.count, end - 1).map((x) => x.kind).filter((k): k is SiteChangeKind => k !== 'group'))];
  return { label: e.label, author: e.author, at: e.at, kind: 'group', kinds };
}
