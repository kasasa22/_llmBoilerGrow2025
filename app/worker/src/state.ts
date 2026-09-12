/**
 * NetworkState — the object threaded through every agent + tool in the
 * multi-agent Network (plan A1). Zod-validated so tool outputs cannot
 * silently poison state; agents mutate through `push*` helpers only.
 */
import { ulid } from 'ulid';
import { z } from 'zod';

export const SourceSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  title: z.string(),
  fetchedAt: z.string(),
});
export type Source = z.infer<typeof SourceSchema>;

export const EvidenceSchema = z.object({
  sourceId: z.string(),
  chunkText: z.string(),
  tokensApprox: z.number().nonnegative(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const SourceScoreSchema = z.object({
  sourceId: z.string(),
  score: z.number().min(0).max(1),
  reason: z.string(),
});
export type SourceScore = z.infer<typeof SourceScoreSchema>;

export const ClaimSchema = z.object({
  id: z.string(),
  text: z.string(),
  sourceIds: z.array(z.string()).min(1),
  confidence: z.number().min(0).max(1),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const CitationSchema = z.object({
  n: z.number().int().positive(),
  url: z.string().url(),
  title: z.string(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const StateErrorSchema = z.object({
  agent: z.string(),
  code: z.string().optional(),
  msg: z.string(),
  at: z.string(),
});
export type StateError = z.infer<typeof StateErrorSchema>;

export const NetworkPhase = z.enum(['research', 'analysis', 'synthesis', 'done']);
export type NetworkPhase = z.infer<typeof NetworkPhase>;

export const NetworkStateSchema = z.object({
  jobId: z.string(),
  traceId: z.string(),
  query: z.string(),
  phase: NetworkPhase,
  iteration: z.number().int().nonnegative(),
  sources: z.array(SourceSchema),
  rawEvidence: z.array(EvidenceSchema),
  sourceScores: z.array(SourceScoreSchema),
  claims: z.array(ClaimSchema),
  finalAnswer: z.string().nullable(),
  citations: z.array(CitationSchema),
  errors: z.array(StateErrorSchema),
});
export type NetworkState = z.infer<typeof NetworkStateSchema>;

export function initialState(input: { jobId: string; traceId: string; query: string }): NetworkState {
  return {
    jobId: input.jobId,
    traceId: input.traceId,
    query: input.query,
    phase: 'research',
    iteration: 0,
    sources: [],
    rawEvidence: [],
    sourceScores: [],
    claims: [],
    finalAnswer: null,
    citations: [],
    errors: [],
  };
}

export function newSourceId(): string {
  return ulid();
}
export function newClaimId(): string {
  return ulid();
}
