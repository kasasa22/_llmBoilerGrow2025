/**
 * The three-agent Network + hybrid router.
 *
 * Router (deterministic phase gate + agent-driven within phase):
 *   research -> analysis   when sources >= NETWORK_MIN_SOURCES && rawEvidence >= NETWORK_MIN_EVIDENCE
 *   analysis -> synthesis  when claims >= NETWORK_MIN_CLAIMS || iteration >= NETWORK_MAX_ANALYSIS_ITERS
 *   synthesis -> done      when state.finalAnswer is set
 *
 * Termination guarantees (any of these ends the run):
 *   - phase === 'done'
 *   - callCount >= NETWORK_MAX_CALLS
 *   - wall-clock exceeded (AbortSignal from the caller)
 *   - state.errors.length >= 3
 */
import { createNetwork } from '@inngest/agent-kit';

import type { BudgetTracker } from './budget.js';
import { env } from './config.js';
import { Phase } from './events.js';
import type { EvidenceStore } from './rag/retriever.js';
import { publishEvent } from './redis.js';
import type { NetworkState } from './state.js';
import { createAnalysisAgent } from './agents/analysis.js';
import { createResearchAgent } from './agents/research.js';
import { createSynthesisAgent } from './agents/synthesis.js';

export interface NetworkDeps {
  budget: BudgetTracker;
  jobId: string;
  state: NetworkState;
  evidence: EvidenceStore;
  signal: AbortSignal;
}

export function buildResearchNetwork(deps: NetworkDeps) {
  const research = createResearchAgent({
    budget: deps.budget,
    jobId: deps.jobId,
    evidence: deps.evidence,
    state: deps.state,
    signal: deps.signal,
  });
  const analysis = createAnalysisAgent({ budget: deps.budget, jobId: deps.jobId, state: deps.state });
  const synthesis = createSynthesisAgent({
    budget: deps.budget,
    jobId: deps.jobId,
    state: deps.state,
    evidence: deps.evidence,
  });

  return createNetwork({
    name: 'ResearchNetwork',
    agents: [research, analysis, synthesis],
    defaultRouter: async ({ callCount }) => {
      const s = deps.state;

      if (s.phase === 'done' || s.finalAnswer) {
        s.phase = 'done';
        return undefined;
      }
      if (deps.signal.aborted || deps.budget.isWallClockExhausted()) {
        s.phase = 'done';
        return undefined;
      }
      if (callCount >= env.NETWORK_MAX_CALLS) {
        s.phase = 'done';
        return undefined;
      }
      if (s.errors.length >= 3) {
        s.phase = 'done';
        return undefined;
      }

      if (s.phase === 'research') {
        const ready =
          s.sources.length >= env.NETWORK_MIN_SOURCES && s.rawEvidence.length >= env.NETWORK_MIN_EVIDENCE;
        if (ready) {
          if (env.SKIP_ANALYSIS) {
            await advance(deps, 'research', 'synthesis');
            return synthesis;
          }
          await advance(deps, 'research', 'analysis');
          return analysis;
        }
        s.iteration += 1;
        return research;
      }

      if (s.phase === 'analysis') {
        const enough =
          s.claims.length >= env.NETWORK_MIN_CLAIMS || s.iteration >= env.NETWORK_MAX_ANALYSIS_ITERS;
        if (enough) {
          await advance(deps, 'analysis', 'synthesis');
          return synthesis;
        }
        s.iteration += 1;
        return analysis;
      }

      if (s.phase === 'synthesis') {
        if (s.finalAnswer) {
          s.phase = 'done';
          return undefined;
        }
        s.iteration += 1;
        return synthesis;
      }

      return undefined;
    },
  });
}

async function advance(
  deps: NetworkDeps,
  from: NetworkState['phase'],
  to: NetworkState['phase'],
): Promise<void> {
  deps.state.phase = to;
  deps.state.iteration = 0;
  await publishEvent({
    jobId: deps.jobId,
    phase: Phase.AgentTransition,
    data: { from, to, iteration: 0 },
  });
}
