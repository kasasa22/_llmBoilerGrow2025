'use client';

import { useMemo, useState } from 'react';

import { AnswerPanel } from '@/components/AnswerPanel';
import { ErrorBanner } from '@/components/ErrorBanner';
import { EventTimeline } from '@/components/EventTimeline';
import { JobBadge } from '@/components/JobBadge';
import { QueryForm } from '@/components/QueryForm';
import { TraceBadge } from '@/components/TraceBadge';
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey';
import { useJobStream } from '@/hooks/useJobStream';
import { buildStreamUrl, postChat } from '@/lib/api';
import type { Citation, FinalData } from '@/lib/events';

interface ChatPanelProps {
  modelName: string;
  env: string;
}

interface FinalState {
  answer: string | null;
  citations: Citation[];
  partial: boolean;
}

const INITIAL_FINAL: FinalState = { answer: null, citations: [], partial: false };

export function ChatPanel({ modelName, env }: ChatPanelProps) {
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [final, setFinal] = useState<FinalState>(INITIAL_FINAL);

  const getIdempotencyKey = useIdempotencyKey();

  const { events, status } = useJobStream(streamUrl, {
    onFinal: (data: FinalData) =>
      setFinal({
        answer: data.answer,
        citations: data.citations ?? [],
        partial: Boolean(data.partial),
      }),
  });

  const busy = submitting || status === 'connecting' || status === 'open';

  const onSubmit = async (query: string) => {
    setSubmitting(true);
    setError(null);
    setFinal(INITIAL_FINAL);
    setJobId(null);
    setStreamUrl(null);

    try {
      const idempotencyKey = getIdempotencyKey(query);
      const result = await postChat(query, { idempotencyKey });
      if (result.traceId) setTraceId(result.traceId);
      if (!result.ok) {
        setError(`${result.status} ${result.error}: ${result.message}`);
        return;
      }
      setJobId(result.data.job_id);
      setStreamUrl(buildStreamUrl(result.data.job_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  const statusLabel = useMemo(() => {
    switch (status) {
      case 'connecting':
        return 'connecting…';
      case 'open':
        return 'streaming';
      case 'reconnecting':
        return 'reconnecting…';
      case 'closed':
        return 'stream complete';
      case 'error':
        return 'error';
      default:
        return null;
    }
  }, [status]);

  return (
    <main>
      <QueryForm disabled={busy} onSubmit={onSubmit} />

      <div className="controls">
        <JobBadge jobId={jobId} />
        <TraceBadge traceId={traceId} />
        {statusLabel ? <span className="hint">{statusLabel}</span> : null}
        <span className="hint">
          {modelName} · {env}
        </span>
      </div>

      <ErrorBanner message={error} />

      <EventTimeline events={events} />

      <AnswerPanel
        answer={final.answer}
        citations={final.citations}
        partial={final.partial}
      />
    </main>
  );
}
