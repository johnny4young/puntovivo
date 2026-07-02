import { useEffect, useState } from 'react';

/**
 * Returns `value` after it has been stable for `delayMs`. Unlike
 * `useDeferredValue` — which only deprioritizes the *render* and still
 * lets every settled keystroke become a distinct query key / network
 * request — this coalesces rapid changes into one trailing update, so a
 * cashier typing "gaseosa" issues one search instead of seven.
 *
 * The first non-initial change still waits the full delay; pass a small
 * `delayMs` (150-250ms) so the UI keeps feeling immediate.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [value, delayMs]);

  return debounced;
}
