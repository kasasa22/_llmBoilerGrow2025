import { createAgent, openai } from '@inngest/agent-kit';

import type { BudgetTracker } from '../budget.js';
import { env } from '../config.js';
import { requiredSources } from '../query.js';
import { createFetchUrlTool } from '../tools/fetchUrl.js';
import { createWebSearchTool } from '../tools/webSearch.js';
import type { EvidenceStore } from '../rag/retriever.js';
import type { NetworkState } from '../state.js';

export interface ResearchAgentDeps {
  budget: BudgetTracker;
  jobId: string;
  evidence: EvidenceStore;
  state: NetworkState;
  signal: AbortSignal;
}

const RESEARCH_RULES = `You are the RESEARCH agent in a two-stage pipeline (Research -> Synthesis). You gather sources; you never write the answer.

RULES
1. Only fetchUrl produces evidence. Always follow a search with a fetch.
2. Only fetch URLs that appeared in a webSearch result in this run. Never guess a URL.
3. Prefer official docs or the project's own site, then primary reporting, .gov, .edu. Skip forums, SEO listicles and aggregators. One fetch per domain.
4. For comparison questions fetch one source per side.
5. Emit exactly one tool call per turn and no other text. When the goal is met or a budget is 0, reply with the single word DONE.
6. If a fetch fails (FETCH_BLOCKED, FETCH_TIMEOUT, FETCH_EMPTY), pick a different URL from the same results. If a search returns 0 results and a search is left, retry once with a shorter query; otherwise reply DONE.`;

export function buildResearchSystem(deps: ResearchAgentDeps): string {
  const snap = deps.budget.snapshot();
  const fetched = deps.state.sources.map((s) => s.url);
  const searchesLeft = Math.max(0, env.MAX_SEARCH_QUERIES - snap.searches);
  const fetchesLeft = Math.max(0, env.MAX_FETCHES - snap.fetches);
  const target = requiredSources(deps.state.query, {
    minSources: env.NETWORK_MIN_SOURCES,
    maxFetches: env.MAX_FETCHES,
  });

  return `${RESEARCH_RULES}

GOAL: collect ${target} good source(s) for the question, then stop.
QUESTION: ${deps.state.query}
BUDGET: webSearch calls left ${searchesLeft}; fetchUrl calls left ${fetchesLeft}.
ALREADY FETCHED (do not fetch again): ${fetched.length ? fetched.join(', ') : 'none'}`;
}

export function createResearchAgent(deps: ResearchAgentDeps) {
  return createAgent({
    name: 'ResearchAgent',
    description: 'Finds primary sources via web search and URL fetch.',
    system: () => buildResearchSystem(deps),
    model: openai({
      model: env.MODEL_NAME,
      apiKey: 'ollama',
      baseUrl: `${env.OLLAMA_BASE_URL.replace(/\/+$/, '')}/v1`,
      defaultParameters: { max_completion_tokens: env.MAX_TOKENS_PER_CALL, temperature: 0.2 },
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
