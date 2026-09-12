/**
 * AnalysisAgent — second phase. Extracts atomic claims + rates source
 * credibility from evidence already in state. Never fetches new URLs.
 */
import { createAgent, openai } from '@inngest/agent-kit';

import type { BudgetTracker } from '../budget.js';
import { env } from '../config.js';
import { createExtractClaimTool } from '../tools/extractClaim.js';
import { createRateSourceCredibilityTool } from '../tools/rateSourceCredibility.js';
import type { NetworkState } from '../state.js';

const SYSTEM = `You are the ANALYSIS agent.

Given state.sources and state.rawEvidence, you must:
1. Read the evidence carefully.
2. Call \`rateSourceCredibility\` for each source (score 0..1 with a one-line reason).
3. Call \`extractClaim\` for every atomic factual claim needed to answer state.query.
   - One sentence per claim, present tense, no hedging.
   - Each claim MUST reference source_id(s) that back it, drawn from state.sources.
   - Prefer 3-8 well-supported claims over 20 shallow ones.
4. Do NOT fetch new URLs. Do NOT call submitAnswer. Do NOT write prose.

Stop when you have at least ${env.NETWORK_MIN_CLAIMS} claims — the router hands off to Synthesis.`;

export interface AnalysisAgentDeps {
  budget: BudgetTracker;
  jobId: string;
  state: NetworkState;
}

export function createAnalysisAgent(deps: AnalysisAgentDeps) {
  return createAgent({
    name: 'AnalysisAgent',
    description: 'Extracts atomic claims and scores source credibility.',
    system: SYSTEM,
    model: openai({
      model: env.MODEL_NAME,
      apiKey: 'ollama',
      baseUrl: `${env.OLLAMA_BASE_URL.replace(/\/+$/, '')}/v1`,
      defaultParameters: { max_completion_tokens: env.MAX_TOKENS_PER_CALL, temperature: 0.1 },
    }),
    tools: [
      createExtractClaimTool({ budget: deps.budget, jobId: deps.jobId, state: deps.state }),
      createRateSourceCredibilityTool({ budget: deps.budget, jobId: deps.jobId, state: deps.state }),
    ],
  });
}
