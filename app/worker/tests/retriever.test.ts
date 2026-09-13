/**
 * EvidenceStore — in-memory RAG store. Verifies the RAG-off / circuit-open
 * fallback returns un-embedded chunks in insertion order (no cosine, no embed).
 *
 * The embedding path itself is not tested here because it requires a live
 * Ollama instance; the fallback path is the safety net + failure mode that
 * matters for correctness.
 */
import { describe, expect, it } from 'vitest';

import { EvidenceStore } from '../src/rag/retriever.js';

describe('EvidenceStore with RAG disabled', () => {
  it('addSource returns chunkCount + embedded=false', async () => {
    const store = new EvidenceStore({ ragEnabled: false });
    const text = 'A '.repeat(600); // ~1200 chars, will split into multiple chunks
    const r = await store.addSource('src_1', text);
    expect(r.embedded).toBe(false);
    expect(r.chunkCount).toBeGreaterThan(0);
  });

  it('circuitOpen() reports the effective state (false when RAG off, no failures)', async () => {
    const store = new EvidenceStore({ ragEnabled: false });
    await store.addSource('src_1', 'x'.repeat(400));
    expect(store.circuitOpen()).toBe(false);
  });

  it('topK returns chunks in insertion order without embedding', async () => {
    const store = new EvidenceStore({ ragEnabled: false });
    await store.addSource('src_a', 'the quick brown fox jumps over the lazy dog. '.repeat(20));
    await store.addSource('src_b', 'kubernetes clusters host containerized workloads. '.repeat(20));

    const results = await store.topK('kubernetes', 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3);
    // Fallback path: scores are 0 (no cosine computed).
    for (const r of results) expect(r.score).toBe(0);
    // First chunk should come from src_a (insertion order), NOT scored by relevance.
    expect(results[0].chunk.sourceId).toBe('src_a');
  });

  it('totalChars tracks the sum of chunk text lengths (chunks overlap by RAG_CHUNK_OVERLAP)', async () => {
    const store = new EvidenceStore({ ragEnabled: false });
    await store.addSource('src_1', 'a'.repeat(1000));
    const total = store.totalChars();
    // Chunks overlap by design, so total >= input length.
    expect(total).toBeGreaterThanOrEqual(1000);
  });

  it('topK with k=0 returns empty', async () => {
    const store = new EvidenceStore({ ragEnabled: false });
    await store.addSource('src_1', 'x'.repeat(400));
    const r = await store.topK('anything', 0);
    expect(r).toEqual([]);
  });

  it('empty store returns empty topK', async () => {
    const store = new EvidenceStore({ ragEnabled: false });
    expect(await store.topK('anything', 3)).toEqual([]);
  });
});
