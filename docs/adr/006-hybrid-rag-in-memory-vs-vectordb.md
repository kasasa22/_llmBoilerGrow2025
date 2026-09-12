# 006. Hybrid RAG: in-memory cosine top-K vs a real vector DB

- Status: Accepted
- Date: 2026-09-14
- Deciders: Trevor Ssuuna
- Tags: data, rag

## Context and Problem Statement

After `fetchUrl` we chunk each page and want to feed only the top-k relevant chunks to
Analysis + Synthesis. A full vector DB (pgvector / Qdrant / Weaviate) is the standard
answer; the scope of one job is at most ~200 chunks, so a dependency of that scale is
unjustified.

## Decision Drivers

- Zero infra footprint beyond Ollama + Redis.
- Deterministic per-job lifecycle (state doesn't outlive the job).
- Named upgrade path for future cross-session memory.

## Considered Options

1. In-memory `Float32Array` matrix + dot-product cosine (per-job store).
2. `pgvector` extension in a small Postgres.
3. Qdrant sidecar in the cluster.

## Decision Outcome

Chosen: **in-memory per-job `EvidenceStore`** using `Float32Array` matrix + cosine on
pre-normalized vectors.

### Positive Consequences
- ~50 µs to scan a 200-row matrix; negligible next to a model call.
- No extra chart, no PVC, no backup story.
- Falls back to first-8k-chars if `nomic-embed-text` is unreachable.

### Negative Consequences
- No cross-job memory (by design; the assessment is stateless per request).
- No hybrid dense/sparse retrieval; a follow-up PR would swap this out.

## Alternatives Considered

### pgvector
Pros: durable; industry-standard. Cons: adds Postgres + Helm chart + secret rotation.
Named as the first upgrade path when cross-session memory is needed.

### Qdrant sidecar
Pros: purpose-built. Cons: heavier than pgvector; another dashboard to secure.
Rejected on scope.

## Links

- Store: `app/worker/src/rag/retriever.ts`
- Embedder: `app/worker/src/rag/embedder.ts`
- Related: ADR-004 (embedding model)
