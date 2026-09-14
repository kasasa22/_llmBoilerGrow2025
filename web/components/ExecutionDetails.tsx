'use client';

import type { SseEvent } from '@/lib/events';

export interface ArchivedDetails {
  modelName: string;
  durationMs: number;
  sources: number;
  toolCalls: number;
}

interface ExecutionDetailsProps {
  events: SseEvent[];
  modelName: string;
  startedAt: number | null;
  isComplete: boolean;
  citationCount: number;
  archived?: ArchivedDetails | null;
}

function fmtDuration(ms: number): string {
  if (ms <= 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} seconds`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}m ${rem}s`;
}

export function ExecutionDetails({
  events,
  modelName,
  startedAt,
  isComplete,
  citationCount,
  archived,
}: ExecutionDetailsProps) {
  const live = events.length > 0;
  if (!live && !archived) return null;

  const sources = live ? events.filter((e) => e.phase === 'research.source_found').length : archived!.sources;
  const toolCalls = live ? events.filter((e) => e.phase === 'tool.called').length : archived!.toolCalls;
  const model = live ? modelName : archived!.modelName || modelName;

  const finalEvent = events.find((e) => e.phase === 'final');
  const doneEvent = events.find((e) => e.phase === 'done');
  const endTs = doneEvent?.ts || finalEvent?.ts;

  const durationMs = live
    ? startedAt && endTs
      ? new Date(endTs).getTime() - startedAt
      : startedAt
        ? Date.now() - startedAt
        : 0
    : archived!.durationMs;

  const complete = live ? isComplete : true;
  const confidence = complete && sources > 0 && citationCount > 0
    ? sources >= 2 && citationCount >= 2
      ? 'high'
      : 'medium'
    : 'low';

  return (
    <section className="details-card">
      <h3>Execution Details</h3>
      <dl className="details-list">
        <div className="details-row">
          <dt>
            <span className="details-icon" aria-hidden>◈</span>
            Model
          </dt>
          <dd>{model}</dd>
        </div>
        <div className="details-row">
          <dt>
            <span className="details-icon" aria-hidden>⏱</span>
            Duration
          </dt>
          <dd>{fmtDuration(durationMs)}</dd>
        </div>
        <div className="details-row">
          <dt>
            <span className="details-icon" aria-hidden>◎</span>
            Sources
          </dt>
          <dd>{sources}</dd>
        </div>
        <div className="details-row">
          <dt>
            <span className="details-icon" aria-hidden>⚒</span>
            Tool Calls
          </dt>
          <dd>{toolCalls}</dd>
        </div>
        <div className="details-row">
          <dt>
            <span className="details-icon" aria-hidden>✓</span>
            Confidence
          </dt>
          <dd>
            <span className={`confidence-badge confidence-${confidence}`}>
              {confidence.charAt(0).toUpperCase() + confidence.slice(1)}
            </span>
          </dd>
        </div>
      </dl>
    </section>
  );
}
