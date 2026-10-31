// "Use AI here": an AI run on one block, by default the user's own Claude Code, run headless.
//
// The AI gets only the tykerf MCP tools (validated tree moves and box code): no files, no
// shell, and every other tool is refused. The block is the scope for the run (passed to the MCP
// server for that run only, never written to the shared .scope file), so edits outside it are
// refused, and while the run lasts the editor can't change that block either. Each block keeps its
// own conversation (.tykerf/chats/<id>.json), and follow-up prompts resume the same session, so the
// AI remembers what was said there.
//
// A Runner is what actually runs the AI (Claude Code today, the Anthropic API later); the AI class
// keeps the conversations, the scope and the lock, the same for every runner.

import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KIND_WORD, find, isOp } from '../model.js';
import { pathOf } from '../refs.js';
import { type Leftover, leftoverKey, leftovers, say } from '../check.js';
import { type TaskNow, sayTask, tasks } from '../tasks.js';
import { insideSignature } from '../scope.js';
import { FolderStore } from '../store.js';
import type { Change, Workspace } from '../workspace.js';

const MCP_SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'server.ts');

export interface ChatMessage {
  role: 'user' | 'ai' | 'step' | 'error' | 'check';
  text: string;
  at: string;
  images?: string[]; // file names in .tykerf/images (pictures the user attached)
  /** A check: what a request left unfinished (src/check.ts), and what became of it. */
  items?: { key: string; text: string }[];
  state?: 'auto' | 'open' | 'fixing' | 'left';
}

/** A picture the user attached to a request (screenshot, sketch, reference design). */
export interface Attachment {
  mediaType: string;
  data: string; // base64
}
const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
export const IMAGE_FILE = /^[a-f0-9]{40}\.(png|jpg|gif|webp)$/;
export interface Chat {
  session?: string; // Claude Code session to resume
  messages: ChatMessage[];
}

/** What a box's code may be; sent with every request so the AI never breaks the rest of the page. */
const CODE_RULES = `Box code is an HTML fragment that lives inside its box. Never write <html>, <head> or <body>, and never touch other boxes.
CSS goes in a <style> in the fragment; it is scoped to the box automatically (:scope is the box), so plain selectors are safe. No position:fixed, no 100vw/100vh.
Scripts, only when needed, find their box with document.currentScript.closest('[data-sw]') and listen only inside it.
The box must work at 375, 768 and 1440 px: fluid widths, flex/grid, images with max-width:100%.
If the box has a type, follow it (get_types), and reuse the pattern of sibling boxes of the same type (get_content).
For a new section (hero, features, FAQ, pricing, footer...), start from a ready-made component (list_components, use_component) and adapt its text and images, instead of writing it from scratch.
If the page has a theme (CSS variables such as --color-accent, --color-surface, --font-heading, --radius, --gap, --max-width; sibling boxes use them), use those variables instead of fixed colours and fonts, so the page stays consistent and the theme can restyle it: sizes from --text-hero, --text-title, --text-lead; section padding from --space-section; buttons rounded by --radius-button. Paint a section's background with var(--section-bg, transparent), so the band tones work: tag a section #tone-alt, #tone-soft or #tone-dark (at most one or two dark bands per page) to alternate bands. Images the boxes use live in assets/.
Every link needs a real target: a section of this page (give the section an id and link to #that-id) or a page of the site (/page/). Never make up the address of a page the site doesn't have: leave such a link as it is and ask the user, in your answer, whether that page will be made.
To change those colours, fonts or spacing for the whole page, use get_theme and set_theme; that is only allowed when the request is about the whole page (the page block is selected). From a smaller block, say that the user can select the page block for page-wide changes.`;

/** One request to the AI, about one block. */
export interface RunRequest {
  ws: Workspace; // the page (API runners run its tools in this process)
  dir: string; // the page folder, for runners whose MCP server runs as a separate process ('' when it has none)
  scope: string; // the block the run may change ('' for a run on the whole site)
  /** A run on the whole site: the site folder, whose pages the run lists, opens and makes (MCP list_pages, open_page, new_page). */
  home?: string;
  system: string; // instructions added to the runner's own
  prompt: string;
  images: Attachment[];
  session?: string; // conversation to resume (Claude Code)
  /** The model's side of the block's past requests, for runners that keep it themselves (API runners). */
  memory: { load(): unknown; save(m: unknown): void };
}

/** What a run reports while it works. `end` comes last, once. */
export interface RunEvents {
  session(id: string): void;
  step(text: string): void; // a tool call, or a refused one
  answer(text: string): void;
  error(text: string): void;
  end(): void;
}

export interface Runner {
  /** Which runner and model answer, shown in the AI tab. */
  readonly name?: string;
  readonly model?: string;
  start(req: RunRequest, on: RunEvents): { cancel(): void };
  /** Whether it can run at all (installed, a key set), without calling the model. */
  status?(): { ready: boolean; note: string };
  /** Start finding out the status in the background (it may be slow); resolves when known. */
  warm?(): Promise<void>;
  /** One tiny real request, to see that the key, address and model work. Resolves to the model's words. */
  check?(): Promise<string>;
}

/**
 * The user's own Claude Code (`claude -p`), with only the tykerf MCP tools. It runs with TYKERF's
 * environment, so a proxy set for Claude Code (ANTHROPIC_BASE_URL and its token) applies here too.
 */
/**
 * The environment for Kaity's `claude` runs: TYKERF's own, without a terminal's agent integration. A
 * terminal such as cmux wraps every `claude` started inside it (CMUX_SURFACE_ID and friends) to add
 * its hooks and session tracking; Kaity's runs are not that terminal's sessions, and the wrapper
 * slowed them and could end them (exit 143). Without those variables the wrapper passes through.
 */
export function claudeEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('CMUX_')));
}

export class ClaudeCodeRunner implements Runner {
  readonly name = 'claude-code';
  readonly model = process.env.TYKERF_MODEL || undefined; // undefined: Claude Code's own choice
  private installed: string | null | undefined;
  private probing: Promise<void> | null = null;

  /**
   * Whether `claude` is installed, found once in the background: `claude --version` can take seconds
   * (it starts the whole CLI), and the editor must never wait for it synchronously.
   */
  warm(): Promise<void> {
    this.probing ??= new Promise<void>((done) => {
      let out = '';
      const child = spawn('claude', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'], env: claudeEnv() });
      const timer = setTimeout(() => child.kill('SIGTERM'), 20_000);
      child.stdout!.on('data', (c) => (out += c));
      child.on('error', () => ((this.installed = null), clearTimeout(timer), done()));
      child.on('close', (code) => ((this.installed = code === 0 ? out.trim() : null), clearTimeout(timer), done()));
    });
    return this.probing;
  }

  status() {
    if (this.installed === undefined) {
      void this.warm();
      return { ready: true, note: 'checking that Claude Code is installed…' };
    }
    return this.installed
      ? { ready: true, note: `Claude Code ${this.installed} is installed; Test checks that it is logged in` }
      : { ready: false, note: 'Claude Code is not installed here (the claude command was not found)' };
  }

  check(): Promise<string> {
    return new Promise((ok, fail) => {
      const argv = ['-p', 'Reply with the single word: ok', '--output-format', 'json', '--tools', '', '--max-turns', '1'];
      if (process.env.TYKERF_MODEL) argv.push('--model', process.env.TYKERF_MODEL);
      const child = spawn('claude', argv, { stdio: ['ignore', 'pipe', 'pipe'], env: claudeEnv() });
      let out = '', err = '';
      const timer = setTimeout(() => child.kill('SIGTERM'), 90_000);
      child.stdout!.on('data', (c) => (out += c));
      child.stderr!.on('data', (c) => (err += c));
      child.on('error', (e) => (clearTimeout(timer), fail(new Error(`could not start claude: ${e.message}`))));
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        if (signal) return fail(new Error('Claude Code did not answer within 90 seconds'));
        let r: any = null;
        try { r = JSON.parse(out); } catch {}
        const text = String(r?.result ?? '').trim();
        if (r && !r.is_error) return ok(text || '(done)');
        if (/authenticat|log ?in|oauth|api key/i.test(text + err)) return fail(new Error('Claude Code is not logged in. Run `claude` in a terminal, then /login.'));
        fail(new Error(text || err.trim().slice(0, 300) || `claude exited with code ${code}`));
      });
    });
  }

  start(req: RunRequest, on: RunEvents) {
    if (!req.dir) {
      on.error('Claude Code needs the page in a folder');
      on.end();
      return { cancel: () => {} };
    }
    const cfg = JSON.stringify({ mcpServers: { tykerf: { command: 'npx', args: ['tsx', MCP_SERVER, '--dir', req.dir, ...(req.scope ? ['--scope', req.scope] : [])] } } });
    // The request goes in on stdin as a stream-json user message, so it can carry pictures.
    const argv = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--tools', '', '--strict-mcp-config',
      '--mcp-config', cfg, '--allowedTools', 'mcp__tykerf', '--permission-mode', 'dontAsk', '--append-system-prompt', req.system];
    if (req.session) argv.push('--resume', req.session);
    if (process.env.TYKERF_MODEL) argv.push('--model', process.env.TYKERF_MODEL);
    const child: ChildProcess = spawn('claude', argv, { stdio: ['pipe', 'pipe', 'pipe'], env: claudeEnv() });
    const n = req.images.length;
    const content = [
      { type: 'text', text: req.prompt + (n ? `\n\n(${n === 1 ? 'An image is' : `${n} images are`} attached: use ${n === 1 ? 'it' : 'them'} as the reference.)` : '') },
      ...req.images.map((a) => ({ type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } })),
    ];
    child.stdin!.on('error', () => {}); // the process may exit before reading (e.g. not logged in)
    child.stdin!.end(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');

    let buf = '', stderr = '', answered = false, cancelled = false, session: string | undefined;
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let e: any;
        try { e = JSON.parse(line); } catch { continue; }
        if (e.session_id && e.session_id !== session) on.session((session = e.session_id));
        if (e.type === 'assistant') {
          for (const c of e.message?.content ?? []) {
            if (c.type === 'tool_use') on.step(step(c.name, c.input));
          }
        } else if (e.type === 'user') {
          for (const c of e.message?.content ?? []) {
            if (c?.type === 'tool_result' && c.is_error) {
              const t = typeof c.content === 'string' ? c.content : (c.content ?? []).map((x: any) => x.text ?? '').join(' ');
              on.step(`refused: ${t.split('\n')[0].slice(0, 160)}`);
            }
          }
        } else if (e.type === 'result') {
          answered = true;
          const text = String(e.result ?? '').trim();
          if (e.is_error && /authenticat|log ?in|oauth|api key/i.test(text))
            on.error('Claude Code is not logged in. Run `claude` in a terminal, then /login, and ask again.');
          else if (e.is_error) on.error(text || 'the AI stopped with an error');
          else on.answer(text || '(done)');
        }
      }
    });
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (c: string) => (stderr += c));
    child.on('error', (err) => on.error(`could not start claude: ${err.message}`));
    child.on('close', (code, signal) => {
      // claude handles SIGTERM itself and exits with 143 (128 + 15), so a stop is known by the flag, not the signal
      if (cancelled || signal) on.error('stopped');
      else if (!answered) {
        const err = stderr.split('\n').filter((l) => l.trim() && !/no stdin data/.test(l)).join(' ').slice(0, 300);
        if (err) on.error(err);
        else if (code === 143 || code === 137) on.error(`Claude Code was stopped from outside TYKERF (exit code ${code}: the system or another program ended it). Ask again.`);
        else on.error(`claude exited with code ${code}`);
      }
      on.end();
    });
    return { cancel: () => ((cancelled = true), child.kill('SIGTERM')) };
  }
}

/**
 * While the AI works on a block, the editor may not change it (the tree inside it, its box code)
 * or remove it; the rest of the page stays editable. `current` gives the block's name now (the AI
 * may rename it); if it still can't be found, every layout and box change waits for the run to end.
 */
function lockBlock(current: () => string) {
  return (c: Change) => {
    if (c.kind === 'head') return;
    const id = current();
    const busy = new Error(`"${id}" is locked while Kaity works on it; wait until it is done, or stop it`);
    if (c.kind === 'content' && inBlock(c, id)) throw busy;
    if (c.kind === 'layout') {
      const before = insideSignature(c.prev, id);
      if (before === null || insideSignature(c.next, id) !== before) throw busy;
    }
  };
}

/** Whether a box change is inside the block (also when the block can't be found: then nothing may change). */
function inBlock(c: Extract<Change, { kind: 'content' }>, id: string) {
  const f = find(c.layout.root, id);
  if (!f) return true;
  const target = c.layout.overlays.find((o) => o.id === c.id)?.target ?? c.id;
  return f.node.id === target || (isOp(f.node) && find(f.node, target) !== null);
}

export class AI {
  private run: { cancel(): void; id: string; since: string } | null = null;
  /** The tasks the current run was asked to work through (askTasks); null for any other run. */
  private runTasks: number[] | null = null;

  /**
   * `site`: Kaity for the whole site (the site manager), on `ws` over the site folder: one conversation
   * (SITE_CHAT), the site's pages through list_pages/open_page/new_page, and no block to keep to.
   */
  constructor(private ws: Workspace, private emit: (event: string, data: unknown) => void, private runner: Runner = new ClaudeCodeRunner(), private opts: { site?: string } = {}) {}

  private get store() {
    return this.ws.store;
  }

  running() {
    return this.run ? { id: this.follow(), ...(this.runTasks ? { tasks: this.runTasks } : {}) } : null;
  }

  /**
   * The running block's name now. The AI may rename the block it works on (its MCP server lets the
   * scope follow); its conversation moves along, so it stays with the block.
   */
  private follow(): string {
    const run = this.run!;
    const now = this.ws.followRenames(run.id, run.since);
    if (now !== run.id) {
      this.rename(run.id, now);
      run.id = now;
    }
    return now;
  }

  private file(id: string) {
    return `.tykerf/chats/${encodeURIComponent(id)}.json`;
  }

  /** The model's side of the conversation, for API runners (runners/loop.ts). */
  private memoryFile(id: string) {
    return `.tykerf/chats/${encodeURIComponent(id)}.api.json`;
  }

  /** Which runner and model answer. */
  runnerInfo() {
    return { runner: this.runner.name ?? 'custom', model: this.runner.model ?? null };
  }

  chat(id: string): Chat {
    const raw = this.store.read(this.file(id));
    return raw ? JSON.parse(raw) : { messages: [] };
  }

  private save(id: string, chat: Chat) {
    this.store.write(this.file(id), JSON.stringify(chat, null, 1));
  }

  private add(id: string, role: ChatMessage['role'], text: string, images?: string[]) {
    const c = this.chat(id);
    c.messages.push({ role, text, at: new Date().toISOString(), ...(images?.length ? { images } : {}) });
    this.save(id, c);
    this.emit('ai', { id, role, text });
  }

  /** An attached picture's bytes, by its file name (null for unknown or malformed names). */
  image(name: string): Uint8Array | null {
    return IMAGE_FILE.test(name) ? this.store.readBytes(`.tykerf/images/${name}`) : null;
  }

  /** Keep an attached picture (by content hash) so the conversation can show it again. */
  private keepImage(a: Attachment): string {
    const ext = IMAGE_TYPES[a.mediaType];
    if (!ext) throw new Error(`images must be PNG, JPEG, GIF or WebP (got ${a.mediaType})`);
    const buf = Buffer.from(a.data, 'base64');
    if (buf.length > 5 * 1024 * 1024) throw new Error('an image is larger than 5 MB');
    const name = `${createHash('sha1').update(buf).digest('hex')}.${ext}`;
    this.store.write(`.tykerf/images/${name}`, new Uint8Array(buf));
    return name;
  }

  /** A renamed block keeps its conversation. */
  rename(from: string, to: string) {
    for (const f of [this.file, this.memoryFile].map((fn) => fn.bind(this))) {
      const kept = this.store.read(f(from));
      if (kept === null || this.store.exists(f(to))) continue;
      this.store.write(f(to), kept);
      this.store.remove(f(from));
    }
  }

  /** Start a new conversation for this block (the history is cleared too). */
  reset(id: string) {
    if (this.run?.id === id) return false;
    this.save(id, { messages: [] });
    this.store.remove(this.memoryFile(id));
    this.emit('ai', { id, role: 'reset' });
    return true;
  }

  cancel() {
    if (!this.run) return false;
    this.run.cancel();
    return true;
  }

  /**
   * Ask the AI about a block. `brief` adds instructions for this request (a new page to build, say);
   * `context` is reference material the model gets after the prompt but the chat doesn't show (a design file).
   */
  ask(id: string, prompt: string, size?: string, images: Attachment[] = [], brief?: string, context?: string) {
    if (this.run) throw new Error(`Kaity is already working on "${this.run.id}"`);
    const site = this.opts.site;
    if (site) id = SITE_CHAT;
    if (!prompt.trim()) throw new Error('write what you want first');
    if (images.length > 5) throw new Error('at most 5 images per message');
    const system = site ? siteSystem(brief) : this.blockSystem(id, size, brief);
    const files = images.map((a) => this.keepImage(a));

    // what the page has left unfinished before the request: only what the request adds is reported after it
    const before = site ? new Set<string>() : new Set(leftovers(this.ws).map(leftoverKey));
    this.add(id, 'user', prompt.trim(), files);
    const run = { cancel: () => {}, id, since: new Date().toISOString() };
    this.run = run;
    // a block is locked for the editor while Kaity works on it; a run on the whole site has no block
    const unlock = site ? () => {} : this.ws.addGuard(lockBlock(() => this.follow()));
    let ended = false;
    let failed = false;
    let reviewed = false;
    const now = () => (ended ? run.id : this.follow());
    this.emit('ai', { id, role: 'start', ...(this.runTasks ? { tasks: this.runTasks } : {}) });
    const dir = this.ws.store instanceof FolderStore ? this.ws.dir : '';
    const memory = {
      load: () => {
        const raw = this.store.read(this.memoryFile(now()));
        return raw ? JSON.parse(raw) : null;
      },
      save: (m: unknown) => this.store.write(this.memoryFile(now()), JSON.stringify(m)),
    };
    const start = (text: string, pictures: Attachment[]) => {
      let done = false;
      run.cancel = this.runner.start({ ws: this.ws, dir, scope: site ? '' : run.id, home: site, system, prompt: text, images: pictures, session: this.chat(now()).session, memory }, {
        session: (s) => this.save(now(), { ...this.chat(now()), session: s }),
        step: (t) => this.add(now(), 'step', t),
        answer: (t) => this.add(now(), 'ai', t),
        error: (t) => {
          failed = true;
          this.add(now(), 'error', t);
        },
        end: () => {
          if (done) return;
          done = true;
          const last = this.follow();
          const left = failed || site ? [] : this.left(before); // the site run's pages are checked by check_page
          // a whole page built in this request gets one pass over what it left, before the run ends
          if (left.length && !reviewed && (brief || this.usedLayout(run.since))) {
            reviewed = true;
            this.addCheck(last, left, 'auto');
            return start(fixPrompt(left), []);
          }
          if (left.length) this.addCheck(last, left, 'open');
          ended = true;
          unlock();
          this.run = null;
          this.runTasks = null;
          this.emit('ai', { id: last, role: 'end' });
        },
      }).cancel;
    };
    // the pictures are kept in the page, so Kaity can also put them on it (add_picture)
    const kept = site || !files.length ? '' : `\n\n(The attached ${files.length === 1 ? 'picture is' : 'pictures are'} kept as ${files.join(', ')}: to put ${files.length === 1 ? 'it' : 'one'} on the page, use add_picture with that file name.)`;
    start(prompt.trim() + kept + (context ? `\n\n${context}` : ''), images);
  }

  /** What Kaity is told for a request about one block. */
  private blockSystem(id: string, size: string | undefined, brief: string | undefined): string {
    const layout = this.ws.load();
    const node = find(layout.root, id)?.node;
    if (!node) throw new Error(`no block "${id}"`);
    const ref = pathOf(layout, id);
    const what = isOp(node)
      ? `the container ${ref} (a ${KIND_WORD[node.kind]} of ${node.children.length} blocks)`
      : `the box ${ref}${node.type === 'leaf' && node.boxType ? ` (type ${node.boxType})` : ''}`;
    return [
      'You are Kaity, the assistant of TYKERF, an editor where people and AI change web pages block by block. If you mention yourself, you are Kaity.',
      `You are working on one block of a web page: ${what}${size ? `, about ${size} on screen` : ''}. The user selected it in the TYKERF editor and is talking to you about it.`,
      'Use only the tykerf tools. get_layout shows only this block; read the boxes you need with get_content.',
      'Only this block may change: changes outside it are refused.',
      CODE_RULES,
      'Make the change, then look at it with screenshot (at 1440 and 375 px) and check it with evaluate; fix what looks wrong. Answer in 1-3 short sentences saying what you changed.',
      'If the user only asks a question, answer it without changing anything. If the request cannot be done inside this block, say so.',
      ...this.otherPages(),
      ...(brief ? [brief] : []),
    ].join('\n');
  }

  /** What the page has left unfinished now that it didn't have before, less what the person chose to keep. */
  private left(before: Set<string>): Leftover[] {
    const kept = new Set(this.kept());
    return leftovers(this.ws).filter((l) => !before.has(leftoverKey(l)) && !kept.has(leftoverKey(l)));
  }

  /** The site's other pages, so a request for a page like one of them can start from it (use_page). */
  private otherPages(): string[] {
    const here = this.ws.store instanceof FolderStore ? basename(this.ws.dir) : null;
    const others = (this.ws.site?.pageNames?.() ?? []).filter((p) => p !== here);
    return others.length ? [`This page is part of a site with other pages: ${others.join(', ')}. To make this page like one of them, use_page copies its blocks (theme: true also takes its look); then rewrite the text for this page.`] : [];
  }

  /** Whether the request replaced the whole page, with a layout or another page (a whole page, as from the start screen). */
  private usedLayout(since: string): boolean {
    return this.ws.history(50).some((h) => (h.at ?? '') >= since && /^use (layout|page) /.test(h.label));
  }

  private addCheck(id: string, left: Leftover[], state: 'auto' | 'open') {
    const c = this.chat(id);
    const text = state === 'auto' ? `checking ${left.length} things left unfinished` : `${left.length} things left unfinished`;
    c.messages.push({ role: 'check', text, at: new Date().toISOString(), state, items: left.map((l) => ({ key: leftoverKey(l), text: say(l) })) });
    this.save(id, c);
    this.emit('ai', { id, role: 'check', text, state });
  }

  /** What the person chose to keep as it is (.tykerf/kept.json), so it isn't reported again. */
  private kept(): string[] {
    const raw = this.store.read('.tykerf/kept.json');
    return raw ? JSON.parse(raw) : [];
  }

  /** The block's last check that still waits for the person, if any. */
  private openCheck(id: string): { chat: Chat; check: ChatMessage } | null {
    const chat = this.chat(id);
    const check = chat.messages.at(-1)?.role === 'check' && chat.messages.at(-1)?.state === 'open' ? chat.messages.at(-1)! : null;
    return check ? { chat, check } : null;
  }

  /** "Give it to Kaity" from the tasks: she works through the open tasks on a block (and inside it) and closes each one. */
  askTasks(id: string) {
    if (this.opts.site) throw new Error('tasks belong to a page: give them to Kaity from that page');
    const open = tasks(this.ws, { open: true, within: id });
    if (!open.length) throw new Error(`no open tasks on "${id}"`);
    // the chat shows each task as the person wrote it; Kaity also gets the element paths (tasksPrompt)
    const line = (x: TaskNow) => `#${x.n} · ${x.block}${x.label ? ` › ${x.label}` : ''}${x.width ? ` · ${x.width} px` : ''}\n${x.text}`;
    const head = open.length === 1 ? 'Work through this task:' : `Work through these ${open.length} tasks:`;
    // only these: a task added while she works waits for the next request (known before the run starts, so its start event carries them)
    if (this.run) throw new Error(`Kaity is already working on "${this.run.id}"`);
    const given = open.map((x) => x.n);
    this.runTasks = given;
    try {
      this.ask(id, `${head}\n\n${open.map(line).join('\n\n')}`, undefined, [], undefined, tasksPrompt(open));
    } catch (e) {
      this.runTasks = null;
      throw e;
    }
    return given;
  }

  /** "Fix them": ask Kaity to finish what her last request left. */
  fix(id: string) {
    const open = this.openCheck(id);
    if (!open) throw new Error('nothing is waiting to be fixed');
    const items = open.check.items ?? [];
    this.ask(id, 'Fix what was left unfinished.', undefined, [], undefined, fixPrompt(items.map((i) => i.text)));
    open.check.state = 'fixing';
    const c = this.chat(id);
    c.messages[open.chat.messages.indexOf(open.check)] = open.check;
    this.save(id, c);
  }

  /** "Leave them": keep what the last request left as it is, and don't report it again. */
  leave(id: string) {
    const open = this.openCheck(id);
    if (!open) throw new Error('nothing is waiting');
    this.store.write('.tykerf/kept.json', JSON.stringify([...new Set([...this.kept(), ...(open.check.items ?? []).map((i) => i.key)])]));
    open.check.state = 'left';
    this.save(id, open.chat);
    this.emit('ai', { id, role: 'check', text: open.check.text, state: 'left' });
  }
}

/** The site manager's conversation with Kaity (one for the whole site). */
export const SITE_CHAT = 'site';

/** What Kaity is told for a request about the whole site. */
function siteSystem(brief?: string): string {
  return [
    'You are Kaity, the assistant of TYKERF, an editor where people and AI change web pages block by block. If you mention yourself, you are Kaity.',
    'You are working on a whole site: a folder of pages. The user is talking to you in the site manager.',
    'Use only the tykerf tools. list_pages shows the pages; open_page opens one, and every other tool then works on that page; new_page makes a new one (copy makes it like another).',
    'For a request about several pages, go through them one at a time: open the page, read it (get_layout, get_content), change it, check it (screenshot at 1440 and 375 px, check_page), then the next. Keep what the pages share consistent: the same navigation, the same sizes, the same links. Links between pages are written /<page>/.',
    CODE_RULES.replace(/, and never touch other boxes/, ''),
    'The site\'s shared head (the theme every page uses, and the free code in Styles & scripts) is not yours to change: tell the user it is in the site manager or a page\'s Page tab.',
    'The site kit is yours (list_kit, get_kit_file, set_kit_file): what every page shares besides the theme. Use it for what should be the same everywhere: a navigation or footer as one shared block (share_block on one page, link_block on the others), a button or card style in kit styles, a behaviour in kit scripts, a tag the site uses. Say which pages each change reaches.',
    'Answer in a few short sentences: what you changed, page by page. If the user only asks a question, answer it without changing anything.',
    ...(brief ? [brief] : []),
  ].join('\n');
}

/** What Kaity hears about the tasks she is asked to work through. */
function tasksPrompt(open: TaskNow[]): string {
  return [
    'People added these tasks to the page in the editor. Each names the block, the element inside it and the window width it was written at:',
    ...open.map((x) => `- ${sayTask(x)}`),
    'Do what each task asks, looking at the page at the width it was written at (screenshot with that width). When a task is done, or answered, close it with close_task and a one-sentence reply for the person. Leave open a task you could not do, and say why in your answer.',
    `Work only on these tasks (${open.map((x) => `#${x.n}`).join(', ')}): people may add more while you work, and list_tasks would show them; leave those for a later request, without changing or closing them.`,
  ].join('\n');
}

/** What Kaity hears about what a request left unfinished. */
function fixPrompt(left: (Leftover | string)[]): string {
  return [
    'These were left unfinished on the page:',
    ...left.map((l) => `- ${typeof l === 'string' ? l : say(l)}`),
    'Fix each one: write the real text, replace or remove each placeholder picture, and give each link a real target (a section of this page, with an id on that section, or a page of the site).',
    'For links to pages the site doesn\'t have yet, don\'t make up addresses: leave them as they are and ask the user, in your answer, whether those pages will be made.',
    'If something should stay as it is, say why in one sentence. Then answer in 1-3 short sentences.',
  ].join('\n');
}

/** A tool call as one short readable line. */
export function step(name: string, input: Record<string, unknown>): string {
  const n = name.replace(/^mcp__tykerf__/, '').replace(/_/g, ' ');
  const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);
  // a whole theme or a list of names is shortened like long text, so every step stays a line or two
  const a = Object.values(input ?? {}).map((v) => cut(typeof v === 'string' ? v : JSON.stringify(v), typeof v === 'string' ? 32 : 48));
  return cut(`${n} ${a.join(' ')}`.trim(), 96);
}
