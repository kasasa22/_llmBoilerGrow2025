import { createAgent, openai } from '@inngest/agent-kit';

import type { BudgetTracker } from '../budget.js';
import { env } from '../config.js';
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

function isComparisonQuery(query: string): boolean {
  return /\b(compare|comparison|vs\.?|versus|difference between|differences between)\b/i.test(query);
}

function buildResearchSystem(deps: ResearchAgentDeps): string {
  const snap = deps.budget.snapshot();
  const fetched = deps.state.sources.map((s) => s.url);
  const searchesLeft = Math.max(0, env.MAX_SEARCH_QUERIES - snap.searches);
  const fetchesLeft = Math.max(0, env.MAX_FETCHES - snap.fetches);
  const isComparison = isComparisonQuery(deps.state.query);
  const target = isComparison
    ? Math.min(2, env.MAX_FETCHES)
    : env.NETWORK_MIN_SOURCES;

  return `You are the RESEARCH agent in a pipeline: Research -> Synthesis. Today is ${new Date().toISOString().slice(0, 10)}.

GOAL: collect ${target} good source(s) for the question below, then stop. You do not write the answer.

QUESTION: ${deps.state.query}

BUDGET (hard limits enforced by the runtime; exceeding them ends the run):
- webSearch calls left: ${searchesLeft}
- fetchUrl calls left: ${fetchesLeft}
Already fetched, do not fetch again: ${fetched.length ? fetched.join(', ') : 'none'}

RULES
1. Only fetchUrl produces evidence. A search alone does not move the pipeline forward; always follow a search with a fetch.
2. Only fetch URLs that appeared in a webSearch result in this run. Never invent or guess a URL.
3. Rank results: official docs or project site > primary reporting, .gov, .edu > everything else. Skip forums, SEO listicles, and aggregators. One fetch per domain unless the budget allows more.
4. For comparison questions, fetch one source per side before stopping.
5. Emit exactly one tool call per turn and no other text. When the goal is met or the budget is exhausted, reply with the single word DONE.
6. Never call submitAnswer and never summarise or answer the question. That is the Synthesis agent's job.

TOOL ERRORS
- FETCH_BLOCKED, FETCH_TIMEOUT, FETCH_EMPTY: pick a different URL from the same search results. Never retry the same URL.
- webSearch returned 0 results: if a search is left, retry once with a shorter, more literal query; otherwise reply DONE.`;
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
