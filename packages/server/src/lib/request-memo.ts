import { AsyncLocalStorage } from 'node:async_hooks';

const scope = new AsyncLocalStorage<Map<string, unknown>>();

/**
 * Runs `work` with a memo that `memoizeInScope` shares across every helper it
 * calls. Use it only around work that never writes the values it memoizes.
 */
export function withRequestMemo<T>(work: () => T): T {
  return scope.run(new Map(), work);
}

/** Outside `withRequestMemo` this always computes. A rejected promise is not kept. */
export function memoizeInScope<T>(key: string, compute: () => T): T {
  const memo = scope.getStore();
  if (!memo) return compute();
  if (memo.has(key)) return memo.get(key) as T;
  const value = compute();
  memo.set(key, value);
  if (value instanceof Promise) {
    value.catch(() => {
      if (memo.get(key) === value) memo.delete(key);
    });
  }
  return value;
}
