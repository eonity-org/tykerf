// How Kaity's runs come out in the editor (v4 round 2), end to end against a fake API on the Anthropic runner: a
// request she can't do in one box is "couldn't do it" with Widen to this page; widened, a change to a shared block
// that other pages show waits for the person's OK and names them; with the OK it is a change, with Undo. A task she
// closes without changing anything is not done and stays open. And the site's check says when it is out of date.

import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { newSitePage, pageWorkspace } from '../src/site.js';
import { addTask, tasks } from '../src/tasks.js';
import { freePort } from './ports.js';

vi.setConfig({ testTimeout: 30_000 });

const message = (content: unknown[], stop = 'tool_use') => ({ id: 'm', type: 'message', role: 'assistant', model: 'm', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
const say = (text: string) => message([{ type: 'text', text }], 'end_turn');
const call = (name: string, input: unknown, id = name) => ({ type: 'tool_use', id, name, input });

/** Kaity: in one box she can't change the shared navigation (cant_do); on the whole page she tries. */
function kaity(body: { system: string | { text: string }[]; messages: { role: string; content: { type: string; text?: string }[] }[] }) {
  const system = typeof body.system === 'string' ? body.system : body.system.map((b) => b.text).join('\n');
  const msgs = body.messages;
  let i = msgs.length - 1;
  while (i >= 0 && !(msgs[i].role === 'user' && msgs[i].content.some((c) => c.type === 'text'))) i--;
  const prompt = msgs[i].content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const turn = msgs.slice(i + 1).filter((m) => m.role === 'assistant').length;
  const last = JSON.stringify(msgs.at(-1));
  if (/^Rename the menu's first link/.test(prompt)) {
    if (/working on the whole page/.test(system)) return turn === 0 ? message([call('edit_content', { id: 'nav', old: 'Page one', new: 'Home' })]) : say(/refused/.test(last) ? 'That changes the navigation on every page.' : 'Renamed it on every page.');
    return turn === 0 ? message([call('cant_do', { reason: 'The navigation is a shared block, outside this box.', widen: 'page' })]) : say('I can\'t: the navigation is shared.');
  }
  if (/^Task 1:/.test(prompt)) return turn === 0 ? message([call('close_task', { n: 1, reply: 'I cannot remove the footer from here.' })]) : say('I could not.');
  return say('done');
}

describe("Kaity's runs, as they came out", () => {
  let api: Server;
  let server: ChildProcess;
  let site: string;
  let base: string;
  const get = (u: string) => fetch(base + u).then((r) => r.json());
  const post = (u: string, b: unknown) => fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  /** The thread once nothing runs any more. */
  async function settled() {
    let t: any;
    await expect.poll(async () => (t = await get('/_tykerf/site/thread'), !t.running && !(await get('/home/_tykerf/state')).taskRun?.running), { timeout: 20_000 }).toBe(true);
    return t;
  }

  beforeAll(async () => {
    api = createServer(async (req, res) => {
      let s = '';
      for await (const c of req) s += c;
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(kaity(JSON.parse(s))));
    });
    await new Promise<void>((ok) => api.listen(0, '127.0.0.1', ok));
    site = join(mkdtempSync(join(tmpdir(), 'tykerf-outcomes-')), 'site');
    newSitePage(site, 'home', 'launch', 'studio'); // its navigation and footer are shared
    newSitePage(site, 'about', 'launch', 'studio');
    const port = await freePort();
    base = `http://localhost:${port}`;
    server = spawn(process.execPath, ['--import', 'tsx', 'src/editor/server.ts', site, '--port', String(port)], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, TYKERF_DOTENV: 'off', TYKERF_TASK_SHOTS: 'off', TYKERF_DESIGN_CHECK: 'off', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_BASE_URL: '', TYKERF_RUNNER: 'anthropic', TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}` },
    });
    await new Promise<void>((ok, fail) => {
      server.stdout!.on('data', (d) => String(d).includes('TYKERF: http') && ok());
      server.on('exit', (c) => fail(new Error(`editor exited with ${c}`)));
    });
  }, 60_000);
  afterAll(() => {
    server?.kill();
    api?.close();
  });

  it('in one box: she couldn\'t, and Widen sends it again on the whole page, where the shared block waits for the OK', async () => {
    const nav = pageWorkspace(site, 'home').content('nav');
    await post('/home/_tykerf/ask', { prompt: 'Rename the menu\'s first link to Home', scope: 'box', id: 'hero' });
    let t = await settled();
    const box = t.items.at(-1);
    expect(box).toMatchObject({ scope: 'box', outcome: 'declined', widen: true, undoable: false, note: { cant: { reason: 'The navigation is a shared block, outside this box.', widen: 'page' } } });
    expect(box.review).toBeUndefined();

    // Widen to this page: the same words, on the whole page; the navigation reaches about too, so she asks first
    await post('/home/_tykerf/ask', { again: box.run, scope: 'page' });
    t = await settled();
    const page = t.items.at(-1);
    expect(page).toMatchObject({ scope: 'page', request: box.request, again: box.run, outcome: 'asks', asks: { block: 'nav', pages: ['about', 'home'] }, undoable: false });
    expect(t.items.at(-2).widen).toBeUndefined(); // the box run offers nothing more
    expect(t.waiting).toBe(1);
    expect(pageWorkspace(site, 'home').content('nav')).toBe(nav); // not applied without the OK

    // the OK: she changes it on every page, and it can be undone
    await post('/home/_tykerf/ask', { again: page.run, ok: true });
    t = await settled();
    expect(t.items.at(-1)).toMatchObject({ outcome: 'changed', undoable: true, sharedOk: ['nav'] });
    expect(pageWorkspace(site, 'about').content('nav')).toContain('Home');
    expect(t.items.at(-2).asks).toBeUndefined();
    expect(t.waiting).toBe(0);
  });

  it('a task she closes with nothing changed is one she couldn\'t do: not done, and it stays open', async () => {
    const home = pageWorkspace(site, 'home');
    addTask(home, { block: 'hero', text: 'Remove the footer' });
    await post('/home/_tykerf/taskrun/start', {});
    const t = await settled();
    expect(t.items.at(-1)).toMatchObject({ kind: 'task', task: 1, outcome: 'declined', undoable: false });
    expect(t.items.at(-1).review).toBeUndefined();
    expect(tasks(home, { open: true }).map((x) => x.n)).toEqual([1]);
    // nothing waits for the person: the page's task run closed by itself
    expect((await get('/home/_tykerf/state')).taskRun).toBeNull();
  });

  it('says the design check is out of date once a page changed after it, for the top bar, the rail and the Overview alike', async () => {
    // a design check from before the changes above (kept in the site, so a restart doesn't forget it)
    mkdirSync(join(site, '.tykerf'), { recursive: true });
    writeFileSync(join(site, '.tykerf', 'design-check.json'), JSON.stringify({ at: new Date(Date.now() - 3_600_000).toISOString(), fixes: 0, notes: 1 }));
    expect((await get('/_tykerf/site/check')).design).toEqual({ at: expect.any(String), fixes: 0, notes: 1, stale: true });
  });
});
