import type { Response as UndiciResponse } from 'undici';

import { env } from '../config.js';
import { assertPublicHost } from './ssrf.js';
import { isUrlAllowed } from './urlPolicy.js';

export type FetchLike = (url: string, init: Record<string, unknown>) => Promise<UndiciResponse>;

export interface GuardedFetchOptions {
  fetchFn: FetchLike;
  headers: Record<string, string>;
  signal: AbortSignal;
  maxHops?: number;
  checkHost?: (hostname: string) => Promise<{ ok: boolean; reason?: string; offendingIp?: string }>;
}

export type GuardedFetchResult =
  | { ok: true; response: UndiciResponse; finalUrl: string; hops: number }
  | { ok: false; blocked: true; url: string; reason: string; hops: number }
  | { ok: false; blocked: false; url: string; reason: string; hops: number };

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export async function fetchWithGuardedRedirects(startUrl: string, opts: GuardedFetchOptions): Promise<GuardedFetchResult> {
  const maxHops = opts.maxHops ?? 5;
  const checkHost = opts.checkHost ?? assertPublicHost;
  let url = startUrl;

  for (let hops = 0; hops <= maxHops; hops += 1) {
    const policy = isUrlAllowed(url, { allow: env.ALLOWED_DOMAINS, deny: env.DENIED_DOMAINS });
    if (!policy.ok) {
      return { ok: false, blocked: true, url, reason: policy.reason ?? 'policy', hops };
    }
    const host = new URL(url).hostname;
    const ssrf = await checkHost(host);
    if (!ssrf.ok) {
      return { ok: false, blocked: true, url, reason: ssrf.reason ?? 'ssrf', hops };
    }

    const response = await opts.fetchFn(url, {
      method: 'GET',
      headers: opts.headers,
      signal: opts.signal,
      redirect: 'manual',
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { ok: true, response, finalUrl: url, hops };
    }

    const location = response.headers.get('location');
    await response.body?.cancel().catch(() => undefined);
    if (!location) {
      return { ok: false, blocked: false, url, reason: `redirect_without_location:${response.status}`, hops };
    }
    let next: string;
    try {
      next = new URL(location, url).toString();
    } catch {
      return { ok: false, blocked: false, url, reason: 'redirect_bad_location', hops };
    }
    if (hops === maxHops) {
      return { ok: false, blocked: false, url: next, reason: `too_many_redirects:${maxHops}`, hops: hops + 1 };
    }
    url = next;
  }
  return { ok: false, blocked: false, url, reason: 'unreachable', hops: maxHops };
}
