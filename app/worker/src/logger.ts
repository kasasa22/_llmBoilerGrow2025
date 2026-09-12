/**
 * Structured logger with automatic trace-context binding on every line.
 * Matches the Python side's JSON envelope so `jq 'select(.trace_id==$T)'`
 * correlates Flask and worker logs by field name.
 */
import pino from 'pino';

import { env } from './config.js';
import { currentTrace } from './trace.js';

const base = pino({
  level: env.LOG_LEVEL,
  base: { service: 'bosmart-worker', env: env.NODE_ENV },
  formatters: {
    level: (label) => ({ level: label }),
    bindings: (bindings) => ({ pid: bindings.pid, host: bindings.hostname }),
    log: (obj) => {
      const ctx = currentTrace();
      if (!ctx) return obj;
      return {
        trace_id: ctx.trace_id,
        job_id: ctx.job_id ?? null,
        span_id: ctx.span_id ?? null,
        parent_span_id: ctx.parent_span_id ?? null,
        ...obj,
      };
    },
  },
  timestamp: () => `,"ts":"${new Date().toISOString()}"`,
});

export const logger = base;
export type Logger = typeof base;
