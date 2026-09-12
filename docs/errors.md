# Error codes

Every SSE `error` and `budget.hit` event carries an `ErrorCode`. The taxonomy
below is the source of truth — see [`app/worker/src/errors.ts`](../app/worker/src/errors.ts)
for the retry policy per code.

| Code | When | Retryable | Retry policy | Terminal? |
|---|---|---|---|---|
| `MODEL_ERROR` | Ollama 5xx / timeout / non-JSON | yes | 3× exp backoff (1s/3s/9s) | on exhaust |
| `MODEL_TOOL_PARSE_ERROR` | LLM tool call args fail zod after 2 repair attempts | no | none — counted against `consecutive_tool_errors` | soft |
| `TOOL_ERROR` | Unclassified tool failure | conditional | 1× for idempotent tools | soft |
| `SEARCH_ERROR` | Tavily/DDG 5xx or HTML parse failure | yes | 2× (500ms/2s) | soft |
| `FETCH_ERROR` | 4xx/5xx (except 429), TLS/DNS/timeout/size-cap | conditional | 1× on 5xx/timeout | soft |
| `FETCH_BLOCKED` | SSRF guard / robots / mime / allowlist | no | never — pick another URL | soft |
| `BUDGET_EXCEEDED` | Any of the `MAX_*` limits hit | no | forced synthesis path | soft (partial final) |
| `RATE_LIMITED` | Upstream 429 or our semaphore | yes | honor `Retry-After`; else 2s/4s/8s | on exhaust |
| `E_RAG_EMBED_FAIL` | Embedder circuit opened (3 consecutive failures) | no | fallback to first-8k-chars | soft |
| `E_RAG_NO_MATCHES` | topK returned nothing above similarity floor | no | synthesis is told "no strong matches" | soft |
| `E_RESEARCH_NO_SOURCES` | Research phase exited with 0 sources | no | terminate with apology | soft |
| `E_ANALYSIS_NO_CLAIMS` | Analysis produced no claims | no | synthesis skipped | soft |
| `E_SYNTHESIS_NO_CITATIONS` | Answer lacks `[n]` refs | no | one retry with stricter prompt | soft |
| `E_ROUTER_BUDGET` | `callCount >= NETWORK_MAX_CALLS` | no | never | soft |
| `E_ROUTER_WALLCLOCK` | `network.run` exceeded `NETWORK_WALL_CLOCK_MS` | no | never | soft |
| `INTERNAL_ERROR` | Last-resort catchall | no | none | hard (abort) |

## Sample SSE payload

```
event: error
id: 42
data: {
  "seq": 42,
  "type": "error",
  "code": "FETCH_BLOCKED",
  "message": "blocked: ssrf:blocked_private_ip:10.0.0.1",
  "retryable": false,
  "attempt": 1,
  "context": {"url": "http://internal.example/api", "iteration": 3, "tool": "fetchUrl"},
  "ts": "2026-09-14T12:34:56.789Z"
}
```

## UI behaviour per code

| Category | Rendering |
|---|---|
| Retryable soft | Yellow inline banner; agent continues. |
| Non-retryable soft | Dimmed line, e.g. "skipped: <url> — blocked by SSRF guard". |
| `BUDGET_EXCEEDED` | Orange banner above the final: "hit budget cap, showing best available answer". |
| Hard terminals | Red banner replacing "thinking…"; user acks to submit again. |
