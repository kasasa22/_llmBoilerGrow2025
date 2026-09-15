import { serverBackendUrl } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const lastEventId = request.headers.get('last-event-id');
  const upstream = await fetch(
    `${serverBackendUrl()}/api/jobs/${encodeURIComponent(id)}/stream`,
    {
      method: 'GET',
      headers: {
        accept: 'text/event-stream',
        ...(lastEventId ? { 'last-event-id': lastEventId } : {}),
      },
      cache: 'no-store',
      signal: request.signal,
    },
  );

  if (!upstream.body) {
    return new Response('upstream closed', { status: 502 });
  }

  const headers = new Headers();
  headers.set('content-type', 'text/event-stream');
  headers.set('cache-control', 'no-cache, no-transform');
  headers.set('x-accel-buffering', 'no');
  headers.set('connection', 'keep-alive');
  const traceId = upstream.headers.get('x-trace-id');
  if (traceId) headers.set('x-trace-id', traceId);

  return new Response(upstream.body, { status: upstream.status, headers });
}
