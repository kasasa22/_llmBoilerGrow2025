'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { FinalData, SseEvent } from '@/lib/events';
import { PHASE_NAMES } from '@/lib/phases';

export type StreamStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed'
  | 'error';

export interface UseJobStreamResult {
  events: SseEvent[];
  status: StreamStatus;
  error: string | null;
  reconnect: () => void;
}

export interface UseJobStreamOptions {
  onFinal?: (data: FinalData) => void;
  onDone?: () => void;
}

export function useJobStream(
  streamUrl: string | null,
  opts: UseJobStreamOptions = {},
): UseJobStreamResult {
  const [events, setEvents] = useState<SseEvent[]>([]);
  const [status, setStatus] = useState<StreamStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const seenSeqRef = useRef<number>(-1);
  const sourceRef = useRef<EventSource | null>(null);
  const [reconnectTick, setReconnectTick] = useState(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const reconnect = useCallback(() => {
    setReconnectTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!streamUrl) {
      setStatus('idle');
      return;
    }
    setEvents([]);
    setError(null);
    setStatus('connecting');
    seenSeqRef.current = -1;

    const es = new EventSource(streamUrl);
    sourceRef.current = es;

    const handle = (phase: string) => (raw: MessageEvent) => {
      let envelope: SseEvent | null = null;
      try {
        envelope = JSON.parse(raw.data) as SseEvent;
      } catch {
        return;
      }
      if (!envelope) return;
      const seq = envelope.seq;
      if (typeof seq === 'number') {
        if (seq <= seenSeqRef.current) return;
        seenSeqRef.current = seq;
      }
      setStatus('open');
      setEvents((prev) => [...prev, envelope!]);

      if (envelope.phase === 'final') {
        optsRef.current.onFinal?.(envelope.data as FinalData);
      }
      if (envelope.phase === 'done') {
        optsRef.current.onDone?.();
        setStatus('closed');
        es.close();
      }
      void phase;
    };

    for (const phase of PHASE_NAMES) {
      es.addEventListener(phase, handle(phase) as EventListener);
    }

    es.onopen = () => setStatus('open');
    es.onerror = () => {
      setStatus((prev) => (prev === 'closed' ? prev : 'reconnecting'));
    };

    return () => {
      es.close();
      sourceRef.current = null;
    };
  }, [streamUrl, reconnectTick]);

  return { events, status, error, reconnect };
}
