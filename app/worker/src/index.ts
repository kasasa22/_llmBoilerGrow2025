/**
 * Worker HTTP entrypoint.
 *   - GET  /healthz             — liveness
 *   - GET  /readyz              — Redis + Ollama ping + model presence
 *   - POST /api/inngest         — Inngest serve handler (function registry)
 *
 * SIGTERM handling drains the express server before Redis close.
 */
import { serve } from 'inngest/express';
import express from 'express';
import { fetch } from 'undici';

import { env } from './config.js';
import { researchFn } from './functions/research.js';
import { inngest } from './inngestClient.js';
import { logger } from './logger.js';
import { getRedis, pingRedis } from './redis.js';

const app = express();
app.disable('x-powered-by');

app.use((req, _res, next) => {
  const start = Date.now();
  const method = req.method;
  const url = req.originalUrl;
  logger.debug({ method, url }, 'http.request');
  const done = () => logger.info({ method, url, ms: Date.now() - start }, 'http.done');
  _res.on('finish', done);
  next();
});

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

app.get('/readyz', async (_req, res) => {
  const checks: Record<string, boolean> = {};
  checks.redis = await pingRedis();
  let ollamaOk = false;
  const modelsPresent: string[] = [];
  try {
    const url = `${env.OLLAMA_BASE_URL.replace(/\/+$/, '')}/api/tags`;
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (r.ok) {
      const body = (await r.json()) as { models?: { name: string }[] };
      for (const m of body.models ?? []) modelsPresent.push(m.name);
      ollamaOk = true;
    }
  } catch {
    ollamaOk = false;
  }
  checks.ollama = ollamaOk;
  checks.chat_model = modelsPresent.some((n) => n.startsWith(env.MODEL_NAME));
  checks.embed_model =
    !env.RAG_ENABLED || modelsPresent.some((n) => n.startsWith(env.RAG_EMBED_MODEL));

  const allOk = Object.values(checks).every(Boolean);
  res.status(allOk ? 200 : 503).json({ ok: allOk, checks, models: modelsPresent });
});

app.use(
  env.INNGEST_SERVE_PATH,
  serve({
    client: inngest,
    functions: [researchFn],
  }),
);

const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, ollama: env.OLLAMA_BASE_URL, model: env.MODEL_NAME, inngest: env.INNGEST_BASE_URL },
    'worker.started',
  );
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'worker.shutdown');
  server.close(() => {
    void getRedis()
      .quit()
      .finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled.rejection'));
process.on('uncaughtException', (err) => logger.error({ err }, 'uncaught.exception'));
