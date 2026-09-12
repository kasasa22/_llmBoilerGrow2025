/**
 * ResearchAgent — first phase. Gathers primary sources via webSearch +
 * fetchUrl. Never analyses; router advances it to Analysis when sources +
 * evidence thresholds are met.
 */
import { createAgent, openai } from '@inngest/agent-kit';

import { env } from '../config.js';
import { createFetchUrlTool } from '../tools/fetchUrl.js';
import { createWebSearchTool } from '../tools/webSearch.js';
import type { BudgetTracker } from '../budget.js';
import type { EvidenceStore } from '../rag/retriever.js';
import type { NetworkState } from '../state.js';

const SYSTEM = `You are the RESEARCH agent in a multi-agent research pipeline.

Your ONLY job is to gather primary sources for the user's question. You must:
1. Read state.query and think briefly about what sub-questions matter.
2. Call \`webSearch\` for each distinct sub-question. Prefer 2-3 focused queries.
3. Call \`fetchUrl\` on the 3-5 most promising results. Prefer official docs, primary reporting, .gov, .edu.
4. Skip URLs already present in state.sources (the tool short-circuits).
5. Do NOT synthesize, analyse, or answer. Do NOT call submitAnswer.

Stop as soon as state.sources.length >= ${env.NETWORK_MIN_SOURCES} AND rawEvidence covers the question — the router will hand off to Analysis.

If a fetch returns FETCH_BLOCKED, pick a different source; never retry the same URL.`;

export interface ResearchAgentDeps {
  budget: BudgetTracker;
  jobId: string;
  evidence: EvidenceStore;
  state: NetworkState;
  signal: AbortSignal;
}

export function createResearchAgent(deps: ResearchAgentDeps) {
  return createAgent({
    name: 'ResearchAgent',
    description: 'Finds primary sources via web search and URL fetch.',
    system: SYSTEM,
    model: openai({
      model: env.MODEL_NAME,
      apiKey: 'ollama',
      baseUrl: `${env.OLLAMA_BASE_URL.replace(/\/+$/, '')}/v1`,
      defaultParameters: { max_tokens: env.MAX_TOKENS_PER_CALL, temperature: 0.2 },
    }),
    tools: [
      createWebSearchTool({ budget: deps.budget, jobId: deps.jobId, signal: deps.signal }),
      createFetchUrlTool({
        budget: deps.budget,
        jobId: deps.jobId,
        evidence: deps.evidence,
        state: deps.state,
        signal: deps.signal,
      }),
    ],
  });
}
