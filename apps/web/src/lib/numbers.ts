/**
 * Numeric helpers used across feature modules. Standalone module — leaves
 * room for future helpers (clamp, roundTo, ...) without bloating
 * `lib/utils.ts`.
 *
 * Introduced by  to collapse the ad-hoc
 * `items.reduce((s, x) => s + x.field, 0)` pattern that recurs across cart
 * and totals computations.
 */

/**
 * Sum a numeric projection of an array. Returns `0` for an empty array.
 *
 * The selector is intentionally typed `(item: T) => number` (not `keyof T`)
 * so callers can keep coercion at the call site for shapes whose field is
 * `string | number` (e.g. controlled form inputs). The helper itself stays
 * agnostic to the source data shape.
 *
 * @example
 * sumBy(completedPurchases, p => p.total)
 * sumBy(tenders, t => Number(t.amount) || 0)
 */
export function sumBy<T>(items: readonly T[], selector: (item: T) => number): number {
  let total = 0;
  for (const item of items) {
    total += selector(item);
  }
  return total;
}
