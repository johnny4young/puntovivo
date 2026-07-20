/** shared rate math for live and materialized cashier pace. */
const MIN_RATE_WINDOW_MS = 60_000;
const MS_PER_MINUTE = 60_000;

/**
 * Calculate a stable items/minute rate with a one-minute floor so a newly
 * opened drawer cannot display an exaggerated burst score.
 */
export function calculateCashierItemsPerMinute(
  itemCount: number,
  durationMs: number
): number | null {
  if (
    !Number.isFinite(itemCount) ||
    itemCount < 0 ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    return null;
  }

  const effectiveMinutes = Math.max(durationMs, MIN_RATE_WINDOW_MS) / MS_PER_MINUTE;
  return Math.round((itemCount / effectiveMinutes) * 100) / 100;
}
