import { createAgent, openai } from '@inngest/agent-kit';

import type { BudgetTracker } from '../budget.js';
import { env } from '../config.js';
import { isComparisonQuery } from '../query.js';
import { createSubmitAnswerTool } from '../tools/submitAnswer.js';
import type { NetworkState } from '../state.js';

export interface SynthesisContext {
  evidence: string;
}

export interface SynthesisAgentDeps {
  budget: BudgetTracker;
  jobId: string;
  state: NetworkState;
  context: SynthesisContext;
}

export function buildSynthesisSystem(query: string, evidence: string): string {
  const comparison = isComparisonQuery(query);
  return `You are the SYNTHESIS agent. Your ONLY output is a single \`submitAnswer\` tool call. Today is ${new Date().toISOString().slice(0, 10)}.

QUESTION: ${query}

You MUST:
1. Read the EVIDENCE below carefully; it is the source of truth.
2. Write a clear markdown answer (150-350 words) that directly answers the question.
3. Cite sources inline with [n], where n is the source number in SOURCES.
4. ${comparison ? 'This is a COMPARISON question: use a markdown table with one column per side, then a short "Which to choose" section.' : 'Prefer short headings and bullet points for scannability.'}
5. Call \`submitAnswer\` exactly once with:
   - \`answer\`: the full markdown text you wrote
   - \`citations\`: array of {n, url, title} for each source you cited, copied from SOURCES
6. Never emit prose outside the tool call. If you cannot answer, still submit a short answer explaining what is missing.
7. Never invent URLs. Only cite URLs from SOURCES.

${evidence || 'SOURCES:\n(none)\n\nEVIDENCE:\n(none)'}`;
}

export function createSynthesisAgent(deps: SynthesisAgentDeps) {
  return createAgent({
    name: 'SynthesisAgent',
    description: 'Writes the final markdown answer with citations.',
    system: () => buildSynthesisSystem(deps.state.query, deps.context.evidence),
    model: openai({
      model: env.MODEL_NAME,
      apiKey: 'ollama',
      baseUrl: `${env.OLLAMA_BASE_URL.replace(/\/+$/, '')}/v1`,
      defaultParameters: { max_completion_tokens: env.MAX_TOKENS_PER_CALL, temperature: 0.2 },
    }),
    tools: [createSubmitAnswerTool({ budget: deps.budget, jobId: deps.jobId, state: deps.state })],
  });
}
