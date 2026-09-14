/**
 * Composes the three agents (Research → Analysis → Synthesis) into an
 * AgentKit Network. Routing logic itself lives in `router.ts` as a pure
 * function so it can be tested without spinning up real agents.
 *
 * Termination guarantees are enforced by `decideNextPhase`:
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
import { decideNextPhase, type RouterConfig } from './router.js';
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

const routerConfig: RouterConfig = {
  minSources: env.NETWORK_MIN_SOURCES,
  minEvidence: env.NETWORK_MIN_EVIDENCE,
  minClaims: env.NETWORK_MIN_CLAIMS,
  maxAnalysisIters: env.NETWORK_MAX_ANALYSIS_ITERS,
  maxCalls: env.NETWORK_MAX_CALLS,
  skipAnalysis: env.SKIP_ANALYSIS,
  skipSynthesis: env.SKIP_SYNTHESIS_AGENT,
};

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
      const state = deps.state;
      const decision = decideNextPhase({
        state,
        callCount,
        wallClockExhausted: deps.budget.isWallClockExhausted(),
        aborted: deps.signal.aborted,
        config: routerConfig,
      });

      if (decision.next === 'done') {
        state.phase = 'done';
        return undefined;
      }

      if (decision.advanced && decision.next !== state.phase) {
        const from = state.phase;
        state.phase = decision.next;
        state.iteration = 0;
        await publishEvent({
          jobId: deps.jobId,
          phase: Phase.AgentTransition,
          data: { from, to: decision.next, iteration: 0 },
        });
      } else {
        state.iteration += 1;
      }

      switch (decision.next) {
        case 'research':
          return research;
        case 'analysis':
          return analysis;
        case 'synthesis':
          return synthesis;
        default:
          return undefined;
      }
    },
  });
}
