import { describe, expect, it, vi } from 'vitest';

import { fetchRunStatus, parseRunStatus, startCancellationWatch, type FetchLike } from '../src/inngestRuns.js';

const reply = (status: number, body: unknown): FetchLike => async () => ({ ok: status < 400, status, json: async () => body });

describe('parseRunStatus', () => {
  it('reads the status field of the REST envelope', () => {
    expect(parseRunStatus({ data: { status: 'Cancelled' } })).toBe('Cancelled');
    expect(parseRunStatus({ data: { status: 'Running' } })).toBe('Running');
  });
  it('returns Unknown for anything else', () => {
    expect(parseRunStatus({ data: { status: 'Weird' } })).toBe('Unknown');
    expect(parseRunStatus(null)).toBe('Unknown');
    expect(parseRunStatus({})).toBe('Unknown');
  });
});

describe('fetchRunStatus', () => {
  it('returns Unknown on HTTP errors and network failures instead of throwing', async () => {
    expect(await fetchRunStatus('r1', reply(401, {}))).toBe('Unknown');
    const boom: FetchLike = async () => { throw new Error('ECONNREFUSED'); };
    expect(await fetchRunStatus('r1', boom)).toBe('Unknown');
  });
  it('returns the parsed status on success', async () => {
    expect(await fetchRunStatus('r1', reply(200, { data: { status: 'Cancelled' } }))).toBe('Cancelled');
  });
});

describe('startCancellationWatch', () => {
  it('fires onCancelled once when the run turns Cancelled and then stops polling', async () => {
    vi.useFakeTimers();
    try {
      const statuses = ['Running', 'Cancelled', 'Cancelled'];
      let calls = 0;
      const fetchFn: FetchLike = async () => { calls += 1; return { ok: true, status: 200, json: async () => ({ data: { status: statuses.shift() ?? 'Cancelled' } }) }; };
      const onCancelled = vi.fn();
      const stop = startCancellationWatch({ runId: 'r1', intervalMs: 100, onCancelled, fetchFn });
      await vi.advanceTimersByTimeAsync(100);
      expect(onCancelled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);
      expect(onCancelled).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(500);
      expect(onCancelled).toHaveBeenCalledTimes(1);
      expect(calls).toBe(2);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
  it('does nothing without a run id', () => {
    const stop = startCancellationWatch({ runId: null, intervalMs: 10, onCancelled: () => { throw new Error('should not fire'); } });
    stop();
  });
  it('stop() prevents a late callback', async () => {
    vi.useFakeTimers();
    try {
      const onCancelled = vi.fn();
      const stop = startCancellationWatch({ runId: 'r1', intervalMs: 100, onCancelled, fetchFn: reply(200, { data: { status: 'Cancelled' } }) });
      stop();
      await vi.advanceTimersByTimeAsync(300);
      expect(onCancelled).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
