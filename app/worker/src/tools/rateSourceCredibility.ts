/**
 * rateSourceCredibility — Analysis-agent tool. Scores a source 0..1 with a
 * one-line reason; downstream synthesis prefers higher-scored sources when
 * multiple citations for the same claim compete.
 */
import { createTool } from '@inngest/agent-kit';
import { z } from 'zod';

import type { BudgetTracker } from '../budget.js';
import { Phase } from '../events.js';
import { publishEvent } from '../redis.js';
import type { NetworkState } from '../state.js';

export interface RateSourceDeps {
  budget: BudgetTracker;
  jobId: string;
  state: NetworkState;
}

export function createRateSourceCredibilityTool(deps: RateSourceDeps) {
  return createTool({
    name: 'rateSourceCredibility',
    description:
      'Rate a source 0..1 for credibility. Consider: primary vs. secondary, reputation, freshness, and whether it corroborates other sources.',
    parameters: z.object({
      sourceId: z.string().min(1).describe('Source id from state.sources'),
      score: z.number().min(0).max(1),
      reason: z.string().min(3).max(200),
    }),
    handler: async ({ sourceId, score, reason }) => {
      deps.budget.onToolCall('rateSourceCredibility');
      if (!deps.state.sources.some((s) => s.id === sourceId)) {
        throw new Error(`rateSourceCredibility: unknown sourceId ${sourceId}`);
      }
      // Replace previous score for the same source (idempotent).
      deps.state.sourceScores = deps.state.sourceScores.filter((s) => s.sourceId !== sourceId);
      deps.state.sourceScores.push({ sourceId, score, reason });
      await publishEvent({
        jobId: deps.jobId,
        phase: Phase.AnalysisSourceScored,
        data: { sourceId, score, reason },
      });
      return { accepted: true };
    },
  });
}
