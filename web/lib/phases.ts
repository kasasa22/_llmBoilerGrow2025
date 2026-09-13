import type { Phase } from './events';

export const PHASE_NAMES = [
  'job.started',
  'queued',
  'step.started',
  'step.completed',
  'agent.transition',
  'agent.thought',
  'tool.called',
  'tool.result',
  'tool.error',
  'research.source_found',
  'research.search_completed',
  'analysis.claim_extracted',
  'analysis.source_scored',
  'synthesis.started',
  'synthesis.answer_ready',
  'rag.chunks_indexed',
  'rag.retrieved',
  'rag.circuit_open',
  'citation.added',
  'citation',
  'budget.hit',
  'final',
  'error',
  'network.error',
  'done',
] as const satisfies readonly Phase[];

export function phaseToClass(phase: string): string {
  return phase.replace(/\./g, '-');
}
