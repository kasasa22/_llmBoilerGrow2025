export const RESEARCH_QUERY_SUBMITTED = 'research/query.submitted';

/** Redis pub/sub envelope phases. Keep string values stable. */
export const Phase = {
  JobStarted: 'job.started',
  StepStarted: 'step.started',
  StepCompleted: 'step.completed',
  AgentTransition: 'agent.transition',
  AgentThought: 'agent.thought',
  ToolCalled: 'tool.called',
  ToolResult: 'tool.result',
  ToolError: 'tool.error',
  ResearchSourceFound: 'research.source_found',
  ResearchSearchCompleted: 'research.search_completed',
  AnalysisClaimExtracted: 'analysis.claim_extracted',
  AnalysisSourceScored: 'analysis.source_scored',
  SynthesisStarted: 'synthesis.started',
  SynthesisAnswerReady: 'synthesis.answer_ready',
  RagChunksIndexed: 'rag.chunks_indexed',
  RagRetrieved: 'rag.retrieved',
  RagCircuitOpen: 'rag.circuit_open',
  CitationAdded: 'citation.added',
  BudgetHit: 'budget.hit',
  Final: 'final',
  Error: 'error',
  NetworkError: 'network.error',
  Done: 'done',
} as const;

export type Phase = (typeof Phase)[keyof typeof Phase];

/** Canonical envelope written to Redis and streamed as SSE. */
export interface EventEnvelope {
  seq?: number;
  phase: Phase | string;
  trace_id: string;
  job_id: string;
  span_id?: string | null;
  parent_span_id?: string | null;
  ts: string;
  data: Record<string, unknown>;
}
