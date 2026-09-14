'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { AgentProgress } from '@/components/AgentProgress';
import { AnswerPanel } from '@/components/AnswerPanel';
import { ErrorBanner } from '@/components/ErrorBanner';
import { EventTimeline } from '@/components/EventTimeline';
import { ExecutionDetails } from '@/components/ExecutionDetails';
import { JobBadge } from '@/components/JobBadge';
import { PhaseTracker } from '@/components/PhaseTracker';
import { QueryForm } from '@/components/QueryForm';
import { Sidebar } from '@/components/Sidebar';
import { TopNav } from '@/components/TopNav';
import { TraceBadge } from '@/components/TraceBadge';
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey';
import { useJobStream } from '@/hooks/useJobStream';
import { useQueryHistory } from '@/hooks/useQueryHistory';
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

const SUGGESTIONS = [
  'Compare FastAPI vs Express',
  'How does RAG work?',
  'Latest tech news',
];

export function ChatPanel({ modelName, env }: ChatPanelProps) {
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [final, setFinal] = useState<FinalState>(INITIAL_FINAL);
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<string>('');
  const [viewingHistory, setViewingHistory] = useState(false);

  const getIdempotencyKey = useIdempotencyKey();
  const history = useQueryHistory();

  const { events, status } = useJobStream(streamUrl, {
    onFinal: (data: FinalData) =>
      setFinal({
        answer: data.answer,
        citations: data.citations ?? [],
        partial: Boolean(data.partial),
      }),
  });

  const busy = submitting || status === 'connecting' || status === 'open';
  const hasStream = jobId !== null;
  const hasContent = hasStream || viewingHistory || Boolean(final.answer);
  const isWaiting = hasStream && !final.answer && status !== 'error' && status !== 'closed';
  const streamEndedWithoutAnswer = hasStream && !final.answer && (status === 'closed' || status === 'error');
  const isComplete = status === 'closed' || viewingHistory;

  useEffect(() => {
    if (!activeChatId || !final.answer || viewingHistory) return;
    const sources = events.filter((e) => e.phase === 'research.source_found').length;
    const toolCalls = events.filter((e) => e.phase === 'tool.called').length;
    history.update(activeChatId, {
      answer: final.answer,
      citations: final.citations,
      partial: final.partial,
      completedAt: new Date().toISOString(),
      status: streamEndedWithoutAnswer ? 'no_answer' : 'done',
      sourcesCount: sources,
      toolCallsCount: toolCalls,
    });
  }, [final.answer, activeChatId, viewingHistory, streamEndedWithoutAnswer]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = useCallback(
    async (query: string) => {
      setSubmitting(true);
      setError(null);
      setFinal(INITIAL_FINAL);
      setJobId(null);
      setStreamUrl(null);
      setStartedAt(null);
      setActiveQuery(query);
      setViewingHistory(false);

      try {
        const idempotencyKey = getIdempotencyKey(query);
        const result = await postChat(query, { idempotencyKey });
        if (result.traceId) setTraceId(result.traceId);
        if (!result.ok) {
          setError(`${result.status} ${result.error}: ${result.message}`);
          const newId = history.add(query, null, null, modelName);
          setActiveChatId(newId);
          return;
        }
        setJobId(result.data.job_id);
        setStreamUrl(buildStreamUrl(result.data.job_id));
        setStartedAt(Date.now());
        const newId = history.add(query, result.data.job_id, result.traceId ?? null, modelName);
        setActiveChatId(newId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'unknown error');
        const newId = history.add(query, null, null, modelName);
        setActiveChatId(newId);
      } finally {
        setSubmitting(false);
      }
    },
    [getIdempotencyKey, history, modelName],
  );

  const onNew = useCallback(() => {
    setJobId(null);
    setTraceId(null);
    setStreamUrl(null);
    setStartedAt(null);
    setError(null);
    setFinal(INITIAL_FINAL);
    setActiveQuery(null);
    setActiveChatId(null);
    setPrefill('');
    setViewingHistory(false);
  }, []);

  const onSelectHistory = useCallback(
    (id: string) => {
      const item = history.getById(id);
      if (!item) return;

      setJobId(null);
      setStreamUrl(null);
      setStartedAt(null);
      setError(null);

      setActiveChatId(id);
      setActiveQuery(item.query);
      setTraceId(item.traceId);

      if (item.answer !== null) {
        setFinal({
          answer: item.answer,
          citations: item.citations,
          partial: item.partial,
        });
        setViewingHistory(true);
      } else {
        setFinal(INITIAL_FINAL);
        setViewingHistory(false);
        setPrefill(item.query);
      }
    },
    [history],
  );

  const onDeleteHistory = useCallback(
    (id: string) => {
      history.remove(id);
      if (id === activeChatId) {
        onNew();
      }
    },
    [history, activeChatId, onNew],
  );

  const statusLabel = useMemo(() => {
    if (viewingHistory) return 'archived';
    switch (status) {
      case 'connecting':
        return 'connecting';
      case 'open':
        return 'streaming';
      case 'reconnecting':
        return 'reconnecting';
      case 'closed':
        return 'complete';
      case 'error':
        return 'error';
      default:
        return null;
    }
  }, [status, viewingHistory]);

  const showRightRail = hasContent;

  const currentHistoryItem = activeChatId ? history.getById(activeChatId) : null;
  const displaySourcesCount =
    currentHistoryItem?.sourcesCount ?? events.filter((e) => e.phase === 'research.source_found').length;
  const displayToolCallsCount =
    currentHistoryItem?.toolCallsCount ?? events.filter((e) => e.phase === 'tool.called').length;

  return (
    <div className="shell">
      <Sidebar
        items={history.items}
        activeChatId={activeChatId}
        onSelect={onSelectHistory}
        onNew={onNew}
        onDelete={onDeleteHistory}
        onClear={history.clear}
        modelName={modelName}
      />

      <div className="shell-main">
        <TopNav statusLabel={statusLabel} />

        <div className={showRightRail ? 'body body--with-rail' : 'body'}>
          <div className="body-center">
            <section className="query-card">
              <QueryForm disabled={busy} onSubmit={onSubmit} initialValue={prefill} />
              <div className="query-examples">
                <span className="query-examples-label">Example:</span>
                {SUGGESTIONS.map((s, i) => (
                  <button key={s} className="query-example" onClick={() => setPrefill(s)}>
                    {s}
                    {i < SUGGESTIONS.length - 1 ? <span aria-hidden> • </span> : null}
                  </button>
                ))}
              </div>
            </section>

            <ErrorBanner message={error} />

            {activeQuery ? (
              <section className="query-echo">
                <span className="query-echo-avatar" aria-hidden>T</span>
                <div>
                  <div className="query-echo-text">{activeQuery}</div>
                  <div className="query-echo-time">
                    {currentHistoryItem
                      ? new Date(currentHistoryItem.submittedAt).toLocaleString()
                      : new Date().toLocaleString()}
                  </div>
                </div>
              </section>
            ) : null}

            {isWaiting ? (
              <PhaseTracker events={events} startedAt={startedAt} env={env} />
            ) : null}

            {final.answer ? (
              <section className="answer-card">
                <div className="answer-card-head">
                  <span className="answer-card-avatar" aria-hidden>◆</span>
                  <span className="answer-card-title">AI Research Agent</span>
                  <span className="answer-card-badge">
                    {viewingHistory ? 'Archived' : 'Completed'}
                  </span>
                </div>
                <AnswerPanel
                  answer={final.answer}
                  citations={final.citations}
                  partial={final.partial}
                />
                <div className="answer-card-foot">
                  <span>{displaySourcesCount} sources</span>
                  <span>{displayToolCallsCount} tool calls</span>
                </div>
              </section>
            ) : null}

            {streamEndedWithoutAnswer && !final.answer ? (
              <section className="answer answer--empty">
                <div className="answer-waiting">
                  <div>
                    <strong>Sorry &mdash; I couldn&apos;t put an answer together this time.</strong>
                    <p className="hint">
                      Try a shorter, more specific question, or rephrase and send it again.
                    </p>
                  </div>
                </div>
              </section>
            ) : null}

            {hasStream ? (
              <details className="timeline-details">
                <summary>
                  Developer details
                  {events.length > 0 ? <span className="hint"> &middot; {events.length} events</span> : null}
                </summary>
                <div className="dev-meta">
                  <JobBadge jobId={jobId} />
                  <TraceBadge traceId={traceId} />
                  <span className="hint">{modelName} &middot; {env}</span>
                </div>
                <EventTimeline events={events} />
              </details>
            ) : null}
          </div>

          {showRightRail ? (
            <aside className="rightrail">
              <AgentProgress events={events} isComplete={isComplete} />
              <ExecutionDetails
                events={events}
                modelName={modelName}
                startedAt={startedAt}
                isComplete={isComplete}
                citationCount={final.citations.length}
              />
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}
