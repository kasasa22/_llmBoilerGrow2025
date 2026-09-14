/**
 * Pure router logic for the multi-agent Network.
 *
 * Extracted from network.ts so tests can drive it with synthetic NetworkState
 * without spinning up real agents. See tests/router.test.ts.
 *
 * See plan A1 ("Multi-agent AgentKit Network") for the transition table.
 */
import type { NetworkState } from './state.js';

export type Phase = NetworkState['phase'];

export type NextPhase = Phase | 'done';

export interface RouterConfig {
  minSources: number;
  minEvidence: number;
  minClaims: number;
  maxAnalysisIters: number;
  maxCalls: number;
  skipAnalysis: boolean;
  skipSynthesis: boolean;
}

export interface RouterInputs {
  state: NetworkState;
  callCount: number;
  wallClockExhausted: boolean;
  aborted: boolean;
  config: RouterConfig;
}

export type RouterDecision =
  | { next: NextPhase; advanced: boolean }
  | {
      next: 'done';
      advanced: true;
      reason: 'wall_clock' | 'aborted' | 'call_budget' | 'errors' | 'finalAnswer' | 'skip_synthesis';
    };

/**
 * Given the current state, return the next phase the router should hand off to
 * (or 'done' to terminate). The boolean `advanced` is true when the phase
 * changed vs `state.phase` — the caller then resets iteration and publishes an
 * `agent.transition` Redis event.
 *
 * PURE — does NOT mutate `state`. The network.ts wrapper applies the decision.
 */
export function decideNextPhase(inputs: RouterInputs): RouterDecision {
  const { state, callCount, wallClockExhausted, aborted, config } = inputs;

  if (state.phase === 'done' || state.finalAnswer) {
    return { next: 'done', advanced: true, reason: 'finalAnswer' };
  }
  if (aborted) {
    return { next: 'done', advanced: true, reason: 'aborted' };
  }
  if (wallClockExhausted) {
    return { next: 'done', advanced: true, reason: 'wall_clock' };
  }
  if (callCount >= config.maxCalls) {
    return { next: 'done', advanced: true, reason: 'call_budget' };
  }
  if (state.errors.length >= 3) {
    return { next: 'done', advanced: true, reason: 'errors' };
  }

  if (state.phase === 'research') {
    const ready =
      state.sources.length >= config.minSources && state.rawEvidence.length >= config.minEvidence;
    if (!ready) return { next: 'research', advanced: false };
    if (config.skipSynthesis) {
      return { next: 'done', advanced: true, reason: 'skip_synthesis' };
    }
    return { next: config.skipAnalysis ? 'synthesis' : 'analysis', advanced: true };
  }

  if (state.phase === 'analysis') {
    const enough =
      state.claims.length >= config.minClaims || state.iteration >= config.maxAnalysisIters;
    if (!enough) return { next: 'analysis', advanced: false };
    return { next: 'synthesis', advanced: true };
  }

  if (state.phase === 'synthesis') {
    // Once inside synthesis, only `submitAnswer` can set state.finalAnswer.
    return { next: 'synthesis', advanced: false };
  }

  return { next: 'done', advanced: true, reason: 'errors' };
}
