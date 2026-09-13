/**
 * SSRF hardening — isPrivateIp() and assertPublicHost() work together to keep
 * fetchUrl from talking to internal services. See ADR-008.
 */
import { describe, expect, it } from 'vitest';

import { assertPublicHost, isPrivateIp } from '../src/tools/ssrf.js';

describe('isPrivateIp', () => {
  it.each([
    ['10.0.0.1'],
    ['10.255.255.255'],
    ['127.0.0.1'],
    ['192.168.1.1'],
    ['169.254.169.254'], // AWS/GCP metadata endpoint
    ['169.254.0.1'],
    ['172.16.0.1'],
    ['172.31.255.255'],
    ['0.0.0.0'],
  ])('flags %s as private (IPv4)', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each([
    ['::1'],
    ['fc00::1'],
    ['fd00::1'],
    ['fe80::1'],
  ])('flags %s as private (IPv6)', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each([
    ['8.8.8.8'],
    ['1.1.1.1'],
    ['172.15.0.1'], // just below the /12 range
    ['172.32.0.1'], // just above the /12 range
    ['172.10.0.1'],
    ['2606:4700:4700::1111'], // Cloudflare public v6
  ])('does NOT flag public %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });

  it('returns false for empty / garbage input', () => {
    expect(isPrivateIp('')).toBe(false);
    expect(isPrivateIp('not-an-ip')).toBe(false);
  });
});

describe('assertPublicHost', () => {
  it('accepts a literal public IP', async () => {
    const r = await assertPublicHost('8.8.8.8');
    expect(r.ok).toBe(true);
  });

  it('rejects a literal private IP', async () => {
    const r = await assertPublicHost('10.0.0.1');
    expect(r.ok).toBe(false);
    expect(r.offendingIp).toBe('10.0.0.1');
    expect(r.reason).toMatch(/ssrf:blocked_private_ip/);
  });

  it('rejects the AWS metadata IP by literal', async () => {
    const r = await assertPublicHost('169.254.169.254');
    expect(r.ok).toBe(false);
    expect(r.offendingIp).toBe('169.254.169.254');
  });

  it('DNS failure returns ok=true with a reason (fetch will fail naturally)', async () => {
    const r = await assertPublicHost('bosmart-does-not-exist.invalid');
    expect(r.ok).toBe(true);
    expect(r.reason).toMatch(/dns_unresolved/);
  });
});
