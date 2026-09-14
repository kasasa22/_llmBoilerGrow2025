# 010. Run the agent network in one Inngest step; synthesise with a plain completion

- Status: Accepted
- Date: 2026-09-14
- Deciders: Trevor Kasasa
- Tags: architecture, agents, inngest, reliability
- Supersedes parts of: ADR-003 (step-per-agent durability), ADR-004 (SynthesisAgent tool-call exit)

## Context and Problem Statement

On the CPU deployment every query produced the same failure: the SSE timeline showed
the search → fetch → synthesis cycle repeated four times, and the only "answer" was
the bullet-list fallback ("the synthesis step did not converge"). Runs took 180-200 s
and often ended with the wall-clock message instead of an answer.

Two mechanisms combined to cause this.

1. **Inngest replay re-executed the agent loop.** AgentKit detects Inngest step tools
   through `AsyncLocalStorage` and turns every model call into `step.ai.infer`, but it
   runs tool handlers (`webSearch`, `fetchUrl`) as plain code. Inngest re-invokes the
   whole function after every step and replays memoised results, so all non-step code
   ran again on every invocation: tool handlers re-fetched URLs and re-embedded
   chunks, every Redis publish fired again (the duplicated timeline), and the
   `forcedSynthesis` completion, which was outside any step, ran once per invocation.
   With three steps after the network (`publish-final`, `persist-final`, `mark-done`)
   that meant four full synthesis calls per job. The pre-network wall-clock guard then
   tripped on a later replay and overwrote a finished run with the timeout message.
2. **The synthesis completion had a fixed 60 s timeout.** `qwen2.5:7b` on a 4-vCPU
   node needs 60-120 s to read ~1.5k prompt tokens and write 300 words, so the call
   was aborted and the fallback text was used even on runs that would have finished.

A secondary quality problem: the `SynthesisAgent` never saw the fetched text. Its
system prompt listed only the source count, and AgentKit's message history carries
tool results as summaries, so on the rare runs that reached it the model had nothing
to cite.

## Decision Drivers

- A real, cited answer on every run on the CPU deployment is the submission bar.
- Keep Inngest as the orchestrator with a legible step tree in the dashboard.
- Keep the multi-agent network code path available for GPU deployments.
- No new infrastructure.

## Considered Options

1. Keep AgentKit's per-model-call steps and make every tool handler a memoised step
   too, rehydrating `NetworkState` and the RAG store from step outputs on replay.
2. Run the entire network plus synthesis inside **one** `step.run`, with AgentKit
   forced onto its plain-HTTP path so it does not nest steps.
3. Drop Inngest steps around the network entirely and publish results with plain
   awaits after it.

## Decision Outcome

Chosen: **option 2**, plus a first-class direct synthesis completion.

- `functions/research.ts` runs `runJob()` inside `step.run('run-agent-network')`.
  `runJob` builds the network, runs it via `runDetached()` (a module-load
  `AsyncLocalStorage.snapshot()` that hides the Inngest context from AgentKit), then,
  if no `submitAnswer` happened, calls `directSynthesis()`. It never throws; every
  failure is folded into a serialisable outcome so the caller can always publish
  `final` and `done` and the SSE stream closes.
- The steps around it (`acquire-lock`, `mark-running`, `publish-job-started`,
  `publish-final`, `persist-final`, `mark-done`) are cheap and idempotent, so replays
  cost nothing. The lock is released in `mark-done`/`mark-failed`, not in a `finally`
  that Inngest's pending-promise mechanism would never reach.
- `retries` goes from 0 to 1 (`INNGEST_RETRIES`). The earlier 0 stopped retry storms
  caused by model errors; those can no longer escape `runJob`, so the only thing a
  retry now covers is infrastructure: during verification a query posted while the
  worker pod was restarting produced `EOF writing request to SDK` and, at 0 retries,
  a permanently lost job with no `final` event.
- `directSynthesis()` (`synthesize.ts`) is one streamed `POST /api/chat` on Ollama's
  native API with `num_predict`, `num_ctx`, and `keep_alive` set, its own clock
  (`SYNTHESIS_TIMEOUT_MS`, default 240 s, separate from the research clock
  `MAX_WALL_CLOCK_MS`), thinking disabled for models that support it, and a prompt
  that numbers sources so `[n]` citations map one-to-one to the citation list the UI
  renders. Because the response is streamed, an expiring clock keeps the prose written
  so far (trimmed to the last sentence, flagged `partial`) instead of discarding it.
- Prompts are laid out for Ollama's KV prefix cache: the research agent's static rules
  come first and the per-turn numbers last, search snippets are capped at 160 chars,
  and Ollama runs with `OLLAMA_NUM_PARALLEL=1` and a fixed `OLLAMA_CONTEXT_LENGTH`
  equal to the worker's `OLLAMA_NUM_CTX`. Measured on a 4-core laptop CPU: prompt
  evaluation 13 tok/s, generation 4 tok/s, so a 1.2k-token turn costs ~90 s cold and
  a cached follow-up turn a fraction of that.
- `SKIP_SYNTHESIS_AGENT=true` (default on CPU) makes the router end the network as
  soon as research is ready, so the pipeline is Research agent → direct completion.
  With it off, the `SynthesisAgent` runs as before, now with the retrieved evidence
  primed into its system prompt on the research → synthesis transition, and the
  direct completion remains the fallback if it exits without `submitAnswer`.
- Comparison questions ("X vs Y") raise the research floor to two sources when the
  fetch budget allows, so both sides get a fetched page.
- The worker pre-loads the chat and embedding models at boot and Ollama runs with
  `OLLAMA_KEEP_ALIVE=1h`, so the first query of a demo is not the slowest.

### Positive Consequences

- Each job runs the agent loop exactly once: one search, one to two fetches, one
  synthesis call. No duplicated timeline events, no re-fetching, no leaked timers.
- The answer is a real cited markdown answer; the bullet-list fallback only appears
  if Ollama itself fails within the synthesis window.
- Wall-clock accounting is honest: the research budget and the synthesis budget are
  separate and both are enforced inside the step.

### Negative Consequences

- The Inngest dashboard shows one `run-agent-network` step instead of one step per
  agent call. Per-call durability is lost; the trade is accepted because a run is at
  most a few minutes and `retries: 0` already disabled retry-based recovery.
- AgentKit's plain-HTTP model calls carry no request timeout, so a hung Ollama
  request overruns the research budget by one call. The synthesis call has its own
  timeout and the outer wall clock still bounds the job.

## Alternatives Considered

### Option 1: memoise every tool handler as a step

Correct in principle, but the tool step outputs would have to carry the fetched text
and embedding vectors so state and the RAG store could be rebuilt on replay, and the
budget counters would need to survive replays too. Much more code for a benefit
(resumable tool calls) that does not matter at this run length.

### Option 3: no steps after the network

Fixes the four-times replay but leaves the tool handlers replaying once per model
call during the loop, and loses the memoised `final` publish. Rejected.

## Links

- Function: `app/worker/src/functions/research.ts`
- Detached runner: `app/worker/src/detach.ts`
- Direct synthesis: `app/worker/src/synthesize.ts`, `app/worker/src/ollama.ts`
- Router change: `app/worker/src/router.ts` (`skip_synthesis` reason)
- Related: ADR-003, ADR-004, ADR-006
