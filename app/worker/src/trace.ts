/**
 * AsyncLocalStorage-backed trace context.
 * Mirrors the Python side (app/trace.py): every log line and every Redis
 * envelope carries { trace_id, job_id, span_id, parent_span_id, ts }.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

export interface TraceCtx {
  trace_id: string;
  job_id?: string | null;
  span_id?: string | null;
  parent_span_id?: string | null;
}

export const traceStore = new AsyncLocalStorage<TraceCtx>();

export function newTraceId(): string {
  return randomBytes(16).toString('hex');
}

export function newJobId(): string {
  return 'job_' + randomBytes(6).toString('hex');
}

export function newSpanId(): string {
  return randomBytes(8).toString('hex');
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function currentTrace(): TraceCtx | undefined {
  return traceStore.getStore();
}

export function withTrace<T>(ctx: TraceCtx, fn: () => Promise<T> | T): Promise<T> | T {
  return traceStore.run(ctx, fn);
}

/** Open a child span within the current trace, or start a new trace if absent. */
export function withChildSpan<T>(fn: () => Promise<T> | T): Promise<T> | T {
  const parent = currentTrace();
  const child: TraceCtx = parent
    ? {
        trace_id: parent.trace_id,
        job_id: parent.job_id ?? null,
        span_id: newSpanId(),
        parent_span_id: parent.span_id ?? null,
      }
    : { trace_id: newTraceId(), span_id: newSpanId(), parent_span_id: null };
  return traceStore.run(child, fn);
}
