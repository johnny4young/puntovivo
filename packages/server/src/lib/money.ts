/**
 * Server compatibility facade for the shared money primitive
 * (, centralized by ).
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
 * 1. Tax-exclusive math in tax-inclusive sales:
 * `subtotal = gross / (1 + taxRate)` is non-terminating for most
 * LATAM rates (e.g. `100 / 1.19 = 84.033...`).
 * 2. Σ accumulation of line totals:
 * `subtotal += unitPrice * quantity` accumulates sub-cent drift
 * across multiple line items.
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
 * LATAM currency we ship uses 2 decimals;  will add
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
import { sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { roundMoney } from '@puntovivo/shared/money';

export { roundMoney };

/**
 * Round a value and return it only when its integer-cent representation is
 * exact in JavaScript. This is intentionally opt-in while legacy monetary
 * paths are migrated; callers must translate `null` into their domain error.
 */
export function tryRoundMoneyToSafeCents(value: number): number | null {
  const rounded = roundMoney(value);
  const cents = Math.round(rounded * 100);
  return Number.isFinite(rounded) && Number.isSafeInteger(cents) ? rounded : null;
}

/**
 * A money SUM over rows, rounded to the cent inside SQL.
 *
 * `roundMoney` normalises values the application computes, but it never sees a
 * `SUM()` the database performs. A float sum over N rows is not cent-clean
 * even when every row is: a customer ledger holding 0.10 and 0.20 sums to
 * 0.30000000000000004, and the credit-limit check that compared that against a
 * 0.35 cupo refused a sale landing exactly on it. Rounding each row as it is
 * written does not help; the sum has to be rounded too.
 *
 * Use this for every aggregate over a monetary column. Seventeen of the
 * nineteen such sums in the server already wrapped `round(..., 2)` by hand —
 * this makes the correct form the short one, so the next aggregate does not
 * have to remember.
 */
export function sumMoneySql(column: SQLiteColumn): SQL<number> {
  return sql<number>`round(coalesce(sum(${column}), 0), 2)`;
}
