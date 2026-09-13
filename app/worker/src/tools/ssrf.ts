/**
 * Pure SSRF guards for `fetchUrl`. Split out for testability — DNS-based
 * checks are covered by `tests/ssrf.test.ts` without hitting the network.
 * See ADR-008.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Return true if the given IPv4 or IPv6 address is on the private / link-local set. */
export function isPrivateIp(ip: string): boolean {
  if (!ip) return false;
  const family = isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return false;
}

function isPrivateIpv4(ip: string): boolean {
  if (ip === '127.0.0.1') return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  // Link-local incl. cloud metadata IPs (169.254.169.254 is AWS/GCP metadata).
  if (ip.startsWith('169.254.')) return true;
  if (ip.startsWith('0.')) return true;
  // 172.16.0.0/12
  const m = /^172\.(\d+)\./.exec(ip);
  if (m) {
    const octet = Number(m[1]);
    if (octet >= 16 && octet <= 31) return true;
  }
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1') return true;
  // ULA: fc00::/7 → first byte matches fc or fd.
  if (/^(fc|fd)/i.test(lower)) return true;
  // Link-local v6: fe80::/10.
  if (/^fe8[0-9a-f]:/i.test(lower)) return true;
  return false;
}

export interface HostResolution {
  addresses: string[];
  reason?: string;
}

/**
 * DNS-resolve a hostname (or accept a literal IP) and return all A/AAAA records.
 * Returns an empty list on failure — the caller decides how to react.
 */
export async function resolveHost(hostname: string): Promise<HostResolution> {
  if (isIP(hostname)) {
    return { addresses: [hostname] };
  }
  try {
    const records = await lookup(hostname, { all: true });
    return { addresses: records.map((r) => r.address) };
  } catch (err) {
    return { addresses: [], reason: (err as Error).message };
  }
}

export interface SsrfCheckResult {
  ok: boolean;
  offendingIp?: string;
  reason?: string;
}

/**
 * Resolve a hostname and reject any that maps (fully or partially) to a private
 * network. Applied AFTER the string-level urlPolicy check in fetchUrl.
 */
export async function assertPublicHost(hostname: string): Promise<SsrfCheckResult> {
  const resolution = await resolveHost(hostname);
  if (resolution.addresses.length === 0) {
    return { ok: true, reason: `dns_unresolved:${resolution.reason ?? 'unknown'}` };
  }
  for (const ip of resolution.addresses) {
    if (isPrivateIp(ip)) {
      return { ok: false, offendingIp: ip, reason: `ssrf:blocked_private_ip:${ip}` };
    }
  }
  return { ok: true };
}
