# 001. Two-service split: Flask API + Node/TS AgentKit worker

- Status: Accepted
- Date: 2026-09-14
- Deciders: Trevor Kasasa
- Tags: architecture, runtime

## Context and Problem Statement

The brief says "extend the Flask application" AND "use Inngest AgentKit". AgentKit is a
TypeScript-first framework; a first-class Python equivalent does not exist. Choosing one
language forces a compromise on one side of the brief.

## Decision Drivers

- Fidelity to the brief (both "Flask" and "AgentKit").
- Reviewer legibility: the cluster should look like a real system, not a stunt.
- Time budget: 4 days.

## Considered Options

1. Pure Python — Flask + `inngest-py` with hand-rolled agent primitives.
2. Pure TypeScript — replace Flask with Fastify/Hono + AgentKit.
3. Split — Flask API/SSE/UI + Node worker with AgentKit, communicating via Inngest events.

## Decision Outcome

Chosen: **Split**. Flask owns HTTP, static UI, SSE fan-out; Node/TS worker owns the
multi-agent Network. They meet only at the Inngest event boundary.

### Positive Consequences
- Faithful to both keywords in the brief.
- Each service is small and single-purpose.
- Event-driven boundary demonstrates decoupling.

### Negative Consequences
- Two Dockerfiles, two CI paths, two lint workflows.
- Two runtime environments to reason about in Loom.

## Alternatives Considered

### Pure Python
Pros: single language; less infra. Cons: not actually "AgentKit"; would need to rebuild
router + state primitives ourselves. Rejected — loses the seniority signal AgentKit brings.

### Pure TypeScript
Pros: cleanest AgentKit story. Cons: contradicts "extend the Flask application" in the
brief. Rejected — reviewer wording is explicit.

## Links

- Code: `app/*.py` (Flask), `app/worker/src/*.ts` (worker)
- Related: ADR-003
