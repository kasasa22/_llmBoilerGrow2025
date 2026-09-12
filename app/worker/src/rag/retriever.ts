/**
 * Per-job in-memory vector store.
 *
 * Rationale for skipping pgvector/Qdrant is documented in ADR-006. Summary:
 * chunk count per job stays under ~200, matrix scan is ~50us, no infra to
 * add. Cosine on pre-normalized Float32 vectors → dot product.
 *
 * If embedding is off (circuit open, RAG_ENABLED=false, or embed failure),
 * chunks are kept un-embedded and topK returns them in insertion order —
 * this preserves the first-8k-chars fallback described in the plan.
 */
import { env } from '../config.js';
import { chunkText } from './chunker.js';
import { EmbedderCircuit, embedChunks, embedQuery } from './embedder.js';
import type { Chunk, EmbeddedChunk, EvidenceStoreLike, RetrievalResult } from './types.js';

export class EvidenceStore implements EvidenceStoreLike {
  private embedded: EmbeddedChunk[] = [];
  private unembedded: Chunk[] = [];
  private _totalChars = 0;
  private circuit = new EmbedderCircuit();
  private ragOn: boolean;

  constructor(opts: { ragEnabled?: boolean } = {}) {
    this.ragOn = opts.ragEnabled ?? env.RAG_ENABLED;
  }

  circuitOpen(): boolean {
    return this.circuit.open;
  }

  totalChars(): number {
    return this._totalChars;
  }

  async addSource(sourceId: string, text: string): Promise<{ chunkCount: number; embedded: boolean }> {
    const chunks = chunkText(text, { sourceId });
    this._totalChars += chunks.reduce((a, c) => a + c.text.length, 0);

    if (!this.ragOn || this.circuit.open) {
      this.unembedded.push(...chunks);
      return { chunkCount: chunks.length, embedded: false };
    }
    try {
      const embedded = await embedChunks(chunks, { circuit: this.circuit });
      if (embedded.length === chunks.length) {
        this.embedded.push(...embedded);
        return { chunkCount: chunks.length, embedded: true };
      }
      // Partial success: keep what embedded, fall back for the rest.
      this.embedded.push(...embedded);
      const failedIds = new Set(embedded.map((c) => c.id));
      this.unembedded.push(...chunks.filter((c) => !failedIds.has(c.id)));
      return { chunkCount: chunks.length, embedded: this.embedded.length > 0 };
    } catch {
      this.unembedded.push(...chunks);
      return { chunkCount: chunks.length, embedded: false };
    }
  }

  async topK(query: string, k: number): Promise<RetrievalResult[]> {
    if (!this.ragOn || this.circuit.open || this.embedded.length === 0) {
      return this.unembedded.slice(0, k).map((chunk) => ({ chunk, score: 0 }));
    }
    const qvec = await embedQuery(query, { circuit: this.circuit });
    if (!qvec) {
      return this.unembedded.slice(0, k).map((chunk) => ({ chunk, score: 0 }));
    }
    const scored: RetrievalResult[] = this.embedded.map((c) => ({ chunk: c, score: dot(qvec, c.vector) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.filter((r) => r.score >= env.RAG_MIN_SIMILARITY).slice(0, k);
  }
}

function dot(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let acc = 0;
  for (let i = 0; i < len; i += 1) acc += a[i] * b[i];
  return acc;
}
