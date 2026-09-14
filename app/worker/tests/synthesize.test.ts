import { describe, expect, it } from 'vitest';

import { detectRepetitionLoop, modelSupportsThinking } from '../src/ollama.js';
import {
  buildEvidenceBlock,
  buildSynthesisMessages,
  citationsFor,
  collapseRepeats,
  dropUnknownCitations,
  fallbackAnswer,
  finaliseAnswer,
  stripDanglingTail,
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

describe('dropUnknownCitations', () => {
  it('removes markers that point past the real source list', () => {
    expect(dropUnknownCitations('Runs on every node [1][2].', 1)).toBe('Runs on every node [1].');
    expect(dropUnknownCitations('Fact [3]. Other [1].', 2)).toBe('Fact. Other [1].');
  });
  it('accepts an explicit set of valid numbers', () => {
    expect(dropUnknownCitations('A [1] B [2] C [4].', new Set([1, 4]))).toBe('A [1] B C [4].');
  });
  it('keeps valid markers and zero-source text untouched', () => {
    expect(dropUnknownCitations('A [1] and B [2].', 2)).toBe('A [1] and B [2].');
    expect(dropUnknownCitations('No markers here.', 0)).toBe('No markers here.');
  });
  it('does not leave stray spaces before punctuation or at line ends', () => {
    expect(dropUnknownCitations('Line one [2]\nLine two [2] , done [1]', 1)).toBe('Line one\nLine two, done [1]');
  });
  it('leaves array indexing and code untouched', () => {
    expect(dropUnknownCitations('Use items[0] and arr[3] here [3].', 1)).toBe('Use items[0] and arr[3] here.');
    expect(dropUnknownCitations('Call `list[2]` then see [2].', 1)).toBe('Call `list[2]` then see.');
    const fence = '```js\nconst x = a[2];\n    indented[9]\n```\nText [2].';
    expect(dropUnknownCitations(fence, 1)).toBe('```js\nconst x = a[2];\n    indented[9]\n```\nText.');
  });
  it('preserves leading indentation of nested lists', () => {
    const md = '- parent [1]\n    - child [2]\n        - grandchild';
    expect(dropUnknownCitations(md, 1)).toBe('- parent [1]\n    - child\n        - grandchild');
  });
});

describe('detectRepetitionLoop', () => {
  it('fires on a citation marker repeated many times', () => {
    expect(detectRepetitionLoop('It runs a copy of a Pod. ' + '[1] '.repeat(8))).toBe(true);
    expect(detectRepetitionLoop('text' + '\n\n'.repeat(10))).toBe(true);
  });
  it('stays quiet on normal prose and small tables', () => {
    expect(detectRepetitionLoop('FastAPI is fast [1]. Express is minimal [2]. Both are popular [1][2].')).toBe(false);
    expect(detectRepetitionLoop('| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |')).toBe(false);
    expect(detectRepetitionLoop('- point one [1]\n- point two [1]\n- point three [1]')).toBe(false);
  });
});

describe('collapseRepeats', () => {
  it('collapses a run of the same marker and drops a trailing half marker', () => {
    expect(collapseRepeats('Runs a copy of a Pod. [1] [1] [1] [1')).toBe('Runs a copy of a Pod. [1]');
  });
  it('removes a unit repeated at the end of the text', () => {
    expect(collapseRepeats('Answer here. and so on and so on and so on and so on')).toBe('Answer here. and so on');
  });
  it('keeps legitimate distinct markers and code', () => {
    expect(collapseRepeats('A [1][2]. B [2].')).toBe('A [1][2]. B [2].');
    expect(collapseRepeats('Use `x[1][1]` here [1].')).toBe('Use `x[1][1]` here [1].');
  });
});

describe('finaliseAnswer', () => {
  it('recovers the real qwen2.5:3b failure: two sentences then a marker loop', () => {
    const raw = 'A Kubernetes DaemonSet is a top-level resource. It ensures Nodes run a copy of a Pod. ' + '[1] '.repeat(60) + '[1';
    expect(finaliseAnswer(raw, 1, true)).toBe('A Kubernetes DaemonSet is a top-level resource. It ensures Nodes run a copy of a Pod. [1]');
  });

  it('trims to a boundary before dropping markers so the last sentence survives', () => {
    const text = 'First point [1]. Second point [2]';
    expect(finaliseAnswer(text, 1, true)).toBe('First point [1]. Second point');
  });
  it('strips a dangling heading left after cleanup', () => {
    expect(finaliseAnswer('Body [1].\n\n**Which to choose:**\n\n[2]', 1, false)).toBe('Body [1].');
  });
});

describe('stripDanglingTail', () => {
  it('removes a trailing heading followed only by citation markers', () => {
    const text = '| A | B |\n|---|---|\n| x | y |\n\n**Which to choose:**\n\n[1][2]';
    expect(stripDanglingTail(text)).toBe('| A | B |\n|---|---|\n| x | y |');
  });
  it('removes a bare trailing markdown heading', () => {
    expect(stripDanglingTail('Body sentence [1].\n\n### Which to choose')).toBe('Body sentence [1].');
  });
  it('removes an empty trailing bullet', () => {
    expect(stripDanglingTail('- first point [1]\n- ')).toBe('- first point [1]');
  });
  it('keeps a complete answer untouched', () => {
    const text = 'Opening [1].\n\n### Details\n- point [2]';
    expect(stripDanglingTail(text)).toBe(text);
  });
  it('never strips the only line', () => {
    expect(stripDanglingTail('### Only a heading')).toBe('### Only a heading');
  });
});

describe('buildSynthesisMessages comparison layout', () => {
  it('asks for the recommendation before the table so a stop after the table is complete', () => {
    const [system] = buildSynthesisMessages({ query: 'Compare A vs B', sources, chunks: [], claims: [] });
    const rec = system.content.indexOf('Which to choose');
    const table = system.content.indexOf('markdown table');
    expect(rec).toBeGreaterThan(-1);
    expect(table).toBeGreaterThan(rec);
    expect(system.content).toContain('last thing in the answer');
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
