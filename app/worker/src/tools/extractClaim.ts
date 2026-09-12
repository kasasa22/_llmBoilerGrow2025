/**
 * extractClaim — Analysis-agent tool. Adds an atomic claim (a sentence
 * with 1..N supporting source_ids and a confidence 0..1) to state.claims.
 */
import { createTool } from '@inngest/agent-kit';
import { z } from 'zod';

import type { BudgetTracker } from '../budget.js';
import { Phase } from '../events.js';
import { publishEvent } from '../redis.js';
import { newClaimId, type NetworkState } from '../state.js';

export interface ExtractClaimDeps {
  budget: BudgetTracker;
  jobId: string;
  state: NetworkState;
}

export function createExtractClaimTool(deps: ExtractClaimDeps) {
  return createTool({
    name: 'extractClaim',
    description:
      'Record an atomic factual claim supported by one or more source_ids from state.sources. Use for every non-trivial statement you plan to include in the answer.',
    parameters: z.object({
      text: z.string().min(6).max(400).describe('Single-sentence claim, present tense, no hedging'),
      sourceIds: z.array(z.string().min(1)).min(1).max(6).describe('Source ids from state.sources that back the claim'),
      confidence: z.number().min(0).max(1).describe('0..1; 1 = multiple primary sources agree'),
    }),
    handler: async ({ text, sourceIds, confidence }) => {
      deps.budget.onToolCall('extractClaim');
      const known = new Set(deps.state.sources.map((s) => s.id));
      const validIds = sourceIds.filter((id) => known.has(id));
      if (validIds.length === 0) {
        throw new Error('extractClaim: none of sourceIds match state.sources');
      }
      const id = newClaimId();
      deps.state.claims.push({ id, text, sourceIds: validIds, confidence });
      await publishEvent({
        jobId: deps.jobId,
        phase: Phase.AnalysisClaimExtracted,
        data: { claimId: id, text, sourceIds: validIds, confidence },
      });
      return { claimId: id, accepted: true };
    },
  });
}
