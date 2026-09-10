/**
 * Bounds on the loyalty redemption rate, shared by the server input schema
 * and the settings form that submits to it.
 *
 * They live here rather than beside either consumer because the form used to
 * accept any positive number while the API accepted only [0.01, 1e9]. A
 * cashier could type 0.001, watch the preview render and Save enable, and
 * only learn the value was impossible when the mutation came back rejected.
 * A duplicated literal would drift again the first time one side moved.
 *
 * The lower bound is a cent because the value is money: below that the stored
 * amount rounds to zero and a point silently becomes worth nothing. The upper
 * bound is a sanity ceiling, not a business rule.
 */

/** Smallest redemption value a point may carry, in tenant currency. */
export const MIN_VALUE_PER_POINT = 0.01;

/** Largest redemption value a point may carry, in tenant currency. */
export const MAX_VALUE_PER_POINT = 1_000_000_000;

/** True when `value` is a redemption rate both the form and the API accept. */
export function isValidValuePerPoint(value: number): boolean {
  return Number.isFinite(value) && value >= MIN_VALUE_PER_POINT && value <= MAX_VALUE_PER_POINT;
}
