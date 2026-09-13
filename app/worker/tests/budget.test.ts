/**
 * BudgetTracker — each MAX_* limit throws BudgetExceededError at the correct
 * threshold. Wall-clock uses a mocked clock via Vitest fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BudgetTracker, type Budgets } from '../src/budget.js';
import { BudgetExceededError, ErrorCode } from '../src/errors.js';

function budgets(overrides: Partial<Budgets> = {}): Budgets {
  return {
    MAX_TOOL_CALLS: 3,
    MAX_FETCHES: 2,
    MAX_SEARCH_QUERIES: 2,
    MAX_CONTEXT_CHARS: 1000,
    MAX_WALL_CLOCK_MS: 10_000,
    MAX_TOKENS_PER_CALL: 500,
    ...overrides,
  };
}

describe('BudgetTracker.onToolCall', () => {
  it('throws BudgetExceededError when MAX_TOOL_CALLS is exceeded', () => {
    const t = new BudgetTracker(budgets({ MAX_TOOL_CALLS: 2 }));
    t.onToolCall('webSearch');
    t.onToolCall('fetchUrl');
    expect(() => t.onToolCall('fetchUrl')).toThrow(BudgetExceededError);
  });

  it('carries the offending limit and observed count', () => {
    const t = new BudgetTracker(budgets({ MAX_TOOL_CALLS: 1 }));
    t.onToolCall('webSearch');
    try {
      t.onToolCall('fetchUrl');
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      const be = err as BudgetExceededError;
      expect(be.limit).toBe('MAX_TOOL_CALLS');
      expect(be.observed).toBe(2);
      expect(be.code).toBe(ErrorCode.BudgetExceeded);
    }
  });
});

describe('BudgetTracker.onFetch and onSearch', () => {
  it('MAX_FETCHES is enforced independently of MAX_SEARCH_QUERIES', () => {
    const t = new BudgetTracker(budgets({ MAX_FETCHES: 1, MAX_SEARCH_QUERIES: 5 }));
    t.onFetch('https://a.example');
    expect(() => t.onFetch('https://b.example')).toThrow(BudgetExceededError);
  });

  it('MAX_SEARCH_QUERIES fires with the offending query', () => {
    const t = new BudgetTracker(budgets({ MAX_SEARCH_QUERIES: 1 }));
    t.onSearch('what is civo');
    try {
      t.onSearch('another query');
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      expect((err as BudgetExceededError).limit).toBe('MAX_SEARCH_QUERIES');
    }
  });
});

describe('BudgetTracker.addContext', () => {
  it('accumulates and fires exactly on threshold', () => {
    const t = new BudgetTracker(budgets({ MAX_CONTEXT_CHARS: 100 }));
    t.addContext(40);
    t.addContext(60); // now at 100, still legal
    expect(() => t.addContext(1)).toThrow(BudgetExceededError);
  });

  it('negative chars are floored to 0 (defensive)', () => {
    const t = new BudgetTracker(budgets({ MAX_CONTEXT_CHARS: 100 }));
    t.addContext(-500);
    t.addContext(100);
    expect(() => t.addContext(1)).toThrow();
  });
});

describe('BudgetTracker.wallClockRemaining', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('drops to zero after MAX_WALL_CLOCK_MS elapses', () => {
    const t = new BudgetTracker(budgets({ MAX_WALL_CLOCK_MS: 5000 }));
    expect(t.wallClockRemaining()).toBeGreaterThan(4000);
    vi.advanceTimersByTime(5001);
    expect(t.wallClockRemaining()).toBe(0);
    expect(t.isWallClockExhausted()).toBe(true);
  });

  it('onToolCall throws MAX_WALL_CLOCK_MS when clock exhausted', () => {
    const t = new BudgetTracker(budgets({ MAX_WALL_CLOCK_MS: 100, MAX_TOOL_CALLS: 100 }));
    vi.advanceTimersByTime(200);
    try {
      t.onToolCall('webSearch');
    } catch (err) {
      expect((err as BudgetExceededError).limit).toBe('MAX_WALL_CLOCK_MS');
    }
  });
});

describe('BudgetTracker.snapshot', () => {
  it('includes every counter plus a copy of the input budgets', () => {
    const t = new BudgetTracker(budgets({ MAX_TOOL_CALLS: 5 }));
    t.onToolCall('webSearch');
    t.onFetch();
    t.addContext(200);
    const s = t.snapshot();
    expect(s.toolCalls).toBe(1);
    expect(s.fetches).toBe(1);
    expect(s.contextChars).toBe(200);
    expect(s.budgets.MAX_TOOL_CALLS).toBe(5);
    expect(s.wallClockRemainingMs).toBeGreaterThan(0);
  });
});
