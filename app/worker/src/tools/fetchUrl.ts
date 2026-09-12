/**
 * fetchUrl tool — SSRF-guarded fetcher that also feeds the RAG store.
 *
 * Call order (locked in ADR-008):
 *   1. isUrlAllowed()               — cheap string policy, tldts eTLD+1.
 *   2. DNS resolve + private-CIDR   — SSRF hardening.
 *   3. HTTP GET with timeout + size cap.
 *   4. Text extraction via cheerio.
 *   5. evidenceStore.addSource()    — chunk + optional embed.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { createTool } from '@inngest/agent-kit';
import * as cheerio from 'cheerio';
import { fetch } from 'undici';
import { z } from 'zod';

import type { BudgetTracker } from '../budget.js';
import { env } from '../config.js';
import { AgentError, ErrorCode } from '../errors.js';
import { Phase } from '../events.js';
import { logger } from '../logger.js';
import type { EvidenceStore } from '../rag/retriever.js';
import { publishEvent } from '../redis.js';
import { type NetworkState, newSourceId } from '../state.js';
import { isUrlAllowed } from './urlPolicy.js';

export interface FetchUrlDeps {
  budget: BudgetTracker;
  jobId: string;
  evidence: EvidenceStore;
  state: NetworkState;
  signal: AbortSignal;
}

const UA = 'BosmartResearchAgent/0.1 (+https://github.com/kasasa22/_llmBoilerGrow2025)';

export function createFetchUrlTool(deps: FetchUrlDeps) {
  return createTool({
    name: 'fetchUrl',
    description:
      'Fetch and read a web page. Returns cleaned text plus a source id you must cite. Skip URLs already fetched.',
    parameters: z.object({
      url: z.string().url().describe('Absolute URL to fetch'),
    }),
    handler: async ({ url }) => {
      deps.budget.onFetch(url);
      deps.budget.onToolCall('fetchUrl');

      // Skip re-fetches (state-level idempotency for the agent).
      if (deps.state.sources.some((s) => s.url === url)) {
        return { skipped: true, reason: 'already_fetched', url };
      }

      const policy = isUrlAllowed(url, { allow: env.ALLOWED_DOMAINS, deny: env.DENIED_DOMAINS });
      if (!policy.ok) {
        await publishEvent({
          jobId: deps.jobId,
          phase: Phase.ToolError,
          data: { tool: 'fetchUrl', code: ErrorCode.FetchBlocked, reason: policy.reason, url },
        });
        throw new AgentError({
          code: ErrorCode.FetchBlocked,
          message: `blocked: ${policy.reason}`,
          context: { url, reason: policy.reason },
        });
      }

      await publishEvent({
        jobId: deps.jobId,
        phase: Phase.ToolCalled,
        data: { tool: 'fetchUrl', args: { url } },
      });

      const parsed = new URL(url);
      await assertNotPrivateHost(parsed.hostname);

      const timeoutSignal = AbortSignal.timeout(env.FETCH_URL_TIMEOUT_MS);
      let res;
      try {
        res = await fetch(url, {
          method: 'GET',
          headers: {
            'user-agent': UA,
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5',
            'accept-language': 'en-US,en;q=0.9',
          },
          signal: anyAbortSignal([deps.signal, timeoutSignal]),
          redirect: 'follow',
        });
      } catch (err) {
        const msg = (err as Error).message;
        await publishEvent({
          jobId: deps.jobId,
          phase: Phase.ToolError,
          data: { tool: 'fetchUrl', code: ErrorCode.FetchError, message: msg, url },
        });
        throw new AgentError({ code: ErrorCode.FetchError, message: msg, cause: err, context: { url } });
      }

      if (!res.ok) {
        throw new AgentError({
          code: ErrorCode.FetchError,
          message: `http ${res.status}`,
          context: { url, status: res.status },
        });
      }

      const contentType = res.headers.get('content-type') || '';
      if (!/text\/|json|xml/.test(contentType)) {
        throw new AgentError({
          code: ErrorCode.FetchBlocked,
          message: `unsupported content-type: ${contentType}`,
          context: { url, contentType },
        });
      }

      const buf = await readCapped(res.body, env.FETCH_URL_MAX_BYTES);
      const html = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      const { title, text } = extractText(html, /html/.test(contentType));

      const sourceId = newSourceId();
      const finalUrl = res.url ?? url;
      deps.state.sources.push({ id: sourceId, url: finalUrl, title: title || finalUrl, fetchedAt: new Date().toISOString() });

      const { chunkCount, embedded } = await deps.evidence.addSource(sourceId, text);
      deps.state.rawEvidence.push({
        sourceId,
        chunkText: text.slice(0, 800),
        tokensApprox: Math.ceil(text.length / 4),
      });

      await publishEvent({
        jobId: deps.jobId,
        phase: Phase.ResearchSourceFound,
        data: { sourceId, url: finalUrl, title },
      });
      await publishEvent({
        jobId: deps.jobId,
        phase: Phase.RagChunksIndexed,
        data: { sourceId, chunkCount, embedded },
      });
      await publishEvent({
        jobId: deps.jobId,
        phase: Phase.ToolResult,
        data: {
          tool: 'fetchUrl',
          summary: `${chunkCount} chunks (${embedded ? 'embedded' : 'raw'})`,
          sourceId,
          url: finalUrl,
        },
      });

      return { sourceId, url: finalUrl, title, chars: text.length, chunkCount, embedded };
    },
  });
}

// ---- helpers --------------------------------------------------------------

async function assertNotPrivateHost(hostname: string): Promise<void> {
  const candidates = new Set<string>();
  if (isIP(hostname)) {
    candidates.add(hostname);
  } else {
    try {
      const records = await lookup(hostname, { all: true });
      for (const r of records) candidates.add(r.address);
    } catch {
      // DNS fail: hand off to fetch which will error naturally.
      return;
    }
  }
  for (const ip of candidates) {
    if (isPrivateIp(ip)) {
      throw new AgentError({
        code: ErrorCode.FetchBlocked,
        message: `ssrf:blocked_private_ip:${ip}`,
        context: { hostname, ip },
      });
    }
  }
}

function isPrivateIp(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('169.254.')) return true; // link-local + AWS metadata
  if (ip.startsWith('0.')) return true;
  if (/^(fc|fd)/i.test(ip)) return true; // ULA
  if (/^fe80:/i.test(ip)) return true; // link-local v6
  // 172.16.0.0/12
  const m = /^172\.(\d+)\./.exec(ip);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
}

async function readCapped(body: unknown, maxBytes: number): Promise<Uint8Array> {
  if (!body || typeof (body as { getReader?: () => unknown }).getReader !== 'function') {
    return new Uint8Array(0);
  }
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        break;
      }
      chunks.push(value);
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function extractText(html: string, isHtml: boolean): { title: string; text: string } {
  if (!isHtml) {
    return { title: '', text: html.slice(0, 20_000) };
  }
  const $ = cheerio.load(html);
  $('script, style, nav, footer, header, noscript, svg, form').remove();
  const title = ($('title').first().text() || $('h1').first().text() || '').trim();
  const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 20_000);
  logger.debug({ chars: text.length }, 'fetchUrl.extract');
  return { title, text };
}

function anyAbortSignal(signals: AbortSignal[]): AbortSignal {
  if (typeof (AbortSignal as unknown as { any?: (a: AbortSignal[]) => AbortSignal }).any === 'function') {
    return (AbortSignal as unknown as { any: (a: AbortSignal[]) => AbortSignal }).any(signals);
  }
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      return ctrl.signal;
    }
    s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}
