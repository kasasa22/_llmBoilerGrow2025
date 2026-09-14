import { NonRetriableError } from 'inngest';

import { BudgetTracker } from '../budget.js';
import { env } from '../config.js';
import { AgentError, ErrorCode, classify, retryPolicy } from '../errors.js';
import { Phase, RESEARCH_QUERY_SUBMITTED } from '../events.js';
import { acquireJobLock, refreshJobLock, releaseJobLock, workerOwnerId } from '../idempotency.js';
import { inngest } from '../inngestClient.js';
import { logger } from '../logger.js';
import { buildResearchNetwork } from '../network.js';
import { primeSynthesisContext } from '../agents/synthesis.js';
import { EvidenceStore } from '../rag/retriever.js';
import { getRedis, K, publishEvent, setStatus, writeFinal } from '../redis.js';
import { initialState } from '../state.js';
import { newSpanId, withTrace } from '../trace.js';

interface EventData {
  job_id: string;
  trace_id: string;
  query: string;
  submitted_at: string;
  max_steps?: number;
  model?: string;
}

export const researchFn = inngest.createFunction(
  {
    id: 'research-run',
    name: 'Research query',
    concurrency: { limit: 2 },
    retries: 0,
  },
  { event: RESEARCH_QUERY_SUBMITTED },
  async ({ event, step }) => {
    const data = event.data as EventData;
    const jobId = data.job_id;
    const traceId = data.trace_id;

    return withTrace({ trace_id: traceId, job_id: jobId, span_id: newSpanId(), parent_span_id: null }, async () => {
      const lockOutcome = await step.run('acquire-lock', async () => acquireJobLock(jobId));

      if (lockOutcome.state === 'busy_running') {
        logger.info({ owner: lockOutcome.owner }, 'research.busy_running.exit');
        return { skipped: true, reason: 'busy_running', owner: lockOutcome.owner };
      }
      if (lockOutcome.state === 'done_replay') {
        await step.run('replay-final', async () => {
          const finalRaw = await getRedis().get(K.final(jobId));
          if (finalRaw) {
            await getRedis().publish(K.events(jobId), finalRaw);
          }
        });
        return { skipped: true, reason: 'done_replay' };
      }

      const budget = new BudgetTracker({
        MAX_TOOL_CALLS: env.MAX_TOOL_CALLS,
        MAX_FETCHES: env.MAX_FETCHES,
        MAX_SEARCH_QUERIES: env.MAX_SEARCH_QUERIES,
        MAX_CONTEXT_CHARS: env.MAX_CONTEXT_CHARS,
        MAX_WALL_CLOCK_MS: env.MAX_WALL_CLOCK_MS,
        MAX_TOKENS_PER_CALL: env.MAX_TOKENS_PER_CALL,
      });
      const evidence = new EvidenceStore({ ragEnabled: env.RAG_ENABLED });
      const state = initialState({ jobId, traceId, query: data.query });

      const runStartedAt = await step.run('mark-running', async () => {
        const started = new Date().toISOString();
        await setStatus(jobId, {
          state: 'running',
          owner: workerOwnerId(),
          started_at: started,
          model: data.model || env.MODEL_NAME,
        });
        return started;
      });
      await step.run('publish-job-started', async () =>
        publishEvent({ jobId, phase: Phase.JobStarted, data: { query: data.query } }),
      );

      const startedMs = Date.parse(runStartedAt);
      const alreadyElapsed = Date.now() - startedMs;
      if (alreadyElapsed >= env.MAX_WALL_CLOCK_MS) {
        logger.warn(
          { jobId, alreadyElapsed, MAX_WALL_CLOCK_MS: env.MAX_WALL_CLOCK_MS },
          'research.wallclock_exceeded_on_replay',
        );
        if (!state.finalAnswer && state.sources.length > 0) {
          await forcedSynthesis(jobId, state, evidence, budget);
        }
        const envelope = await step.run('publish-timeout-final', async () =>
          publishEvent({
            jobId,
            phase: Phase.Final,
            data: {
              answer: state.finalAnswer,
              citations: state.citations,
              partial: true,
              errors: [{ agent: 'network', msg: 'wall_clock_exceeded_on_replay', at: new Date().toISOString() }],
            },
          }),
        );
        await step.run('persist-timeout-final', async () => writeFinal(jobId, envelope));
        await step.run('mark-timeout', async () =>
          setStatus(jobId, { state: state.finalAnswer ? 'done' : 'failed', ended_at: new Date().toISOString(), terminal_reason: 'wall_clock_replay' }),
        );
        await publishEvent({ jobId, phase: Phase.Done, data: { state: 'wall_clock_exceeded' } });
        return { jobId, timedOut: true };
      }
      const remainingMs = Math.max(1000, env.MAX_WALL_CLOCK_MS - alreadyElapsed);

      const runAbort = new AbortController();
      const wallClockTimer = setTimeout(() => runAbort.abort(new Error('MAX_WALL_CLOCK_MS')), remainingMs);
      const heartbeat = setInterval(() => {
        void refreshJobLock(jobId);
      }, env.JOB_LOCK_HEARTBEAT_S * 1000);

      try {
        const network = buildResearchNetwork({
          budget,
          jobId,
          state,
          evidence,
          signal: runAbort.signal,
        });

        try {
          await network.run(data.query);
        } catch (err) {
          const classified = classify(err);
          await onSoftError(state, jobId, classified);
          if (classified.code === ErrorCode.BudgetExceeded) {
            await forcedSynthesis(jobId, state, evidence, budget);
          }
        }

        if (!state.finalAnswer && state.sources.length > 0) {
          await forcedSynthesis(jobId, state, evidence, budget);
        }

        if (state.finalAnswer) {
          const envelope = await step.run('publish-final', async () =>
            publishEvent({
              jobId,
              phase: Phase.Final,
              data: {
                answer: state.finalAnswer,
                citations: state.citations,
                partial: false,
              },
            }),
          );
          await step.run('persist-final', async () => writeFinal(jobId, envelope));
          await step.run('mark-done', async () =>
            setStatus(jobId, { state: 'done', ended_at: new Date().toISOString() }),
          );
        } else {
          const envelope = await step.run('publish-empty-final', async () =>
            publishEvent({
              jobId,
              phase: Phase.Final,
              data: {
                answer: null,
                citations: state.citations,
                partial: true,
                errors: state.errors.slice(-3),
              },
            }),
          );
          await step.run('persist-empty-final', async () => writeFinal(jobId, envelope));
          await step.run('mark-failed', async () =>
            setStatus(jobId, {
              state: state.errors.length ? 'failed' : 'no_answer',
              ended_at: new Date().toISOString(),
            }),
          );
        }
        await publishEvent({ jobId, phase: Phase.Done, data: { state: state.phase } });

        return { jobId, sources: state.sources.length, claims: state.claims.length, citations: state.citations.length };
      } catch (err) {
        const classified = classify(err);
        const policy = retryPolicy[classified.code];
        if (policy?.terminal === 'hard') {
          await publishEvent({
            jobId,
            phase: Phase.Error,
            data: { code: classified.code, message: classified.message, terminal: true },
          });
          await setStatus(jobId, { state: 'failed', terminal_reason: classified.code });
          throw new NonRetriableError(classified.message);
        }
        throw classified;
      } finally {
        clearTimeout(wallClockTimer);
        clearInterval(heartbeat);
        await releaseJobLock(jobId).catch(() => undefined);
      }
    });
  },
);

async function onSoftError(state: ReturnType<typeof initialState>, jobId: string, err: AgentError) {
  state.errors.push({
    agent: 'network',
    code: err.code,
    msg: err.message,
    at: new Date().toISOString(),
  });
  await publishEvent({
    jobId,
    phase: err.code === ErrorCode.BudgetExceeded ? Phase.BudgetHit : Phase.Error,
    data: { code: err.code, message: err.message, context: err.context },
  });
}

async function forcedSynthesis(
  jobId: string,
  state: ReturnType<typeof initialState>,
  evidence: EvidenceStore,
  budget: BudgetTracker,
): Promise<void> {
  logger.info({ jobId }, 'research.forced_synthesis.start');
  const prompt = await primeSynthesisContext({ budget, jobId, state, evidence });

  await publishEvent({
    jobId,
    phase: Phase.SynthesisStarted,
    data: { forced: true, claimCount: state.claims.length, sourceCount: state.sources.length },
  });

  const sourceLines = state.sources
    .slice(0, 6)
    .map((s, i) => `[${i + 1}] ${s.title || s.url}`)
    .join('\n');

  let answer: string | null = null;

  if (state.sources.length > 0) {
    answer = await tryLlmSynthesis(prompt, state.query, sourceLines).catch((err) => {
      logger.warn({ err: String(err), jobId }, 'forced_synthesis.llm_failed');
      return null;
    });
  }

  if (!answer) {
    const claimBullets = state.claims.slice(0, 8).map((c, i) => `- ${c.text} [${i + 1}]`).join('\n');
    const sourceBullets = state.sources
      .slice(0, 6)
      .map((s, i) => `- ${s.title || s.url} [${i + 1}]`)
      .join('\n');

    if (claimBullets.length > 0) {
      answer = `Best-effort summary from extracted claims (budget exhausted before full synthesis):\n\n${claimBullets}`;
    } else if (sourceBullets.length > 0) {
      answer = `The research agent gathered ${state.sources.length} source(s) but the synthesis step did not converge on a final answer before the budget was reached. Sources reviewed:\n\n${sourceBullets}\n\nTry a shorter, more specific query — the CPU-hosted model handles single-fact questions best.`;
    } else {
      answer = 'The research agent did not find any usable sources within the budget.';
    }
  }

  const claimCitations = state.claims
    .flatMap((c) => c.sourceIds)
    .filter((v, i, a) => a.indexOf(v) === i);
  const citationSourceIds = claimCitations.length > 0 ? claimCitations : state.sources.map((s) => s.id);
  const citations = citationSourceIds
    .slice(0, 20)
    .map((sourceId, idx) => {
      const src = state.sources.find((s) => s.id === sourceId);
      return src ? { n: idx + 1, url: src.url, title: src.title } : null;
    })
    .filter((v): v is { n: number; url: string; title: string } => v !== null);

  state.finalAnswer = answer;
  state.citations = citations;
  await publishEvent({
    jobId,
    phase: Phase.SynthesisAnswerReady,
    data: { length: answer.length, citationCount: citations.length, forced: true, prompt_chars: prompt.length },
  });
}

async function tryLlmSynthesis(context: string, query: string, sourceLines: string): Promise<string | null> {
  const url = `${env.OLLAMA_BASE_URL.replace(/\/+$/, '')}/v1/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: env.MODEL_NAME,
        temperature: 0.2,
        max_tokens: env.MAX_TOKENS_PER_CALL,
        messages: [
          {
            role: 'system',
            content: `You are writing a clear, cited markdown answer to the user's question, using ONLY the evidence chunks provided.

Rules:
- 200-500 words. Use markdown headings/tables where they help.
- Cite sources inline with [n], where n corresponds to the numbered SOURCES list.
- Comparison queries: use a markdown table or explicit contrast structure.
- Never invent facts not present in the evidence.
- Do NOT preface with "Based on the evidence" or apologize. Just answer.`,
          },
          {
            role: 'user',
            content: `QUESTION: ${query}\n\nSOURCES:\n${sourceLines}\n\n${context}`,
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = body.choices?.[0]?.message?.content?.trim();
    return text && text.length > 40 ? text : null;
  } finally {
    clearTimeout(timeout);
  }
}
