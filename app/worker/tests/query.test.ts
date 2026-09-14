import { describe, expect, it } from 'vitest';

import { isComparisonQuery, requiredSources } from '../src/query.js';

describe('isComparisonQuery', () => {
  it.each([
    'Compare FastAPI vs Express',
    'FastAPI versus Express',
    'What is the difference between Redis Streams and Pub/Sub?',
    'Redis vs. Kafka',
    'A comparison of Terraform and Pulumi',
  ])('detects "%s"', (q) => {
    expect(isComparisonQuery(q)).toBe(true);
  });

  it.each(['What is Ollama?', 'How does RAG work?', 'Explain Kubernetes DaemonSets'])('rejects "%s"', (q) => {
    expect(isComparisonQuery(q)).toBe(false);
  });
});

describe('requiredSources', () => {
  it('uses the configured minimum for plain questions', () => {
    expect(requiredSources('What is Ollama?', { minSources: 1, maxFetches: 2 })).toBe(1);
    expect(requiredSources('What is Ollama?', { minSources: 3, maxFetches: 5 })).toBe(3);
  });

  it('raises the floor to two for comparison questions when the fetch budget allows', () => {
    expect(requiredSources('Compare FastAPI vs Express', { minSources: 1, maxFetches: 2 })).toBe(2);
  });

  it('never exceeds the fetch budget', () => {
    expect(requiredSources('Compare FastAPI vs Express', { minSources: 1, maxFetches: 1 })).toBe(1);
    expect(requiredSources('What is Ollama?', { minSources: 3, maxFetches: 2 })).toBe(2);
  });

  it('keeps a larger configured minimum for comparisons', () => {
    expect(requiredSources('Compare FastAPI vs Express', { minSources: 3, maxFetches: 5 })).toBe(3);
  });
});
