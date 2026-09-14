'use client';

import type { SseEvent } from '@/lib/events';

interface AgentProgressProps {
  events: SseEvent[];
  isComplete: boolean;
}

interface ProgressStep {
  id: string;
  label: string;
  done: boolean;
  ts: string | null;
}

function fmtTs(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  } catch {
    return '';
  }
}

function findTs(events: SseEvent[], predicate: (e: SseEvent) => boolean): string | null {
  const e = events.find(predicate);
  return e?.ts ?? null;
}

export function AgentProgress({ events, isComplete }: AgentProgressProps) {
  const steps: ProgressStep[] = [
    {
      id: 'received',
      label: 'Query Received',
      done: events.some((e) => e.phase === 'job.started'),
      ts: findTs(events, (e) => e.phase === 'job.started'),
    },
    {
      id: 'searching',
      label: 'Searching Sources',
      done: events.some((e) => e.phase === 'research.search_completed'),
      ts: findTs(events, (e) => e.phase === 'research.search_completed'),
    },
    {
      id: 'reading',
      label: 'Reading Sources',
      done: events.some((e) => e.phase === 'rag.chunks_indexed'),
      ts: findTs(events, (e) => e.phase === 'rag.chunks_indexed'),
    },
    {
      id: 'analyzing',
      label: 'Analyzing Findings',
      done: events.some(
        (e) => e.phase === 'agent.transition' && e.data.to === 'synthesis',
      ) || events.some((e) => e.phase === 'synthesis.started'),
      ts:
        findTs(events, (e) => e.phase === 'synthesis.started') ||
        findTs(events, (e) => e.phase === 'agent.transition' && e.data.to === 'synthesis'),
    },
    {
      id: 'final',
      label: 'Generating Final Answer',
      done: events.some((e) => e.phase === 'final'),
      ts: findTs(events, (e) => e.phase === 'final'),
    },
  ];

  const anyDone = steps.some((s) => s.done);
  if (!anyDone) return null;

  return (
    <section className="progress-card">
      <div className="progress-card-header">
        <h3>Agent Progress</h3>
        <span className={`progress-status ${isComplete ? 'is-complete' : 'is-running'}`}>
          <span className="status-dot" aria-hidden />
          {isComplete ? 'Completed' : 'Running'}
        </span>
      </div>
      <ol className="progress-list">
        {steps.map((step) => (
          <li key={step.id} className={step.done ? 'progress-item is-done' : 'progress-item'}>
            <span className="progress-check" aria-hidden>
              {step.done ? '✓' : ''}
            </span>
            <span className="progress-label">{step.label}</span>
            <span className="progress-ts">{fmtTs(step.ts)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
