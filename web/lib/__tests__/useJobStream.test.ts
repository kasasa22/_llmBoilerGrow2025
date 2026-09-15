import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useJobStream } from '@/hooks/useJobStream';
import { installMockEventSource, mockEventSourceRegistry } from './mockEventSource';

describe('useJobStream', () => {
  beforeEach(() => installMockEventSource());
  afterEach(() => {
    mockEventSourceRegistry.reset();
  });

  it('starts idle when streamUrl is null', () => {
    const { result } = renderHook(() => useJobStream(null));
    expect(result.current.status).toBe('idle');
    expect(result.current.events).toEqual([]);
  });

  it('accepts events by phase and preserves order via seq', async () => {
    const { result } = renderHook(() => useJobStream('/api/jobs/x/stream'));
    const es = mockEventSourceRegistry.instances[0];
    expect(es).toBeDefined();

    act(() => {
      es!.emit('job.started', {
        seq: 1, phase: 'job.started', trace_id: 't', job_id: 'x',
        span_id: null, parent_span_id: null, ts: '2026-09-13T00:00:00.000Z',
        data: { query: 'q' },
      });
      es!.emit('tool.called', {
        seq: 2, phase: 'tool.called', trace_id: 't', job_id: 'x',
        span_id: null, parent_span_id: null, ts: '2026-09-13T00:00:01.000Z',
        data: { tool: 'webSearch' },
      });
    });

    await waitFor(() => expect(result.current.events).toHaveLength(2));
    expect(result.current.events[0]!.phase).toBe('job.started');
    expect(result.current.events[1]!.phase).toBe('tool.called');
    expect(result.current.status).toBe('open');
  });

  it('drops events whose seq is <= last seen (dedup on reconnect replay)', async () => {
    const { result } = renderHook(() => useJobStream('/api/jobs/x/stream'));
    const es = mockEventSourceRegistry.instances[0]!;

    const envelope = (seq: number) => ({
      seq, phase: 'tool.called', trace_id: 't', job_id: 'x',
      span_id: null, parent_span_id: null, ts: 't',
      data: { tool: 'webSearch' },
    });

    act(() => {
      es.emit('tool.called', envelope(1));
      es.emit('tool.called', envelope(2));
      es.emit('tool.called', envelope(2));
      es.emit('tool.called', envelope(1));
      es.emit('tool.called', envelope(3));
    });

    await waitFor(() => expect(result.current.events).toHaveLength(3));
    const seqs = result.current.events.map((e) => e.seq);
    expect(seqs).toEqual([1, 2, 3]);
  });

  it('closes on done event and reports status closed', async () => {
    const { result } = renderHook(() => useJobStream('/api/jobs/x/stream'));
    const es = mockEventSourceRegistry.instances[0]!;

    act(() => {
      es.emit('done', {
        seq: 5, phase: 'done', trace_id: 't', job_id: 'x',
        span_id: null, parent_span_id: null, ts: 't', data: { state: 'done' },
      });
    });

    await waitFor(() => expect(result.current.status).toBe('closed'));
    expect(es.closed).toBe(true);
  });

  it('surfaces an error and stops waiting when the stream goes silent', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useJobStream('/api/jobs/x/stream', { inactivityMs: 1000 }));
      const es = mockEventSourceRegistry.instances[0]!;
      act(() => {
        es.emit('job.started', {
          seq: 1, phase: 'job.started', trace_id: 't', job_id: 'x',
          span_id: null, parent_span_id: null, ts: '2026-09-13T00:00:00.000Z', data: { query: 'q' },
        });
      });
      act(() => { vi.advanceTimersByTime(600); });
      expect(result.current.status).toBe('open');
      act(() => { vi.advanceTimersByTime(500); });
      expect(result.current.status).toBe('error');
      expect(result.current.error).toMatch(/No update from the server/);
      expect(es.closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('turns a terminal error event into an error state', async () => {
    const { result } = renderHook(() => useJobStream('/api/jobs/x/stream'));
    const es = mockEventSourceRegistry.instances[0]!;
    act(() => {
      es.emit('error', {
        seq: 1, phase: 'error', trace_id: 't', job_id: 'x',
        span_id: null, parent_span_id: null, ts: '2026-09-13T00:00:00.000Z',
        data: { code: 'INTERNAL_ERROR', message: 'boom', terminal: true },
      });
    });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toContain('INTERNAL_ERROR');
    expect(es.closed).toBe(true);
  });

  it('reconnect opens a fresh source and clears the error', async () => {
    const { result } = renderHook(() => useJobStream('/api/jobs/x/stream'));
    const first = mockEventSourceRegistry.instances[0]!;
    act(() => {
      first.emit('error', {
        seq: 1, phase: 'error', trace_id: 't', job_id: 'x',
        span_id: null, parent_span_id: null, ts: '2026-09-13T00:00:00.000Z',
        data: { code: 'INTERNAL_ERROR', message: 'boom', terminal: true },
      });
    });
    await waitFor(() => expect(result.current.status).toBe('error'));
    act(() => { result.current.reconnect(); });
    await waitFor(() => expect(mockEventSourceRegistry.instances).toHaveLength(2));
    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe('connecting');
  });
});
