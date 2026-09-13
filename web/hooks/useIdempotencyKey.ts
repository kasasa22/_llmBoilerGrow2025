'use client';

import { useCallback, useRef } from 'react';

const WINDOW_MS = 60_000;

interface CachedKey {
  query: string;
  key: string;
  createdAt: number;
}

function normalise(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

function makeKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `bosmart-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function useIdempotencyKey(): (query: string) => string {
  const cacheRef = useRef<CachedKey | null>(null);

  return useCallback((query: string) => {
    const now = Date.now();
    const norm = normalise(query);
    const cached = cacheRef.current;
    if (cached && cached.query === norm && now - cached.createdAt < WINDOW_MS) {
      return cached.key;
    }
    const key = makeKey();
    cacheRef.current = { query: norm, key, createdAt: now };
    return key;
  }, []);
}
