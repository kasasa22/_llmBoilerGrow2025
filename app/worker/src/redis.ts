/**
 * Redis client + shared helpers. Keeps every key-name string in one place so
 * app/redis_bus.py (Python) and this file stay in lock-step. If you change
 * a key, change it in both — the interview will absolutely catch a drift.
 */
import Redis from 'ioredis';

import { env } from './config.js';
import type { EventEnvelope } from './events.js';
import { currentTrace, nowIso } from './trace.js';

let _client: Redis | null = null;

export function getRedis(): Redis {
  if (_client) return _client;
  _client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableAutoPipelining: true,
    lazyConnect: false,
  });
  return _client;
}

export async function pingRedis(): Promise<boolean> {
  try {
    const r = await getRedis().ping();
    return r === 'PONG';
  } catch {
    return false;
  }
}

// ---- key names (source of truth) ------------------------------------------
export const K = {
  hash: (h: string) => `job:hash:${h}`,
  hashBody: (h: string) => `job:hash:${h}:body`,
  status: (id: string) => `job:${id}:status`,
  lock: (id: string) => `job:${id}:lock`,
  events: (id: string) => `job:${id}:events`,
  log: (id: string) => `job:${id}:log`,
  final: (id: string) => `job:${id}:final`,
  seq: (id: string) => `job:${id}:seq`,
} as const;

// ---- publish + status ------------------------------------------------------
export interface PublishInput {
  jobId: string;
  phase: string;
  data: Record<string, unknown>;
}

export async function publishEvent({ jobId, phase, data }: PublishInput): Promise<EventEnvelope> {
  const r = getRedis();
  const ctx = currentTrace();
  const seq = await r.incr(K.seq(jobId));
  await r.expire(K.seq(jobId), env.JOB_STATUS_TTL_S);
  const envelope: EventEnvelope = {
    seq,
    phase,
    trace_id: ctx?.trace_id ?? '',
    job_id: jobId,
    span_id: ctx?.span_id ?? null,
    parent_span_id: ctx?.parent_span_id ?? null,
    ts: nowIso(),
    data,
  };
  const payload = JSON.stringify(envelope);
  const pipeline = r.pipeline();
  pipeline.publish(K.events(jobId), payload);
  pipeline.lpush(K.log(jobId), payload);
  pipeline.ltrim(K.log(jobId), 0, env.JOB_LOG_MAX_ENTRIES - 1);
  pipeline.expire(K.log(jobId), env.JOB_STATUS_TTL_S);
  await pipeline.exec();
  return envelope;
}

export async function writeFinal(jobId: string, envelope: EventEnvelope): Promise<void> {
  const r = getRedis();
  await r.set(K.final(jobId), JSON.stringify(envelope), 'EX', env.JOB_STATUS_TTL_S);
}

export async function setStatus(jobId: string, patch: Record<string, unknown>): Promise<void> {
  const r = getRedis();
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(patch)) {
    flat[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  await r.hset(K.status(jobId), flat);
  await r.expire(K.status(jobId), env.JOB_STATUS_TTL_S);
}

export async function getStatus(jobId: string): Promise<Record<string, string> | null> {
  const r = getRedis();
  const raw = await r.hgetall(K.status(jobId));
  return Object.keys(raw).length === 0 ? null : raw;
}
