import type { FreshSaleStatus } from './types.js';

/** discard abandoned carts from the motivational checkout average. */
export const MAX_CHECKOUT_DURATION_MS = 4 * 60 * 60 * 1000;

export interface CheckoutTiming {
  checkoutStartedAt: string | null;
  checkoutCompletedAt: string | null;
}

/**
 * Normalize a renderer-supplied cart start against the authoritative server
 * completion time. Missing, future, or abandoned-cart timestamps remain
 * unmeasured instead of poisoning the operator's average.
 */
export function resolveCheckoutTiming(
  startedAt: string | null | undefined,
  completedAt: string
): CheckoutTiming {
  if (!startedAt) {
    return { checkoutStartedAt: null, checkoutCompletedAt: null };
  }

  const startedMs = Date.parse(startedAt);
  const completedMs = Date.parse(completedAt);
  const durationMs = completedMs - startedMs;
  if (
    !Number.isFinite(startedMs) ||
    !Number.isFinite(completedMs) ||
    durationMs < 0 ||
    durationMs > MAX_CHECKOUT_DURATION_MS
  ) {
    return { checkoutStartedAt: null, checkoutCompletedAt: null };
  }

  return {
    checkoutStartedAt: new Date(startedMs).toISOString(),
    checkoutCompletedAt: new Date(completedMs).toISOString(),
  };
}

/** Fresh drafts/import states are not completed checkouts. */
export function resolveFreshCheckoutTiming(
  status: FreshSaleStatus,
  startedAt: string | null | undefined,
  completedAt: string
): CheckoutTiming {
  return status === 'completed'
    ? resolveCheckoutTiming(startedAt, completedAt)
    : { checkoutStartedAt: null, checkoutCompletedAt: null };
}
