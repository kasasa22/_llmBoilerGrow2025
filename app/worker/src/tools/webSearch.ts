/**
 * webSearch tool — Tavily API when TAVILY_API_KEY is present, else scrape
 * DuckDuckGo HTML. Rate-limited, timeout-bounded, budget-tracked.
 */
import { createTool } from '@inngest/agent-kit';
import * as cheerio from 'cheerio';
import { fetch } from 'undici';
import { z } from 'zod';

import type { BudgetTracker } from '../budget.js';
import { env } from '../config.js';
import { AgentError, ErrorCode } from '../errors.js';
import { Phase } from '../events.js';
import { logger } from '../logger.js';
import { publishEvent } from '../redis.js';

export interface WebSearchDeps {
  budget: BudgetTracker;
  jobId: string;
  signal: AbortSignal;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const DDG_HTML = 'https://html.duckduckgo.com/html/';
const TAVILY_URL = 'https://api.tavily.com/search';
const UA = 'BosmartResearchAgent/0.1 (+https://github.com/kasasa22/_llmBoilerGrow2025)';

export function createWebSearchTool(deps: WebSearchDeps) {
  return createTool({
    name: 'webSearch',
    description:
      'Search the web for information. Returns titles, URLs, and short snippets for the top results. Use a short, literal query.',
    parameters: z.object({
      query: z.string().min(2).max(200).describe('The search query'),
    }),
    handler: async ({ query }) => {
      deps.budget.onSearch(query);
      deps.budget.onToolCall('webSearch');
      const q = query.trim();
      const k = env.SEARCH_RESULTS;

      await publishEvent({
        jobId: deps.jobId,
        phase: Phase.ToolCalled,
        data: { tool: 'webSearch', args: { query: q, limit: k } },
      });

      try {
        const results = env.TAVILY_API_KEY ? await tavily(q, k, deps.signal) : await ddg(q, k, deps.signal);
        await publishEvent({
          jobId: deps.jobId,
          phase: Phase.ResearchSearchCompleted,
          data: { query: q, resultCount: results.length },
        });
        await publishEvent({
          jobId: deps.jobId,
          phase: Phase.ToolResult,
          data: {
            tool: 'webSearch',
            summary: `${results.length} results`,
            results: results.map((r) => ({ title: r.title, url: r.url })),
          },
        });
        return {
          results: results.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet.slice(0, env.SEARCH_SNIPPET_CHARS) })),
        };
      } catch (err) {
        logger.warn({ err: (err as Error).message, query: q }, 'webSearch.failed');
        await publishEvent({
          jobId: deps.jobId,
          phase: Phase.ToolError,
          data: {
            tool: 'webSearch',
            code: ErrorCode.SearchError,
            message: (err as Error).message,
          },
        });
        throw new AgentError({
          code: ErrorCode.SearchError,
          message: `webSearch failed: ${(err as Error).message}`,
          cause: err,
        });
      }
    },
  });
}

async function tavily(query: string, k: number, signal: AbortSignal): Promise<SearchResult[]> {
  const timeout = AbortSignal.timeout(env.SEARCH_TIMEOUT_MS);
  const res = await fetch(TAVILY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({
      api_key: env.TAVILY_API_KEY,
      query,
      max_results: k,
      search_depth: 'basic',
      include_answer: false,
    }),
    signal: anyAbortSignal([signal, timeout]),
  });
  if (!res.ok) throw new Error(`tavily http ${res.status}`);
  const body = (await res.json()) as { results?: { title: string; url: string; content?: string }[] };
  return (body.results ?? []).slice(0, k).map((r) => ({
    title: r.title || r.url,
    url: r.url,
    snippet: (r.content || '').slice(0, 400),
  }));
}

async function ddg(query: string, k: number, signal: AbortSignal): Promise<SearchResult[]> {
  const timeout = AbortSignal.timeout(env.SEARCH_TIMEOUT_MS);
  const params = new URLSearchParams({ q: query, kl: 'us-en' });
  const res = await fetch(`${DDG_HTML}?${params.toString()}`, {
    method: 'GET',
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9',
      'accept-language': 'en-US,en;q=0.9',
    },
    signal: anyAbortSignal([signal, timeout]),
  });
  if (!res.ok) throw new Error(`ddg http ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const out: SearchResult[] = [];
  $('.result').each((_, el) => {
    if (out.length >= k) return;
    const anchor = $(el).find('a.result__a').first();
    let href = anchor.attr('href') || '';
    // DDG wraps outbound links via a redirect: /l/?uddg=<encoded>
    const uddg = new URL(href, DDG_HTML).searchParams.get('uddg');
    if (uddg) href = decodeURIComponent(uddg);
    if (!href) return;
    const title = anchor.text().trim();
    const snippet = $(el).find('.result__snippet').text().trim().slice(0, 400);
    if (title && href.startsWith('http')) out.push({ title, url: href, snippet });
  });
  return out;
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
