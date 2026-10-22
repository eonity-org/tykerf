// The API runners: the Anthropic Messages API (or a compatible endpoint) and Gemini, against fake
// servers that answer with scripted turns. The tools are TYKERF's own (in-process MCP), so the scope,
// refusals and history are the real ones.

import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AI, type ChatMessage, claudeEnv, step } from '../src/editor/ai.js';
import { AnthropicRunner } from '../src/editor/runners/anthropic.js';
import { GeminiRunner, geminiSchema } from '../src/editor/runners/gemini.js';
import { runnerFromEnv } from '../src/editor/runners/index.js';
import { timedOut, trim } from '../src/editor/runners/loop.js';
import { openTools } from '../src/editor/tools-client.js';
import { Workspace } from '../src/workspace.js';
import { createPage } from '../src/library.js';
import { pageWorkspace } from '../src/site.js';

type Reply = { status?: number; body: unknown; delay?: number };

/** A fake API: answers each request with the next scripted reply and keeps what it was sent. */
async function fakeAPI(replies: Reply[]) {
  const got: { url: string; body: any; headers: IncomingMessage['headers'] }[] = [];
  const server: Server = createServer(async (req, res) => {
    let s = '';
    for await (const c of req) s += c;
    got.push({ url: req.url ?? '', body: JSON.parse(s || '{}'), headers: req.headers });
    const r = replies.shift() ?? { status: 500, body: { error: { type: 'api_error', message: 'no more replies' } } };
    if (r.delay) await new Promise((ok) => setTimeout(ok, r.delay));
    if (res.destroyed) return;
    res.writeHead(r.status ?? 200, { 'content-type': 'application/json' }).end(JSON.stringify(r.body));
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as { port: number }).port;
  servers.push(server);
  return { url: `http://127.0.0.1:${port}`, got };
}
const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

function page() {
  const ws = new Workspace(mkdtempSync(join(tmpdir(), 'tykerf-runner-')));
  ws.create('a b V c H', { a: '<p>A</p>', b: '<p>B</p>', c: '<p>C</p>' });
  return ws;
}

/** Ask the AI about a block and wait until the run ends; returns the block's chat. */
async function ask(ai: AI, id: string, prompt: string, during?: () => void): Promise<ChatMessage[]> {
  let done!: () => void;
  const ended = new Promise<void>((ok) => (done = ok));
  (ai as any).emit = (_e: string, d: any) => d.role === 'end' && done();
  ai.ask(id, prompt);
  during?.();
  await ended;
  return ai.chat(id).messages;
}

const message = (content: unknown[], stop = 'tool_use') => ({ body: { id: 'msg', type: 'message', role: 'assistant', model: 'm', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });

describe('the tools in the editor process', () => {
  it('are the MCP tools, limited to the scope', async () => {
    const ws = page();
    const tools = await openTools(ws, 'a');
    expect(tools.list.map((t) => t.name)).toEqual(expect.arrayContaining(['get_layout', 'set_content', 'screenshot', 'use_component']));
    expect((await tools.call('set_content', { id: 'a', html: '<p>new</p>' })).isError).toBe(false);
    const refused = await tools.call('set_content', { id: 'c', html: '<p>x</p>' });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/outside the scope/);
    expect(ws.content('a')).toContain('new');
    expect(ws.content('c')).toContain('C');
    await tools.close();
  });
});

describe('the Anthropic runner', () => {
  it('runs the tools the model asks for, inside the block, and keeps the conversation', async () => {
    const api = await fakeAPI([
      message([{ type: 'text', text: 'Changing it.' }, toolUse('t1', 'set_content', { id: 'a', html: '<p>new A</p>' }), toolUse('t2', 'set_content', { id: 'c', html: '<p>no</p>' })]),
      message([{ type: 'text', text: 'Done: a says new A.' }], 'end_turn'),
      message([{ type: 'text', text: 'It says new A.' }], 'end_turn'),
    ]);
    const ws = page();
    const ai = new AI(ws, () => {}, new AnthropicRunner({ TYKERF_API_KEY: 'sk-test', TYKERF_API_BASE_URL: api.url, TYKERF_MODEL: 'claude-test' }));
    const chat = await ask(ai, 'a', 'make it new');
    expect(ws.content('a')).toContain('new A');
    expect(ws.content('c')).toContain('C');
    expect(chat.map((m) => [m.role, m.text])).toEqual([
      ['user', 'make it new'],
      ['step', 'set content a <p>new A</p>'],
      ['step', 'set content c <p>no</p>'],
      ['step', expect.stringMatching(/^refused: .*outside the scope/)],
      ['ai', 'Done: a says new A.'],
    ]);
    expect(ws.history(1)[0]).toMatchObject({ author: 'ai' });

    const [first, second] = api.got;
    expect(first.url).toBe('/v1/messages');
    expect(first.headers['x-api-key']).toBe('sk-test');
    expect(first.body.model).toBe('claude-test');
    expect(first.body.system).toMatch(/You are working on one block/);
    expect(first.body.tools.find((t: any) => t.name === 'set_content').input_schema.properties.html).toBeTruthy();
    const results = second.body.messages.at(-1).content;
    expect(results.map((r: any) => [r.tool_use_id, !!r.is_error])).toEqual([['t1', false], ['t2', true]]);

    // the next request about the block carries the earlier exchange
    await ask(ai, 'a', 'what does it say now?');
    expect(api.got[2].body.messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(api.got[2].body.messages[0].content[0].text).toBe('make it new');
    // a new conversation forgets it
    ai.reset('a');
    expect(ws.store.exists('.tykerf/chats/a.api.json')).toBe(false);
  });

  it('runs nothing from a reply cut off at the length limit, and tells the model why', async () => {
    const api = await fakeAPI([
      message([toolUse('t1', 'set_content', { html: '<p>very long…' })], 'max_tokens'), // the call lost its id
      message([toolUse('t2', 'edit_content', { id: 'a', old: 'A', new: 'short' })]),
      message([{ type: 'text', text: 'Done.' }], 'end_turn'),
    ]);
    const ws = page();
    const ai = new AI(ws, () => {}, new AnthropicRunner({ TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: api.url }));
    const chat = await ask(ai, 'a', 'change it');
    expect(chat.some((m) => m.role === 'step' && /^refused: your reply was cut off/.test(m.text))).toBe(true);
    const back = api.got[1].body.messages.at(-1).content[0];
    expect(back).toMatchObject({ tool_use_id: 't1', is_error: true });
    expect(back.content[0].text).toMatch(/edit_content/);
    expect(ws.content('a')).toContain('<p>short</p>');
    expect(chat.at(-1)).toMatchObject({ role: 'ai', text: 'Done.' });
  });

  it('shows the model its screenshots, then keeps only a note of them', async () => {
    const api = await fakeAPI([
      message([toolUse('s1', 'screenshot', { width: 375 })]),
      message([{ type: 'text', text: 'Looks fine.' }], 'end_turn'),
    ]);
    const ws = page();
    const ai = new AI(ws, () => {}, new AnthropicRunner({ TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: api.url }));
    await ask(ai, 'a', 'look at it');
    const result = api.got[1].body.messages.at(-1).content[0];
    expect(result.content.map((c: any) => c.type)).toEqual(['text', 'image']);
    expect(result.content[1].source.media_type).toBe('image/png');
    const memory = ws.store.read('.tykerf/chats/a.api.json')!;
    expect(memory).toContain('[screenshot]');
    expect(memory.length).toBeLessThan(5000);
  }, 30_000);

  it('sends a Bearer token to a compatible endpoint', async () => {
    const api = await fakeAPI([message([{ type: 'text', text: 'ok' }], 'end_turn')]);
    const ai = new AI(page(), () => {}, new AnthropicRunner({ ANTHROPIC_AUTH_TOKEN: 'tok', ANTHROPIC_BASE_URL: api.url }));
    await ask(ai, 'a', 'hi');
    expect(api.got[0].headers.authorization).toBe('Bearer tok');
  });

  it('says plainly when the key is refused, missing, or the run is stopped', async () => {
    const api = await fakeAPI([
      { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } },
      { delay: 3000, ...message([{ type: 'text', text: 'late' }], 'end_turn') },
    ]);
    const ai = new AI(page(), () => {}, new AnthropicRunner({ TYKERF_API_KEY: 'bad', TYKERF_API_BASE_URL: api.url }));
    expect((await ask(ai, 'a', 'hi')).at(-1)).toMatchObject({ role: 'error', text: expect.stringMatching(/API key was refused/) });
    expect((await ask(ai, 'b', 'hi', () => setTimeout(() => ai.cancel(), 100))).at(-1)).toMatchObject({ role: 'error', text: 'stopped' });
    const none = new AI(page(), () => {}, new AnthropicRunner({}));
    expect((await ask(none, 'a', 'hi')).at(-1)).toMatchObject({ role: 'error', text: expect.stringMatching(/no API key/) });
  });

  it('stops a turn the API never answers, and says so', async () => {
    const api = await fakeAPI([{ delay: 3000, ...message([{ type: 'text', text: 'late' }], 'end_turn') }]);
    const ai = new AI(page(), () => {}, new AnthropicRunner({ TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: api.url, TYKERF_TURN_TIMEOUT: '0.2' }));
    expect((await ask(ai, 'a', 'hi')).at(-1)).toMatchObject({ role: 'error', text: 'the model did not answer within 1 second; ask again to continue' });
    expect(timedOut(180_000)).toBe('the model did not answer within 3 minutes; ask again to continue');
  });

  it('stops a model that never finishes', async () => {
    const loop = Array.from({ length: 41 }, (_, i) => message([toolUse(`t${i}`, 'get_layout', {})]));
    const api = await fakeAPI(loop);
    const ai = new AI(page(), () => {}, new AnthropicRunner({ TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: api.url }));
    const chat = await ask(ai, 'a', 'go on forever');
    expect(chat.at(-1)).toMatchObject({ role: 'error', text: 'stopped after 40 steps; ask again to continue' });
    expect(chat.filter((m) => m.role === 'step')).toHaveLength(40);
  });
});

describe('the Gemini runner', () => {
  const answer = (parts: unknown[]) => ({ body: { candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }] } });

  it('runs the same tools through function calls', async () => {
    const api = await fakeAPI([
      answer([{ functionCall: { id: 'f1', name: 'set_content', args: { id: 'a', html: '<p>gem</p>' } } }]),
      answer([{ text: 'Done.' }]),
    ]);
    const ws = page();
    const ai = new AI(ws, () => {}, new GeminiRunner({ GEMINI_API_KEY: 'g-key', GEMINI_BASE_URL: api.url, TYKERF_MODEL: 'gemini-test' }));
    const chat = await ask(ai, 'a', 'gemini, change it');
    expect(ws.content('a')).toContain('gem');
    expect(chat.map((m) => m.role)).toEqual(['user', 'step', 'ai']);
    expect(chat.at(-1)!.text).toBe('Done.');
    const [first, second] = api.got;
    expect(first.url).toMatch(/models\/gemini-test:generateContent/);
    const decl = first.body.tools[0].functionDeclarations.find((d: any) => d.name === 'set_content');
    expect(decl.parametersJsonSchema.properties.id).toBeTruthy();
    expect(decl.parametersJsonSchema.$schema).toBeUndefined();
    expect(second.body.contents.at(-1).parts[0].functionResponse).toMatchObject({ id: 'f1', name: 'set_content', response: { output: expect.stringMatching(/^ok/) } });
  });

  it('makes every tool schema acceptable', async () => {
    const tools = await openTools(page(), 'a');
    for (const t of tools.list) {
      const s = geminiSchema(t.inputSchema);
      expect(s.$schema, t.name).toBeUndefined();
      expect(s.type, t.name).toBe('object');
    }
    await tools.close();
  });
});

describe('what a request leaves unfinished', () => {
  it('is reported after the request, without what the person had left before, and the person can keep it', async () => {
    const api = await fakeAPI([
      message([toolUse('t1', 'set_content', { id: 'a', html: '<p>A</p><a href="#">Read more</a>' })]),
      message([{ type: 'text', text: 'Added a link.' }], 'end_turn'),
      message([{ type: 'text', text: 'ok' }], 'end_turn'),
    ]);
    const ws = page();
    ws.setContent('b', '<p>Page one</p>', 'user'); // a placeholder the person left there
    const ai = new AI(ws, () => {}, new AnthropicRunner({ TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: api.url }));
    const chat = await ask(ai, 'a', 'add a link');
    expect(api.got).toHaveLength(2); // no extra pass for a request about one block
    expect(chat.at(-1)).toMatchObject({ role: 'check', state: 'open', items: [{ key: 'a|link|# Read more', text: 'a: the link "Read more" goes nowhere' }] });

    ai.leave('a');
    expect(ai.chat('a').messages.at(-1)).toMatchObject({ role: 'check', state: 'left' });
    expect(JSON.parse(ws.store.read('.tykerf/kept.json')!)).toEqual(['a|link|# Read more']);
    expect(() => ai.leave('a')).toThrow(/nothing is waiting/);
    // kept, it isn't reported again
    expect((await ask(ai, 'a', 'thanks')).at(-1)).toMatchObject({ role: 'ai', text: 'ok' });
  });

  it('gets one pass by Kaity when the request built a whole page', async () => {
    const api = await fakeAPI([
      message([toolUse('t1', 'use_component', { id: 'a', name: 'nav' })]),
      message([{ type: 'text', text: 'Built.' }], 'end_turn'),
      message([toolUse('t2', 'set_content', { id: 'a', html: '<nav><a href="#sw-c">Rome</a></nav>' })]),
      message([{ type: 'text', text: 'Finished the navigation.' }], 'end_turn'),
    ]);
    const ws = page();
    const root = ws.load().root.id;
    const ai = new AI(ws, () => {}, new AnthropicRunner({ TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: api.url }));
    let done!: () => void;
    const ended = new Promise<void>((ok) => (done = ok));
    (ai as any).emit = (_e: string, d: any) => d.role === 'end' && done();
    ai.ask(root, 'a page about Rome', undefined, [], 'Build the whole page.');
    await ended;
    const fix = api.got[2].body.messages.at(-1).content[0].text;
    expect(fix).toMatch(/^These were left unfinished on the page:/);
    expect(fix).toContain('- a: placeholder text "Page one"');
    expect(fix).toMatch(/don't make up addresses/);
    expect(ws.content('a')).toContain('Rome');
    const chat = ai.chat(root).messages;
    expect(chat.map((m) => m.role)).toEqual(['user', 'step', 'ai', 'check', 'step', 'ai']);
    expect(chat[3]).toMatchObject({ state: 'auto' });
    expect(() => ai.fix(root)).toThrow(/nothing is waiting/);
  });

  it('can be finished on request: "Fix them" asks Kaity with the list', async () => {
    const api = await fakeAPI([
      message([toolUse('t1', 'set_content', { id: 'a', html: '<img src="assets/placeholder-wide.svg" alt="">' })]),
      message([{ type: 'text', text: 'Added a picture.' }], 'end_turn'),
      message([{ type: 'text', text: 'Which picture should it be?' }], 'end_turn'),
    ]);
    const ws = page();
    const ai = new AI(ws, () => {}, new AnthropicRunner({ TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: api.url }));
    await ask(ai, 'a', 'add a picture');
    let done!: () => void;
    const ended = new Promise<void>((ok) => (done = ok));
    (ai as any).emit = (_e: string, d: any) => d.role === 'end' && done();
    ai.fix('a');
    await ended;
    expect(api.got[2].body.messages.at(-1).content[0].text).toContain('- a: a placeholder picture (placeholder-wide.svg)');
    const chat = ai.chat('a').messages;
    expect(chat.find((m) => m.role === 'check')).toMatchObject({ state: 'fixing' });
    expect(chat.at(-1)).toMatchObject({ role: 'ai', text: 'Which picture should it be?' }); // what was asked about isn't reported again
  });
});

describe("Kaity's instructions", () => {
  it("name the site's other pages, so a page like one of them starts from it", async () => {
    const api = await fakeAPI([message([{ type: 'text', text: 'ok' }], 'end_turn')]);
    const dir = mkdtempSync(join(tmpdir(), 'tykerf-runner-site-'));
    for (const name of ['rome', 'munich']) createPage(new Workspace(join(dir, name)), 'blank');
    const ws = pageWorkspace(dir, 'munich');
    const ai = new AI(ws, () => {}, new AnthropicRunner({ TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: api.url }));
    await ask(ai, 'nav', 'hi');
    expect(api.got[0].body.system).toContain('This page is part of a site with other pages: rome. To make this page like one of them, use_page');
  });
});

describe('checking a runner', () => {
  it('says whether a key is set, and sends one short request on Test', async () => {
    expect(new AnthropicRunner({}).status()).toMatchObject({ ready: false, note: expect.stringMatching(/no key/) });
    expect(new GeminiRunner({}).status().ready).toBe(false);
    const api = await fakeAPI([message([{ type: 'text', text: 'ok' }], 'end_turn'), { status: 404, body: { type: 'error', error: { type: 'not_found_error', message: 'model' } } }]);
    const runner = new AnthropicRunner({ TYKERF_API_KEY: 'k', TYKERF_API_BASE_URL: api.url, TYKERF_MODEL: 'nope' });
    expect(runner.status().ready).toBe(true);
    expect(await runner.check()).toBe('ok');
    expect(api.got[0].body.max_tokens).toBe(16);
    await expect(runner.check()).rejects.toThrow(/model "nope" was not found/);
    const gem = await fakeAPI([{ body: { candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }] } }]);
    expect(await new GeminiRunner({ GEMINI_API_KEY: 'g', GEMINI_BASE_URL: gem.url }).check()).toBe('ok');
  });
});

describe('choosing a runner', () => {
  it('reads TYKERF_RUNNER and refuses unknown ones', () => {
    expect(runnerFromEnv({}).name).toBe('claude-code');
    expect(runnerFromEnv({ TYKERF_RUNNER: 'anthropic', TYKERF_MODEL: 'x' })).toMatchObject({ name: 'anthropic', model: 'x' });
    expect(runnerFromEnv({ TYKERF_RUNNER: 'gemini' }).name).toBe('gemini');
    expect(() => runnerFromEnv({ TYKERF_RUNNER: 'gpt' })).toThrow(/not a runner TYKERF knows/);
  });

  it('keeps the conversation short by dropping the oldest exchanges', () => {
    const ex = Array.from({ length: 10 }, (_, i) => [{ text: `${i}`.repeat(100) }]);
    const kept = trim(ex, 500);
    expect(kept.length).toBeLessThan(10);
    expect(kept.at(-1)).toEqual(ex.at(-1));
  });
});

describe('Claude Code runs', () => {
  it("start without a terminal's agent integration (cmux), keeping the rest of the environment", () => {
    const env = claudeEnv({ PATH: '/bin', ANTHROPIC_BASE_URL: 'https://proxy.test', CMUX_SURFACE_ID: 'x', CMUX_CLAUDE_HOOK_SPOOL_DIR: '/tmp/y' });
    expect(env).toEqual({ PATH: '/bin', ANTHROPIC_BASE_URL: 'https://proxy.test' });
  });
});

describe('a step as Kaity\'s work shows it', () => {
  it('stays short: long text, whole themes and lists are cut', () => {
    expect(step('mcp__tykerf__use_component', { id: 'text', name: 'hero' })).toBe('use component text hero');
    expect(step('set_content', { id: 'nav', html: '<style>:scope { background: var(--section-bg); }</style>' })).toBe(`set content nav ${'<style>:scope { background: var(--section-bg); }</style>'.slice(0, 32)}…`);
    const theme = step('set_theme', { values: { '--color-accent': '#d8491f', '--color-band': '#f4efeb', '--font-heading': '"Playfair Display", Georgia, serif' } });
    expect(theme).toBe(`set theme ${JSON.stringify({ '--color-accent': '#d8491f', '--color-band': '#f4efeb', '--font-heading': '"Playfair Display", Georgia, serif' }).slice(0, 48)}…`);
    expect(step('split', { leaf: 'text', kind: 'column', names: Array.from({ length: 30 }, (_, i) => `section${i}`) }).length).toBeLessThanOrEqual(97);
  });
});
