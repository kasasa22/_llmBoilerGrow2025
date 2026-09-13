# 004. Model choice: qwen3:8b

- Status: Accepted
- Date: 2026-09-14
- Deciders: Trevor Kasasa
- Tags: model, cost

## Context and Problem Statement

The Civo GPU node is `g4s.kube.small` (single GPU, ~24 GB VRAM). All three network
agents call the same model — we can only ship one that fits.

## Decision Drivers

- Fits on a single 24GB GPU with headroom for a second concurrent request.
- Reliable OpenAI-compatible tool-calling on Ollama.
- English + code + moderate reasoning depth.

## Considered Options

1. `llama3.3` (70B) — too big for the node.
2. `gemma3:4b` — small, weak on structured tool calls under load.
3. `qwen3:8b` — 8B, ships in Ollama, tool-call reliable.
4. `mistral-nemo:12b` — good but larger; less headroom.

## Decision Outcome

Chosen: **qwen3:8b** for all three agents.

### Positive Consequences
- Fits comfortably; leaves room for concurrent embed calls to `nomic-embed-text`.
- Consistent behaviour across agents; one prompt tuning surface.
- Already in the boilerplate's `default_models` list.

### Negative Consequences
- qwen3 sometimes emits `<think>…</think>` blocks that must be stripped in the UI
  layer; noted in the synthesis-agent post-processor TODO.

## Alternatives Considered

### llama3.3:70b
Pros: strongest reasoning. Cons: doesn't fit on `g4s.kube.small`. Rejected.

### gemma3:4b
Pros: fast; low VRAM. Cons: drops `arguments` from tool_calls when the prompt grows.
Rejected — flaky under Analysis-phase load.

### mistral-nemo:12b
Pros: strong on tool calls. Cons: less headroom for embeds; unclear win over qwen3:8b.
Rejected on parsimony.

## Links

- Env: `MODEL_NAME=qwen3:8b` in `infra/helm/{app,worker}/values.yaml`
- Ollama models: `infra/tf/variables.tf#default_models`
