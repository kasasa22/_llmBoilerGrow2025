/**
 * decideNextPhase — the pure router extracted from network.ts.
 * These tests drive the router with synthetic NetworkState to verify every
 * transition and termination path — the interview-critical logic.
 */
import { describe, expect, it } from 'vitest';

import { decideNextPhase, type RouterConfig } from '../src/router.js';
import { initialState, type NetworkState } from '../src/state.js';

const DEFAULTS: RouterConfig = {
  minSources: 3,
  minEvidence: 4,
  minClaims: 3,
  maxAnalysisIters: 2,
  maxCalls: 12,
  skipAnalysis: false,
};

function state(overrides: Partial<NetworkState> = {}): NetworkState {
  return {
    ...initialState({ jobId: 'job_test', traceId: 't', query: 'q' }),
    ...overrides,
  };
}

function decide(s: NetworkState, callCount = 0, opts: { wallClockExhausted?: boolean; aborted?: boolean; config?: RouterConfig } = {}) {
  return decideNextPhase({
    state: s,
    callCount,
    wallClockExhausted: opts.wallClockExhausted ?? false,
    aborted: opts.aborted ?? false,
    config: opts.config ?? DEFAULTS,
  });
}

describe('decideNextPhase — happy path', () => {
  it('starts in research, stays in research until thresholds met', () => {
    const d = decide(state());
    expect(d.next).toBe('research');
    expect(d.advanced).toBe(false);
  });

  it('advances research -> analysis when sources AND evidence thresholds hit', () => {
    const d = decide(
      state({
        sources: [1, 2, 3].map((i) => ({ id: `s${i}`, url: `https://x.example/${i}`, title: `${i}`, fetchedAt: '' })),
        rawEvidence: Array.from({ length: 4 }, (_, i) => ({ sourceId: `s${i}`, chunkText: '', tokensApprox: 0 })),
      }),
    );
    expect(d.next).toBe('analysis');
    expect(d.advanced).toBe(true);
  });

  it('does NOT advance if sources are enough but evidence is thin', () => {
    const d = decide(
      state({
        sources: [1, 2, 3].map((i) => ({ id: `s${i}`, url: `https://x.example/${i}`, title: `${i}`, fetchedAt: '' })),
        rawEvidence: [{ sourceId: 's1', chunkText: '', tokensApprox: 0 }], // only 1
      }),
    );
    expect(d.next).toBe('research');
    expect(d.advanced).toBe(false);
  });

  it('advances analysis -> synthesis when claims threshold hit', () => {
    const s = state({
      phase: 'analysis',
      claims: [1, 2, 3].map((i) => ({ id: `c${i}`, text: `claim ${i}`, sourceIds: ['s1'], confidence: 0.8 })),
    });
    const d = decide(s);
    expect(d.next).toBe('synthesis');
    expect(d.advanced).toBe(true);
  });

  it('advances analysis -> synthesis when iteration budget hit (even without claims)', () => {
    const d = decide(state({ phase: 'analysis', iteration: 2, claims: [] }));
    expect(d.next).toBe('synthesis');
    expect(d.advanced).toBe(true);
  });

  it('stays in synthesis until finalAnswer is set (only submitAnswer sets it)', () => {
    const d = decide(state({ phase: 'synthesis', finalAnswer: null }));
    expect(d.next).toBe('synthesis');
    expect(d.advanced).toBe(false);
  });

  it('terminates when finalAnswer is set', () => {
    const d = decide(state({ phase: 'synthesis', finalAnswer: 'answer.' }));
    expect(d.next).toBe('done');
    expect(d.advanced).toBe(true);
    if (d.next === 'done') expect(d.reason).toBe('finalAnswer');
  });
});

describe('decideNextPhase — termination guards', () => {
  it('call budget: terminates when callCount >= maxCalls at any phase', () => {
    const d = decide(state(), DEFAULTS.maxCalls);
    expect(d.next).toBe('done');
    if (d.next === 'done') expect(d.reason).toBe('call_budget');
  });

  it('wall clock: terminates when wallClockExhausted regardless of phase', () => {
    const d = decide(state({ phase: 'analysis' }), 0, { wallClockExhausted: true });
    expect(d.next).toBe('done');
    if (d.next === 'done') expect(d.reason).toBe('wall_clock');
  });

  it('aborted signal terminates immediately', () => {
    const d = decide(state({ phase: 'research' }), 0, { aborted: true });
    expect(d.next).toBe('done');
    if (d.next === 'done') expect(d.reason).toBe('aborted');
  });

  it('3+ errors terminate the run', () => {
    const s = state({
      errors: [
        { agent: 'r', msg: 'x', at: '' },
        { agent: 'r', msg: 'y', at: '' },
        { agent: 'r', msg: 'z', at: '' },
      ],
    });
    const d = decide(s);
    expect(d.next).toBe('done');
    if (d.next === 'done') expect(d.reason).toBe('errors');
  });

  it('2 errors alone are NOT terminal', () => {
    const s = state({
      errors: [
        { agent: 'r', msg: 'x', at: '' },
        { agent: 'r', msg: 'y', at: '' },
      ],
    });
    expect(decide(s).next).toBe('research');
  });
});

describe('decideNextPhase — SKIP_ANALYSIS cut-list switch', () => {
  it('research -> synthesis directly when SKIP_ANALYSIS=true and thresholds met', () => {
    const cfg = { ...DEFAULTS, skipAnalysis: true };
    const s = state({
      sources: [1, 2, 3].map((i) => ({ id: `s${i}`, url: `https://x.example/${i}`, title: `${i}`, fetchedAt: '' })),
      rawEvidence: Array.from({ length: 4 }, (_, i) => ({ sourceId: `s${i}`, chunkText: '', tokensApprox: 0 })),
    });
    const d = decide(s, 0, { config: cfg });
    expect(d.next).toBe('synthesis');
    expect(d.advanced).toBe(true);
  });
});

describe('decideNextPhase — purity', () => {
  it('does NOT mutate the state object', () => {
    const s = state({
      sources: [1, 2, 3].map((i) => ({ id: `s${i}`, url: `https://x.example/${i}`, title: `${i}`, fetchedAt: '' })),
      rawEvidence: Array.from({ length: 4 }, (_, i) => ({ sourceId: `s${i}`, chunkText: '', tokensApprox: 0 })),
    });
    const before = JSON.stringify(s);
    decide(s);
    expect(JSON.stringify(s)).toBe(before);
  });
});
