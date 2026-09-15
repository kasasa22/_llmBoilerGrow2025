import { describe, expect, it } from 'vitest';

import { fetchWithGuardedRedirects, type FetchLike } from '../src/tools/redirects.js';

function fakeFetch(routes: Record<string, { status: number; location?: string }>): { fn: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fn: FetchLike = async (url) => {
    calls.push(url);
    const r = routes[url] ?? { status: 404 };
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      headers: { get: (k: string) => (k === 'location' ? (r.location ?? null) : null) },
      body: { cancel: async () => undefined },
    } as never;
  };
  return { fn, calls };
}

const publicHost = async () => ({ ok: true });
const privateFor = (bad: string) => async (host: string) =>
  host === bad ? { ok: false, reason: `ssrf:blocked_private_ip:${host}` } : { ok: true };
const base = { headers: {}, signal: new AbortController().signal };

describe('fetchWithGuardedRedirects', () => {
  it('returns the response when there is no redirect', async () => {
    const { fn, calls } = fakeFetch({ 'https://a.example/': { status: 200 } });
    const r = await fetchWithGuardedRedirects('https://a.example/', { ...base, fetchFn: fn, checkHost: publicHost });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.finalUrl).toBe('https://a.example/');
    expect(calls).toEqual(['https://a.example/']);
  });

  it('follows http to https and relative redirects, reporting the final url', async () => {
    const { fn, calls } = fakeFetch({
      'http://a.example/': { status: 301, location: 'https://a.example/' },
      'https://a.example/': { status: 302, location: '/docs/' },
      'https://a.example/docs/': { status: 200 },
    });
    const r = await fetchWithGuardedRedirects('http://a.example/', { ...base, fetchFn: fn, checkHost: publicHost });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.finalUrl).toBe('https://a.example/docs/');
      expect(r.hops).toBe(2);
    }
    expect(calls).toHaveLength(3);
  });

  it('blocks a redirect that lands on a private host without fetching it', async () => {
    const { fn, calls } = fakeFetch({
      'https://a.example/': { status: 302, location: 'http://169.254.169.254/latest/meta-data/' },
    });
    const r = await fetchWithGuardedRedirects('https://a.example/', {
      ...base,
      fetchFn: fn,
      checkHost: privateFor('169.254.169.254'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.blocked).toBe(true);
      expect(r.url).toBe('http://169.254.169.254/latest/meta-data/');
    }
    expect(calls).toEqual(['https://a.example/']);
  });

  it('blocks a redirect to a scheme the url policy rejects', async () => {
    const { fn, calls } = fakeFetch({ 'https://a.example/': { status: 302, location: 'file:///etc/passwd' } });
    const r = await fetchWithGuardedRedirects('https://a.example/', { ...base, fetchFn: fn, checkHost: publicHost });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocked).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('gives up after the hop limit', async () => {
    const { fn } = fakeFetch({
      'https://a.example/1': { status: 302, location: '/2' },
      'https://a.example/2': { status: 302, location: '/3' },
      'https://a.example/3': { status: 302, location: '/4' },
    });
    const r = await fetchWithGuardedRedirects('https://a.example/1', { ...base, fetchFn: fn, checkHost: publicHost, maxHops: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.blocked).toBe(false);
      expect(r.reason).toMatch(/too_many_redirects/);
    }
  });

  it('treats a redirect with no location as a fetch error', async () => {
    const { fn } = fakeFetch({ 'https://a.example/': { status: 302 } });
    const r = await fetchWithGuardedRedirects('https://a.example/', { ...base, fetchFn: fn, checkHost: publicHost });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/redirect_without_location/);
  });
});
