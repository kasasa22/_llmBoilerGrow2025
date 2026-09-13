# Architecture Decision Records

Every non-trivial choice in this project has a one-page ADR here. The
format follows [MADR 3.0](https://adr.github.io/madr/).

## Index

| # | Title | Status | Date |
|---|-------|--------|------|
| [001](001-two-service-flask-plus-ts-worker.md) | Two-service split: Flask + TS worker | Accepted | 2026-09-14 |
| [002](002-self-hosted-inngest-vs-cloud.md) | Self-hosted Inngest vs Inngest Cloud | Accepted | 2026-09-14 |
| [003](003-inngest-agentkit-multi-agent-network.md) | AgentKit multi-agent Network vs single agent | Accepted | 2026-09-14 |
| [004](004-model-choice-qwen3-8b.md) | Model choice: qwen3:8b | Accepted | 2026-09-14 |
| [005](005-redis-pubsub-for-sse-fanout.md) | Redis pub/sub for SSE fan-out | Accepted | 2026-09-14 |
| [006](006-hybrid-rag-in-memory-vs-vectordb.md) | Hybrid RAG: in-memory vs vector DB | Accepted | 2026-09-14 |
| [007](007-idempotency-strategy-outbox-lite.md) | Idempotency strategy: outbox-lite | Accepted | 2026-09-14 |
| [008](008-ssrf-hardening-in-fetchurl.md) | SSRF hardening in fetchUrl | Accepted | 2026-09-14 |
| [009](009-nextjs-frontend.md) | Next.js 15 App Router frontend on top of vanilla-JS baseline | Accepted | 2026-09-13 |

## Status legend

- **Accepted** — currently in effect.
- **Superseded by ADR-XXX** — replaced; keep the file for history.
- **Deprecated** — no longer applicable; do not re-adopt without new ADR.

## Adding a new ADR

1. Copy [`0000-template.md`](0000-template.md) to `NNN-kebab-title.md`.
2. Fill in each section.
3. Add a row to the index above.

ADRs are additive — never delete a merged one. If a decision changes, mark
the old ADR *Superseded by* and write a new one.
