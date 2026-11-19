// Google's Gemini API with TYKERF's own key, through the same tools as every other runner.
//
//   TYKERF_RUNNER=gemini
//   GEMINI_API_KEY=…          (or GOOGLE_API_KEY)
//   GEMINI_BASE_URL=…         (optional: a compatible endpoint or proxy)
//   TYKERF_MODEL=…              (default below)
//   TYKERF_TURN_TIMEOUT=…       (optional: seconds one model turn may take, 180 by default)

import { ApiError, type Content, type FunctionCall, GoogleGenAI, type Part } from '@google/genai';
import type { RunEvents, RunRequest, Runner } from '../ai.js';
import { ANSWER_MAX, type Wire, retryWaits, runLoop, turnTimeout } from './loop.js';

export const GEMINI_MODEL = 'gemini-pro-latest';

/** A tool's JSON Schema as Gemini takes it (parametersJsonSchema): only without the $schema marker. */
export function geminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _, ...rest } = schema;
  return rest;
}

/** How a reply starts: a capital or a letter of a script without case, a figure, an opening mark, or a list. */
const SENTENCE = /^(?:[\p{Lu}\p{Lt}\p{Lo}\p{N}\p{So}¿¡"'“‘«(*#_`[]|[-•]\s)/u;

/**
 * The words of a model turn: its text parts, without thoughts. Gemini (gemini-pro-latest) sometimes writes
 * something else where its reply should be, or before it: the end of some code, half a word, a note to itself
 * ("I am ready to reply to the user."), pages of documentation. The reply is the parts after the last stray one
 * (no space in it and not a word such as "Done.", or a short note about "the user": Kaity speaks to the person
 * as "you"); `garbled` when what is
 * left doesn't start like a sentence or is too long to be a reply, so the loop asks for the turn again.
 */
export function reply(parts: Part[]): { text: string; garbled: boolean } {
  const texts = parts.filter((p) => p.text && !p.thought).map((p) => p.text!.trim()).filter(Boolean);
  const all = texts.join('\n');
  if (all.length > ANSWER_MAX) return { text: all, garbled: true };
  const stray = (t: string) => (!/\s/.test(t) && !SENTENCE.test(t)) || (t.length < 80 && /\bthe user\b/i.test(t));
  let from = texts.length;
  while (from > 0 && !stray(texts[from - 1])) from--;
  const text = texts.slice(from).join('\n\n');
  return { text, garbled: texts.length > 0 && !SENTENCE.test(text) };
}

export class GeminiRunner implements Runner {
  readonly name = 'gemini';
  readonly model: string;
  private client: GoogleGenAI | null = null;
  private apiKey: string | null;
  private baseUrl: string | null;
  private limit: number;
  private waits: number[];

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.model = env.TYKERF_MODEL || GEMINI_MODEL;
    this.limit = turnTimeout(env);
    this.waits = retryWaits(env);
    this.apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || null;
    this.baseUrl = env.GEMINI_BASE_URL || null;
  }

  private api(): GoogleGenAI {
    if (!this.apiKey) throw new Error('no API key: set GEMINI_API_KEY in .env, then restart TYKERF');
    this.client ??= new GoogleGenAI({ apiKey: this.apiKey, ...(this.baseUrl ? { httpOptions: { baseUrl: this.baseUrl } } : {}) });
    return this.client;
  }

  status() {
    return this.apiKey
      ? { ready: true, note: `a key is set for ${this.baseUrl ?? 'the Gemini API'}; Test sends one short request` }
      : { ready: false, note: 'no key: set GEMINI_API_KEY in .env, then restart TYKERF' };
  }

  async check(): Promise<string> {
    try {
      const r = await this.api().models.generateContent({ model: this.model, contents: 'Reply with the single word: ok' });
      return (r.text ?? '').trim() || '(done)';
    } catch (e) {
      throw new Error(this.describe(e));
    }
  }

  /** A failed request in plain words. */
  describe(e: unknown): string {
    const where = this.baseUrl ?? 'generativelanguage.googleapis.com';
    if (e instanceof ApiError) {
      if (e.status === 400 && /api key/i.test(e.message)) return 'the API key was refused: check GEMINI_API_KEY in .env';
      if (e.status === 401 || e.status === 403) return 'the API key was refused: check GEMINI_API_KEY in .env';
      if (e.status === 429) return 'the API is rate-limited or out of quota; try again in a moment';
      if (e.status === 404) return `the model "${this.model}" was not found: set TYKERF_MODEL in .env`;
      return `the API answered ${e.status}: ${e.message}`;
    }
    if (e instanceof TypeError && /fetch/i.test(e.message)) return `could not reach ${where}: ${e.message}`;
    return (e as Error).message ?? String(e);
  }

  /** Whether a failed request may work later: no connection, a busy or rate-limited service. */
  retryable(e: unknown): { wait?: number } | null {
    if (e instanceof ApiError) return e.status === 408 || e.status === 429 || e.status >= 500 ? {} : null;
    if (e instanceof TypeError && /fetch/i.test(e.message)) return {};
    return null;
  }

  start(req: RunRequest, on: RunEvents) {
    const wire: Wire<Content> = {
      turn: async (history, system, tools, signal) => {
        const r = await this.api().models.generateContent({
          model: this.model,
          contents: history,
          config: {
            systemInstruction: system,
            tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: geminiSchema(t.inputSchema) })) }],
            abortSignal: signal,
          },
        });
        const content = r.candidates?.[0]?.content;
        if (!content?.parts?.length) throw new Error(`Gemini gave no answer${r.promptFeedback?.blockReason ? ` (blocked: ${r.promptFeedback.blockReason})` : ''}`);
        const parts = content.parts;
        const calls = parts.filter((p): p is Part & { functionCall: FunctionCall } => !!p.functionCall).map((p, i) => ({ id: p.functionCall.id ?? `call-${i}`, name: p.functionCall.name ?? '', args: (p.functionCall.args ?? {}) as Record<string, unknown> }));
        const { text, garbled } = reply(parts);
        // the model's turn goes back as it came (it may carry thought signatures the API wants to see again)
        return { message: { role: 'model', parts }, calls, text, garbled, cut: r.candidates?.[0]?.finishReason === 'MAX_TOKENS' };
      },
      user: (prompt, images) => ({ role: 'user', parts: [{ text: prompt }, ...images.map((a) => ({ inlineData: { mimeType: a.mediaType, data: a.data } }))] }),
      results: (calls, outputs) => [{
        role: 'user',
        parts: [
          ...calls.map((c, i) => ({ functionResponse: { id: c.id.startsWith('call-') ? undefined : c.id, name: c.name, response: outputs[i].isError ? { error: outputs[i].text } : { output: outputs[i].text || '(no output)' } } })),
          // screenshots follow the answers, as pictures in the same turn
          ...outputs.flatMap((o) => o.images.map((x) => ({ inlineData: { mimeType: x.mediaType, data: x.data } }))),
        ],
      }],
      withoutImages: (m) => ({ ...m, parts: (m.parts ?? []).map((p) => (p.inlineData ? { text: '[picture]' } : p)) }),
      error: (e) => this.describe(e),
      retry: (e) => this.retryable(e),
      assistant: (text) => ({ role: 'model', parts: [{ text }] }),
    };
    return runLoop(this.name, wire, req, on, this.limit, this.waits);
  }
}
