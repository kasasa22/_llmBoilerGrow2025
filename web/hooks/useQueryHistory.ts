'use client';

import { useCallback, useEffect, useState } from 'react';

import type { Citation } from '@/lib/events';

const STORAGE_KEY = 'bosmart-chat-history-v2';
const MAX_ITEMS = 50;

export interface HistoryItem {
  id: string;
  query: string;
  submittedAt: string;
  completedAt: string | null;
  jobId: string | null;
  traceId: string | null;
  answer: string | null;
  citations: Citation[];
  partial: boolean;
  modelName: string;
  sourcesCount: number;
  toolCallsCount: number;
  status: 'running' | 'done' | 'failed' | 'no_answer';
}

export function useQueryHistory() {
  const [items, setItems] = useState<HistoryItem[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setItems(JSON.parse(raw) as HistoryItem[]);
    } catch {}
  }, []);

  const persist = useCallback((next: HistoryItem[]) => {
    setItems(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  const add = useCallback(
    (query: string, jobId: string | null, traceId: string | null, modelName: string): string => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const entry: HistoryItem = {
        id,
        query: query.trim(),
        submittedAt: new Date().toISOString(),
        completedAt: null,
        jobId,
        traceId,
        answer: null,
        citations: [],
        partial: false,
        modelName,
        sourcesCount: 0,
        toolCallsCount: 0,
        status: 'running',
      };
      persist([entry, ...items].slice(0, MAX_ITEMS));
      return id;
    },
    [items, persist],
  );

  const update = useCallback(
    (id: string, patch: Partial<HistoryItem>) => {
      persist(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    },
    [items, persist],
  );

  const remove = useCallback(
    (id: string) => persist(items.filter((it) => it.id !== id)),
    [items, persist],
  );

  const getById = useCallback((id: string): HistoryItem | null => items.find((it) => it.id === id) ?? null, [items]);

  const clear = useCallback(() => persist([]), [persist]);

  return { items, add, update, remove, getById, clear };
}
