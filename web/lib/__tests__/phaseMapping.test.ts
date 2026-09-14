import { describe, expect, it } from 'vitest';

import type { SseEvent } from '@/lib/events';
import { deriveProgress, formatElapsed, typicalTimeHint } from '@/lib/phaseMapping';

function ev<P extends SseEvent['phase']>(seq: number, phase: P, data: unknown): SseEvent {
  return {
    seq,
    phase,
    trace_id: 't',
    job_id: 'j',
    span_id: null,
    parent_span_id: null,
    ts: '2026-09-14T00:00:00Z',
    data,
  } as unknown as SseEvent;
}

describe('deriveProgress', () => {
  it('starts on understand with no events', () => {
    const p = deriveProgress([]);
    expect(p.activeStepId).toBe('understand');
    expect(p.stepStates.understand).toBe('active');
    expect(p.stepStates.search).toBe('pending');
    expect(p.isComplete).toBe(false);
  });

  it('advances to search when webSearch is called', () => {
    const p = deriveProgress([
      ev(1, 'job.started', { query: 'q' }),
      ev(2, 'tool.called', { tool: 'webSearch', args: { query: 'q', limit: 3 } }),
    ]);
    expect(p.activeStepId).toBe('search');
    expect(p.stepStates.understand).toBe('done');
    expect(p.stepStates.search).toBe('active');
  });

  it('advances to read when a source is found', () => {
    const p = deriveProgress([
      ev(1, 'job.started', { query: 'q' }),
      ev(2, 'research.search_completed', { query: 'q', resultCount: 3 }),
      ev(3, 'research.source_found', { sourceId: 's1', url: 'https://ollama.com/', title: 'Ollama' }),
    ]);
    expect(p.activeStepId).toBe('read');
    expect(p.stepStates.search).toBe('done');
    expect(p.sourcesFound).toBe(1);
  });

  it('advances to write on synthesis transition', () => {
    const p = deriveProgress([
      ev(1, 'agent.transition', { from: 'research', to: 'synthesis', iteration: 0 }),
    ]);
    expect(p.activeStepId).toBe('write');
    expect(p.stepStates.read).toBe('done');
    expect(p.stepStates.write).toBe('active');
  });

  it('marks all done on final event', () => {
    const p = deriveProgress([
      ev(1, 'final', { answer: 'yes', citations: [] }),
    ]);
    expect(p.isComplete).toBe(true);
    expect(p.stepStates.write).toBe('done');
  });

  it('flags error when error event present', () => {
    const p = deriveProgress([
      ev(1, 'tool.error', { tool: 'webSearch', code: 'SEARCH_ERROR', message: 'oops' }),
    ]);
    expect(p.hasError).toBe(true);
  });

  it('exposes currentActivity for the latest phase', () => {
    const p = deriveProgress([
      ev(1, 'tool.called', { tool: 'fetchUrl', args: { url: 'https://ollama.com/docs' } }),
    ]);
    expect(p.currentActivity).toContain('ollama.com');
  });
});

describe('formatElapsed', () => {
  it('shows seconds under a minute', () => {
    expect(formatElapsed(45_000)).toBe('45s');
  });
  it('shows minutes + seconds over a minute', () => {
    expect(formatElapsed(75_000)).toBe('1m 15s');
  });
  it('shows 0s below 1 second', () => {
    expect(formatElapsed(500)).toBe('0s');
  });
});

describe('typicalTimeHint', () => {
  it('shows a shorter estimate in prod env', () => {
    expect(typicalTimeHint('prod')).toMatch(/5-10 seconds/);
  });
  it('shows a longer estimate in demo env', () => {
    expect(typicalTimeHint('demo')).toMatch(/30-90 seconds/);
  });
});
