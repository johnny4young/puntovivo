import { useCallback, useEffect, useState } from 'react';
import { calendarDayAt } from '@/lib/utils';

const VISIBLE_CLOCK_REFRESH_MS = 60_000;

/** Keep a corrupt clock or legacy tenant zone from exposing dated stock. */
export function resolveLotBusinessDate(now: number, timezone: string): string | null {
  try {
    return calendarDayAt(new Date(now), timezone);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/**
 * A bounded clock for long-open operational surfaces. Refresh while visible,
 * and recover immediately when a suspended register gets focus again.
 * Consumers still validate time-sensitive commands against a fresh clock.
 */
export function useLiveNow(): { now: number; refreshNow: () => number } {
  const [now, setNow] = useState(() => Date.now());
  const refreshNow = useCallback(() => {
    const current = Date.now();
    setNow(current);
    return current;
  }, []);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (!document.hidden) refreshNow();
    };
    const interval = window.setInterval(refreshIfVisible, VISIBLE_CLOCK_REFRESH_MS);
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [refreshNow]);

  return { now, refreshNow };
}
