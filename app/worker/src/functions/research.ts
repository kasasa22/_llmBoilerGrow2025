import { BudgetTracker } from '../budget.js';
import { env } from '../config.js';
import { runDetached } from '../detach.js';
import { ErrorCode, classify } from '../errors.js';
import { Phase, RESEARCH_QUERY_SUBMITTED } from '../events.js';
import { acquireJobLock, refreshJobLock, releaseJobLock, workerOwnerId } from '../idempotency.js';
import { inngest } from '../inngestClient.js';
import { logger } from '../logger.js';
import { buildResearchNetwork } from '../network.js';
import { EvidenceStore } from '../rag/retriever.js';
import { getRedis, K, publishEvent, setStatus, writeFinal } from '../redis.js';
import { type Citation, type StateError, initialState } from '../state.js';
import { directSynthesis } from '../synthesize.js';
import { type TraceCtx, newSpanId, withTrace } from '../trace.js';

interface EventData {
  job_id: string;
  trace_id: string;
  query: string;
  submitted_at: string;
}

export interface JobOutcome {
  answer: string | null;
  citations: Citation[];
  partial: boolean;
  mode: 'agent' | 'direct' | 'fallback' | 'none';
  phase: string;
  sources: number;
  claims: number;
  errors: StateError[];
  elapsedMs: number;
}

export const researchFn = inngest.createFunction(
  {
    id: 'research-run',
    name: 'Research query',
    concurrency: { limit: env.WORKER_CONCURRENCY },
    retries: env.INNGEST_RETRIES,
  },
  { event: RESEARCH_QUERY_SUBMITTED },
  async ({ event, step }) => {
    const data = event.data as EventData;
    const jobId = data.job_id;
    const trace: TraceCtx = { trace_id: data.trace_id, job_id: jobId, span_id: newSpanId(), parent_span_id: null };
    const traced =
      <T>(fn: () => Promise<T>) =>
      (): Promise<T> =>
        withTrace(trace, fn) as Promise<T>;

    return withTrace(trace, async () => {
      const lockOutcome = await step.run('acquire-lock', traced(async () => acquireJobLock(jobId)));

      if (lockOutcome.state === 'busy_running') {
        logger.info({ owner: lockOutcome.owner }, 'research.busy_running.exit');
        return { skipped: true, reason: 'busy_running', owner: lockOutcome.owner };
      }
      if (lockOutcome.state === 'done_replay') {
        await step.run(
          'replay-final',
          traced(async () => {
            const finalRaw = await getRedis().get(K.final(jobId));
            if (finalRaw) await getRedis().publish(K.events(jobId), finalRaw);
          }),
        );
        return { skipped: true, reason: 'done_replay' };
      }

      await step.run(
        'mark-running',
        traced(async () =>
          setStatus(jobId, {
            state: 'running',
            owner: workerOwnerId(),
            started_at: new Date().toISOString(),
            model: env.MODEL_NAME,
          }),
        ),
      );
      await step.run(
        'publish-job-started',
        traced(async () => publishEvent({ jobId, phase: Phase.JobStarted, data: { query: data.query } })),
      );

      const outcome = await step.run(
        'run-agent-network',
        traced(async () => runJob({ jobId, trace, query: data.query })),
      );

      if (outcome.answer) {
        const envelope = await step.run(
          'publish-final',
          traced(async () =>
            publishEvent({
              jobId,
              phase: Phase.Final,
              data: { answer: outcome.answer, citations: outcome.citations, partial: outcome.partial, mode: outcome.mode },
            }),
          ),
        );
        await step.run('persist-final', traced(async () => writeFinal(jobId, envelope)));
        await step.run(
          'mark-done',
          traced(async () => {
            await setStatus(jobId, { state: 'done', ended_at: new Date().toISOString(), mode: outcome.mode });
            await releaseJobLock(jobId).catch(() => undefined);
            await publishEvent({ jobId, phase: Phase.Done, data: { state: 'done', mode: outcome.mode } });
          }),
        );
      } else {
        const envelope = await step.run(
          'publish-empty-final',
          traced(async () =>
            publishEvent({
              jobId,
              phase: Phase.Final,
              data: { answer: null, citations: outcome.citations, partial: true, errors: outcome.errors.slice(-3) },
            }),
          ),
        );
        await step.run('persist-empty-final', traced(async () => writeFinal(jobId, envelope)));
        await step.run(
          'mark-failed',
          traced(async () => {
            await setStatus(jobId, {
              state: outcome.errors.length ? 'failed' : 'no_answer',
              ended_at: new Date().toISOString(),
            });
            await releaseJobLock(jobId).catch(() => undefined);
            await publishEvent({ jobId, phase: Phase.Done, data: { state: outcome.errors.length ? 'failed' : 'no_answer' } });
          }),
        );
      }

      return {
        jobId,
        mode: outcome.mode,
        sources: outcome.sources,
        claims: outcome.claims,
        citations: outcome.citations.length,
        elapsedMs: outcome.elapsedMs,
      };
    });
  },
);

interface RunJobInput {
  jobId: string;
  trace: TraceCtx;
  query: string;
}

export async function runJob(input: RunJobInput): Promise<JobOutcome> {
  const { jobId, trace, query } = input;
  const startedAt = Date.now();

  const researchBudgetMs = env.MAX_WALL_CLOCK_MS;

  const budget = new BudgetTracker({
    MAX_TOOL_CALLS: env.MAX_TOOL_CALLS,
    MAX_FETCHES: env.MAX_FETCHES,
    MAX_SEARCH_QUERIES: env.MAX_SEARCH_QUERIES,
    MAX_CONTEXT_CHARS: env.MAX_CONTEXT_CHARS,
    MAX_WALL_CLOCK_MS: researchBudgetMs,
    MAX_TOKENS_PER_CALL: env.MAX_TOKENS_PER_CALL,
  });
  const evidence = new EvidenceStore({ ragEnabled: env.RAG_ENABLED });
  const state = initialState({ jobId, traceId: trace.trace_id, query });

  const researchAbort = new AbortController();
  const researchTimer = setTimeout(() => researchAbort.abort(new Error('MAX_WALL_CLOCK_MS')), researchBudgetMs);
  const heartbeat = setInterval(() => {
    void refreshJobLock(jobId);
  }, env.JOB_LOCK_HEARTBEAT_S * 1000);

  let mode: JobOutcome['mode'] = 'none';
  let partial = false;

  try {
    const network = buildResearchNetwork({ budget, jobId, state, evidence, signal: researchAbort.signal });

    try {
      await runDetached(() => withTrace(trace, () => network.run(query)));
    } catch (err) {
      const classified = classify(err);
      logger.warn({ jobId, code: classified.code, err: classified.message }, 'research.network.exited_with_error');
      state.errors.push({ agent: 'network', code: classified.code, msg: classified.message, at: new Date().toISOString() });
      await publishEvent({
        jobId,
        phase: classified.code === ErrorCode.BudgetExceeded ? Phase.BudgetHit : Phase.Error,
        data: { code: classified.code, message: classified.message, context: classified.context, terminal: false },
      });
    } finally {
      clearTimeout(researchTimer);
    }

    if (state.finalAnswer) {
      mode = 'agent';
    } else if (state.sources.length > 0) {
      const result = await directSynthesis({ jobId, state, evidence, deadlineMs: env.SYNTHESIS_TIMEOUT_MS });
      mode = result.mode;
      partial = result.partial;
    }

    logger.info(
      { jobId, mode, partial, sources: state.sources.length, claims: state.claims.length, elapsedMs: Date.now() - startedAt },
      'research.job.completed',
    );
  } catch (err) {
    const classified = classify(err);
    logger.error({ jobId, code: classified.code, err: classified.message }, 'research.job.failed');
    state.errors.push({ agent: 'job', code: classified.code, msg: classified.message, at: new Date().toISOString() });
    await publishEvent({
      jobId,
      phase: Phase.Error,
      data: { code: classified.code, message: classified.message, terminal: true },
    }).catch(() => undefined);
  } finally {
    clearTimeout(researchTimer);
    clearInterval(heartbeat);
  }

  return {
    answer: state.finalAnswer,
    citations: state.citations,
    partial,
    mode,
    phase: state.phase,
    sources: state.sources.length,
    claims: state.claims.length,
    errors: state.errors,
    elapsedMs: Date.now() - startedAt,
  };
}
