import { AsyncLocalStorage } from 'node:async_hooks';

const bootContext = AsyncLocalStorage.snapshot();

export function runDetached<T>(fn: () => T): T {
  return bootContext(fn);
}
