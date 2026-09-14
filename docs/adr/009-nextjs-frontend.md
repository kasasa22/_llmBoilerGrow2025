# 009. Next.js 15 App Router as the sole frontend

- Status: Accepted (amended 2026-09-14 — vanilla baseline UI removed)
- Date: 2026-09-13
- Deciders: Trevor Kasasa
- Tags: architecture, frontend

## Amendment — 2026-09-14

The original decision (below) introduced the Next.js UI as an *additive* service
alongside the vanilla `app/templates/index.html` baseline. Once the Next.js UI reached
feature parity — matching the SSE envelope, adding phase progress, citations, chat
history — the vanilla UI became dead weight and was removed together with
`app/static/` and the `ui` Flask blueprint. Flask now serves only the JSON API
(`POST /api/chat`, `GET /api/jobs/<id>/stream`, `GET /healthz`, `GET /` returns a
descriptor pointing at the Next.js host).

The context and reasoning below is preserved as-written for historical accuracy.

## Context and Problem Statement

The initial frontend is a vanilla HTML/JS/CSS UI served by Flask at
`app/templates/index.html`. That was the right minimum for an SSE-only chat interface
with zero build step. As the project grew, three shortcomings became visible:

1. **No component model.** Growing the UI (badges, panels, timeline, answer render,
   citations, error banner, connection status) as functions of a single 250-line
   `app.js` starts to hurt readability and test-ability.
2. **Cross-origin friction if the frontend ever moves off the Flask origin.** Direct
   browser POSTs to Flask would need CORS configured; the vanilla setup happens to
   avoid this only because it is *served by* Flask.
3. **No typed contract for the SSE envelope.** The vanilla JS deals with 25 phase
   strings via string comparison. Any drift between backend event names and frontend
   handlers is silent.

The multi-agent Network already demands more structure on the UI side (agent
transitions, tool calls, per-source citation rendering, RAG events). That is enough
justification to reach for a component framework.

## Decision Drivers

- **Component model** — a Server Component page shell + a Client Component tree lets
  the interactive chat live in one focused subtree; the badges/env metadata stay in
  static server-rendered markup.
- **Typed SSE envelope** — a TypeScript discriminated union of the 25 phase strings
  gives compile-time exhaustiveness in the timeline renderer.
- **Same-origin API from the browser** — a route handler in the frontend service
  proxies `/api/chat` and `/api/jobs/[id]/stream` to Flask server-side. The browser
  only ever talks to the frontend origin. No CORS setup on the Flask side.
- **Deployment story** — the `output: 'standalone'` build produces a self-contained
  node server that fits the existing Helm + GHCR + Terraform + LoadBalancer pattern
  used by Flask and the worker. No new deploy shape to invent.
- **Zero regression** — the existing Flask vanilla UI must remain functional and
  deployable as a "baseline" reference.

## Considered Options

1. **Keep vanilla-only, iterate the JS in-place** — cheapest, but the readability
   and typing issues compound as UI grows.
2. **React SPA (Vite/CRA)** — component model + typing. But requires CORS on Flask
   because the SPA runs on a different origin, and needs nginx-alpine to serve the
   `dist/` output.
3. **HTMX + partial hydration** — SSE via `hx-sse` is elegant; MPA-native. Skips
   TypeScript typing of the envelope. Off-target for the async multi-phase UX we want.
4. **Next.js 15 App Router** — chosen.

## Decision Outcome

Chosen: **Next.js 15 App Router + React 19 + TypeScript strict**, added as an ADDITIVE
`web/` service alongside Flask. The vanilla UI at `flask:8080/` stays as a "baseline";
the Next.js UI at `web:3001/` becomes the primary interactive interface.

### Positive Consequences

- Route handlers at `web/app/api/chat/route.ts` and
  `web/app/api/jobs/[id]/stream/route.ts` proxy the browser's requests to Flask
  server-side, so **the browser never crosses an origin** and CORS is unnecessary.
- SSE passthrough is a one-liner: `return new Response(upstream.body, { … })`. No
  buffering, no framework-specific streaming API to fight.
- `output: 'standalone'` produces a self-contained node server. Runtime image is
  ~150 MB and deploys identically to Flask and the worker (Helm chart mirroring
  the app chart shape).
- Typed discriminated union of the 25 SSE phases in `web/lib/events.ts` — the
  timeline renderer's `switch(event.phase)` is compile-time exhaustive.
- Server Component page shell + Client Component interactive subtree is a clear
  split; static header/footer stays server-rendered, no client JS penalty for the
  chrome.

### Negative Consequences / Trade-offs

- Two UIs now live in the codebase. Explained in `__README.MD` "Design notes"; both
  UIs share the same idempotency guarantees on the API side (ADR-007).
- One more image to build in CI (now three: Flask, worker, web).
- Standalone Next.js image (~150 MB) is larger than the vanilla Flask image but still
  well within the free GHCR quota.
- Server Components cannot consume SSE (EventSource is browser-only) — the
  interactive chat lives entirely in a `"use client"` subtree. Documented so a
  reader doesn't wonder why more of the page isn't a Server Component.

## Alternatives Considered

### React SPA (Vite/CRA)

Pros: familiar bundling; smaller build; simpler mental model than App Router.
Cons: needs CORS on Flask (SPA runs on a different origin from the API); nginx-alpine
runtime config; no route handler primitive to hide the backend behind. **Rejected —
Next.js is a superset of the React-SPA capability for this project.**

### HTMX + partial hydration

Pros: minimal JS; MPA-native; `hx-sse` for streaming. Cons: no static typing of the
envelope; server templating and client hydration split changes the "one JavaScript
codebase" mental model. **Rejected — off-target for a multi-phase async UI.**

### Vanilla-only + iterate in place

Pros: zero rebuild. Cons: no path to typed SSE envelope; growing component structure
becomes brittle. **Rejected in favour of an additive rebuild.**

## Links

- Next.js app: [`web/`](../../web/)
- Route handler proxy: [`web/app/api/chat/route.ts`](../../web/app/api/chat/route.ts)
- SSE passthrough: [`web/app/api/jobs/[id]/stream/route.ts`](../../web/app/api/jobs/[id]/stream/route.ts)
- Hook: [`web/hooks/useJobStream.ts`](../../web/hooks/useJobStream.ts)
- Type surface: [`web/lib/events.ts`](../../web/lib/events.ts)
- Helm chart: [`infra/helm/web/`](../../infra/helm/web/)
- Related: ADR-001 (Flask + TS split), ADR-005 (Redis pub/sub for SSE fan-out).
