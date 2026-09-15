'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ErrorData, FinalData, SseEvent } from '@/lib/events';
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
  inactivityMs?: number;
}

export const DEFAULT_INACTIVITY_MS = 10 * 60 * 1000;

export function useJobStream(
  streamUrl: string | null,
  opts: UseJobStreamOptions = {},
): UseJobStreamResult {
  const [events, setEvents] = useState<SseEvent[]>([]);
  const [status, setStatus] = useState<StreamStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const seenSeqRef = useRef<number>(-1);
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
    const inactivityMs = optsRef.current.inactivityMs ?? DEFAULT_INACTIVITY_MS;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let finished = false;

    const finish = (next: StreamStatus, message: string | null) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      setStatus(next);
      if (message) setError(message);
      es.close();
    };

    const armTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const minutes = Math.round(inactivityMs / 60000);
        finish('error', `No update from the server for ${minutes} minutes. The job may have been lost; try sending the question again.`);
      }, inactivityMs);
    };

    const handle = () => (raw: MessageEvent) => {
      let envelope: SseEvent | null = null;
      try {
        envelope = JSON.parse(raw.data) as SseEvent;
      } catch {
        return;
      }
      if (!envelope || finished) return;
      const seq = envelope.seq;
      if (typeof seq === 'number') {
        if (seq <= seenSeqRef.current) return;
        seenSeqRef.current = seq;
      }
      armTimer();
      setStatus('open');
      setEvents((prev) => [...prev, envelope!]);

      if (envelope.phase === 'final') {
        optsRef.current.onFinal?.(envelope.data as FinalData);
      }
      if (envelope.phase === 'done') {
        optsRef.current.onDone?.();
        finish('closed', null);
      }
      if (envelope.phase === 'error' && (envelope.data as ErrorData & { terminal?: boolean }).terminal === true) {
        const data = envelope.data as ErrorData;
        finish('error', `The agent stopped with ${data.code}: ${data.message}`);
      }
    };

    for (const phase of PHASE_NAMES) {
      es.addEventListener(phase, handle() as EventListener);
    }

    es.onopen = () => {
      if (!finished) setStatus('open');
    };
    es.onerror = () => {
      if (finished) return;
      setStatus((prev) => (prev === 'closed' ? prev : 'reconnecting'));
    };
    armTimer();

    return () => {
      if (timer) clearTimeout(timer);
      es.close();
    };
  }, [streamUrl, reconnectTick]);

  return { events, status, error, reconnect };
}
