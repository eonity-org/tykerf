// Which model answers in the editor's AI tab: TYKERF_RUNNER in the environment or .env.
//
//   claude-code (default)  the user's own Claude Code, logged in with their account (ai.ts)
//   anthropic              the Anthropic API, or any Anthropic-compatible endpoint (anthropic.ts)
//   gemini                 Google's Gemini API (gemini.ts)

import { ClaudeCodeRunner, type Runner } from '../ai.js';
import { AnthropicRunner } from './anthropic.js';
import { GeminiRunner } from './gemini.js';

export const RUNNERS = ['claude-code', 'anthropic', 'gemini'] as const;

export function runnerFromEnv(env: NodeJS.ProcessEnv = process.env): Runner {
  const name = (env.TYKERF_RUNNER || 'claude-code').trim().toLowerCase();
  if (name === 'claude-code' || name === 'claude') return new ClaudeCodeRunner();
  if (name === 'anthropic' || name === 'api') return new AnthropicRunner(env);
  if (name === 'gemini') return new GeminiRunner(env);
  throw new Error(`TYKERF_RUNNER="${env.TYKERF_RUNNER}" is not a runner TYKERF knows; use one of ${RUNNERS.join(', ')}`);
}
