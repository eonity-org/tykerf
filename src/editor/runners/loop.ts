// The agent loop the API runners share: send the conversation and the tools, run the tools the model
// asks for, send their results back, until the model answers in words. Each provider (anthropic.ts,
// gemini.ts) only says how its messages look on the wire.
//
// The model's side of past requests is kept per block (RunRequest.memory) as "exchanges": one
// request and everything that followed it. Pictures are dropped once an exchange is over (the model
// has seen them), and the oldest exchanges go when the conversation grows too long, so a block's
// conversation can go on for a long time without growing without bound.

import type { Attachment, RunEvents, RunRequest } from '../ai.js';
import { step, stepAt } from '../ai.js';
import { type ToolDef, type ToolOutput, type Tools, openTools } from '../tools-client.js';

/** What the model hears when its reply was cut off at the length limit. */
export const CUT = 'your reply was cut off at the length limit before this call was complete, so nothing was done; ' +
  'to change part of a box use edit_content (only the changed text), and write long code in several smaller steps';

/** Most tool calls in one request; then the model is stopped and the user can ask it to go on. */
export const MAX_STEPS = 40;
/** Roughly how much past conversation (characters of JSON) is sent with each request. */
export const MAX_MEMORY = 100_000;
/** How long one model turn may take (ms) before the run stops; a request the API never answers would otherwise hang the run. */
export const TURN_TIMEOUT = 180_000;

/** The turn limit from the environment (TYKERF_TURN_TIMEOUT, in seconds), or the default. */
export const turnTimeout = (env: NodeJS.ProcessEnv) => Number(env.TYKERF_TURN_TIMEOUT) * 1000 || TURN_TIMEOUT;

/** What the chat says when the model took longer than the limit. */
export function timedOut(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const n = s >= 60 && s % 60 === 0 ? [s / 60, 'minute'] as const : [s, 'second'] as const;
  return `the model did not answer within ${n[0]} ${n[1]}${n[0] === 1 ? '' : 's'}; ask again to continue`;
}

export interface Call {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** How one provider writes messages. M is its message type. */
export interface Wire<M> {
  /** One model turn: the message to keep, the tools it calls (in order) and its words. */
  turn(history: M[], system: string, tools: ToolDef[], signal: AbortSignal): Promise<{ message: M; calls: Call[]; text: string; cut?: boolean }>;
  /** The user's request, with the pictures they attached. */
  user(prompt: string, images: Attachment[]): M;
  /** The messages that give the tools' answers back to the model. */
  results(calls: Call[], outputs: ToolOutput[]): M[];
  /** A message without its pictures (once the model has seen them). */
  withoutImages(m: M): M;
  /** A readable message for a failed request (wrong key, rate limit, no network). */
  error(e: unknown): string;
}

interface Memory<M> {
  runner: string;
  exchanges: M[][];
}

/** Drop the oldest exchanges until the rest fits. */
export function trim<M>(exchanges: M[][], max = MAX_MEMORY): M[][] {
  const out = [...exchanges];
  while (out.length > 1 && JSON.stringify(out).length > max) out.shift();
  return out;
}

export function runLoop<M>(runner: string, wire: Wire<M>, req: RunRequest, on: RunEvents, limit = TURN_TIMEOUT): { cancel(): void } {
  const abort = new AbortController();
  (async () => {
    let tools: Tools | null = null;
    let late: AbortSignal | null = null;
    try {
      tools = await openTools(req.ws, req.scope, req.home);
      const saved = req.memory.load() as Memory<M> | null;
      const past = saved?.runner === runner ? saved.exchanges : [];
      const now: M[] = [wire.user(req.prompt, req.images)];
      const keep = () => req.memory.save({ runner, exchanges: trim([...past, now.map((m) => wire.withoutImages(m))]) } satisfies Memory<M>);
      let steps = 0;
      for (;;) {
        late = AbortSignal.timeout(limit);
        const r = await wire.turn([...past.flat(), ...now], req.system, tools.list, AbortSignal.any([abort.signal, late]));
        late = null;
        now.push(r.message);
        if (!r.calls.length) {
          keep();
          on.answer(r.text.trim() || '(done)');
          break;
        }
        if (steps + r.calls.length > MAX_STEPS) {
          // the conversation must not end on calls without results: keep it up to the last answer
          now.pop();
          keep();
          on.error(`stopped after ${steps} steps; ask again to continue`);
          break;
        }
        // a reply cut off at the length limit: its last call is incomplete (its arguments may be missing). Every call
        // gets the reason back instead of running, so the model can do it in smaller pieces
        if (r.cut) {
          on.step(`refused: ${CUT.split(';')[0]}`);
          now.push(...wire.results(r.calls, r.calls.map(() => ({ text: CUT, images: [], isError: true }))));
          steps += r.calls.length;
          continue;
        }
        const outputs: ToolOutput[] = [];
        for (const c of r.calls) {
          if (abort.signal.aborted) throw new DOMException('stopped', 'AbortError');
          on.step(step(c.name, c.args), stepAt(c.name, c.args));
          const out = await tools.call(c.name, c.args);
          if (out.isError) on.step(`refused: ${out.text.replace(/^error: (refused: )?/, '').split('\n')[0].slice(0, 160)}`); // once, not "refused: refused:"
          outputs.push(out);
        }
        steps += r.calls.length;
        now.push(...wire.results(r.calls, outputs));
      }
    } catch (e) {
      on.error(abort.signal.aborted ? 'stopped' : late?.aborted ? timedOut(limit) : wire.error(e));
    } finally {
      await tools?.close().catch(() => {});
      on.end();
    }
  })();
  return { cancel: () => abort.abort() };
}
