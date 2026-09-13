export type Phase =
  | 'job.started'
  | 'queued'
  | 'step.started'
  | 'step.completed'
  | 'agent.transition'
  | 'agent.thought'
  | 'tool.called'
  | 'tool.result'
  | 'tool.error'
  | 'research.source_found'
  | 'research.search_completed'
  | 'analysis.claim_extracted'
  | 'analysis.source_scored'
  | 'synthesis.started'
  | 'synthesis.answer_ready'
  | 'rag.chunks_indexed'
  | 'rag.retrieved'
  | 'rag.circuit_open'
  | 'citation.added'
  | 'citation'
  | 'budget.hit'
  | 'final'
  | 'error'
  | 'network.error'
  | 'done';

export interface Citation {
  n: number;
  url: string;
  title: string;
}

export interface EventEnvelopeBase<P extends Phase, D> {
  seq: number;
  phase: P;
  trace_id: string;
  job_id: string;
  span_id: string | null;
  parent_span_id: string | null;
  ts: string;
  data: D;
}

export interface JobStartedData { query: string }
export interface QueuedData { position?: number }
export interface StepStartedData { step_id: string; agent?: string }
export interface StepCompletedData { step_id: string; ms?: number }
export interface AgentTransitionData { from: string; to: string; iteration: number }
export interface AgentThoughtData { agent: string; text: string }
export interface ToolCalledData { tool: string; args?: Record<string, unknown> }
export interface ToolResultData {
  tool: string;
  summary?: string;
  results?: Array<{ title: string; url: string }>;
  sourceId?: string;
  url?: string;
}
export interface ToolErrorData { tool: string; code: string; message: string; url?: string }
export interface ResearchSourceFoundData { sourceId: string; url: string; title: string }
export interface ResearchSearchCompletedData { query: string; resultCount: number }
export interface AnalysisClaimExtractedData {
  claimId: string;
  text: string;
  confidence: number;
  sourceIds: string[];
}
export interface AnalysisSourceScoredData { sourceId: string; score: number }
export interface SynthesisStartedData { claimCount: number; sourceCount: number }
export interface SynthesisAnswerReadyData { length: number; citationCount: number }
export interface RagChunksIndexedData { sourceId: string; chunkCount: number; embedded: boolean }
export interface RagRetrievedData { agent: string; k: number; topScore: number; minScore: number }
export interface RagCircuitOpenData { reason: string }
export interface CitationAddedData extends Citation { title: string }
export interface BudgetHitData { limit: string; observed?: number }
export interface FinalData {
  answer: string | null;
  citations: Citation[];
  partial?: boolean;
  errors?: Array<{ agent: string; msg: string; at: string }>;
}
export interface ErrorData {
  code: string;
  message: string;
  retryable?: boolean;
  context?: Record<string, unknown>;
}
export interface DoneData { state?: string; reason?: string }

export type SseEvent =
  | EventEnvelopeBase<'job.started', JobStartedData>
  | EventEnvelopeBase<'queued', QueuedData>
  | EventEnvelopeBase<'step.started', StepStartedData>
  | EventEnvelopeBase<'step.completed', StepCompletedData>
  | EventEnvelopeBase<'agent.transition', AgentTransitionData>
  | EventEnvelopeBase<'agent.thought', AgentThoughtData>
  | EventEnvelopeBase<'tool.called', ToolCalledData>
  | EventEnvelopeBase<'tool.result', ToolResultData>
  | EventEnvelopeBase<'tool.error', ToolErrorData>
  | EventEnvelopeBase<'research.source_found', ResearchSourceFoundData>
  | EventEnvelopeBase<'research.search_completed', ResearchSearchCompletedData>
  | EventEnvelopeBase<'analysis.claim_extracted', AnalysisClaimExtractedData>
  | EventEnvelopeBase<'analysis.source_scored', AnalysisSourceScoredData>
  | EventEnvelopeBase<'synthesis.started', SynthesisStartedData>
  | EventEnvelopeBase<'synthesis.answer_ready', SynthesisAnswerReadyData>
  | EventEnvelopeBase<'rag.chunks_indexed', RagChunksIndexedData>
  | EventEnvelopeBase<'rag.retrieved', RagRetrievedData>
  | EventEnvelopeBase<'rag.circuit_open', RagCircuitOpenData>
  | EventEnvelopeBase<'citation.added', CitationAddedData>
  | EventEnvelopeBase<'citation', CitationAddedData>
  | EventEnvelopeBase<'budget.hit', BudgetHitData>
  | EventEnvelopeBase<'final', FinalData>
  | EventEnvelopeBase<'error', ErrorData>
  | EventEnvelopeBase<'network.error', ErrorData>
  | EventEnvelopeBase<'done', DoneData>;

export interface PostChatResponse {
  job_id: string;
  stream_url: string;
  status_url: string;
  idempotent: boolean;
}

export interface PostChatErrorResponse {
  error: string;
  message: string;
}
