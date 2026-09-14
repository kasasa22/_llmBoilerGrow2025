const COMPARISON_RE = /\b(compare|comparison|vs\.?|versus|difference between|differences between)\b/i;

export function isComparisonQuery(query: string): boolean {
  return COMPARISON_RE.test(query);
}

export interface SourceTargetOpts {
  minSources: number;
  maxFetches: number;
}

export function requiredSources(query: string, opts: SourceTargetOpts): number {
  const cap = Math.max(1, opts.maxFetches);
  const base = Math.max(1, opts.minSources);
  const target = isComparisonQuery(query) ? Math.max(base, 2) : base;
  return Math.min(target, cap);
}
