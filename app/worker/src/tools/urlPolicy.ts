/**
 * Pure URL policy check (no I/O). Runs BEFORE the SSRF DNS check in fetchUrl.
 * Returns a discriminated union so callers can surface FETCH_BLOCKED with a
 * concrete reason instead of a boolean.
 */
import { getDomain, parse } from 'tldts';

export type PolicyResult =
  | { ok: true; domain: string }
  | { ok: false; code: 'FETCH_BLOCKED'; reason: string };

export interface PolicyOpts {
  allow: string[];
  deny: string[];
}

export function isUrlAllowed(rawUrl: string, opts: PolicyOpts): PolicyResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, code: 'FETCH_BLOCKED', reason: 'invalid_url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, code: 'FETCH_BLOCKED', reason: `unsupported_scheme:${url.protocol}` };
  }
  const domain = getDomain(url.hostname);
  if (!domain) {
    return { ok: false, code: 'FETCH_BLOCKED', reason: 'invalid_hostname' };
  }
  const info = parse(url.hostname);
  if (info.isIp) {
    return { ok: false, code: 'FETCH_BLOCKED', reason: 'raw_ip_forbidden' };
  }
  if (opts.deny.length > 0 && opts.deny.includes(domain)) {
    return { ok: false, code: 'FETCH_BLOCKED', reason: `denylisted:${domain}` };
  }
  if (opts.allow.length > 0 && !opts.allow.includes(domain)) {
    return { ok: false, code: 'FETCH_BLOCKED', reason: `not_in_allowlist:${domain}` };
  }
  return { ok: true, domain };
}
