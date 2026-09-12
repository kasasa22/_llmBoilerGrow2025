# 008. SSRF hardening in fetchUrl

- Status: Accepted
- Date: 2026-09-14
- Deciders: Trevor Ssuuna
- Tags: security

## Context and Problem Statement

The `fetchUrl` tool takes an LLM-proposed URL and issues an HTTP request. The URL is
attacker-controlled by construction — a research agent could be steered by an
adversarial prompt to fetch `http://ollama.ollama.svc.cluster.local:11434`, the AWS
metadata service, or an internal admin endpoint.

## Decision Drivers

- Zero private-network reachability from `fetchUrl`.
- Cheap enough that we can afford to run all checks on every call.
- Layered: a policy failure at any step is a `FETCH_BLOCKED` — never a raw exception.

## Considered Options

1. No guard (trust the agent). *Rejected on principle.*
2. Private-CIDR check only.
3. Full stack: WHATWG parse + tldts eTLD+1 + allow/deny lists + DNS resolve +
   private-CIDR block + timeout + size cap + optional robots.txt.

## Decision Outcome

Chosen: **Full stack**, in this order:

1. `isUrlAllowed()` — pure string check via `tldts` for eTLD+1 comparison against
   `ALLOWED_DOMAINS` / `DENIED_DOMAINS`.
2. DNS resolve → private-CIDR block (`10/8`, `127/8`, `169.254/16`, `172.16/12`,
   `192.168/16`, `0/8`, `fc00::/7`, `fe80::/10`). Blocks the metadata IP explicitly.
3. HTTP GET with 10 s timeout and 1 MB size cap.
4. Optional robots.txt honouring (off by default; 1 h per-host cache when on).

### Positive Consequences
- Attacker can't pivot from an adversarial prompt to internal services.
- Failures surface as `FETCH_BLOCKED` with a concrete reason (`ssrf:...`,
  `denylisted:...`, `not_in_allowlist:...`) — the agent then picks a different source.

### Negative Consequences
- False positives on legit internal docs shipped on private IPs (out of scope).
- `RESPECT_ROBOTS_TXT=false` in dev by design; ADR-compliant reviewers may want it on.

## Alternatives Considered

### Private-CIDR only
Pros: cheap. Cons: no protection against agent exfiltration to arbitrary public hosts.
Rejected — half a control.

## Links

- Policy: `app/worker/src/tools/urlPolicy.ts`
- Fetcher: `app/worker/src/tools/fetchUrl.ts`
- Errors: `docs/errors.md#FETCH_BLOCKED`
