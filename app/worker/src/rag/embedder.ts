/**
 * Ollama /api/embeddings client with circuit-breaker.
 *
 * Behaviour:
 *  - concurrency bounded by RAG_EMBED_CONCURRENCY.
 *  - 2 retries per chunk with 200ms / 500ms backoff.
 *  - After 3 consecutive failures the breaker opens; caller then falls back
 *    to raw first-8k-chars (see retriever.ts + tools/fetchUrl.ts).
 */
import pLimit from 'p-limit';
import { fetch } from 'undici';

import { env } from '../config.js';
import { AgentError, ErrorCode } from '../errors.js';
import { logger } from '../logger.js';
import type { Chunk, EmbeddedChunk } from './types.js';

export class EmbedderCircuit {
  private consecutiveFailures = 0;
  private _open = false;
  private _openedReason: string | null = null;

  get open(): boolean {
    return this._open;
  }
  get openedReason(): string | null {
    return this._openedReason;
  }
  recordFailure(reason: string): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= 3) {
      this._open = true;
      this._openedReason = reason;
    }
  }
  recordSuccess(): void {
    this.consecutiveFailures = 0;
  }
}

export interface EmbedOptions {
  circuit: EmbedderCircuit;
  signal?: AbortSignal;
}

export async function embedChunks(chunks: Chunk[], opts: EmbedOptions): Promise<EmbeddedChunk[]> {
  if (chunks.length === 0) return [];
  if (opts.circuit.open) {
    throw new AgentError({
      code: ErrorCode.RagEmbedFail,
      message: `embed circuit open: ${opts.circuit.openedReason ?? 'unknown'}`,
    });
  }
  const limit = pLimit(env.RAG_EMBED_CONCURRENCY);
  const results = await Promise.all(
    chunks.map((chunk) => limit(() => embedOne(chunk, opts))),
  );
  return results.filter((c): c is EmbeddedChunk => c !== null);
}

export async function embedQuery(text: string, opts: EmbedOptions): Promise<Float32Array | null> {
  if (opts.circuit.open) return null;
  const vec = await embedRaw(text, opts.signal);
  if (!vec) {
    opts.circuit.recordFailure('query_embed_failed');
    return null;
  }
  opts.circuit.recordSuccess();
  return normalize(vec);
}

async function embedOne(chunk: Chunk, opts: EmbedOptions): Promise<EmbeddedChunk | null> {
  const attempts = [0, 200, 500];
  for (let i = 0; i < attempts.length; i += 1) {
    if (attempts[i] > 0) await sleep(attempts[i]);
    if (opts.signal?.aborted) return null;
    try {
      const vec = await embedRaw(chunk.text, opts.signal);
      if (!vec) throw new Error('empty embedding');
      opts.circuit.recordSuccess();
      return { ...chunk, embedded: true, vector: normalize(vec) };
    } catch (err) {
      logger.warn({ err: (err as Error).message, chunk: chunk.id, attempt: i }, 'rag.embed.retry');
      if (i === attempts.length - 1) {
        opts.circuit.recordFailure((err as Error).message);
        return null;
      }
    }
  }
  return null;
}

async function embedRaw(text: string, signal?: AbortSignal): Promise<number[] | null> {
  const url = `${env.OLLAMA_BASE_URL.replace(/\/+$/, '')}/api/embeddings`;
  const timeout = AbortSignal.timeout(env.RAG_EMBED_TIMEOUT_MS);
  const merged = signal ? anyAbortSignal([signal, timeout]) : timeout;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.RAG_EMBED_MODEL, prompt: text }),
    signal: merged,
  });
  if (!res.ok) throw new Error(`embed http ${res.status}`);
  const body = (await res.json()) as { embedding?: number[] };
  return body.embedding ?? null;
}

function normalize(vec: number[]): Float32Array {
  const out = new Float32Array(vec.length);
  let norm = 0;
  for (let i = 0; i < vec.length; i += 1) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vec.length; i += 1) out[i] = vec[i] / norm;
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function anyAbortSignal(signals: AbortSignal[]): AbortSignal {
  // Node 20 lacks AbortSignal.any() until 20.11+; construct manually.
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
