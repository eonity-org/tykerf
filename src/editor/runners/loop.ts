// The agent loop the API runners share: send the conversation and the tools, run the tools the model
// asks for, send their results back, until the model answers in words. Each provider (anthropic.ts,
// gemini.ts) only says how its messages look on the wire.
//
// The model's side of past requests is kept per block (RunRequest.memory) as "exchanges": one
// request and everything that followed it. Pictures are dropped once an exchange is over (the model
// has seen them), and the oldest exchanges go when the conversation grows too long, so a block's
// conversation can go on for a long time without growing without bound.

import type { Attachment, RunEvents, RunRequest, StopReason } from '../ai.js';
import { step, stepAt } from '../ai.js';
import { type ToolDef, type ToolOutput, type Tools, openTools } from '../tools-client.js';

/** What the model hears when its reply was cut off at the length limit. */
export const CUT = 'your reply was cut off at the length limit before this call was complete, so nothing was done; ' +
  'to change part of a box use edit_content (only the changed text), and write long code in several smaller steps';

/**
 * The longest final reply taken as an answer. Kaity answers in a few sentences (her answers in the test runs
 * stay under 1,300 characters); a model sometimes writes out pages of text it remembers from elsewhere
 * (documentation, course material) where its answer should be.
 */
export const ANSWER_MAX = 4000;
/** How many times a reply that is not an answer (too long, or garbled) is asked for again. */
export const GARBLED_TRIES = 2;
/** The answer when the model's replies stayed too long to be one: what it did is on the page. */
export const GARBLED = 'I finished, but my reply came out garbled. Everything I did is on the page: look at it, and ask me if something is missing.';

/** Most tool calls in one request; then the model is stopped and the user can ask it to go on. */
export const MAX_STEPS = 40;
/** Roughly how much past conversation (characters of JSON) is sent with each request. */
export const MAX_MEMORY = 100_000;
/** How long one model turn may take (ms) before the run stops; a request the API never answers would otherwise hang the run. */
export const TURN_TIMEOUT = 180_000;

/** The turn limit from the environment (TYKERF_TURN_TIMEOUT, in seconds), or the default. */
export const turnTimeout = (env: NodeJS.ProcessEnv) => Number(env.TYKERF_TURN_TIMEOUT) * 1000 || TURN_TIMEOUT;

/** How long to wait before each new try of a turn that failed for a passing reason (a timeout, a busy or unreachable API). */
export const RETRY_WAITS = [10_000, 30_000, 90_000];
/** The waits from the environment (TYKERF_RETRY_WAITS, seconds separated by commas; "0" or "" = no retries), or the default. */
export function retryWaits(env: NodeJS.ProcessEnv): number[] {
  const raw = env.TYKERF_RETRY_WAITS;
  if (raw === undefined) return RETRY_WAITS;
  return raw.split(',').map((x) => Number(x.trim()) * 1000).filter((ms) => ms > 0);
}
/** The longest wait a service may ask for (Retry-After) that is honoured; past it, the run stops and continues later. */
const MAX_WAIT = 120_000;

/** What the model is told it said when a run stopped before it finished: the conversation stays valid, and it knows. */
export const STOPPED_HERE = '(I was stopped here, before I finished the request.)';

/** A run that stopped, with why: the editor continues it on its own when the reason passes (ai.ts). */
class Stop extends Error {
  constructor(message: string, readonly reason: StopReason) {
    super(message);
  }
}

/** Wait, unless the run is stopped meanwhile. */
const pause = (ms: number, signal: AbortSignal) => new Promise<void>((ok, fail) => {
  if (signal.aborted) return fail(new DOMException('stopped', 'AbortError'));
  const timer = setTimeout(() => (signal.removeEventListener('abort', off), ok()), ms);
  const off = () => (clearTimeout(timer), fail(new DOMException('stopped', 'AbortError')));
  signal.addEventListener('abort', off, { once: true });
});

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
  /** `garbled`: the words are not a reply (the provider can tell: see gemini.ts), so the loop asks for the turn again. */
  turn(history: M[], system: string, tools: ToolDef[], signal: AbortSignal): Promise<{ message: M; calls: Call[]; text: string; cut?: boolean; garbled?: boolean }>;
  /** The user's request, with the pictures they attached. */
  user(prompt: string, images: Attachment[]): M;
  /** The messages that give the tools' answers back to the model. */
  results(calls: Call[], outputs: ToolOutput[]): M[];
  /**
   * A message as the conversation keeps it for later requests: without its pictures (the model has seen them),
   * and without what only the request that made it needs (Gemini's thought signatures).
   */
  kept(m: M): M;
  /** A readable message for a failed request (wrong key, rate limit, no network). */
  error(e: unknown): string;
  /** Whether a failed request may work if tried again (busy, rate-limited, unreachable): null when it won't (a refused key, an unknown model); `wait` is what the service asked for (ms). */
  retry(e: unknown): { wait?: number } | null;
  /** A message in the model's own voice (used to close a conversation that was stopped). */
  assistant(text: string): M;
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

export function runLoop<M>(runner: string, wire: Wire<M>, req: RunRequest, on: RunEvents, limit = TURN_TIMEOUT, waits = RETRY_WAITS): { cancel(): void } {
  const abort = new AbortController();
  (async () => {
    let tools: Tools | null = null;
    // what has been said so far, kept whatever ends the run: a run stopped half-way is continued knowing what it did
    let keepSoFar: (() => void) | null = null;
    try {
      tools = await openTools(req.ws, req.scope, req.home, { tag: req.tag, mark: req.mark, readOnly: req.readOnly, sharedOk: req.sharedOk });
      const saved = req.memory.load() as Memory<M> | null;
      const past = saved?.runner === runner ? saved.exchanges : [];
      const now: M[] = [wire.user(req.prompt, req.images)];
      const save = (exchange: M[]) => req.memory.save({ runner, exchanges: trim([...past, exchange.map((m) => wire.kept(m))]) } satisfies Memory<M>);
      const keep = () => save(now);
      // up to the last whole round (never calls without their results), closed by the model saying it was stopped
      let whole = now.length;
      keepSoFar = () => save([...now.slice(0, whole), wire.assistant(STOPPED_HERE)]);
      keepSoFar();
      let steps = 0, garbled = 0;
      for (;;) {
        const r = await turn(wire, [...past.flat(), ...now], req.system, tools.list, abort.signal, limit, waits, on);
        // a final reply that is not an answer (too long, or garbled) is not kept; the turn is asked again. After
        // that, a short one is taken as it is, and a long one gives way to GARBLED
        const long = r.text.length > ANSWER_MAX;
        if (!r.calls.length && (long || r.garbled)) {
          if (garbled++ < GARBLED_TRIES) {
            on.retry?.(`the model's reply came out garbled${long ? ` (${r.text.length} characters)` : ''}; asking again (${garbled} of ${GARBLED_TRIES})`);
            continue;
          }
          if (long) {
            now.push(wire.assistant(GARBLED));
            keep();
            keepSoFar = null;
            on.answer(GARBLED);
            break;
          }
        }
        now.push(r.message);
        if (!r.calls.length) {
          keep();
          keepSoFar = null;
          on.answer(r.text.trim() || '(done)');
          break;
        }
        if (steps + r.calls.length > MAX_STEPS) {
          // the conversation must not end on calls without results: keep it up to the last answer
          now.pop();
          throw new Stop(`stopped after ${steps} steps; ask again to continue`, 'limit');
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
        whole = now.length;
        keepSoFar();
      }
    } catch (e) {
      keepSoFar?.();
      if (abort.signal.aborted) on.error('stopped', 'stopped');
      else if (e instanceof Stop) on.error(e.message, e.reason);
      else on.error(wire.error(e), wire.retry(e) ? 'transient' : 'permanent');
    } finally {
      await tools?.close().catch(() => {});
      on.end();
    }
  })();
  return { cancel: () => abort.abort() };
}

/**
 * One model turn, tried again after a wait when it fails for a passing reason (no answer in time, a busy or
 * rate-limited service, no connection): each new try is said in the conversation, so people see why it waits.
 */
async function turn<M>(wire: Wire<M>, history: M[], system: string, tools: ToolDef[], stop: AbortSignal, limit: number, waits: number[], on: RunEvents) {
  for (let tried = 0; ; tried++) {
    const late = AbortSignal.timeout(limit);
    try {
      return await wire.turn(history, system, tools, AbortSignal.any([stop, late]));
    } catch (e) {
      if (stop.aborted) throw e;
      const slow = late.aborted;
      const again = slow ? {} : wire.retry(e);
      if (!again) throw e;
      if (tried >= waits.length) throw slow ? new Stop(timedOut(limit), 'timeout') : new Stop(wire.error(e), 'transient');
      const wait = Math.min(Math.max(waits[tried], again.wait ?? 0), MAX_WAIT);
      on.retry?.(`${slow ? 'the model did not answer in time' : wire.error(e)}; trying again in ${Math.round(wait / 1000)} s (${tried + 1} of ${waits.length})`);
      await pause(wait, stop);
    }
  }
}
