/**
 * Recursive character splitter (plan A2).
 * Deterministic chunk IDs so re-runs produce stable output — this is what
 * makes the RAG pipeline idempotent-friendly.
 */
import { env } from '../config.js';
import type { Chunk } from './types.js';

const SEPARATORS = ['\n\n', '\n', '. ', ' '] as const;

export interface ChunkOptions {
  sourceId: string;
  chunkSize?: number;
  overlap?: number;
}

export function chunkText(text: string, opts: ChunkOptions): Chunk[] {
  const size = Math.max(50, opts.chunkSize ?? env.RAG_CHUNK_SIZE);
  const overlap = Math.max(0, Math.min(opts.overlap ?? env.RAG_CHUNK_OVERLAP, size - 1));
  const clean = text.replace(/\r\n/g, '\n').replace(/\s+$/g, '');
  const raw = _split(clean, size, overlap);
  const chunks: Chunk[] = [];
  for (let ordinal = 0; ordinal < raw.length; ordinal += 1) {
    const body = raw[ordinal].trim();
    if (body.length < 40) continue;
    chunks.push({
      id: `${opts.sourceId}:${ordinal}`,
      sourceId: opts.sourceId,
      text: body,
      ordinal,
      tokensApprox: Math.ceil(body.length / 4),
      embedded: false,
    });
  }
  return chunks;
}

function _split(text: string, size: number, overlap: number): string[] {
  if (text.length <= size) return [text];

  for (const sep of SEPARATORS) {
    if (!text.includes(sep)) continue;
    const parts = text.split(sep);
    return _pack(parts, sep, size, overlap);
  }
  // Hard cut fallback.
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + size));
    i += size - overlap;
  }
  return out;
}

function _pack(parts: string[], sep: string, size: number, overlap: number): string[] {
  const out: string[] = [];
  let buf = '';
  for (const part of parts) {
    const next = buf ? buf + sep + part : part;
    if (next.length <= size) {
      buf = next;
      continue;
    }
    if (buf) out.push(buf);
    if (part.length <= size) {
      buf = _tail(out[out.length - 1] ?? '', overlap) + (out.length ? sep : '') + part;
    } else {
      // A single part too big; sub-split by hard cut.
      let i = 0;
      while (i < part.length) {
        out.push(part.slice(i, i + size));
        i += size - overlap;
      }
      buf = '';
    }
  }
  if (buf) out.push(buf);
  return out;
}

function _tail(s: string, n: number): string {
  return n > 0 && s.length > n ? s.slice(-n) : '';
}
