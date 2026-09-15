import type { PostChatResponse } from './events';

export interface PostChatOptions {
  idempotencyKey?: string;
  timeoutMs?: number;
}

export const POST_TIMEOUT_MS = 30_000;

export interface PostChatSuccess {
  ok: true;
  status: number;
  data: PostChatResponse;
  traceId: string | null;
}

export interface PostChatFailure {
  ok: false;
  status: number;
  error: string;
  message: string;
  traceId: string | null;
}

export async function postChat(
  query: string,
  opts: PostChatOptions = {},
): Promise<PostChatSuccess | PostChatFailure> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;

  let res: Response;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? POST_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    return {
      ok: false,
      status: 0,
      error: timedOut ? 'timeout' : 'network_error',
      message: timedOut
        ? `The server did not accept the request within ${Math.round((opts.timeoutMs ?? POST_TIMEOUT_MS) / 1000)} seconds.`
        : err instanceof Error
          ? err.message
          : 'network error',
      traceId: null,
    };
  }
  const traceId = res.headers.get('x-trace-id');
  const json = (await res.json()) as
    | PostChatResponse
    | { error: string; message: string };

  if (!res.ok || 'error' in json) {
    const err = json as { error?: string; message?: string };
    return {
      ok: false,
      status: res.status,
      error: err.error ?? 'unknown',
      message: err.message ?? '',
      traceId,
    };
  }
  return { ok: true, status: res.status, data: json as PostChatResponse, traceId };
}

export function buildStreamUrl(jobId: string): string {
  return `/api/jobs/${encodeURIComponent(jobId)}/stream`;
}
