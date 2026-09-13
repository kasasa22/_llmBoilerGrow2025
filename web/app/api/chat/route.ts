import { NextResponse } from 'next/server';

import { serverBackendUrl } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  const idempotencyKey = request.headers.get('idempotency-key');

  const upstream = await fetch(`${serverBackendUrl()}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body,
    cache: 'no-store',
  });

  const text = await upstream.text();
  const headers = new Headers();
  headers.set('content-type', upstream.headers.get('content-type') ?? 'application/json');
  const traceId = upstream.headers.get('x-trace-id');
  if (traceId) headers.set('x-trace-id', traceId);
  const idemStatus = upstream.headers.get('idempotency-status');
  if (idemStatus) headers.set('idempotency-status', idemStatus);

  return new NextResponse(text, { status: upstream.status, headers });
}
