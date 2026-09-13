import type { PostChatResponse } from './events';

export interface PostChatOptions {
  idempotencyKey?: string;
}

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

  const res = await fetch('/api/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  });
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
