'use client';

import type {
  AgentTransitionData,
  BudgetHitData,
  CitationAddedData,
  ErrorData,
  RagChunksIndexedData,
  RagCircuitOpenData,
  RagRetrievedData,
  ResearchSourceFoundData,
  SseEvent,
  ToolCalledData,
  ToolErrorData,
  ToolResultData,
} from '@/lib/events';
import { phaseToClass } from '@/lib/phases';

interface TimelineEventProps {
  event: SseEvent;
}

function summariseArgs(args: unknown): string {
  const s = JSON.stringify(args ?? {});
  return s.length > 120 ? s.slice(0, 117) + '...' : s;
}

function describeToolCalled(data: ToolCalledData): string {
  return `→ ${data.tool}${data.args ? ' ' + summariseArgs(data.args) : ''}`;
}

function describeToolResult(data: ToolResultData): string {
  return `← ${data.tool}${data.summary ? ': ' + data.summary : ' done'}`;
}

function describeToolError(data: ToolErrorData): string {
  return `× ${data.tool}: ${data.message ?? data.code ?? 'error'}`;
}

function describeAgentTransition(data: AgentTransitionData): string {
  return `${data.from} → ${data.to} (iteration ${data.iteration})`;
}

function describeSourceFound(data: ResearchSourceFoundData): string {
  return `${data.title || data.url}${data.url ? ' — ' + data.url : ''}`;
}

function describeCitation(data: CitationAddedData): string {
  return `[${data.n ?? '?'}] ${data.title || data.url || 'cited'}`;
}

function describeError(data: ErrorData): string {
  return `${data.code || 'ERROR'}: ${data.message || 'unknown'}`;
}

function describeBudget(data: BudgetHitData): string {
  return `Budget limit reached: ${data.limit}`;
}

function describeRagChunks(data: RagChunksIndexedData): string {
  return `Indexed ${data.chunkCount} chunks (${data.embedded ? 'embedded' : 'raw'})`;
}

function describeRagRetrieved(data: RagRetrievedData): string {
  return `Retrieved top-${data.k} (min score ${data.minScore})`;
}

function describeRagCircuit(data: RagCircuitOpenData): string {
  return `Embedder circuit open: ${data.reason}`;
}

function describe(event: SseEvent): string {
  switch (event.phase) {
    case 'tool.called':
      return describeToolCalled(event.data);
    case 'tool.result':
      return describeToolResult(event.data);
    case 'tool.error':
      return describeToolError(event.data);
    case 'agent.transition':
      return describeAgentTransition(event.data);
    case 'research.source_found':
      return describeSourceFound(event.data);
    case 'citation.added':
    case 'citation':
      return describeCitation(event.data);
    case 'error':
    case 'network.error':
      return describeError(event.data);
    case 'budget.hit':
      return describeBudget(event.data);
    case 'rag.chunks_indexed':
      return describeRagChunks(event.data);
    case 'rag.retrieved':
      return describeRagRetrieved(event.data);
    case 'rag.circuit_open':
      return describeRagCircuit(event.data);
    case 'final':
      return event.data.partial
        ? 'Partial answer (budget exhausted)'
        : 'Final answer ready.';
    case 'done':
      return 'Stream complete.';
    default:
      try {
        return JSON.stringify(event.data);
      } catch {
        return '';
      }
  }
}

export function TimelineEvent({ event }: TimelineEventProps) {
  return (
    <li className={phaseToClass(event.phase)}>
      <span className="phase">{event.phase}</span>
      <span className="detail">{describe(event)}</span>
    </li>
  );
}
