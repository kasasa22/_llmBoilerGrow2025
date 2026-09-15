import { fetch } from 'undici';

import { env } from './config.js';
import { logger } from './logger.js';

export type FetchLike = (url: string, init: Record<string, unknown>) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type RunStatus = 'Running' | 'Completed' | 'Failed' | 'Cancelled' | 'Unknown';

export function parseRunStatus(body: unknown): RunStatus {
  const data = (body as { data?: { status?: string } })?.data;
  const status = data?.status;
  if (status === 'Running' || status === 'Completed' || status === 'Failed' || status === 'Cancelled') return status;
  return 'Unknown';
}

export async function fetchRunStatus(runId: string, fetchFn: FetchLike = fetch as never): Promise<RunStatus> {
  const url = `${env.INNGEST_BASE_URL.replace(/\/+$/, '')}/v1/runs/${encodeURIComponent(runId)}`;
  const headers: Record<string, string> = env.INNGEST_SIGNING_KEY ? { authorization: `Bearer ${env.INNGEST_SIGNING_KEY}` } : {};
  try {
    const res = await fetchFn(url, { method: 'GET', headers, signal: AbortSignal.timeout(env.RUN_STATUS_TIMEOUT_MS) });
    if (!res.ok) {
      logger.debug({ runId, status: res.status }, 'inngest.run_status.http');
      return 'Unknown';
    }
    return parseRunStatus(await res.json());
  } catch (err) {
    logger.debug({ runId, err: (err as Error).message }, 'inngest.run_status.failed');
    return 'Unknown';
  }
}

export function startCancellationWatch(opts: {
  runId: string | null;
  intervalMs: number;
  onCancelled: () => void;
  fetchFn?: FetchLike;
}): () => void {
  if (!opts.runId) return () => undefined;
  let stopped = false;
  const timer = setInterval(() => {
    void fetchRunStatus(opts.runId as string, opts.fetchFn).then((status) => {
      if (stopped) return;
      if (status === 'Cancelled') {
        stopped = true;
        clearInterval(timer);
        opts.onCancelled();
      }
    });
  }, opts.intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
