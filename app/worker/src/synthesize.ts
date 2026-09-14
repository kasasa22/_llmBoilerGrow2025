import { env } from './config.js';
import { ErrorCode } from './errors.js';
import { Phase } from './events.js';
import { logger } from './logger.js';
import { chat, type ChatMessage } from './ollama.js';
import { isComparisonQuery } from './query.js';
import type { EvidenceStore } from './rag/retriever.js';
import type { RetrievalResult } from './rag/types.js';
import { publishEvent } from './redis.js';
import type { Citation, Claim, NetworkState, Source } from './state.js';

export interface SynthesisInput {
  query: string;
  sources: Source[];
  chunks: RetrievalResult[];
  claims: Claim[];
}

export function citationsFor(sources: Source[]): Citation[] {
  return sources.slice(0, 20).map((s, i) => ({ n: i + 1, url: s.url, title: s.title || s.url }));
}

export function buildEvidenceBlock(input: SynthesisInput): string {
  const numberOf = new Map(input.sources.map((s, i) => [s.id, i + 1]));
  const sourceLines = input.sources.map((s, i) => `[${i + 1}] ${s.title || s.url} — ${s.url}`).join('\n');

  const chunkLines = input.chunks
    .map((r) => {
      const n = numberOf.get(r.chunk.sourceId);
      const label = n ? `[${n}]` : `[${r.chunk.sourceId}]`;
      return `${label} ${r.chunk.text.trim()}`;
    })
    .join('\n\n');

  const claimLines = input.claims
    .map((c) => {
      const refs = c.sourceIds.map((id) => numberOf.get(id)).filter(Boolean);
      const cite = refs.length ? ` [${refs.join('][')}]` : '';
      return `- ${c.text}${cite}`;
    })
    .join('\n');

  return [
    `SOURCES:\n${sourceLines || '(none)'}`,
    claimLines ? `KEY CLAIMS (extracted earlier):\n${claimLines}` : null,
    `EVIDENCE:\n${chunkLines || '(no passages retrieved; use the source titles only and say the evidence is thin)'}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildSynthesisMessages(input: SynthesisInput): ChatMessage[] {
  const comparison = isComparisonQuery(input.query);
  const structure = comparison
    ? 'This is a comparison question. After the opening sentence write a "Which to choose" paragraph of 2-3 sentences, then finish with a markdown table that has one column per option and one row per dimension. The table is the last thing in the answer.'
    : 'After the opening sentence, use short headings or bullet points so the answer is easy to scan. Never end on a heading; the last line must be a full sentence or a bullet.';

  const system = `You write the final answer for a research assistant. Answer the QUESTION using only the EVIDENCE provided.

Format rules:
- GitHub-flavoured markdown, 120-250 words. Be direct and concrete.
- Start with one sentence that directly answers the question.
- ${structure}
- Every factual sentence ends with a citation like [1] or [1][2], where the number is the source number from SOURCES. Use only numbers that appear in SOURCES. Cite each source at most once per sentence and never repeat a marker.
- Never invent facts, numbers, or URLs. If the evidence does not cover part of the question, say so in one sentence instead of guessing.
- No title, no preamble, no closing "Sources" list; the application renders citations itself.`;

  const user = `QUESTION: ${input.query}\n\n${buildEvidenceBlock(input)}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^<think>[\s\S]*$/i, '')
    .trim();
}

export function trimToBoundary(text: string): string {
  const trimmed = text.trimEnd();
  if (!trimmed) return '';
  if (/[.!?)\]`|]$/.test(trimmed)) return trimmed;
  const candidates = [
    trimmed.lastIndexOf('\n'),
    trimmed.lastIndexOf('. '),
    trimmed.lastIndexOf('.\n'),
    trimmed.lastIndexOf('! '),
    trimmed.lastIndexOf('? '),
  ];
  const cut = Math.max(...candidates);
  if (cut > trimmed.length / 2) {
    const head = trimmed.slice(0, cut + 1).trimEnd();
    if (head) return head;
  }
  return trimmed;
}

const CODE_SEGMENT = /(```[\s\S]*?```|`[^`\n]*`)/g;

function mapProse(text: string, fn: (prose: string) => string): string {
  return text
    .split(CODE_SEGMENT)
    .map((part, i) => (i % 2 === 1 ? part : fn(part)))
    .join('');
}

export function dropUnknownCitations(text: string, valid: number | ReadonlySet<number>): string {
  const isValid = (n: number) => (typeof valid === 'number' ? n >= 1 && n <= valid : valid.has(n));
  return mapProse(text, (prose) =>
    prose
      .replace(/(?<!\w)\[(\d+)\]/g, (match, n: string) => (isValid(Number(n)) ? match : ''))
      .replace(/[ \t]+([.,;:])/g, '$1')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/(?<=\S)[ \t]{2,}/g, ' '),
  );
}

export function collapseRepeats(text: string): string {
  return mapProse(text, (prose) =>
    prose
      .replace(/(\[\d+\])(?:[ \t]*\1)+/g, '$1')
      .replace(/(.{2,24}?)\1{2,}\s*$/s, '$1')
      .replace(/[ \t]*\[\d*$/, ''),
  );
}

export function finaliseAnswer(text: string, valid: number | ReadonlySet<number>, truncated: boolean): string {
  const collapsed = collapseRepeats(text.trimEnd());
  const bounded = truncated ? trimToBoundary(collapsed) : collapsed;
  return stripDanglingTail(dropUnknownCitations(bounded, valid));
}

const DANGLING_LINE = /^(#{1,6}\s.*|\*\*[^*]+\*\*:?|(\[\d+\]\s*)+|[-*]\s*)$/;

export function stripDanglingTail(text: string): string {
  const lines = text.trimEnd().split('\n');
  while (lines.length > 1) {
    const last = lines[lines.length - 1].trim();
    if (last === '' || DANGLING_LINE.test(last)) {
      lines.pop();
      continue;
    }
    break;
  }
  return lines.join('\n').trimEnd();
}

export function fallbackAnswer(state: Pick<NetworkState, 'sources' | 'claims'>): string {
  const sourceBullets = state.sources
    .slice(0, 6)
    .map((s, i) => `- ${s.title || s.url} [${i + 1}]`)
    .join('\n');
  const claimBullets = state.claims
    .slice(0, 8)
    .map((c) => `- ${c.text}`)
    .join('\n');

  if (claimBullets) {
    return `I ran out of time before writing a full answer, so here are the key findings extracted from the sources:\n\n${claimBullets}\n\nSources:\n${sourceBullets}`;
  }
  if (sourceBullets) {
    return `I found ${state.sources.length} relevant source(s) but ran out of time before writing the answer. Sources found:\n\n${sourceBullets}\n\nPlease try again; the model is now warm and the second run is usually much faster.`;
  }
  return 'I could not find any usable sources for this question within the budget. Try a shorter, more specific question.';
}

export interface DirectSynthesisDeps {
  jobId: string;
  state: NetworkState;
  evidence: EvidenceStore;
  deadlineMs: number;
  signal?: AbortSignal;
}

export interface DirectSynthesisResult {
  mode: 'direct' | 'fallback';
  partial: boolean;
}

export async function directSynthesis(deps: DirectSynthesisDeps): Promise<DirectSynthesisResult> {
  const { jobId, state, evidence } = deps;

  if (state.phase !== 'synthesis') {
    await publishEvent({
      jobId,
      phase: Phase.AgentTransition,
      data: { from: state.phase, to: 'synthesis', iteration: 0, mode: 'direct' },
    });
    state.phase = 'synthesis';
  }
  await publishEvent({
    jobId,
    phase: Phase.SynthesisStarted,
    data: { claimCount: state.claims.length, sourceCount: state.sources.length, mode: 'direct' },
  });

  const chunks = await evidence.topK(state.query, env.RAG_TOP_K);
  await publishEvent({
    jobId,
    phase: Phase.RagRetrieved,
    data: { agent: 'DirectSynthesis', k: chunks.length, topScore: chunks[0]?.score ?? 0, minScore: env.RAG_MIN_SIMILARITY },
  });

  const citations = citationsFor(state.sources);
  const messages = buildSynthesisMessages({ query: state.query, sources: state.sources, chunks, claims: state.claims });
  const promptChars = messages.reduce((n, m) => n + m.content.length, 0);
  const timeoutMs = Math.max(20_000, deps.deadlineMs);

  let answer: string | null = null;
  let truncated = false;
  try {
    const result = await chat({ messages, timeoutMs, signal: deps.signal });
    truncated = result.doneReason !== 'stop';
    const text = finaliseAnswer(stripThinking(result.content), citations.length, truncated);
    logger.info(
      {
        jobId,
        promptChars,
        promptTokens: result.promptTokens,
        outputTokens: result.outputTokens,
        tokensPerSecond: result.tokensPerSecond,
        totalMs: result.totalMs,
        doneReason: result.doneReason,
        chars: text.length,
      },
      'synthesis.direct.completed',
    );
    if (text.length >= 40) answer = text;
  } catch (err) {
    const message = (err as Error).message;
    logger.warn({ jobId, err: message, timeoutMs }, 'synthesis.direct.failed');
    state.errors.push({ agent: 'synthesis', code: ErrorCode.ModelError, msg: message, at: new Date().toISOString() });
    await publishEvent({
      jobId,
      phase: Phase.Error,
      data: { code: ErrorCode.ModelError, message, terminal: false, context: { stage: 'synthesis', timeoutMs } },
    });
  }

  const mode: DirectSynthesisResult['mode'] = answer ? 'direct' : 'fallback';
  if (answer && truncated) {
    answer += '\n\n*The answer was cut short; the sources below cover the rest.*';
  }
  state.finalAnswer = answer ?? fallbackAnswer(state);
  state.citations = citations;

  await publishEvent({
    jobId,
    phase: Phase.SynthesisAnswerReady,
    data: {
      length: state.finalAnswer.length,
      citationCount: state.citations.length,
      mode,
      truncated,
      promptChars,
    },
  });

  return { mode, partial: mode === 'fallback' || truncated };
}
