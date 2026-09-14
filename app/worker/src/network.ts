import { createNetwork } from '@inngest/agent-kit';

import type { BudgetTracker } from './budget.js';
import { env } from './config.js';
import { Phase } from './events.js';
import { requiredSources } from './query.js';
import type { EvidenceStore } from './rag/retriever.js';
import { publishEvent } from './redis.js';
import { decideNextPhase, type RouterConfig } from './router.js';
import type { NetworkState } from './state.js';
import { buildEvidenceBlock } from './synthesize.js';
import { createAnalysisAgent } from './agents/analysis.js';
import { createResearchAgent } from './agents/research.js';
import { type SynthesisContext, createSynthesisAgent } from './agents/synthesis.js';

export interface NetworkDeps {
  budget: BudgetTracker;
  jobId: string;
  state: NetworkState;
  evidence: EvidenceStore;
  signal: AbortSignal;
}

export function routerConfigFor(query: string): RouterConfig {
  return {
    minSources: requiredSources(query, { minSources: env.NETWORK_MIN_SOURCES, maxFetches: env.MAX_FETCHES }),
    minEvidence: env.NETWORK_MIN_EVIDENCE,
    minClaims: env.NETWORK_MIN_CLAIMS,
    maxAnalysisIters: env.NETWORK_MAX_ANALYSIS_ITERS,
    maxCalls: env.NETWORK_MAX_CALLS,
    skipAnalysis: env.SKIP_ANALYSIS,
    skipSynthesis: env.SKIP_SYNTHESIS_AGENT,
  };
}

export function buildResearchNetwork(deps: NetworkDeps) {
  const routerConfig = routerConfigFor(deps.state.query);
  const synthesisContext: SynthesisContext = { evidence: '' };

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
    context: synthesisContext,
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
        if (decision.next === 'synthesis') {
          synthesisContext.evidence = await primeSynthesisEvidence(deps);
        }
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

async function primeSynthesisEvidence(deps: NetworkDeps): Promise<string> {
  const chunks = await deps.evidence.topK(deps.state.query, env.RAG_TOP_K);
  await publishEvent({
    jobId: deps.jobId,
    phase: Phase.RagRetrieved,
    data: { agent: 'SynthesisAgent', k: chunks.length, topScore: chunks[0]?.score ?? 0, minScore: env.RAG_MIN_SIMILARITY },
  });
  return buildEvidenceBlock({
    query: deps.state.query,
    sources: deps.state.sources,
    chunks,
    claims: deps.state.claims,
  });
}
