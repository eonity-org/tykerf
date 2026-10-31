// A workspace holds one page, in a Store (a folder, memory, later S3 and Tydal):
//   layout.slice     the slicing tree (postfix, all op ids written) + overlay/rule lines
//   boxes/<id>.html  the content of each box (markup, text, scripts)
//   boxes/<id>.css   its style (scoped to the box when rendered); content and style are kept apart
//   contents.json    legacy/simple form: id -> HTML snippet (boxes/ files take precedence)
//   types/<type>.json  box types: placement + content grammar (types.ts)
//   head.html        optional page-level <head> additions (theme, fonts, section styles from an import)
//   assets/          images and files the boxes use (copied to out/assets when rendering)
//   .scope           the block the AI is limited to (one node name), shared by MCP and editor
//   .history.jsonl   undo stack + audit log: layout and content changes, with author and time (the last
//                    HISTORY_STEPS steps; older ones move to .history-archive.jsonl, without their snapshots)
//   .redo.jsonl      undone steps that redo can bring back (cleared by any new change)
//   .images.json     images the image tool cropped, turned or scaled: the original each came from (assets.ts)
//   out/index.html   rendered page
//   .tykerf/           editor state (AI conversations, attached images, the removed-code buffer)

import { join } from 'node:path';
import { type Layout, find, walk } from './model.js';
import { markCurrentPage } from './kit.js';
import { FolderStore, type Store } from './store.js';
import * as M from './moves.js';
import { type Registry, contentErrors, loadTypes, newTypeErrors } from './types.js';
import { parseSlice, serializeSlice } from './notation.js';
import { type Contents, toHTML } from './render.js';

type HistoryEntry =
  | { kind?: 'layout'; label: string; author?: string; at?: string; slice: string }
  | { kind: 'rename'; label: string; author: string; at: string; slice: string; from: string; to: string }
  | { kind: 'content'; label: string; author: string; at: string; id: string; prev: string | null }
  | { kind: 'head'; label: string; author: string; at: string; prev: string | null } // head.html: page-wide fonts, theme, scripts
  | { kind: 'group'; label: string; author: string; at: string; count: number }; // the previous `count` entries are one step

/** An undone step, kept so redo can bring it back: the entry plus the state undo replaced. */
type RedoEntry =
  | { entry: HistoryEntry; slice: string } // layout and rename steps: the layout before undo
  | { entry: HistoryEntry; content: string | null } // box code steps: the code before undo
  | { entry: HistoryEntry; head: string | null } // head.html steps: head.html before undo
  | { group: Extract<HistoryEntry, { kind: 'group' }> }; // marks the inner steps below it as one

/** A change about to be made, as guards see it (see Workspace.addGuard). */
export type Change =
  | { kind: 'layout'; prev: Layout; next: Layout }
  | { kind: 'content'; id: string; layout: Layout }
  | { kind: 'head' };

const BOX_ID = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/** Separate a box's code into content (markup, text, scripts) and style (all its <style> blocks). */
export function splitStyle(code: string): { html: string; css: string } {
  const css: string[] = [];
  const html = code.replace(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>\s*/gi, (_m, c: string) => {
    css.push(c.replace(/^\s*\n|\s+$/g, '')); // keep the CSS as written (indentation included)
    return '';
  });
  return { html: html.trim(), css: css.filter(Boolean).join('\n') };
}

/** The box code the renderer gets: its style as one <style> block, then its content. */
export function joinStyle(html: string, css: string): string {
  const c = css.replace(/^\s*\n|\s+$/g, '');
  return c.trim() ? `<style>\n${c}\n</style>\n${html}` : html;
}

const SLICE = 'layout.slice';
const CONTENTS = 'contents.json';
const BOXES = 'boxes';
const HISTORY = '.history.jsonl';
const REDO = '.redo.jsonl';
const ARCHIVE = '.history-archive.jsonl';
/** Undo steps kept in the history; it is trimmed back to this once it has HISTORY_TRIM steps. */
const HISTORY_STEPS = 200;
const HISTORY_TRIM = 250;
const SCOPE = '.scope';
const HEAD = 'head.html';
const ASSETS = 'assets';
const OUT = 'out/index.html';

/** The site a page belongs to, as far as rendering goes: the head every page of the site shares (site.ts). */
export interface SiteLink {
  head(): string;
  /** How many pages the site has: a site of one page shares its theme with that page alone. */
  pages?(): number;
  /** The site's page names, so links between pages can be checked (src/check.ts). */
  pageNames?(): string[];
  /** The site's own files (its assets/ folder, at /assets/), so a page's references to them can be checked. */
  files?(): string[];
  /** One of the site's own files (assets/<file>), as a page asks for it at /assets/<file>; null when there is none. */
  asset?(file: string): Uint8Array | null;
  /** The <link rel="icon"> every page of the site gets (its own icon, or the one made from its name). */
  icon?(): string;
  /** Replace the shared head (the site keeps the previous one for its own undo). */
  setHead?(html: string, label: string): void;
  /** This page's name in the site (for marking links to it in shared blocks). */
  page?: string;
  /** The site's folder (its kit: shared blocks, styles, tags). */
  dir?: string;
  /** The site kit's part of every page's head: its styles and the behaviours' loader (src/kit.ts). */
  kit?(): string;
  /** A shared block's code (kit/blocks/<name>.html), or null. */
  block?(name: string): string | null;
  /** Change a shared block: every page that uses it changes (the site keeps the previous version for its undo). */
  setBlock?(name: string, code: string | null, author: string): void;
  /** The box types every page of the site has (kit/types/). */
  types?(): Registry;
}

/** A page head with this marker keeps its own look: the site's shared head is left out (imported copies). */
export const NO_SITE_HEAD = '<meta name="tykerf-site-theme" content="off">';

export class Workspace {
  readonly store: Store;
  /** The site this page belongs to, when it is a page of a site: its shared head comes first. */
  readonly site?: SiteLink;
  /** A folder path (as before) or any Store. */
  constructor(where: string | Store, opts: { site?: SiteLink | null } = {}) {
    this.store = typeof where === 'string' ? new FolderStore(where) : where;
    if (opts.site) this.site = opts.site;
  }

  /** The site's shared head, as this page uses it ('' outside a site, or when the page keeps its own look). */
  siteHead(): string {
    if (!this.site) return '';
    return this.head().includes(NO_SITE_HEAD) ? '' : this.site.head();
  }

  /** The site kit's part of this page's head ('' outside a site, or when the page keeps its own look). */
  kitHead(): string {
    if (!this.site?.kit) return '';
    return this.head().includes(NO_SITE_HEAD) ? '' : this.site.kit();
  }

  /** The shared block a box shows instead of its own code (its use=), when the site has it. */
  sharedBlock(id: string, l: Layout = this.load()): string | null {
    const n = find(l.root, id)?.node;
    return n?.type === 'leaf' && n.use ? n.use : null;
  }

  /** The folder, for workspaces on disk (tools that need real files: the CLI, child processes). */
  get dir(): string {
    if (this.store instanceof FolderStore) return this.store.root;
    throw new Error(`this workspace is not a folder (${this.store.location})`);
  }
  private abs(path: string) {
    return join(this.dir, path);
  }
  get slicePath() {
    return this.abs(SLICE);
  }
  get contentsPath() {
    return this.abs(CONTENTS);
  }
  get boxesDir() {
    return this.abs(BOXES);
  }
  get historyPath() {
    return this.abs(HISTORY);
  }
  get htmlPath() {
    return this.abs(OUT);
  }

  /**
   * Run a read-modify-write as one piece: no other process (the AI's MCP server, another editor)
   * changes the page in between. Every change below takes it too; callers that load, compute and
   * save wrap the whole sequence. Reentrant; keep it short (other processes wait for it).
   */
  transaction<T>(fn: () => T): T {
    return this.store.lock ? this.store.lock(fn) : fn();
  }

  private guards = new Set<(c: Change) => void>();
  /** Add a check that may refuse changes made through this object (by throwing). Returns a remove function. */
  addGuard(fn: (c: Change) => void): () => void {
    this.guards.add(fn);
    return () => this.guards.delete(fn);
  }
  private checkGuards(c: Change) {
    for (const g of this.guards) g(c);
  }

  /** Whether the workspace has a page yet (a layout.slice). */
  exists(): boolean {
    return this.store.exists(SLICE);
  }

  private slice(): string {
    const s = this.store.read(SLICE);
    if (s === null) throw new Error(`no ${SLICE} in ${this.store.location}`);
    return s;
  }

  load(): Layout {
    return parseSlice(this.slice());
  }

  /** Start a page from a layout and box code (refuses to overwrite an existing page). */
  create(layout: Layout | string, boxes: Record<string, string> = {}) {
    if (this.exists()) throw new Error(`there is already a page in ${this.store.location}`);
    this.store.write(SLICE, typeof layout === 'string' ? layout : serializeSlice(layout));
    for (const [id, html] of Object.entries(boxes)) this.writeBox(id, html);
  }

  /** Record a new change. A new change makes the undone steps unreachable, so redo starts over. */
  private log(entry: HistoryEntry) {
    this.store.append(HISTORY, JSON.stringify(entry) + '\n');
    this.store.remove(REDO);
    if (!this.grouping) this.trimHistory();
  }

  /** Keep the newest HISTORY_STEPS steps; older entries go to the archive as label, author and time only. */
  private trimHistory() {
    const lines = this.lines();
    if (lines.length < HISTORY_TRIM) return; // a step is at least one line
    // where each step starts, newest first (a group takes its marker plus the entries before it)
    const starts: number[] = [];
    for (let i = lines.length; i > 0 && starts.length < HISTORY_TRIM; ) {
      const e = JSON.parse(lines[i - 1]) as HistoryEntry;
      i -= e.kind === 'group' ? e.count + 1 : 1;
      starts.push(i);
    }
    if (starts.length < HISTORY_TRIM) return;
    const start = starts[HISTORY_STEPS - 1];
    if (start <= 0) return;
    const old = lines.slice(0, start).map((l) => {
      const { label, author, at, kind } = JSON.parse(l) as HistoryEntry;
      return JSON.stringify({ label, author, at, kind }) + '\n';
    });
    this.store.append(ARCHIVE, old.join(''));
    this.store.write(HISTORY, lines.slice(start).map((l) => l + '\n').join(''));
  }

  types(): Registry {
    // the site's types first: a page's own type of the same name wins
    return { ...(this.site?.types?.() ?? {}), ...loadTypes(this.store) };
  }

  /** Throw if `next` introduces box-type violations that `prev` did not have. */
  private checkTypes(prev: Layout, next: Layout) {
    const errs = newTypeErrors(prev, next, this.types());
    if (errs.length) throw new Error(`refused by box types: ${errs.join('; ')}`);
  }

  /** Template code for new boxes of a type, if the type has one. */
  template(type: string): string | null {
    const t = this.types()[type]?.template;
    return t ? this.store.read(t) : null;
  }

  get scopePath() {
    return this.abs(SCOPE);
  }

  /** The block the AI is limited to and who set it, or null (also when that block no longer exists). */
  scopeInfo(): { id: string; author: string } | null {
    const raw = this.store.read(SCOPE);
    if (raw === null) return null;
    const [id, author = 'user'] = raw.trim().split(/\s+/);
    return id && find(this.load().root, id) ? { id, author } : null;
  }

  scope(): string | null {
    return this.scopeInfo()?.id ?? null;
  }

  /** The .scope file as written, also when its block no longer exists (scopeInfo() then says null). */
  scopeSetting(): { id: string; author: string } | null {
    const [id, author = 'user'] = (this.store.read(SCOPE) ?? '').trim().split(/\s+/);
    return id ? { id, author } : null;
  }

  setScope(id: string | null, author = 'user') {
    if (id === null) this.store.remove(SCOPE);
    else this.store.write(SCOPE, `${id} ${author}\n`);
  }

  /** Save a new layout version; the history entry records what changed, who did it and when. */
  save(layout: Layout, label: string, author: string = 'ai') {
    this.transaction(() => {
      const prev = this.slice();
      const next = serializeSlice(layout);
      if (prev === next) return;
      const before = parseSlice(prev);
      this.checkTypes(before, layout);
      this.checkGuards({ kind: 'layout', prev: before, next: layout });
      this.log({ label, author, at: new Date().toISOString(), slice: prev });
      this.store.write(SLICE, next);
    });
  }

  private lines(): string[] {
    return (this.store.read(HISTORY) ?? '').split('\n').filter(Boolean);
  }

  private entries(): HistoryEntry[] {
    return this.lines().map((l) => JSON.parse(l));
  }

  /** The most recent history entries, newest first (label, author, time). */
  history(limit = 30): { label: string; author?: string; at?: string; kind?: string }[] {
    return this.entries().slice(-limit).reverse().map(({ label, author, at, kind }) => ({ label, author, at, kind }));
  }

  /**
   * The boxes whose code changed since `since` (an ISO time), counted from the last step that replaced the
   * whole page (use layout, use page), under their names now. Kaity's build shows them as being worked on.
   */
  boxesWorkedOn(since: string): Set<string> {
    const run = this.entries().filter((e) => (e.at ?? '') >= since);
    let from = 0;
    run.forEach((e, i) => e.kind === 'group' && /^use (layout|page) /.test(e.label) && (from = i + 1));
    const out = new Set<string>();
    for (const e of run.slice(from)) {
      if (e.kind === 'content') out.add(e.id);
      if (e.kind === 'rename' && out.delete(e.from)) out.add(e.to);
    }
    return out;
  }

  private grouping = false;

  /** The name a block has now, following the renames logged since `since` (an ISO time), by anyone. */
  followRenames(id: string, since: string): string {
    let name = id;
    for (const e of this.entries()) if (e.kind === 'rename' && e.at >= since && e.from === name) name = e.to;
    return name;
  }

  /**
   * Run several changes as one step: if `fn` logs more than one history entry, a group entry is
   * added so that undo reverts them together. If `fn` throws, the changes it made are undone, so a
   * group happens whole or not at all. A group inside a group is part of the outer one.
   */
  group<T>(label: string, author: string, fn: () => T): T {
    if (this.grouping) return fn();
    return this.transaction(() => {
      const before = this.lines().length;
      this.grouping = true;
      let r: T;
      try {
        r = fn();
      } catch (e) {
        const made = this.lines().length - before;
        for (let i = 0; i < made; i++) this.undo();
        if (made) this.store.remove(REDO); // what was rolled back is not something to redo
        throw e;
      } finally {
        this.grouping = false;
      }
      const count = this.lines().length - before;
      if (count > 1) this.log({ kind: 'group', label, author, at: new Date().toISOString(), count });
      return r;
    });
  }

  /**
   * What undo would do, without doing it: the layout it would restore, the box it would change, and
   * whether it changes head.html (which affects the whole page).
   */
  peekUndo(): { label: string; author?: string; layout?: Layout; box?: string; head?: boolean } | null {
    const last = this.lines().pop();
    if (!last) return null;
    const e = JSON.parse(last) as HistoryEntry;
    if (e.kind === 'group') {
      // the layout before the whole group, and the box it changes (if any)
      const inner = this.entries().slice(-1 - e.count, -1);
      const firstLayout = inner.find((x) => 'slice' in x) as { slice: string } | undefined;
      const box = inner.find((x) => x.kind === 'content') as { id: string } | undefined;
      const head = inner.some((x) => x.kind === 'head') || undefined;
      return { label: e.label, author: e.author, layout: firstLayout && parseSlice(firstLayout.slice), box: box?.id, head };
    }
    if (e.kind === 'content') return { label: e.label, author: e.author, box: e.id };
    if (e.kind === 'head') return { label: e.label, author: e.author, head: true };
    return { label: e.label, author: e.author, layout: parseSlice(e.slice), box: e.kind === 'rename' ? e.to : undefined };
  }

  /** Revert the last change (layout or content); returns its label. Redo can bring it back. */
  undo(): string {
    return this.transaction(() => this.undoStep());
  }

  private undoStep(): string {
    const lines = this.lines();
    const last = lines.pop();
    if (!last) throw new Error('nothing to undo');
    const e = JSON.parse(last) as HistoryEntry;
    if (e.kind === 'group') {
      this.store.write(HISTORY, lines.map((l) => l + '\n').join(''));
      for (let i = 0; i < e.count; i++) this.undoStep();
      this.pushRedo({ group: e });
      return e.label;
    }
    if (e.kind === 'content') {
      this.pushRedo({ entry: e, content: this.content(e.id) });
      this.writeBox(e.id, e.prev);
    } else if (e.kind === 'head') {
      this.pushRedo({ entry: e, head: this.store.read(HEAD) });
      this.writeHead(e.prev);
    } else {
      this.pushRedo({ entry: e, slice: this.slice() });
      this.store.write(SLICE, e.slice);
      if (e.kind === 'rename') this.moveBox(e.to, e.from);
    }
    this.store.write(HISTORY, lines.map((l) => l + '\n').join(''));
    return e.label;
  }

  private redoLines(): string[] {
    return (this.store.read(REDO) ?? '').split('\n').filter(Boolean);
  }
  private pushRedo(r: RedoEntry) {
    this.store.append(REDO, JSON.stringify(r) + '\n');
  }

  /** Bring back the last undone change; returns its label. */
  redo(): string {
    return this.transaction(() => this.redoStep());
  }

  private redoStep(): string {
    const lines = this.redoLines();
    const last = lines.pop();
    if (!last) throw new Error('nothing to redo');
    this.store.write(REDO, lines.map((l) => l + '\n').join(''));
    const r = JSON.parse(last) as RedoEntry;
    if ('group' in r) {
      for (let i = 0; i < r.group.count; i++) this.redoStep();
      this.store.append(HISTORY, JSON.stringify(r.group) + '\n');
      return r.group.label;
    }
    const e = r.entry;
    if ('content' in r) this.writeBox((e as { id: string }).id, r.content);
    else if ('head' in r) this.writeHead(r.head);
    else {
      this.store.write(SLICE, r.slice);
      if (e.kind === 'rename') this.moveBox(e.from, e.to);
    }
    // back on the undo stack as it was (not through log(), which would drop the rest of the redo list)
    this.store.append(HISTORY, JSON.stringify(e) + '\n');
    return e.label;
  }

  /** What redo would do, without doing it: the layout it would restore and/or the box it would change. */
  peekRedo(): { label: string; author?: string; layout?: Layout; box?: string; head?: boolean } | null {
    const lines = this.redoLines();
    const last = lines.pop();
    if (!last) return null;
    const top = JSON.parse(last) as RedoEntry;
    // a group redoes the `count` steps below it, top first; its result is the last of them that sets a layout
    const steps = 'group' in top ? lines.slice(-top.group.count).reverse().map((l) => JSON.parse(l) as RedoEntry) : [top];
    const layouts = steps.filter((x): x is Extract<RedoEntry, { slice: string }> => 'slice' in x);
    const box = steps.find((x) => 'content' in x) as { entry: { id: string } } | undefined;
    const rename = steps.find((x) => 'entry' in x && x.entry.kind === 'rename') as { entry: { to: string } } | undefined;
    const label = 'group' in top ? top.group : top.entry;
    return {
      label: label.label,
      author: label.author,
      layout: layouts.length ? parseSlice(layouts[layouts.length - 1].slice) : undefined,
      box: box?.entry.id ?? rename?.entry.to,
      head: steps.some((x) => 'head' in x) || undefined,
    };
  }

  contents(): Contents {
    const legacy = this.store.read(CONTENTS);
    const c: Contents = legacy ? JSON.parse(legacy) : {};
    for (const f of this.store.list(BOXES)) {
      if (!f.endsWith('.html')) continue;
      const id = f.slice(0, -5);
      const html = this.store.read(`${BOXES}/${f}`) ?? '';
      const css = this.store.read(`${BOXES}/${id}.css`);
      c[id] = css !== null ? joinStyle(html, css) : html;
    }
    // a box linked to a shared block shows the block (its own code waits, for when it's unlinked)
    if (this.site?.block) walk(this.load().root, (n) => {
      if (n.type === 'leaf' && n.use) {
        const b = this.site!.block!(n.use);
        if (b !== null) c[n.id] = b;
      }
    });
    return c;
  }

  /** The code of one box (reads only its own files). */
  content(id: string): string | null {
    if (!BOX_ID.test(id)) return null;
    const use = this.site?.block ? this.sharedBlock(id) : null;
    if (use) {
      const b = this.site!.block!(use);
      if (b !== null) return b;
    }
    return this.ownContent(id);
  }

  /** A box's own code, even while it shows a shared block. */
  ownContent(id: string): string | null {
    if (!BOX_ID.test(id)) return null;
    const html = this.store.read(`${BOXES}/${id}.html`);
    if (html !== null) {
      const css = this.store.read(`${BOXES}/${id}.css`);
      return css !== null ? joinStyle(html, css) : html;
    }
    const legacy = this.store.read(CONTENTS);
    const c: Contents = legacy ? JSON.parse(legacy) : {};
    return Object.hasOwn(c, id) ? c[id] : null;
  }

  /** The boxes and overlays that have code (without reading it). */
  boxIds(): string[] {
    const legacy = this.store.read(CONTENTS);
    const ids = new Set(legacy ? Object.keys(JSON.parse(legacy) as Contents) : []);
    for (const f of this.store.list(BOXES)) if (f.endsWith('.html')) ids.add(f.slice(0, -5));
    return [...ids];
  }

  /** A box's content and style, separately (for editing them apart). */
  parts(id: string): { html: string; css: string } | null {
    const code = this.content(id);
    return code === null ? null : splitStyle(code);
  }

  /** Write a box as content (.html) + style (.css); <style> blocks in the code go to the .css file. */
  private writeBox(id: string, code: string | null) {
    if (!BOX_ID.test(id)) throw new Error(`bad box id "${id}"`);
    const file = `${BOXES}/${id}.html`;
    const cssFile = `${BOXES}/${id}.css`;
    if (code === null) {
      this.store.remove(file);
      this.store.remove(cssFile);
    } else {
      const { html, css } = splitStyle(code);
      this.store.write(file, html + '\n');
      if (css) this.store.write(cssFile, css + '\n');
      else this.store.remove(cssFile);
    }
    // a boxes/ file replaces any legacy contents.json entry for the same id
    const legacy = this.store.read(CONTENTS);
    if (legacy) {
      const c = JSON.parse(legacy) as Contents;
      if (id in c) {
        delete c[id];
        this.store.write(CONTENTS, JSON.stringify(c, null, 2) + '\n');
      }
    }
  }

  /** Move a box's code from one name to another (no history entry; used by rename/undo). */
  private moveBox(from: string, to: string) {
    const html = this.content(from);
    if (html === null) return;
    this.writeBox(to, html);
    this.writeBox(from, null);
  }

  /**
   * Rename a node/overlay: the tree, every reference to it and its code file change in one logged,
   * undoable step, so nothing is left pointing at the old name.
   */
  rename(id: string, newName: string, author: string = 'ai'): Layout {
    return this.transaction(() => this.renameNow(id, newName, author));
  }

  private renameNow(id: string, newName: string, author: string): Layout {
    const prev = this.slice();
    const before = parseSlice(prev);
    const next = M.rename(before, id, newName);
    this.checkTypes(before, next);
    this.checkGuards({ kind: 'layout', prev: before, next });
    const sc = this.scopeInfo();
    if (sc?.id === id) this.setScope(newName, sc.author); // the scope follows its block
    this.log({ kind: 'rename', label: `rename ${id} ${newName}`, author, at: new Date().toISOString(), slice: prev, from: id, to: newName });
    this.store.write(SLICE, serializeSlice(next));
    this.moveBox(id, newName);
    return next;
  }

  /** Set (or with null remove) the code of a box. Logged and undoable like layout moves. */
  setContent(id: string, html: string | null, author: string = 'ai') {
    this.transaction(() => this.setContentNow(id, html, author));
  }

  private setContentNow(id: string, html: string | null, author: string) {
    if (!BOX_ID.test(id)) throw new Error(`bad box id "${id}"`);
    const layout = this.load();
    const node = find(layout.root, id)?.node;
    const t = node?.type === 'leaf' ? node.boxType : undefined;
    if (t && html !== null) {
      const def = this.types()[t];
      const errs = def ? contentErrors(html, t, def) : [];
      if (errs.length) throw new Error(`refused by box type: ${errs.join('; ')}`);
    }
    // a box that shows a shared block changes the block, on every page (the site keeps its undo);
    // emptying it only empties the box's own code
    const use = node?.type === 'leaf' ? node.use : undefined;
    if (use && html !== null && this.site?.setBlock && this.site.block?.(use) != null) {
      if (this.site.block(use) === html) return;
      this.checkGuards({ kind: 'content', id, layout });
      this.site.setBlock(use, html, author);
      return;
    }
    const prev = this.ownContent(id);
    if (prev === html) return;
    this.checkGuards({ kind: 'content', id, layout });
    this.log({ kind: 'content', label: `set_content ${id}${html === null ? ' (removed)' : ` (${html.length} chars)`}`, author, at: new Date().toISOString(), id, prev });
    this.writeBox(id, html);
  }

  /** Page-level <head> additions (head.html), e.g. fonts and section styles from an import. */
  head(): string {
    return this.store.read(HEAD) ?? '';
  }

  private writeHead(html: string | null) {
    if (html === null) this.store.remove(HEAD);
    else this.store.write(HEAD, html);
  }

  /** Replace head.html (page-wide theme, fonts, styles, scripts). Logged and undoable; null removes it. */
  setHead(html: string | null, author: string = 'user', label?: string) {
    this.transaction(() => this.setHeadNow(html, author, label));
  }

  private setHeadNow(html: string | null, author: string, label?: string) {
    const prev = this.store.read(HEAD);
    const next = html === null || html.trim() === '' ? null : html.endsWith('\n') ? html : html + '\n';
    if (prev === next) return;
    this.checkGuards({ kind: 'head' });
    this.log({ kind: 'head', label: label ?? (next === null ? 'page head removed' : 'edit page head'), author, at: new Date().toISOString(), prev });
    this.writeHead(next);
  }

  /** The files in assets/ (images and other files the boxes use). */
  assets(): string[] {
    return this.store.list(ASSETS);
  }

  /** The full page: layout + box code + the site's shared head + head.html. Every renderer (CLI, editor, MCP) goes through this. */
  page(opts: { title?: string; head?: string; bodyEnd?: string } = {}): string {
    // the site's icon first: a page that has its own (an imported copy) declares it later, and that one wins
    const l = this.load();
    const c = this.contents();
    // a site menu in a shared block shows which page this is
    if (this.site?.page) walk(l.root, (n) => {
      if (n.type === 'leaf' && n.use && c[n.id] !== undefined) c[n.id] = markCurrentPage(c[n.id], this.site!.page);
    });
    return toHTML(l, c, { ...opts, head: (this.site?.icon?.() ?? '') + this.siteHead() + this.kitHead() + this.head() + (opts.head ?? '') });
  }

  /** Write the rendered page to out/index.html; returns where it went (a file path for folders). */
  render(title?: string): string {
    this.store.write(OUT, this.page({ title }));
    // boxes refer to assets/<file>; the rendered page sits in out/, so its assets go next to it
    for (const f of this.assets()) this.store.write(`out/${ASSETS}/${f}`, this.store.readBytes(`${ASSETS}/${f}`)!);
    return this.store instanceof FolderStore ? this.htmlPath : `${this.store.location}/${OUT}`;
  }
}
