# 002. Self-hosted Inngest (single-binary) vs Inngest Cloud

- Status: Accepted
- Date: 2026-09-14
- Deciders: Trevor Kasasa
- Tags: architecture, ops, security

## Context and Problem Statement

Inngest orchestrates the multi-agent research fn. It ships as either a managed
"Inngest Cloud" or an OSS single-binary. The reviewer will inspect the dashboard mid-demo.

## Decision Drivers

- Reviewer must see the run tree without signing up.
- Keys stay in-cluster (no third-party control plane).
- Infra footprint stays small.

## Considered Options

1. Inngest Cloud (managed).
2. Self-hosted single-binary in-cluster with a LoadBalancer service.
3. Alternative queue (BullMQ / raw Redis Streams) with a custom UI.

## Decision Outcome

Chosen: **Self-hosted single-binary** with the dashboard exposed via LoadBalancer on 8288.

### Positive Consequences
- Reviewer opens `http://<lb-ip>:8288` immediately — no signup, no invite.
- Signing/event keys never leave the cluster.
- Redis is already in the stack; Inngest storage is the only extra dep.

### Negative Consequences
- OSS build has no built-in auth. LB is public. **Demo-only trade-off.**
- Single-binary uses local storage — not HA. Fine for the assessment; would need
  clustered deployment in production.

## Alternatives Considered

### Inngest Cloud
Pros: managed HA + built-in auth + team-scoped dashboards. Cons: reviewer needs an
account or trusts screenshots; keys leave the cluster. Rejected — worse Loom story.

### BullMQ / raw Streams
Pros: no extra service. Cons: rebuilds Inngest's step durability + dashboard from
scratch. Rejected — outside the brief and the time budget.

## Links

- Chart: `infra/helm/inngest/`
- Terraform: `infra/tf/helm-inngest.tf`
- Related: ADR-005
