// The Anthropic Messages API, with TYKERF's own key or any Anthropic-compatible endpoint (a proxy or
// another provider's compatible API): set the key and the base URL in .env (see .env.example).
//
//   TYKERF_RUNNER=anthropic
//   TYKERF_API_KEY=…            (or ANTHROPIC_API_KEY; TYKERF_AUTH_TOKEN / ANTHROPIC_AUTH_TOKEN for a Bearer token)
//   TYKERF_API_BASE_URL=…       (or ANTHROPIC_BASE_URL; default: Anthropic)
//   TYKERF_MODEL=…              (default below)
//   TYKERF_TURN_TIMEOUT=…       (optional: seconds one model turn may take, 180 by default)

import Anthropic from '@anthropic-ai/sdk';
import type { RunEvents, RunRequest, Runner } from '../ai.js';
import { type Wire, runLoop, turnTimeout } from './loop.js';

export const ANTHROPIC_MODEL = 'claude-sonnet-5-5';

type Message = Anthropic.MessageParam;
type Block = Anthropic.ContentBlockParam;
type ImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

const image = (mediaType: string, data: string): Block => ({ type: 'image', source: { type: 'base64', media_type: mediaType as ImageType, data } });

export class AnthropicRunner implements Runner {
  readonly name = 'anthropic';
  readonly model: string;
  private client: Anthropic | null = null;
  private config: { apiKey: string | null; authToken: string | null; baseURL: string | null };
  private limit: number;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.model = env.TYKERF_MODEL || ANTHROPIC_MODEL;
    this.limit = turnTimeout(env);
    this.config = {
      apiKey: env.TYKERF_API_KEY || env.ANTHROPIC_API_KEY || null,
      authToken: env.TYKERF_AUTH_TOKEN || env.ANTHROPIC_AUTH_TOKEN || null,
      baseURL: env.TYKERF_API_BASE_URL || env.ANTHROPIC_BASE_URL || null,
    };
  }

  private api(): Anthropic {
    if (!this.config.apiKey && !this.config.authToken) throw new Error('no API key: set TYKERF_API_KEY (or ANTHROPIC_API_KEY) in .env, then restart TYKERF');
    this.client ??= new Anthropic({ ...this.config, maxRetries: 2 });
    return this.client;
  }

  status() {
    const where = this.config.baseURL ?? 'api.anthropic.com';
    return this.config.apiKey || this.config.authToken
      ? { ready: true, note: `a key is set for ${where}; Test sends one short request` }
      : { ready: false, note: 'no key: set TYKERF_API_KEY (or TYKERF_AUTH_TOKEN) in .env, then restart TYKERF' };
  }

  async check(): Promise<string> {
    try {
      const r = await this.api().messages.create({ model: this.model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with the single word: ok' }] });
      return r.content.filter((c): c is Anthropic.TextBlock => c.type === 'text').map((c) => c.text).join(' ').trim() || '(done)';
    } catch (e) {
      throw new Error(this.describe(e));
    }
  }

  /** A failed request in plain words. */
  describe(e: unknown): string {
    const where = this.config.baseURL ?? 'api.anthropic.com';
    if (e instanceof Anthropic.APIConnectionError) return `could not reach ${where}: ${e.message}`;
    if (e instanceof Anthropic.APIError) {
      if (e.status === 401 || e.status === 403) return 'the API key was refused: check TYKERF_API_KEY (or ANTHROPIC_API_KEY) in .env';
      if (e.status === 429) return 'the API is rate-limited or out of credit; try again in a moment';
      if (e.status === 404) return `the model "${this.model}" was not found at ${where}: set TYKERF_MODEL in .env`;
      return `the API answered ${e.status ?? 'with an error'}: ${e.message}`;
    }
    return (e as Error).message ?? String(e);
  }

  start(req: RunRequest, on: RunEvents) {
    const wire: Wire<Message> = {
      turn: async (history, system, tools, signal) => {
        const r = await this.api().messages.create({
          model: this.model,
          max_tokens: 8192,
          system,
          messages: history,
          tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema })),
        }, { signal });
        const calls = r.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use').map((c) => ({ id: c.id, name: c.name, args: (c.input ?? {}) as Record<string, unknown> }));
        const text = r.content.filter((c): c is Anthropic.TextBlock => c.type === 'text').map((c) => c.text).join('\n');
        return { message: { role: 'assistant', content: r.content as Block[] }, calls, text, cut: r.stop_reason === 'max_tokens' };
      },
      user: (prompt, images) => ({ role: 'user', content: [{ type: 'text', text: prompt }, ...images.map((a) => image(a.mediaType, a.data))] }),
      results: (calls, outputs) => [{
        role: 'user',
        content: calls.map((c, i) => ({
          type: 'tool_result' as const,
          tool_use_id: c.id,
          is_error: outputs[i].isError || undefined,
          content: [{ type: 'text' as const, text: outputs[i].text || '(no output)' }, ...outputs[i].images.map((x) => image(x.mediaType, x.data) as Anthropic.ImageBlockParam)],
        })),
      }],
      withoutImages: (m) => {
        if (typeof m.content === 'string') return m;
        const strip = (b: Block): Block => {
          if (b.type === 'image') return { type: 'text', text: '[picture]' };
          if (b.type === 'tool_result' && Array.isArray(b.content)) return { ...b, content: b.content.map((x) => (x.type === 'image' ? { type: 'text' as const, text: '[screenshot]' } : x)) as Anthropic.ToolResultBlockParam['content'] };
          return b;
        };
        return { ...m, content: m.content.map(strip) };
      },
      error: (e) => this.describe(e),
    };
    return runLoop(this.name, wire, req, on, this.limit);
  }
}
