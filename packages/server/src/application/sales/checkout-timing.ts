import type { FreshSaleStatus } from './types.js';

/** discard abandoned carts from the motivational checkout average. */
export const MAX_CHECKOUT_DURATION_MS = 4 * 60 * 60 * 1000;

export interface CheckoutTiming {
  checkoutStartedAt: string | null;
  checkoutCompletedAt: string | null;
}

/**
 * Normalize a renderer-supplied cart start against the authoritative server
 * completion time. The completion instant is always retained for a
 * completed sale; missing, future, or abandoned-cart START timestamps
 * remain unmeasured instead of poisoning the operator's average.
 */
export function resolveCheckoutTiming(
  startedAt: string | null | undefined,
  completedAt: string
): CheckoutTiming {
  const completedMs = Date.parse(completedAt);
  if (!Number.isFinite(completedMs)) {
    return { checkoutStartedAt: null, checkoutCompletedAt: null };
  }
  const normalizedCompletedAt = new Date(completedMs).toISOString();
  if (!startedAt) {
    return { checkoutStartedAt: null, checkoutCompletedAt: normalizedCompletedAt };
  }

  const startedMs = Date.parse(startedAt);
  const durationMs = completedMs - startedMs;
  if (!Number.isFinite(startedMs) || durationMs < 0 || durationMs > MAX_CHECKOUT_DURATION_MS) {
    return { checkoutStartedAt: null, checkoutCompletedAt: normalizedCompletedAt };
  }

  return {
    checkoutStartedAt: new Date(startedMs).toISOString(),
    checkoutCompletedAt: normalizedCompletedAt,
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
