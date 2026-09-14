import { describe, expect, it } from 'vitest';

import { modelSupportsThinking } from '../src/ollama.js';
import {
  buildEvidenceBlock,
  buildSynthesisMessages,
  citationsFor,
  fallbackAnswer,
  stripThinking,
  trimToBoundary,
} from '../src/synthesize.js';
import type { Source } from '../src/state.js';

const sources: Source[] = [
  { id: 'src_a', url: 'https://fastapi.tiangolo.com/', title: 'FastAPI', fetchedAt: '' },
  { id: 'src_b', url: 'https://expressjs.com/', title: 'Express', fetchedAt: '' },
];

const chunk = (sourceId: string, text: string, score = 0.5) => ({
  chunk: { id: `${sourceId}:0`, sourceId, text, ordinal: 0, tokensApprox: 10, embedded: true },
  score,
});

describe('buildEvidenceBlock', () => {
  it('numbers sources in order and labels chunks with the matching number', () => {
    const block = buildEvidenceBlock({
      query: 'q',
      sources,
      chunks: [chunk('src_b', 'Express is minimal.'), chunk('src_a', 'FastAPI is typed.')],
      claims: [],
    });
    expect(block).toContain('[1] FastAPI — https://fastapi.tiangolo.com/');
    expect(block).toContain('[2] Express — https://expressjs.com/');
    expect(block).toContain('[2] Express is minimal.');
    expect(block).toContain('[1] FastAPI is typed.');
    expect(block).not.toContain('KEY CLAIMS');
  });

  it('maps claim source ids to source numbers', () => {
    const block = buildEvidenceBlock({
      query: 'q',
      sources,
      chunks: [],
      claims: [{ id: 'c1', text: 'FastAPI uses type hints', sourceIds: ['src_a'], confidence: 0.9 }],
    });
    expect(block).toContain('KEY CLAIMS');
    expect(block).toContain('- FastAPI uses type hints [1]');
    expect(block).toContain('no passages retrieved');
  });
});

describe('buildSynthesisMessages', () => {
  it('puts the question and evidence in the user turn and the rules in the system turn', () => {
    const [system, user] = buildSynthesisMessages({
      query: 'What is FastAPI?',
      sources,
      chunks: [chunk('src_a', 'FastAPI is a Python web framework.')],
      claims: [],
    });
    expect(system.role).toBe('system');
    expect(system.content).toContain('[1]');
    expect(system.content).toContain('bullet points');
    expect(user.role).toBe('user');
    expect(user.content.startsWith('QUESTION: What is FastAPI?')).toBe(true);
    expect(user.content).toContain('FastAPI is a Python web framework.');
  });

  it('asks for a table on comparison questions', () => {
    const [system] = buildSynthesisMessages({ query: 'Compare FastAPI vs Express', sources, chunks: [], claims: [] });
    expect(system.content).toContain('markdown table');
    expect(system.content).toContain('Which to choose');
  });
});

describe('stripThinking', () => {
  it('removes closed think blocks', () => {
    expect(stripThinking('<think>hmm</think>\n\nAnswer [1]')).toBe('Answer [1]');
  });
  it('drops an unterminated think block entirely', () => {
    expect(stripThinking('<think>still thinking')).toBe('');
  });
  it('leaves plain text alone', () => {
    expect(stripThinking('  Plain answer.  ')).toBe('Plain answer.');
  });
});

describe('trimToBoundary', () => {
  it('keeps text that already ends at a boundary', () => {
    expect(trimToBoundary('FastAPI is fast [1].')).toBe('FastAPI is fast [1].');
    expect(trimToBoundary('- item one\n- item two\n')).toBe('- item one\n- item two');
  });
  it('cuts a trailing fragment back to the last sentence', () => {
    const text = 'FastAPI is fast [1]. Express is minimal [2]. Both frameworks supp';
    expect(trimToBoundary(text)).toBe('FastAPI is fast [1]. Express is minimal [2].');
  });
  it('cuts a trailing fragment back to the last completed line', () => {
    const text = '| Feature | FastAPI | Express |\n|---|---|---|\n| Typing | built-in [1] | none [2] |\n| Perf';
    expect(trimToBoundary(text)).toBe('| Feature | FastAPI | Express |\n|---|---|---|\n| Typing | built-in [1] | none [2] |');
  });
  it('returns the raw text when the only boundary is in the first half', () => {
    const text = 'Short intro. ' + 'x'.repeat(200);
    expect(trimToBoundary(text)).toBe(text);
  });
  it('returns an empty string for whitespace', () => {
    expect(trimToBoundary('   \n')).toBe('');
  });
});

describe('citationsFor', () => {
  it('numbers sources from one and falls back to the url as title', () => {
    expect(citationsFor([{ ...sources[0], title: '' }, sources[1]])).toEqual([
      { n: 1, url: 'https://fastapi.tiangolo.com/', title: 'https://fastapi.tiangolo.com/' },
      { n: 2, url: 'https://expressjs.com/', title: 'Express' },
    ]);
  });
});

describe('fallbackAnswer', () => {
  it('lists sources when there are no claims', () => {
    const text = fallbackAnswer({ sources, claims: [] });
    expect(text).toContain('2 relevant source(s)');
    expect(text).toContain('- FastAPI [1]');
    expect(text).toContain('- Express [2]');
  });
  it('prefers claims when present', () => {
    const text = fallbackAnswer({
      sources,
      claims: [{ id: 'c1', text: 'FastAPI is async-first', sourceIds: ['src_a'], confidence: 0.8 }],
    });
    expect(text).toContain('key findings');
    expect(text).toContain('- FastAPI is async-first');
  });
  it('explains when nothing was found', () => {
    expect(fallbackAnswer({ sources: [], claims: [] })).toContain('could not find any usable sources');
  });
});

describe('modelSupportsThinking', () => {
  it.each(['qwen3:8b', 'deepseek-r1:7b', 'gpt-oss:20b'])('true for %s', (m) => {
    expect(modelSupportsThinking(m)).toBe(true);
  });
  it.each(['qwen2.5:7b', 'llama3.2:3b', 'gemma3:4b'])('false for %s', (m) => {
    expect(modelSupportsThinking(m)).toBe(false);
  });
});
