# 005. Redis pub/sub for SSE fan-out

- Status: Accepted
- Date: 2026-09-14
- Deciders: Trevor Kasasa
- Tags: architecture, transport

## Context and Problem Statement

The worker publishes per-phase events; the browser subscribes via SSE served by Flask.
We need cross-process pub/sub + a small replay log so late subscribers see the run.

## Decision Drivers

- Cross-pod fan-out (Flask + worker in different Deployments).
- Replay on reconnect / late subscribers.
- Minimum extra infra.

## Considered Options

1. Redis pub/sub + `LPUSH job:{id}:log` for replay.
2. Inngest Realtime (event-side subscription).
3. Postgres `LISTEN/NOTIFY`.

## Decision Outcome

Chosen: **Redis pub/sub + Redis LIST replay**. Redis is already needed for job status +
idempotency lock, so no new dependency.

### Positive Consequences
- One infra piece for three concerns (state, dedup, transport).
- LPUSH+LTRIM gives a simple 500-message replay window.
- Cheap horizontal scaling: Flask pods share the pubsub bus.

### Negative Consequences
- Pub/sub is at-most-once; the LPUSH log is the durability net.
- No fan-in coalescing — a slow subscriber cannot back-pressure the worker.

## Alternatives Considered

### Inngest Realtime
Pros: no extra transport. Cons: still beta at v0.5; couples orchestrator to transport;
harder to reason about across Flask deployments. Rejected.

### Postgres LISTEN/NOTIFY
Pros: durable. Cons: drags a whole DB dependency into a stack that doesn't otherwise
need one. Rejected on parsimony.

## Links

- Publisher: `app/worker/src/redis.ts#publishEvent`
- Subscriber: `app/routes/stream.py`
- Related: ADR-002
