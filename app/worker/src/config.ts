/**
 * Zod-validated environment loader for the worker.
 * Every knob mentioned in the plan file's "Consolidated env vars" table
 * lives here. Import `env` anywhere — the parse happens once at boot.
 */
import { z } from 'zod';

const bool = () =>
  z
    .union([z.string(), z.boolean()])
    .transform((v) => (typeof v === 'boolean' ? v : /^(1|true|yes|on)$/i.test(v)));

const csv = () =>
  z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );

const Schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),
  LOG_INCLUDE_STACK: bool().default(false),

  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  MODEL_NAME: z.string().default('qwen2.5:7b'),
  OLLAMA_KEEP_ALIVE: z.string().default('30m'),
  OLLAMA_NUM_CTX: z.coerce.number().int().positive().default(4096),
  OLLAMA_REPEAT_PENALTY: z.coerce.number().positive().default(1.15),
  OLLAMA_REPEAT_LAST_N: z.coerce.number().int().positive().default(128),
  MODEL_WARMUP_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(1),

  REDIS_URL: z.string().default('redis://localhost:6379/0'),

  INNGEST_APP_ID: z.string().default('bosmart-worker'),
  INNGEST_BASE_URL: z.string().url().default('http://localhost:8288'),
  INNGEST_EVENT_KEY: z.string().default(''),
  INNGEST_SIGNING_KEY: z.string().default(''),
  INNGEST_SERVE_PATH: z.string().default('/api/inngest'),
  RUN_STATUS_POLL_MS: z.coerce.number().int().positive().default(10_000),
  RUN_STATUS_TIMEOUT_MS: z.coerce.number().int().positive().default(4_000),
  INNGEST_RETRIES: z.coerce
    .number()
    .int()
    .min(0)
    .max(5)
    .default(1)
    .transform((n) => n as 0 | 1 | 2 | 3 | 4 | 5),

  // Network / router bounds
  NETWORK_MIN_SOURCES: z.coerce.number().int().positive().default(3),
  NETWORK_MIN_EVIDENCE: z.coerce.number().int().positive().default(4),
  NETWORK_MIN_CLAIMS: z.coerce.number().int().positive().default(3),
  NETWORK_MAX_ANALYSIS_ITERS: z.coerce.number().int().positive().default(2),
  NETWORK_MAX_CALLS: z.coerce.number().int().positive().default(12),
  SKIP_ANALYSIS: bool().default(false),
  SKIP_SYNTHESIS_AGENT: bool().default(false),

  // RAG
  RAG_ENABLED: bool().default(true),
  RAG_EMBED_MODEL: z.string().default('nomic-embed-text'),
  RAG_CHUNK_SIZE: z.coerce.number().int().positive().default(900),
  RAG_CHUNK_OVERLAP: z.coerce.number().int().nonnegative().default(120),
  RAG_TOP_K: z.coerce.number().int().positive().default(6),
  RAG_MIN_SIMILARITY: z.coerce.number().default(0.35),
  RAG_EMBED_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  RAG_EMBED_CONCURRENCY: z.coerce.number().int().positive().default(4),

  // Cost controls
  MAX_TOOL_CALLS: z.coerce.number().int().positive().default(10),
  MAX_FETCHES: z.coerce.number().int().positive().default(5),
  MAX_SEARCH_QUERIES: z.coerce.number().int().positive().default(4),
  MAX_CONTEXT_CHARS: z.coerce.number().int().positive().default(20_000),
  MAX_WALL_CLOCK_MS: z.coerce.number().int().positive().default(240_000),
  SYNTHESIS_TIMEOUT_MS: z.coerce.number().int().positive().default(240_000),
  MAX_TOKENS_PER_CALL: z.coerce.number().int().positive().default(450),

  // Idempotency
  JOB_LOCK_TTL_S: z.coerce.number().int().positive().default(300),
  JOB_LOCK_HEARTBEAT_S: z.coerce.number().int().positive().default(30),
  JOB_STATUS_TTL_S: z.coerce.number().int().positive().default(86_400),
  JOB_LOG_MAX_ENTRIES: z.coerce.number().int().positive().default(500),

  // Search / fetch
  FETCH_URL_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  FETCH_URL_MAX_BYTES: z.coerce.number().int().positive().default(1_048_576),
  FETCH_MAX_REDIRECTS: z.coerce.number().int().min(0).max(10).default(5),
  FETCH_MIN_TEXT_CHARS: z.coerce.number().int().nonnegative().default(300),
  SEARCH_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  SEARCH_RESULTS: z.coerce.number().int().min(1).max(8).default(5),
  SEARCH_SNIPPET_CHARS: z.coerce.number().int().positive().default(160),
  TAVILY_API_KEY: z.string().default(''),

  // URL policy
  ALLOWED_DOMAINS: csv(),
  DENIED_DOMAINS: csv(),
  RESPECT_ROBOTS_TXT: bool().default(false),
});

const parsed = Schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('[worker] invalid env:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
