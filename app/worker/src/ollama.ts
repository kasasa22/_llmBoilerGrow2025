import { fetch } from 'undici';

import { env } from './config.js';
import { logger } from './logger.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  timeoutMs: number;
  signal?: AbortSignal;
  temperature?: number;
  numPredict?: number;
}

export interface ChatResult {
  content: string;
  doneReason: 'stop' | 'length' | 'timeout' | 'aborted' | 'unknown';
  promptTokens: number;
  outputTokens: number;
  totalMs: number;
  tokensPerSecond: number;
}

interface OllamaChatChunk {
  message?: { content?: string; thinking?: string };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
  total_duration?: number;
  error?: string;
}

export function ollamaUrl(path: string): string {
  return `${env.OLLAMA_BASE_URL.replace(/\/+$/, '')}${path}`;
}

const THINKING_MODELS = /^(qwen3|deepseek-r1|gpt-oss|magistral)/i;

export function modelSupportsThinking(model: string): boolean {
  return THINKING_MODELS.test(model);
}

export async function chat(opts: ChatOptions): Promise<ChatResult> {
  const started = Date.now();
  const controller = new AbortController();
  let doneReason: ChatResult['doneReason'] = 'unknown';
  const timer = setTimeout(() => {
    doneReason = 'timeout';
    controller.abort(new Error('SYNTHESIS_TIMEOUT'));
  }, opts.timeoutMs);
  const onOuterAbort = () => {
    doneReason = 'aborted';
    controller.abort(opts.signal?.reason);
  };
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true });

  const body: Record<string, unknown> = {
    model: env.MODEL_NAME,
    stream: true,
    keep_alive: env.OLLAMA_KEEP_ALIVE,
    messages: opts.messages,
    options: {
      temperature: opts.temperature ?? 0.2,
      num_predict: opts.numPredict ?? env.MAX_TOKENS_PER_CALL,
      num_ctx: env.OLLAMA_NUM_CTX,
    },
  };
  if (modelSupportsThinking(env.MODEL_NAME)) body.think = false;

  let content = '';
  let promptTokens = 0;
  let outputTokens = 0;
  let evalNs = 0;
  let totalNs = 0;

  try {
    const res = await fetch(ollamaUrl('/api/chat'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`ollama chat http ${res.status}: ${text.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      let newline = buffered.indexOf('\n');
      while (newline >= 0) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (line) {
          const chunk = JSON.parse(line) as OllamaChatChunk;
          if (chunk.error) throw new Error(`ollama chat error: ${chunk.error}`);
          content += chunk.message?.content ?? '';
          if (chunk.done) {
            doneReason = chunk.done_reason === 'length' ? 'length' : 'stop';
            promptTokens = chunk.prompt_eval_count ?? 0;
            outputTokens = chunk.eval_count ?? 0;
            evalNs = chunk.eval_duration ?? 0;
            totalNs = chunk.total_duration ?? 0;
          }
        }
        newline = buffered.indexOf('\n');
      }
    }
  } catch (err) {
    if (!controller.signal.aborted) throw err;
    if (content.trim().length === 0) throw err;
    logger.warn({ reason: doneReason, chars: content.length, ms: Date.now() - started }, 'ollama.chat.partial');
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }

  const totalMs = totalNs > 0 ? Math.round(totalNs / 1e6) : Date.now() - started;
  return {
    content,
    doneReason,
    promptTokens,
    outputTokens,
    totalMs,
    tokensPerSecond: evalNs > 0 ? Math.round((outputTokens / (evalNs / 1e9)) * 10) / 10 : 0,
  };
}

export async function warmModels(): Promise<void> {
  const targets: Array<{ model: string; path: string; body: Record<string, unknown> }> = [
    { model: env.MODEL_NAME, path: '/api/generate', body: { options: { num_ctx: env.OLLAMA_NUM_CTX } } },
  ];
  if (env.RAG_ENABLED) {
    targets.push({ model: env.RAG_EMBED_MODEL, path: '/api/embeddings', body: { prompt: 'warm-up' } });
  }
  for (const { model, path, body } of targets) {
    const started = Date.now();
    try {
      const res = await fetch(ollamaUrl(path), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, keep_alive: env.OLLAMA_KEEP_ALIVE, ...body }),
        signal: AbortSignal.timeout(env.MODEL_WARMUP_TIMEOUT_MS),
      });
      logger.info({ model, ok: res.ok, status: res.status, ms: Date.now() - started }, 'ollama.warm');
    } catch (err) {
      logger.warn({ model, err: (err as Error).message, ms: Date.now() - started }, 'ollama.warm_failed');
    }
  }
}
