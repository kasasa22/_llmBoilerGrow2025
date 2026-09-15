/**
 * Typed error taxonomy — see plan B2 "Failure classification".
 * `classify(err)` normalises anything thrown into an AgentError so the
 * research fn's error handler can decide retry vs abort vs skip.
 */
export const ErrorCode = {
  ModelError: 'MODEL_ERROR',
  ModelToolParseError: 'MODEL_TOOL_PARSE_ERROR',
  ToolError: 'TOOL_ERROR',
  SearchError: 'SEARCH_ERROR',
  FetchError: 'FETCH_ERROR',
  FetchBlocked: 'FETCH_BLOCKED',
  FetchEmpty: 'FETCH_EMPTY',
  BudgetExceeded: 'BUDGET_EXCEEDED',
  RateLimited: 'RATE_LIMITED',
  RagEmbedFail: 'E_RAG_EMBED_FAIL',
  RagNoMatches: 'E_RAG_NO_MATCHES',
  ResearchNoSources: 'E_RESEARCH_NO_SOURCES',
  AnalysisNoClaims: 'E_ANALYSIS_NO_CLAIMS',
  SynthesisNoCitations: 'E_SYNTHESIS_NO_CITATIONS',
  RouterBudget: 'E_ROUTER_BUDGET',
  RouterWallclock: 'E_ROUTER_WALLCLOCK',
  InternalError: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface RetryPolicy {
  retryable: boolean;
  attempts: number;
  backoffMs: number[];
  terminal: 'hard' | 'soft' | 'on-exhaust' | 'never';
}

export const retryPolicy: Record<ErrorCode, RetryPolicy> = {
  MODEL_ERROR: { retryable: true, attempts: 3, backoffMs: [1000, 3000, 9000], terminal: 'on-exhaust' },
  MODEL_TOOL_PARSE_ERROR: { retryable: false, attempts: 0, backoffMs: [], terminal: 'soft' },
  TOOL_ERROR: { retryable: false, attempts: 1, backoffMs: [500], terminal: 'soft' },
  SEARCH_ERROR: { retryable: true, attempts: 2, backoffMs: [500, 2000], terminal: 'soft' },
  FETCH_ERROR: { retryable: false, attempts: 1, backoffMs: [500], terminal: 'soft' },
  FETCH_BLOCKED: { retryable: false, attempts: 0, backoffMs: [], terminal: 'soft' },
  FETCH_EMPTY: { retryable: false, attempts: 0, backoffMs: [], terminal: 'soft' },
  BUDGET_EXCEEDED: { retryable: false, attempts: 0, backoffMs: [], terminal: 'soft' },
  RATE_LIMITED: { retryable: true, attempts: 3, backoffMs: [2000, 4000, 8000], terminal: 'on-exhaust' },
  E_RAG_EMBED_FAIL: { retryable: false, attempts: 0, backoffMs: [], terminal: 'soft' },
  E_RAG_NO_MATCHES: { retryable: false, attempts: 0, backoffMs: [], terminal: 'soft' },
  E_RESEARCH_NO_SOURCES: { retryable: false, attempts: 0, backoffMs: [], terminal: 'soft' },
  E_ANALYSIS_NO_CLAIMS: { retryable: false, attempts: 0, backoffMs: [], terminal: 'soft' },
  E_SYNTHESIS_NO_CITATIONS: { retryable: false, attempts: 1, backoffMs: [500], terminal: 'soft' },
  E_ROUTER_BUDGET: { retryable: false, attempts: 0, backoffMs: [], terminal: 'soft' },
  E_ROUTER_WALLCLOCK: { retryable: false, attempts: 0, backoffMs: [], terminal: 'soft' },
  INTERNAL_ERROR: { retryable: false, attempts: 0, backoffMs: [], terminal: 'hard' },
};

export interface AgentErrorInit {
  code: ErrorCode;
  message: string;
  cause?: unknown;
  context?: Record<string, unknown>;
}

export class AgentError extends Error {
  readonly code: ErrorCode;
  readonly context: Record<string, unknown>;

  constructor(init: AgentErrorInit) {
    super(init.message, init.cause ? { cause: init.cause } : undefined);
    this.name = 'AgentError';
    this.code = init.code;
    this.context = init.context ?? {};
  }

  toJSON(): Record<string, unknown> {
    return { name: this.name, code: this.code, message: this.message, context: this.context };
  }
}

export class BudgetExceededError extends AgentError {
  readonly limit: string;
  readonly observed: number;

  constructor(limit: string, observed: number, context: Record<string, unknown> = {}) {
    super({
      code: ErrorCode.BudgetExceeded,
      message: `budget exceeded: ${limit} at ${observed}`,
      context: { limit, observed, ...context },
    });
    this.name = 'BudgetExceededError';
    this.limit = limit;
    this.observed = observed;
  }
}

export function classify(err: unknown): AgentError {
  if (err instanceof AgentError) return err;

  if (isDomError(err, 'AbortError')) {
    return new AgentError({ code: ErrorCode.BudgetExceeded, message: 'request aborted (wall-clock or manual)', cause: err });
  }
  if (err instanceof Error) {
    const msg = err.message || '';
    if (/timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED/i.test(msg)) {
      return new AgentError({ code: ErrorCode.ModelError, message: msg, cause: err });
    }
    if (/429/.test(msg)) {
      return new AgentError({ code: ErrorCode.RateLimited, message: msg, cause: err });
    }
    const status = (err as { status?: number; statusCode?: number }).status ?? (err as { statusCode?: number }).statusCode;
    if (typeof status === 'number' && status >= 500) {
      return new AgentError({ code: ErrorCode.ModelError, message: msg, cause: err });
    }
    return new AgentError({ code: ErrorCode.InternalError, message: msg, cause: err });
  }
  return new AgentError({ code: ErrorCode.InternalError, message: String(err) });
}

function isDomError(err: unknown, name: string): boolean {
  return !!err && typeof err === 'object' && (err as { name?: string }).name === name;
}
