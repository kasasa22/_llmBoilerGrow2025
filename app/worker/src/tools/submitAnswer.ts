/**
 * submitAnswer — terminal Synthesis-agent tool.
 * Setting state.finalAnswer is the ONLY clean-exit path from the network
 * (router returns undefined once phase='done').
 */
import { createTool } from '@inngest/agent-kit';
import { z } from 'zod';

import type { BudgetTracker } from '../budget.js';
import { Phase } from '../events.js';
import { publishEvent } from '../redis.js';
import type { NetworkState } from '../state.js';

export interface SubmitAnswerDeps {
  budget: BudgetTracker;
  jobId: string;
  state: NetworkState;
}

export function createSubmitAnswerTool(deps: SubmitAnswerDeps) {
  return createTool({
    name: 'submitAnswer',
    description:
      'Submit the final markdown answer plus its citations. Only call once. Every non-trivial sentence in `answer` must reference an [n] citation from the `citations` array.',
    parameters: z.object({
      answer: z.string().min(20).describe('Markdown answer with [n] citation refs'),
      citations: z
        .array(
          z.object({
            n: z.number().int().positive(),
            url: z.string().url(),
            title: z.string().min(1),
          }),
        )
        .min(1)
        .max(20),
    }),
    handler: async ({ answer, citations }) => {
      deps.budget.onToolCall('submitAnswer');
      deps.state.finalAnswer = answer;
      deps.state.citations = citations;
      await publishEvent({
        jobId: deps.jobId,
        phase: Phase.SynthesisAnswerReady,
        data: { length: answer.length, citationCount: citations.length },
      });
      return { accepted: true };
    },
  });
}
