/**
 * BudgetTracker — enforces the six MAX_* budgets from plan B3 Cost controls.
 * Every check throws `BudgetExceededError` which the classifier turns into
 * a `BUDGET_EXCEEDED` SSE event + forced-synthesis path in research.ts.
 */
import { BudgetExceededError } from './errors.js';

export interface Budgets {
  MAX_TOOL_CALLS: number;
  MAX_FETCHES: number;
  MAX_SEARCH_QUERIES: number;
  MAX_CONTEXT_CHARS: number;
  MAX_WALL_CLOCK_MS: number;
  MAX_TOKENS_PER_CALL: number;
}

export interface BudgetSnapshot {
  toolCalls: number;
  fetches: number;
  searches: number;
  contextChars: number;
  elapsedMs: number;
  wallClockRemainingMs: number;
  budgets: Budgets;
}

export class BudgetTracker {
  private toolCalls = 0;
  private fetches = 0;
  private searches = 0;
  private contextChars = 0;
  private readonly startMs = Date.now();

  constructor(private readonly budgets: Budgets) {}

  onToolCall(name: string): void {
    this.toolCalls += 1;
    if (this.toolCalls > this.budgets.MAX_TOOL_CALLS) {
      throw new BudgetExceededError('MAX_TOOL_CALLS', this.toolCalls, { tool: name });
    }
    this._checkWallClock();
  }

  onFetch(url?: string): void {
    this.fetches += 1;
    if (this.fetches > this.budgets.MAX_FETCHES) {
      throw new BudgetExceededError('MAX_FETCHES', this.fetches, { url });
    }
  }

  onSearch(query?: string): void {
    this.searches += 1;
    if (this.searches > this.budgets.MAX_SEARCH_QUERIES) {
      throw new BudgetExceededError('MAX_SEARCH_QUERIES', this.searches, { query });
    }
  }

  addContext(chars: number): void {
    this.contextChars += Math.max(0, chars);
    if (this.contextChars > this.budgets.MAX_CONTEXT_CHARS) {
      throw new BudgetExceededError('MAX_CONTEXT_CHARS', this.contextChars, { addedChars: chars });
    }
  }

  wallClockRemaining(): number {
    return Math.max(0, this.budgets.MAX_WALL_CLOCK_MS - (Date.now() - this.startMs));
  }

  isWallClockExhausted(): boolean {
    return this.wallClockRemaining() <= 0;
  }

  maxTokensPerCall(): number {
    return this.budgets.MAX_TOKENS_PER_CALL;
  }

  snapshot(): BudgetSnapshot {
    return {
      toolCalls: this.toolCalls,
      fetches: this.fetches,
      searches: this.searches,
      contextChars: this.contextChars,
      elapsedMs: Date.now() - this.startMs,
      wallClockRemainingMs: this.wallClockRemaining(),
      budgets: this.budgets,
    };
  }

  private _checkWallClock(): void {
    if (this.isWallClockExhausted()) {
      throw new BudgetExceededError('MAX_WALL_CLOCK_MS', this.budgets.MAX_WALL_CLOCK_MS);
    }
  }
}
