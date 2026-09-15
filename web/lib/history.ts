import type { HistoryItem } from '@/hooks/useQueryHistory';

export type HistorySelection = 'archive' | 'reattach' | 'prefill';

export function resolveHistorySelection(item: Pick<HistoryItem, 'answer' | 'jobId'>): HistorySelection {
  if (item.answer !== null) return 'archive';
  if (item.jobId) return 'reattach';
  return 'prefill';
}
