import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const V4_BLOCKED: Array<[number, number]> = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0a80000, 16],
  [0xe0000000, 4],
  [0xf0000000, 4],
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out = out * 256 + n;
  }
  return out;
}

function inV4Block(n: number, base: number, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((n & mask) >>> 0) === ((base & mask) >>> 0);
}

function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  return V4_BLOCKED.some(([base, bits]) => inV4Block(n, base, bits));
}

function expandIpv6(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = ipv4ToInt(tail);
    if (v4 === null) return null;
    text = `${text.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 && head.length !== 8) return null;
  if (halves.length === 2 && missing < 1) return null;
  const groups = [...head, ...(halves.length === 2 ? Array<string>(missing).fill('0') : []), ...rest];
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out.length === 8 ? out : null;
}

function isPrivateIpv6(ip: string): boolean {
  const g = expandIpv6(ip);
  if (!g) return false;
  const allZero = g.every((x) => x === 0);
  if (allZero) return true;
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true;
  const mapped = g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff;
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0);
  if (mapped || nat64) {
    const v4 = ((g[6] << 16) | g[7]) >>> 0;
    return V4_BLOCKED.some(([base, bits]) => inV4Block(v4, base, bits));
  }
  if ((g[0] & 0xfe00) === 0xfc00) return true;
  if ((g[0] & 0xffc0) === 0xfe80) return true;
  if ((g[0] & 0xff00) === 0xff00) return true;
  return false;
}

export function isPrivateIp(ip: string): boolean {
  if (!ip) return false;
  const family = isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return false;
}

export interface HostResolution {
  addresses: string[];
  reason?: string;
}

export async function resolveHost(hostname: string): Promise<HostResolution> {
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (isIP(bare)) {
    return { addresses: [bare] };
  }
  try {
    const records = await lookup(bare, { all: true });
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
