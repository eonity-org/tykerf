// One page in the editor: its workspace, its AI conversations, its open browser tabs and the API
// the panel uses (/_tykerf/... and the page's assets/), at a path relative to where the page is
// served. Each page of the site gets one of these, at "/<page>/".
// See server.ts for the server around it (addresses, security checks, the editor's own files).

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ASSET_TYPES, fetchImage, imageOrigin, pageImages, recordEdit, saveImage, trashUnusedAssets, unusedAssets } from '../assets.js';
import { KIND_WORD, type Layout, type Node, find, freshId, isOp } from '../model.js';
import * as M from '../moves.js';
import { serializeSlice } from '../notation.js';
import { leftovers } from '../check.js';
import { handbookMarkdown, handbookPage } from '../handbook.js';
import { kitList, kitTags } from '../kit.js';
import { blockUsers, linkBlock, shareBlock, unlinkBlock } from '../site.js';
import { addTask, clearDone, closeTask, removeTask, reopenTask, sayTask, tasks } from '../tasks.js';
import { pathOf } from '../refs.js';
import { renderParts } from '../render.js';
import { checkPath } from '../store.js';
import { components, hasTheme, pageLayouts, readOverrides, themeVariables, useComponent, withFonts, withOverrides } from '../library.js';
import { NO_SITE_HEAD, type Workspace, joinStyle, splitStyle } from '../workspace.js';
import { AI, type Runner } from './ai.js';

export const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const MAX_BODY = 25 * 1024 * 1024; // an image upload (15 MB) as base64, with room to spare

export async function body(req: IncomingMessage): Promise<any> {
  let s = '';
  for await (const c of req) {
    s += c;
    if (s.length > MAX_BODY) throw new Error('the request is too large');
  }
  return s ? JSON.parse(s) : {};
}


/** The pages of the site this page is in, for the panel's page switcher. */
export interface SiteInfo {
  pages: string[];
  current: string;
  /** Every page of the site uses the site's shared theme (site.ts). */
  sharedTheme: boolean;
}

/** One step of a background job, as an English sentence (the key the editor translates) and its values. */
export interface JobStep {
  text: string;
  vars?: Record<string, string | number>;
  refused?: boolean; // a step the AI tried and TYKERF refused
}

/**
 * Work that makes a new page and takes a while (the AI building it, a copy of a website). The page
 * opens at once and shows the job in a modal; the job lives here, so a reload shows it again.
 */
export interface Job {
  kind: 'ai' | 'copy';
  state: 'running' | 'done' | 'stopped' | 'failed';
  steps: JobStep[];
  select: string | null; // the block the editor opens on afterwards
  answer?: string; // the AI's last words
  error?: string;
  site?: string; // the site being copied
  since?: string; // when it started (ISO), for the boxes Kaity worked on since
}

export interface PageHost {
  ai: AI;
  /** The page's background job, if it has one (until the person has seen how it ended). */
  job: {
    start(kind: Job['kind'], opts: { select?: string | null; site?: string; stop?: () => void }): void;
    step(text: string, vars?: JobStep['vars']): void;
    end(state: Exclude<Job['state'], 'running'>, extra?: { error?: string }): void;
  };
  /** The page changed on disk through another Workspace (a rename elsewhere rewrote its links): refresh open tabs. */
  refresh(): void;
  /** The page is going away (renamed or removed): stop watching it and send open tabs to `movedTo` (or the site). */
  close(movedTo?: string): void;
  /** Answer a request for this page; `p` is the path relative to the page (always starting with "/"). */
  handle(req: IncomingMessage, res: ServerResponse, p: string, url: URL): Promise<unknown>;
}

export function createPageHost(ws: Workspace, opts: { name: string; site?: () => SiteInfo; runner?: Runner; title?: () => string; admin?: (req: IncomingMessage) => boolean; visitorEnd?: string }): PageHost {
  const store = ws.store;

  /**
   * While Kaity builds the page: the boxes still holding sample content, apart in two. `soft`: she has
   * changed them since the page's layout was placed (she is on them); `strong`: not yet. A finished box is
   * in neither, so it shows clearly (tykerf.js blurs the others).
   */
  function buildFocus(): { strong: string[]; soft: string[] } | null {
    if (job?.kind !== 'ai' || job.state !== 'running' || !job.since) return null;
    const unfinished = [...new Set(leftovers(ws).map((l) => l.box))];
    const worked = ws.boxesWorkedOn(job.since);
    return { strong: unfinished.filter((b) => !worked.has(b)), soft: unfinished.filter((b) => worked.has(b)) };
  }

  // ---------- the tree as the panel sees it: containers and boxes ----------

  interface PanelNode {
    id: string;
    kind: 'box' | 'container';
    arrangement?: string; // row | column | periphery | wheel
    boxType?: string;
    hasCode?: boolean;
    minH?: number; // min height in px (absent = as tall as its content)
    maxW?: number; // max width in px, centred (absent = the full width it gets)
    ratios?: number[]; // relative sizes of the children (rows/columns); absent = equal
    tags?: string[]; // its tags: band tones (tone-alt, tone-soft, tone-dark), dense, reverse…
    shared?: string; // a box that shows one of the site's shared blocks (kit/blocks/<shared>.html)
    children?: PanelNode[];
  }

  function panelTree(n: Node, codes: Set<string>): PanelNode | null {
    if (n.type === 'empty') return null;
    if (!isOp(n)) return { id: n.id, kind: 'box', boxType: n.boxType, minH: n.minH, maxW: n.maxW, hasCode: codes.has(n.id) || !!n.use, tags: n.tags, ...(n.use ? { shared: n.use } : {}) };
    return {
      id: n.id, kind: 'container', arrangement: KIND_WORD[n.kind], boxType: n.boxType, minH: n.minH, maxW: n.maxW, ratios: n.ratios, tags: n.tags,
      children: n.children.map((c) => panelTree(c, codes)).filter((c): c is PanelNode => c !== null),
    };
  }

  /** Changes when head.html changes, so open pages know to reload (the head can't be swapped in place). */
  const headVersion = () => {
    let h = 0;
    for (const c of ws.siteHead() + ws.kitHead() + ws.head()) h = (h * 31 + c.charCodeAt(0)) | 0;
    return h;
  };

  function state() {
    const layout = ws.load();
    const codes = new Set(ws.boxIds());
    const undo = ws.peekUndo();
    return { name: opts.name, site: opts.site?.() ?? null, tree: panelTree(layout.root, codes), slice: serializeSlice(layout), ai: ai.running(), aiRunner: ai.runnerInfo(), buffer: bufferSummary(), canUndo: !!undo, lastChange: undo?.label ?? null, nextRedo: ws.peekRedo()?.label ?? null, head: headVersion(), build: buildFocus() };
  }

  // ---------- operations the panel may ask for ----------

  const isLeaf = (l: Layout, id: string) => find(l.root, id)?.node.type === 'leaf';

  /** All boxes in reading order (tree order). */
  function boxesIn(n: Node): string[] {
    if (n.type === 'leaf') return [n.id];
    return isOp(n) ? n.children.flatMap(boxesIn) : [];
  }

  /** The box that takes a deleted block's code: the box just before it in reading order (else just after). */
  function previousBox(l: Layout, id: string): string | null {
    const all = boxesIn(l.root);
    const own = new Set(boxesIn(find(l.root, id)!.node));
    const first = all.findIndex((b) => own.has(b));
    const before = all.slice(0, Math.max(first, 0)).filter((b) => !own.has(b));
    if (before.length) return before.at(-1)!;
    return all.slice(first).find((b) => !own.has(b)) ?? null;
  }

  /** The code of a block: the content and style of every box inside it, in reading order. */
  function codeOf(l: Layout, id: string): { boxes: string[]; html: string; css: string } {
    const boxes = boxesIn(find(l.root, id)!.node).filter((b) => ws.parts(b));
    const parts = boxes.map((b) => ws.parts(b)!);
    return { boxes, html: parts.map((p) => p.html).filter(Boolean).join('\n'), css: parts.map((p) => p.css).filter(Boolean).join('\n') };
  }

  const append = (to: string, code: { html: string; css: string }) => {
    const cur = ws.parts(to) ?? { html: '', css: '' };
    ws.setContent(to, joinStyle([cur.html, code.html].filter(Boolean).join('\n'), [cur.css, code.css].filter(Boolean).join('\n')), 'user');
  };

  // The buffer: code of removed blocks, newest first, ready to paste somewhere else.
  interface BufferItem { from: string; boxes: string[]; html: string; css: string; at: string }
  const BUFFER = '.tykerf/buffer.json';
  const readBuffer = (): BufferItem[] => JSON.parse(store.read(BUFFER) ?? '[]');
  const writeBuffer = (b: BufferItem[]) => {
    store.write(BUFFER, JSON.stringify(b.slice(0, 20), null, 1));
  };
  const textOf = (html: string) => html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const bufferSummary = () => readBuffer().map((b, i) => ({ i, from: b.from, boxes: b.boxes.length, preview: textOf(b.html).slice(0, 90), at: b.at }));

  /** A name for a new box that is not in the tree and has no leftover code file. */
  function newBoxName(l: Layout, wanted?: string): string {
    const taken = new Set(ws.boxIds());
    if (wanted && !find(l.root, wanted) && !taken.has(wanted) && /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(wanted)) return wanted;
    return freshId(l.root, `${wanted ?? 'box'}-`, taken);
  }

  const LETTER = { row: 'V', column: 'H' } as const;

  type Handler = (a: any) => string | null; // applies the change, returns a label for the reply
  const OPS: Record<string, Handler> = {
    /** Fill a box with a ready-made component (its code, images and, if needed, the theme variables). */
    component: (a: { id: string; name: string }) => {
      useComponent(ws, a.id, a.name, 'user');
      return a.id;
    },
    /** A new empty box beside (row) or below (column) a block; `before` puts it left/above. */
    insert: (a: { id: string; as: 'row' | 'column'; before?: boolean }) => {
      const l = ws.load();
      const name = newBoxName(l);
      ws.save(M.insertNext(l, a.id, LETTER[a.as], name, !!a.before), `add ${name} ${a.as === 'row' ? 'beside' : 'below'} ${a.id}`, 'user');
      return name;
    },
    /** A new empty box inside a container (at the end, or at `index`) or next to a box. */
    add: (a: { id: string; where?: 'inside' | 'before' | 'after' }) => {
      const l = ws.load();
      const f = find(l.root, a.id);
      if (!f) throw new Error(`no block "${a.id}"`);
      let parent: string, index: number;
      if ((a.where ?? 'inside') === 'inside' && isOp(f.node)) {
        if (f.node.kind !== 'H' && f.node.kind !== 'V') throw new Error('boxes can only be added to rows and columns');
        parent = f.node.id;
        index = f.node.children.length;
      } else {
        if (!f.parent) throw new Error('the page itself has no siblings');
        parent = f.parent.id;
        index = f.index + (a.where === 'before' ? 0 : 1);
      }
      const name = newBoxName(l);
      ws.save(M.addLeaf(l, parent, index, name), `add ${name} in ${parent}`, 'user');
      return name;
    },
    flip: (a: { id: string }) => {
      ws.save(M.flip(ws.load(), a.id), `flip ${a.id}`, 'user');
      return a.id;
    },
    /** A block's look: its band tone (one of the theme's, or none) and whether it is packed tighter. One step. */
    look: (a: { id: string; tone?: 'alt' | 'soft' | 'dark' | null; dense?: boolean }) => {
      let l = ws.load();
      const parts: string[] = [];
      if (a.tone !== undefined) {
        if (a.tone !== null && !['alt', 'soft', 'dark'].includes(a.tone)) throw new Error(`unknown band "${a.tone}"`);
        for (const t of ['tone-alt', 'tone-soft', 'tone-dark']) l = M.untag(l, a.id, t);
        if (a.tone) l = M.tag(l, a.id, `tone-${a.tone}`);
        parts.push(a.tone ? `band ${a.tone}` : 'no band');
      }
      if (a.dense !== undefined) {
        l = a.dense ? M.tag(l, a.id, 'dense') : M.untag(l, a.id, 'dense');
        parts.push(a.dense ? 'dense' : 'normal density');
      }
      ws.save(l, `${a.id}: ${parts.join(', ')}`, 'user');
      return a.id;
    },
    /** The site's own tags (kit/tags.json) on a block: on or off. One step. */
    tag: (a: { id: string; tag: string; on: boolean }) => {
      const dir = ws.site?.dir;
      if (!dir || !(a.tag in kitTags(dir))) throw new Error(`"${a.tag}" is not one of the site's tags`);
      ws.save(a.on ? M.tag(ws.load(), a.id, a.tag) : M.untag(ws.load(), a.id, a.tag), `${a.id}: ${a.on ? '' : 'no '}#${a.tag}`, 'user');
      return a.id;
    },
    /** Share a box with every page of the site: its code becomes a shared block, which this box shows. */
    share: (a: { id: string; name?: string }) => {
      if (!ws.site?.dir) throw new Error('only a page of a site can share a block');
      return shareBlock(ws.site.dir, ws, a.id, a.name || a.id);
    },
    /** Make a box show one of the site's shared blocks. */
    link: (a: { id: string; name: string }) => {
      if (!ws.site?.dir) throw new Error('only a page of a site has shared blocks');
      linkBlock(ws.site.dir, ws, a.id, String(a.name));
      return a.id;
    },
    /** Make a box that shows a shared block this page's own copy. */
    unlink: (a: { id: string }) => {
      unlinkBlock(ws, a.id);
      return a.id;
    },
    /** Dissolve a container: its children take its place in the parent. */
    ungroup: (a: { id: string }) => {
      ws.save(M.unwrap(ws.load(), a.id), `ungroup ${a.id}`, 'user');
      return a.id;
    },
    /** Move a block one place earlier (-1) or later (+1) among its siblings. */
    reorder: (a: { id: string; by: -1 | 1 }) => {
      const l = ws.load();
      const f = find(l.root, a.id);
      if (!f?.parent) throw new Error('nothing to reorder');
      const to = f.index + a.by;
      const other = f.parent.children[to];
      if (!other) throw new Error('already at the edge');
      ws.save(M.swap(l, a.id, other.id), `move ${a.id} ${a.by < 0 ? 'earlier' : 'later'}`, 'user');
      return a.id;
    },
    rename: (a: { id: string; name: string }) => {
      ws.rename(a.id, a.name.trim(), 'user');
      ai.rename(a.id, a.name.trim());
      return a.name.trim();
    },
    /** Relative sizes of a row's/column's children; null = equal. */
    ratios: (a: { id: string; ratios: number[] | null }) => {
      const r = a.ratios?.map((x) => Math.round(x * 1000) / 1000) ?? null;
      ws.save(M.setRatios(ws.load(), a.id, r), `sizes of ${a.id} ${r ? r.join(':') : 'equal'}`, 'user');
      return a.id;
    },
    /** Min height of a block in px (null = as tall as its content). */
    height: (a: { id: string; px: number | null }) => {
      const l = ws.load();
      const n = find(l.root, a.id)?.node;
      if (!n || n.type === 'empty') throw new Error(`no block "${a.id}"`);
      const px = a.px === null ? null : Math.round(a.px);
      ws.save(isOp(n) ? M.setOp(l, a.id, { minH: px }) : M.setLeaf(l, a.id, { minH: px }), `height of ${a.id} ${px === null ? 'auto' : `${px}px`}`, 'user');
      return a.id;
    },
    /** Max width of a block in px, centred in the space it has (null = full width). */
    width: (a: { id: string; px: number | null }) => {
      const l = ws.load();
      const n = find(l.root, a.id)?.node;
      if (!n || n.type === 'empty') throw new Error(`no block "${a.id}"`);
      const px = a.px === null ? null : Math.max(40, Math.round(a.px));
      ws.save(isOp(n) ? M.setOp(l, a.id, { maxW: px }) : M.setLeaf(l, a.id, { maxW: px }), `width of ${a.id} ${px === null ? 'full' : `${px}px`}`, 'user');
      return a.id;
    },
    /** Delete a block: its code jumps into the previous box (one undo step). */
    delete: (a: { id: string }) => {
      const l = ws.load();
      const next = M.remove(l, a.id); // validates before anything changes
      const code = codeOf(l, a.id);
      const to = previousBox(l, a.id);
      if (!code.boxes.length || !to) {
        ws.save(next, `delete ${a.id}`, 'user');
        return null;
      }
      const label = `delete ${a.id} (code moved into ${to})`;
      ws.group(label, 'user', () => {
        append(to, code);
        ws.save(next, label, 'user');
      });
      return to;
    },
    /** Remove a block: its code goes to the buffer and disappears from the page (undo brings it back). */
    remove: (a: { id: string }) => {
      const l = ws.load();
      const next = M.remove(l, a.id);
      const code = codeOf(l, a.id);
      if (code.boxes.length) writeBuffer([{ from: a.id, ...code, at: new Date().toISOString() }, ...readBuffer()]);
      ws.save(next, `remove ${a.id} (code to the buffer)`, 'user');
      return a.id;
    },
    /** Paste a buffer item: into a box, as a new box beside/below a block, or inside a container. */
    paste: (a: { i: number; id: string; how: 'into' | 'beside' | 'below' | 'inside' }) => {
      const item = readBuffer()[a.i];
      if (!item) throw new Error('nothing in the buffer at that place');
      const l = ws.load();
      if (a.how === 'into') {
        if (!isLeaf(l, a.id)) throw new Error('paste into works on a box; choose a new box instead');
        append(a.id, item);
        return a.id;
      }
      const name = newBoxName(l, item.boxes.length === 1 ? item.boxes[0] : item.from);
      const label = `paste ${item.from} as ${name}`;
      ws.group(label, 'user', () => {
        if (a.how === 'inside') {
          const n = find(l.root, a.id)?.node;
          if (!n || !isOp(n) || (n.kind !== 'H' && n.kind !== 'V')) throw new Error('paste inside works on rows and columns');
          ws.save(M.addLeaf(l, a.id, n.children.length, name), label, 'user');
        } else ws.save(M.insertNext(l, a.id, a.how === 'beside' ? 'V' : 'H', name), label, 'user');
        ws.setContent(name, joinStyle(item.html, item.css), 'user');
      });
      return name;
    },
    /** Put a section of the last copied page in place of a box (see /_tykerf/import). */
    section: (a: { id: string; token: string; section: string }) => {
      if (!copied || copied.token !== a.token) throw new Error('that copy is no longer here; copy the page again');
      return copied.place(a.section, a.id);
    },
    /** Forget a buffer item. */
    drop: (a: { i: number }) => {
      const b = readBuffer();
      b.splice(a.i, 1);
      writeBuffer(b);
      broadcast('changed', {});
      return null;
    },
  };

  // The last page copied for "Import a section": kept until the next copy, so the user can pick from it.
  let copied: { token: string; place: (section: string, box: string) => string } | null = null;

  const clients = new Set<ServerResponse>();
  const broadcast = (event: string, data: unknown) => {
    for (const c of clients) c.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  // ---------- the background job (a copy, or the AI building the page) ----------
  let job: (Job & { stop?: () => void }) | null = null;
  const publicJob = () => (job ? { kind: job.kind, state: job.state, steps: job.steps, select: job.select, answer: job.answer, error: job.error, site: job.site } : null);
  const jobs: PageHost['job'] = {
    start(kind, o) {
      job = { kind, state: 'running', steps: [], select: o.select ?? null, site: o.site, stop: o.stop, since: new Date().toISOString() };
      broadcast('job', publicJob());
    },
    step(text, vars) {
      if (!job || job.state !== 'running') return;
      job.steps.push({ text, ...(vars ? { vars } : {}) });
      broadcast('job', publicJob());
    },
    end(state, extra = {}) {
      if (!job || job.state !== 'running') return;
      Object.assign(job, { state, ...extra });
      broadcast('job', publicJob());
    },
  };
  // the AI building a new page reports to the job: its steps, its answer, how it ended
  const aiEvents = (event: string, data: unknown) => {
    const m = data as { role?: string; text?: string; state?: string };
    if (event === 'ai' && job?.kind === 'ai' && job.state === 'running') {
      if (m.role === 'check' && m.state === 'auto' && m.text) job.steps.push({ text: m.text });
      if (m.role === 'step' && m.text) {
        const refused = m.text.startsWith('refused: ');
        job.steps.push({ text: refused ? m.text.slice('refused: '.length) : m.text, ...(refused ? { refused } : {}) });
      }
      if (m.role === 'ai') job.answer = m.text;
      if (m.role === 'error') job.error = m.text;
      if (m.role === 'end') job.state = job.error === 'stopped' ? 'stopped' : job.error ? 'failed' : 'done';
      broadcast('job', publicJob());
    }
    broadcast(event, data);
  };
  const ai = new AI(ws, aiEvents, opts.runner);

  // Every change to the page refreshes open pages: this editor's own changes (after each change
  // request) and changes from outside (the AI's MCP server, another editor, a text editor), seen
  // through the store's watcher when it has one.
  let debounce: NodeJS.Timeout | undefined;
  const changed = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => broadcast('changed', {}), 80);
  };
  // tasks change on their own (the page doesn't): open editors redraw their tabs
  const tasksChanged = () => broadcast('tasks', {});
  const unwatch = store.watch?.((f) => {
    if (['layout.slice', 'contents.json', 'head.html'].includes(f) || f.startsWith('boxes/') || f.startsWith('assets/')) changed();
    if (f === '.tykerf/tasks.json') tasksChanged();
  });

  async function handle(req: IncomingMessage, res: ServerResponse, p: string, url: URL) {
    if (req.method === 'GET' && p === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      // a visitor (TYKERF serving the site, auth.ts) gets the page as it is, and the way to sign in when their
      // browser signed in here before (visitorEnd); the admin gets the editor
      const admin = opts.admin?.(req) ?? true;
      return res.end(ws.page({ title: opts.title?.() ?? opts.name, bodyEnd: admin ? '<script type="module" src="_tykerf/tykerf.js"></script>' : (opts.visitorEnd ?? '') }));
    }
    // the page's own files: images and other files the boxes refer to as assets/<file>
    if (req.method === 'GET' && p.startsWith('/assets/')) {
      let path: string;
      try {
        path = checkPath(decodeURIComponent(p.slice(1)));
      } catch {
        return res.writeHead(404).end('not found');
      }
      const bytes = store.readBytes(path);
      if (!bytes) return res.writeHead(404).end('not found');
      const ext = path.split('.').pop()!.toLowerCase();
      // sandbox: a page file opened on its own (an SVG, say) can't run script on the editor's origin
      res.writeHead(200, { 'content-type': ASSET_TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox' });
      return res.end(bytes);
    }
    // files in assets/ that nothing uses any more, not even undo (the Page tab offers to clean them up)
    if (req.method === 'GET' && p === '/_tykerf/assets/unused') {
      const files = unusedAssets(ws);
      return json(res, 200, { files: files.map((f) => f.file), bytes: files.reduce((n, f) => n + f.bytes, 0) });
    }
    if (req.method === 'GET' && p === '/_tykerf/components') return json(res, 200, { components: components(), layouts: pageLayouts().map(({ name, label, description }) => ({ name, label, description })) });
    // the page's head, and whether its theme is the site's shared one (then the Page tab edits the site's head)
    if (req.method === 'GET' && p === '/_tykerf/head') return json(res, 200, { html: ws.head(), themeVariables: themeVariables(), siteHead: ws.site ? ws.siteHead() : null, sharedTheme: !hasTheme(ws.head()) && hasTheme(ws.siteHead()), ownLook: ws.head().includes(NO_SITE_HEAD), overrides: readOverrides(ws.head()) });
    if (req.method === 'GET' && p === '/_tykerf/state') return json(res, 200, state());
    if (req.method === 'GET' && p === '/_tykerf/job') return json(res, 200, { job: publicJob() });
    if (req.method === 'GET' && p === '/_tykerf/assets') return json(res, 200, { images: pageImages(ws) });
    if (req.method === 'GET' && p === '/_tykerf/asset/origin') return json(res, 200, { origin: imageOrigin(ws, url.searchParams.get('src') ?? '') });
    if (req.method === 'GET' && p === '/_tykerf/page') return json(res, 200, renderParts(ws.load(), ws.contents()));
    if (req.method === 'GET' && p === '/_tykerf/box') {
      const id = url.searchParams.get('id') ?? '';
      const l = ws.load();
      const parts = ws.parts(id) ?? { html: '', css: '' };
      const inside = find(l.root, id) ? codeOf(l, id).boxes.length : 0;
      const use = ws.sharedBlock(id, l);
      const shared = use && ws.site?.dir ? { name: use, pages: Object.keys(blockUsers(ws.site.dir, use)) } : null;
      return json(res, 200, { id, ...parts, path: pathOf(l, id), previous: find(l.root, id) ? previousBox(l, id) : null, boxesWithCode: inside, shared });
    }
    if (req.method === 'GET' && p.startsWith('/_tykerf/image/')) {
      const name = p.slice('/_tykerf/image/'.length);
      const img = ai.image(name);
      if (!img) return res.writeHead(404).end('not found');
      const ext = name.split('.').pop()!;
      res.writeHead(200, { 'content-type': `image/${ext === 'jpg' ? 'jpeg' : ext}`, 'cache-control': 'max-age=31536000, immutable' });
      return res.end(img);
    }
    if (req.method === 'GET' && p === '/_tykerf/chat') return json(res, 200, ai.chat(url.searchParams.get('id') ?? ''));
    // the handbook: the page's theme and blocks with their tasks, for people (HTML) and agents (Markdown)
    if (req.method === 'GET' && (p === '/_tykerf/handbook' || p === '/_tykerf/handbook.md')) {
      const name = opts.title?.() || opts.name || 'page';
      const md = p.endsWith('.md');
      res.writeHead(200, { 'content-type': md ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(md ? handbookMarkdown(ws, name) : handbookPage(ws, name));
    }
    if (req.method === 'GET' && p === '/_tykerf/kit') {
      const dir = ws.site?.dir;
      const blocks = dir ? kitList(dir).blocks : [];
      return json(res, 200, dir ? { site: true, blocks, tags: kitTags(dir), users: Object.fromEntries(blocks.map((b) => [b, Object.keys(blockUsers(dir, b))])) } : { site: false, blocks: [], tags: {}, users: {} });
    }
    if (req.method === 'GET' && p === '/_tykerf/tasks') return json(res, 200, { tasks: tasks(ws), text: tasks(ws, { open: true }).map(sayTask).join('\n') });
    if (req.method === 'GET' && p === '/_tykerf/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.method !== 'POST') return res.writeHead(404).end('not found');
    const a = await body(req);
    if (p === '/_tykerf/op') {
      const op = OPS[a.op];
      if (!op) return json(res, 400, { ok: false, error: `unknown operation "${a.op}"` });
      const result = ws.transaction(() => op(a));
      changed();
      return json(res, 200, { ok: true, result });
    }
    if (p === '/_tykerf/box') {
      const err = ws.transaction(() => {
        const l = ws.load();
        if (!isLeaf(l, a.id) && !l.overlays.some((o) => o.id === a.id)) return `"${a.id}" is not a box`;
        // Content-only saves keep the style as it is, and vice versa.
        const cur = ws.parts(a.id) ?? { html: '', css: '' };
        const parts = typeof a.full === 'string' ? splitStyle(a.full) : { html: a.html ?? cur.html, css: a.css ?? cur.css };
        ws.setContent(a.id, joinStyle(parts.html, parts.css), 'user');
        return null;
      });
      if (err) return json(res, 422, { ok: false, error: err });
      changed();
      return json(res, 200, { ok: true });
    }
    // an image for the page (the image tool): checked, named by its content, saved in assets/
    // (with `from`: it was cropped, turned or scaled from another image of the page, remembered so it can be undone)
    if (p === '/_tykerf/asset') {
      const path = saveImage(ws, new Uint8Array(Buffer.from(String(a.data ?? ''), 'base64')));
      if (a.from) recordEdit(ws, path, a.from);
      return json(res, 200, { ok: true, path });
    }
    // unused files go to .trash/ (nothing is deleted)
    if (p === '/_tykerf/assets/clean') {
      const r = trashUnusedAssets(ws);
      if (r.files) changed();
      return json(res, 200, { ok: true, result: r });
    }
    if (p === '/_tykerf/asset/fetch') return json(res, 200, { ok: true, path: saveImage(ws, await fetchImage(String(a.url ?? ''))) });
    // this page's own values over the site's theme (only those that differ; {} goes back to the site theme)
    if (p === '/_tykerf/head/override') {
      const values = Object.fromEntries(Object.entries((a.values ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
      const n = Object.keys(values).length;
      ws.transaction(() => ws.setHead(withFonts(ws, withOverrides(ws.head(), values)), 'user', n ? `this page's own theme values: ${Object.keys(values).join(', ')}` : 'this page follows the site theme again'));
      changed();
      return json(res, 200, { ok: true });
    }
    if (p === '/_tykerf/head') {
      // fonts the theme names come along (their files in assets/, @font-face in the head)
      ws.transaction(() => ws.setHead(typeof a.html === 'string' ? withFonts(ws, a.html) : null, 'user'));
      changed();
      return json(res, 200, { ok: true });
    }
    if (p === '/_tykerf/redo' || p === '/_tykerf/undo') {
      // undo and redo take the newest step, which could be the AI's own while it is still working on it
      const run = ai.running();
      if (run) return json(res, 409, { ok: false, error: `Kaity is working on "${run.id}"; undo and redo wait until it is done` });
      const redo = p === '/_tykerf/redo';
      const { box, label } = ws.transaction(() => {
        const box = (redo ? ws.peekRedo() : ws.peekUndo())?.box;
        return { box, label: redo ? ws.redo() : ws.undo() };
      });
      changed();
      return json(res, 200, { ok: true, [redo ? 'redone' : 'undone']: label, focus: box && find(ws.load().root, box) ? box : null });
    }
    // "Import a section": copy a page (slow: a browser opens it) and list its sections with a picture of each
    if (p === '/_tykerf/import') {
      const { importPage, importURL, namesIn, placeSection } = await import('../importer.js');
      const from = importURL(String(a.url ?? ''));
      const r = await importPage(from, { sections: true, taken: namesIn(ws) });
      const token = randomUUID();
      copied = { token, place: (section, box) => placeSection(ws, r, section, box, 'user') };
      return json(res, 200, { ok: true, token, url: from, sections: r.sections ?? [] });
    }
    if (p === '/_tykerf/ask') {
      ai.ask(a.id, String(a.prompt ?? ''), a.size, Array.isArray(a.images) ? a.images : []);
      return json(res, 200, { ok: true });
    }
    if (p === '/_tykerf/ask/cancel') return json(res, 200, { ok: ai.cancel() });
    // stop the page's job (the AI stops; a copy is dropped), or forget it once the person has seen how it ended
    if (p === '/_tykerf/job/stop') return json(res, 200, { ok: !!job?.stop && job.state === 'running' && (job.stop(), true) });
    if (p === '/_tykerf/job/seen') {
      if (job && job.state !== 'running') job = null;
      return json(res, 200, { ok: true });
    }
    if (p === '/_tykerf/chat/reset') return json(res, 200, { ok: ai.reset(a.id) });
    // tasks left on the page: what to change, ask or check (src/tasks.ts); not part of the page's history
    if (p.startsWith('/_tykerf/tasks/')) {
      const n = Number(a.n);
      const r = ({
        add: () => addTask(ws, { block: String(a.block ?? ''), text: String(a.text ?? ''), path: a.path ?? null, label: a.label, width: a.width ?? null, by: 'user' }),
        close: () => closeTask(ws, n, 'user', typeof a.reply === 'string' ? a.reply : undefined),
        reopen: () => reopenTask(ws, n),
        remove: () => removeTask(ws, n),
        clear: () => clearDone(ws),
        ask: () => ai.askTasks(String(a.id ?? '')),
      } as Record<string, () => unknown>)[p.slice('/_tykerf/tasks/'.length)];
      if (!r) return res.writeHead(404).end('not found');
      const result = r();
      tasksChanged();
      return json(res, 200, { ok: true, result: result ?? null });
    }
    // what Kaity's last request left unfinished: she finishes it, or the person keeps it as it is
    if (p === '/_tykerf/check/fix') return ai.fix(String(a.id ?? '')), json(res, 200, { ok: true });
    if (p === '/_tykerf/check/leave') return ai.leave(String(a.id ?? '')), json(res, 200, { ok: true });
    res.writeHead(404).end('not found');
  }

  function close(movedTo = '/') {
    unwatch?.();
    clearTimeout(debounce);
    broadcast('moved', { url: movedTo });
    for (const c of clients) c.end();
    clients.clear();
  }

  return { ai, job: jobs, handle, refresh: changed, close };
}
