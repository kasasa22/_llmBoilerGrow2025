import { createTool } from '@inngest/agent-kit';
import { z } from 'zod';

import type { BudgetTracker } from '../budget.js';
import { Phase } from '../events.js';
import { publishEvent } from '../redis.js';
import type { NetworkState } from '../state.js';
import { citationsFor, finaliseAnswer } from '../synthesize.js';

export interface SubmitAnswerDeps {
  budget: BudgetTracker;
  jobId: string;
  state: NetworkState;
}

export function createSubmitAnswerTool(deps: SubmitAnswerDeps) {
  return createTool({
    name: 'submitAnswer',
    description:
      'Submit the final markdown answer. Only call once. Cite with [n] where n is the source number from SOURCES; list the numbers you used in `citations`.',
    parameters: z.object({
      answer: z.string().min(20).describe('Markdown answer with [n] citation refs'),
      citations: z
        .array(z.object({ n: z.number().int().positive(), url: z.string().optional(), title: z.string().optional() }))
        .max(20)
        .optional()
        .default([]),
    }),
    handler: async ({ answer, citations }) => {
      deps.budget.onToolCall('submitAnswer');
      const known = citationsFor(deps.state.sources);
      const requested = new Set(citations.map((c) => c.n));
      const used = known.filter((c) => requested.has(c.n));
      const final = used.length > 0 ? used : known;
      deps.state.finalAnswer = finaliseAnswer(answer, new Set(final.map((c) => c.n)), false);
      deps.state.citations = final;
      await publishEvent({
        jobId: deps.jobId,
        phase: Phase.SynthesisAnswerReady,
        data: { length: deps.state.finalAnswer.length, citationCount: final.length, dropped: citations.length - used.length },
      });
      return { accepted: true, citations: final.map((c) => c.n) };
    },
  });
}
