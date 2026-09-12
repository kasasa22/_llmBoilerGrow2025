# 007. Idempotency strategy: outbox-lite (SETNX + request-hash)

- Status: Accepted
- Date: 2026-09-14
- Deciders: Trevor Ssuuna
- Tags: architecture, correctness

## Context and Problem Statement

Two failure modes produce duplicate work:

1. **Ingress**: the client retries `POST /api/chat` (network wobble, load-balancer
   idempotency, browser back button).
2. **Delivery**: Inngest re-delivers `research/query.submitted` to the worker (retry,
   worker crash mid-run, cluster upgrade).

Without dedup, the same query fires two GPU-bound runs and two SSE streams diverge.
The interview reviewer specifically probed this area.

## Decision Drivers

- No new infra beyond Redis.
- Same semantics whether the client sends `Idempotency-Key` or not.
- Late subscribers replay the terminal event without triggering re-execution.

## Considered Options

1. Full transactional outbox on a relational DB.
2. At-least-once + client-side dedup.
3. **Outbox-lite**: Redis `SETNX job:{id}:lock` + request-hash mapping + Inngest step
   memoisation via deterministic step IDs.

## Decision Outcome

Chosen: **outbox-lite**. Two layers:

- Ingress: `request_hash = sha256(normalize(query) [+ ":" + Idempotency-Key])` binds
  identical retries to the same `job_id` via Redis `SET NX`.
- Worker: `SETNX job:{id}:lock <owner> EX 300` with a 30 s heartbeat and Lua CAS
  takeover for stale locks.
- Step IDs are pure functions of iteration + tool call index, exploiting Inngest's
  built-in step memoisation on function retries.

### Positive Consequences
- Duplicate POSTs collapse to a single background job.
- Worker crash mid-run: the next worker takes over the stale lock and replays.
- Late subscribers replay the final envelope from `job:{id}:final`.

### Negative Consequences
- Correctness relies on Redis durability (AOF every-second). If Redis loses the last
  second of writes, an in-flight job could be re-run — acceptable at this scale.
- No 409 detail when a client reuses an `Idempotency-Key` with a body that only
  differs by whitespace — the normalise step is a light hash, not a diff.

## Alternatives Considered

### Full transactional outbox
Pros: rigorous. Cons: drags a Postgres dependency in for a single table. Rejected on
scope.

### At-least-once + client dedup
Pros: simplest server. Cons: the browser can't dedup GPU minutes; and the client is
usually the code that broke retry etiquette in the first place. Rejected.

## Links

- Ingress: `app/idempotency.py`
- Worker lock: `app/worker/src/idempotency.ts`
- Redis key layout: plan file `B1. Idempotency` section
- Smoke test: `scripts/smoke-idempotency.sh`
