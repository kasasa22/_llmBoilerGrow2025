# 003. AgentKit multi-agent Network vs a single agent with tools

- Status: Accepted, amended by ADR-010 (the network now runs inside a single Inngest
  step, and on CPU deploys the Synthesis phase is a direct completion rather than the
  SynthesisAgent)
- Date: 2026-09-14
- Deciders: Trevor Kasasa
- Tags: architecture, agents

## Context and Problem Statement

A single "research agent with tools" conflates three concerns: evidence gathering,
judgement about which evidence supports which claim, and final prose generation. This
degrades quality when the LLM has to hold everything at once.

## Decision Drivers

- Signal that agent orchestration is understood, not just tool use.
- Deterministic phase boundaries (visible in the Inngest step tree).
- Testability: each agent has a narrow prompt and a testable tool surface.

## Considered Options

1. Single agent — `webSearch`, `fetchUrl`, `submitAnswer` in one loop.
2. Multi-agent Network — `Research → Analysis → Synthesis` behind a hybrid router.
3. LangGraph — Python-native state machines for LLM apps.

## Decision Outcome

Chosen: **Multi-agent Network** via AgentKit's `createNetwork` + a hybrid router
(deterministic phase gate + agent-driven within phase).

### Positive Consequences
- Clear separation of concerns; each agent's prompt is short and focused.
- Router is easy to test in isolation.
- Free `step.run` durability from Inngest around every phase transition.

### Negative Consequences
- Extra router prompt = one more failure surface.
- Token cost is roughly 2.5× a single-agent baseline — capped by `NETWORK_MAX_CALLS=12`
  and `NETWORK_WALL_CLOCK_MS=120000`.

## Alternatives Considered

### Single agent with tools
Pros: cheapest, one prompt. Cons: prose quality drops as tool history piles up in
context; router state is implicit. Rejected — no seniority signal.

### LangGraph
Pros: mature Python state-machine primitives. Cons: contradicts the Flask+AgentKit
brief and duplicates AgentKit's Network. Rejected.

## Links

- Router: `app/worker/src/network.ts`
- Agents: `app/worker/src/agents/{research,analysis,synthesis}.ts`
- Related: ADR-001, ADR-006, ADR-007
- External: https://agentkit.inngest.com/concepts/networks
