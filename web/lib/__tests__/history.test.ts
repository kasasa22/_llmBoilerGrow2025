import { describe, expect, it } from 'vitest';

import { resolveHistorySelection } from '@/lib/history';

describe('resolveHistorySelection', () => {
  it('shows the stored answer when there is one', () => {
    expect(resolveHistorySelection({ answer: 'done', jobId: 'job_1' })).toBe('archive');
  });
  it('re-attaches to the stream when a job exists but has not answered yet', () => {
    expect(resolveHistorySelection({ answer: null, jobId: 'job_1' })).toBe('reattach');
  });
  it('pre-fills the question only when the submission never produced a job', () => {
    expect(resolveHistorySelection({ answer: null, jobId: null })).toBe('prefill');
  });
});
