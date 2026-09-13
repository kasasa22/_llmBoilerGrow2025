/**
 * errors.classify() — every branch of the taxonomy.
 */
import { describe, expect, it } from 'vitest';

import { AgentError, BudgetExceededError, ErrorCode, classify } from '../src/errors.js';

describe('classify', () => {
  it('returns AgentError unchanged', () => {
    const original = new AgentError({ code: ErrorCode.FetchBlocked, message: 'blocked' });
    expect(classify(original)).toBe(original);
    expect(classify(new BudgetExceededError('MAX_TOOL_CALLS', 3))).toBeInstanceOf(BudgetExceededError);
  });

  it('classifies AbortError as BUDGET_EXCEEDED', () => {
    const abort = new Error('aborted');
    (abort as unknown as { name: string }).name = 'AbortError';
    const r = classify(abort);
    expect(r.code).toBe(ErrorCode.BudgetExceeded);
  });

  it.each([
    ['ETIMEDOUT: upstream', ErrorCode.ModelError],
    ['request timeout', ErrorCode.ModelError],
    ['ECONNRESET on socket', ErrorCode.ModelError],
    ['ECONNREFUSED 127.0.0.1', ErrorCode.ModelError],
  ])('%s -> MODEL_ERROR (transport)', (msg, code) => {
    expect(classify(new Error(msg)).code).toBe(code);
  });

  it('classifies a 429 message as RATE_LIMITED', () => {
    const err = new Error('upstream returned 429 Too Many Requests');
    expect(classify(err).code).toBe(ErrorCode.RateLimited);
  });

  it('classifies a 5xx status object as MODEL_ERROR', () => {
    const err = Object.assign(new Error('server exploded'), { status: 502 });
    expect(classify(err).code).toBe(ErrorCode.ModelError);
  });

  it('falls back to INTERNAL_ERROR for arbitrary Error', () => {
    const r = classify(new Error('unexplained badness'));
    expect(r.code).toBe(ErrorCode.InternalError);
  });

  it('falls back to INTERNAL_ERROR for non-Error thrown values', () => {
    expect(classify('a bare string').code).toBe(ErrorCode.InternalError);
    expect(classify(42).code).toBe(ErrorCode.InternalError);
    expect(classify(null).code).toBe(ErrorCode.InternalError);
    expect(classify(undefined).code).toBe(ErrorCode.InternalError);
  });

  it('preserves the original message on classified errors', () => {
    const r = classify(new Error('very specific detail'));
    expect(r.message).toBe('very specific detail');
  });
});
