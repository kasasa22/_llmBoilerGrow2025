/**
 * urlPolicy.isUrlAllowed — string-level allow/deny policy on eTLD+1.
 * DNS-based SSRF checks live in ssrf.test.ts.
 */
import { describe, expect, it } from 'vitest';

import { isUrlAllowed } from '../src/tools/urlPolicy.js';

describe('isUrlAllowed', () => {
  it('accepts http and https public URLs when both lists are empty', () => {
    expect(isUrlAllowed('https://civo.com/kubernetes', { allow: [], deny: [] })).toEqual({
      ok: true,
      domain: 'civo.com',
    });
    expect(isUrlAllowed('http://kubernetes.io/docs', { allow: [], deny: [] }).ok).toBe(true);
  });

  it('rejects non-http(s) schemes', () => {
    const r = isUrlAllowed('file:///etc/passwd', { allow: [], deny: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('FETCH_BLOCKED');
      expect(r.reason).toMatch(/unsupported_scheme/);
    }
  });

  it('rejects raw IP hosts even without allow/deny (SSRF hardening)', () => {
    const r = isUrlAllowed('http://10.0.0.1/', { allow: [], deny: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('raw_ip_forbidden');
    }
  });

  it('rejects malformed URLs', () => {
    const r = isUrlAllowed('not a url', { allow: [], deny: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('invalid_url');
    }
  });

  it('rejects hostnames without a public suffix', () => {
    const r = isUrlAllowed('http://localhost/', { allow: [], deny: [] });
    expect(r.ok).toBe(false);
  });

  it('applies denylist BEFORE allowlist', () => {
    // On allowlist AND denylist → denylist wins.
    const opts = { allow: ['pastebin.com'], deny: ['pastebin.com'] };
    const r = isUrlAllowed('https://pastebin.com/raw/abc', opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('denylisted:pastebin.com');
  });

  it('empty allowlist means "allow all"', () => {
    const r = isUrlAllowed('https://random.example/', { allow: [], deny: [] });
    expect(r.ok).toBe(true);
  });

  it('non-empty allowlist rejects domains not on it', () => {
    const r = isUrlAllowed('https://not-in-list.io/', { allow: ['civo.com', 'kubernetes.io'], deny: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_in_allowlist:not-in-list.io');
  });

  it('non-empty allowlist accepts domains on it (eTLD+1 match)', () => {
    // Subdomains of allowed domains should be accepted (eTLD+1 comparison).
    expect(
      isUrlAllowed('https://docs.civo.com/kubernetes', { allow: ['civo.com'], deny: [] }).ok,
    ).toBe(true);
    expect(
      isUrlAllowed('https://www.kubernetes.io/docs', { allow: ['kubernetes.io'], deny: [] }).ok,
    ).toBe(true);
  });

  it('denylist rejects across subdomains', () => {
    const r = isUrlAllowed('https://raw.pastebin.com/', { allow: [], deny: ['pastebin.com'] });
    expect(r.ok).toBe(false);
  });
});
