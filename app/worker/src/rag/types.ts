/**
 * Shared types for the RAG pipeline. Kept in a dedicated module so tools
 * (fetchUrl) and agents (analysis, synthesis) don't create a dep cycle
 * with retriever/embedder.
 */
export interface Chunk {
  id: string;
  sourceId: string;
  text: string;
  ordinal: number;
  tokensApprox: number;
  embedded: boolean;
}

export interface EmbeddedChunk extends Chunk {
  vector: Float32Array;
}

export interface RetrievalResult {
  chunk: Chunk;
  score: number;
}

export interface EvidenceStoreLike {
  addSource(sourceId: string, text: string): Promise<{ chunkCount: number; embedded: boolean }>;
  topK(query: string, k: number): Promise<RetrievalResult[]>;
  totalChars(): number;
  circuitOpen(): boolean;
}
