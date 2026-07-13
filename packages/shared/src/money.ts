/**
 * Round monetary values to two decimals using the POS-wide
 * half-away-from-zero contract (ENG-176a / ENG-203).
 *
 * The absolute-value mirror keeps negative half-cent values aligned with
 * SQLite round(), while Number.EPSILON corrects common IEEE-754 boundaries
 * such as 1.005. Negative zero is normalized before values reach UI or DB.
 */
export function roundMoney(value: number): number {
  const rounded =
    Math.sign(value) * (Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100);
  return Object.is(rounded, -0) ? 0 : rounded;
}
