/**
 * Server compatibility facade for the shared money primitive
 * (ENG-176a-rounding, centralized by ENG-203).
 *
 * Why this exists. The schema (`db/schema.ts`) declares CHECK invariants
 * on every monetary column: `chk_<col>_nonneg` (no negatives on
 * always-positive columns) and `chk_<col>_2dec`
 * (`round(value, 2) = value`). The precision invariant is strict: any
 * value with more than two decimal digits, including IEEE-754 epsilon
 * drift (`99.99000000000001`), is rejected at the storage layer.
 *
 * Why the codebase needs the shared primitive. Two legitimate flows produce non-2-decimal
 * intermediates:
 *
 *   1. Tax-exclusive math in tax-inclusive sales:
 *      `subtotal = gross / (1 + taxRate)` is non-terminating for most
 *      LATAM rates (e.g. `100 / 1.19 = 84.033...`).
 *   2. Σ accumulation of line totals:
 *      `subtotal += unitPrice * quantity` accumulates sub-cent drift
 *      across multiple line items.
 *
 * To keep the storage layer's precision contract honest WITHOUT
 * dropping the application's tax / accumulation flow, every monetary
 * write must round to two decimals at the boundary. The shared `roundMoney`
 * normalises a JS number to its nearest cent using the
 * `(value + Number.EPSILON) * 100` trick — the EPSILON offset defeats
 * banker's-rounding edge cases (`1.005 → 1.00` vs `1.01`) that browser
 * JS engines disagree on. The result is byte-identical to what
 * `intl.NumberFormat` would render and what SQLite's `round(x, 2)`
 * returns.
 *
 * Apply this at every `db.insert(<table>).values({...})` or
 * `db.update(<table>).set({...})` that touches a column declared in
 * `db/schema.ts` with `moneyPositiveChecks` or `moneyTwoDecimalCheck`.
 * For accumulation patterns (`subtotal += ...`), round AFTER each
 * iteration (not only at the end) so a long line list does not stack
 * drift across iterations.
 *
 * Out of scope: per-currency exponent (JPY = 0, BHD = 3). Today every
 * LATAM currency we ship uses 2 decimals; ENG-176b will add
 * `currency_code` per-row and a future iteration can refine to
 * `roundMoney(value, currency_code)` using `currency_catalog.decimals`.
 *
 * Negative values round half-away-from-zero too (auditoría 2026-06):
 * `Math.round` alone rounds negative halves toward +infinity
 * (`Math.round(-234.5) === -234`), which would make
 * `roundMoney(-2.345)` land on -2.34 while SQLite's `round()` and this
 * doc promise -2.35. Mirroring on `Math.abs` keeps both signs on the
 * same rule; the explicit `-0` normalization covers the sign
 * multiplication when a tiny negative collapses to zero (a NaN input
 * still propagates as NaN instead of silently coining 0.00).
 *
 * @example
 * roundMoney(99.99000000001) === 99.99
 * roundMoney(0.1 + 0.2) === 0.30
 * roundMoney(100 / 1.19) === 84.03
 * roundMoney(-2.345) === -2.35
 */
export { roundMoney } from '@puntovivo/shared/money';
