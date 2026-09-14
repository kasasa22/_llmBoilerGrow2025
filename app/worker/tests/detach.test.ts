import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, expect, it } from 'vitest';

import { runDetached } from '../src/detach.js';
import { currentTrace, withTrace } from '../src/trace.js';

const als = new AsyncLocalStorage<string>();

describe('runDetached', () => {
  it('hides the caller store from synchronous and awaited code', async () => {
    const seen = await als.run('outer', () =>
      runDetached(async () => {
        const before = als.getStore();
        await new Promise((resolve) => setTimeout(resolve, 1));
        const after = als.getStore();
        return { before, after };
      }),
    );
    expect(seen).toEqual({ before: undefined, after: undefined });
    expect(als.getStore()).toBeUndefined();
  });

  it('does not leak the detached context back to the caller', async () => {
    await als.run('outer', async () => {
      await runDetached(async () => {
        await Promise.resolve();
      });
      expect(als.getStore()).toBe('outer');
    });
  });

  it('allows a new trace store to be entered inside the detached context', async () => {
    const ctx = { trace_id: 'abc', job_id: 'job_1', span_id: 's1', parent_span_id: null };
    const seen = await als.run('outer', () =>
      runDetached(() =>
        withTrace(ctx, async () => {
          await Promise.resolve();
          return { trace: currentTrace(), other: als.getStore() };
        }),
      ),
    );
    expect(seen.trace).toEqual(ctx);
    expect(seen.other).toBeUndefined();
  });

  it('a trace re-entered inside a foreign context is visible to awaited work', async () => {
    const ctx = { trace_id: 'abc', job_id: 'job_1', span_id: 's1', parent_span_id: null };
    const traced = <T>(fn: () => Promise<T>) => () => withTrace(ctx, fn);
    const seen = await runDetached(
      traced(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return currentTrace();
      }),
    );
    expect(seen).toEqual(ctx);
  });

  it('propagates return values and errors', async () => {
    expect(runDetached(() => 42)).toBe(42);
    await expect(runDetached(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });
});
