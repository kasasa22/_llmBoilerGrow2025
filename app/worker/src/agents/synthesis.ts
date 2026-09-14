/**
 * SynthesisAgent — terminal phase. Reads state.claims + retrieved RAG
 * chunks and produces the final markdown answer with [n] citations.
 * Calling `submitAnswer` is the ONLY clean exit.
 */
import { createAgent, openai } from '@inngest/agent-kit';

import type { BudgetTracker } from '../budget.js';
import { env } from '../config.js';
import { Phase } from '../events.js';
import { publishEvent } from '../redis.js';
import type { EvidenceStore } from '../rag/retriever.js';
import { createSubmitAnswerTool } from '../tools/submitAnswer.js';
import type { NetworkState } from '../state.js';

function buildSynthesisSystem(query: string, sourceCount: number): string {
  const isComparison = /\b(compare|comparison|vs\.?|versus|difference between|differences between)\b/i.test(query);
  return `You are the SYNTHESIS agent. Your ONLY output is a single \`submitAnswer\` tool call. Today is ${new Date().toISOString().slice(0, 10)}.

QUESTION: ${query}
SOURCES AVAILABLE: ${sourceCount}

You MUST:
1. Read the RETRIEVED EVIDENCE CHUNKS below carefully — those chunks ARE the source of truth. Even with zero extracted claims, the chunks contain enough content to answer.
2. Write a clear markdown answer (200-500 words) that directly answers the question.
3. Cite sources inline with [n], where n=1..N maps to entries in the SOURCES section below.
4. ${isComparison ? 'This is a COMPARISON question — use a markdown table with columns for each side, or explicit "X does A, Y does B" contrasts.' : 'Prefer short headings + bullet points for scannability.'}
5. Call \`submitAnswer\` exactly once with:
   - \`answer\`: the full markdown text you wrote (not a summary — the full thing)
   - \`citations\`: array of {n, url, title} for each source you cited
6. Never emit prose outside the tool call. If you cannot answer, still submit a short answer explaining what's missing — do NOT stay silent.
7. Never invent URLs. Only cite URLs from the SOURCES section below.`;
}

export interface SynthesisAgentDeps {
  budget: BudgetTracker;
  jobId: string;
  state: NetworkState;
  evidence: EvidenceStore;
}

export async function primeSynthesisContext(deps: SynthesisAgentDeps): Promise<string> {
  await publishEvent({
    jobId: deps.jobId,
    phase: Phase.SynthesisStarted,
    data: { claimCount: deps.state.claims.length, sourceCount: deps.state.sources.length },
  });

  const results = await deps.evidence.topK(deps.state.query, env.RAG_TOP_K);
  await publishEvent({
    jobId: deps.jobId,
    phase: Phase.RagRetrieved,
    data: {
      agent: 'SynthesisAgent',
      k: results.length,
      topScore: results[0]?.score ?? 0,
      minScore: env.RAG_MIN_SIMILARITY,
    },
  });

  const bySource = new Map(deps.state.sources.map((s) => [s.id, s]));
  const chunks = results
    .map((r, i) => {
      const src = bySource.get(r.chunk.sourceId);
      const title = src?.title || src?.url || r.chunk.sourceId;
      return `[chunk ${i + 1}] source_id=${r.chunk.sourceId} (${title}) score=${r.score.toFixed(3)}\n${r.chunk.text}`;
    })
    .join('\n\n');

  const claimsBlock = deps.state.claims
    .map((c) => `- (${c.id}, conf=${c.confidence.toFixed(2)}, sources=${c.sourceIds.join(',')}): ${c.text}`)
    .join('\n');

  const sourcesBlock = deps.state.sources.map((s) => `- ${s.id} | ${s.title} | ${s.url}`).join('\n');

  return `# QUESTION
${deps.state.query}

# CLAIMS (extracted by AnalysisAgent)
${claimsBlock || '(none — synthesize cautiously)'}

# SOURCES (available for citations)
${sourcesBlock || '(none)'}

# RETRIEVED EVIDENCE CHUNKS
${chunks || '(none — no matches above the similarity threshold)'}`;
}

export function createSynthesisAgent(deps: SynthesisAgentDeps) {
  return createAgent({
    name: 'SynthesisAgent',
    description: 'Writes the final markdown answer with citations.',
    system: () => buildSynthesisSystem(deps.state.query, deps.state.sources.length),
    model: openai({
      model: env.MODEL_NAME,
      apiKey: 'ollama',
      baseUrl: `${env.OLLAMA_BASE_URL.replace(/\/+$/, '')}/v1`,
      defaultParameters: { max_completion_tokens: env.MAX_TOKENS_PER_CALL, temperature: 0.2 },
    }),
    tools: [createSubmitAnswerTool({ budget: deps.budget, jobId: deps.jobId, state: deps.state })],
  });
}
