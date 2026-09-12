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

const SYSTEM_BASE = `You are the SYNTHESIS agent.

You have received:
- state.query — the user's question.
- state.claims — atomic factual claims with sourceIds + confidence.
- retrieved evidence chunks (below).

You MUST:
1. Compose a concise markdown answer (200-500 words) that directly answers state.query.
2. Every non-trivial sentence must reference an [n] citation.
3. Build the citations array by assigning n=1..N to the distinct URLs you cite, using state.sources for url + title.
4. Do NOT introduce facts absent from state.claims or the retrieved chunks.
5. Call \`submitAnswer\` exactly once with the answer + citations. This is the ONLY way to finish.

If claims/evidence are thin, be honest about limitations. Never fabricate citations.`;

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
    system: SYSTEM_BASE,
    model: openai({
      model: env.MODEL_NAME,
      apiKey: 'ollama',
      baseUrl: `${env.OLLAMA_BASE_URL.replace(/\/+$/, '')}/v1`,
      defaultParameters: { max_tokens: env.MAX_TOKENS_PER_CALL, temperature: 0.2 },
    }),
    tools: [createSubmitAnswerTool({ budget: deps.budget, jobId: deps.jobId, state: deps.state })],
  });
}
