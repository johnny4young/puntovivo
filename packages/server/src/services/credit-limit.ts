/**
 * Credit limit invariant — ENG-090.
 *
 * `requireCreditLimitNotExceeded` is the server-side guard that
 * `completeSale` calls before writing a `customer_ledger_entries`
 * row of `kind='sale'`. The invariant reads the customer's
 * `creditLimit` column (introduced by ENG-089) and the running
 * balance computed as `SUM(amount)` over the existing ledger rows,
 * then projects what the balance would be after the attempted
 * sale. If the projection exceeds the limit, the helper throws
 * `CREDIT_LIMIT_EXCEEDED` carrying the four values the cashier UI
 * needs to render a precise "Cupo superado" toast.
 *
 * Two bypass paths:
 *
 *   - `creditLimit === 0` is the explicit "no limit" sentinel per
 *     ENG-089. The helper returns immediately; sales proceed.
 *   - `allowOverride === true` is the admin-override path. The
 *     router gates the flag to admin callers; the helper trusts
 *     the bool and skips the throw. The ledger row is still
 *     written so the receivable remains visible.
 *
 * The helper is pure-with-db (no DOM, no globals); a given input
 * always reads the same row + sum so it is safe to call inside the
 * sale transaction without changing the surrounding semantics.
 *
 * @module services/credit-limit
 */

import { and, eq, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../db/index.js';
import { customers, customerLedgerEntries } from '../db/schema.js';
import { throwServerError } from '../lib/errorCodes.js';

export interface RequireCreditLimitNotExceededInput {
  db: DatabaseInstance;
  tenantId: string;
  customerId: string;
  /** Currency amount the credit sale will add to the receivable. */
  attemptedAmount: number;
  /**
   * Admin override flag. When true, the helper computes the
   * projection (so callers still have the numbers) but
   * skips the `CREDIT_LIMIT_EXCEEDED` throw. Defaults to false.
   */
  allowOverride?: boolean;
}

export interface CreditLimitProjection {
  creditLimit: number;
  currentBalance: number;
  projectedBalance: number;
  attemptedAmount: number;
  /** True when the projection exceeded the limit but the override
   *  flag was set; lets callers surface override metadata if they
   *  choose to persist it. */
  overrideApplied: boolean;
}

/**
 * Throws `CREDIT_LIMIT_EXCEEDED` when the projected balance would
 * exceed the customer's `creditLimit`. Returns the projection so
 * the caller can surface or persist the override context.
 *
 * `attemptedAmount` MUST be positive — credit-sale amounts are
 * always > 0 by the time they reach this helper. Zero and negative
 * inputs are rejected so a caller never silently writes a ledger
 * row of the wrong sign.
 */
export async function requireCreditLimitNotExceeded(
  input: RequireCreditLimitNotExceededInput
): Promise<CreditLimitProjection> {
  if (!Number.isFinite(input.attemptedAmount) || input.attemptedAmount <= 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_QUANTITY_INVALID',
      message: 'Credit sale amount must be a positive finite number',
      details: { attemptedAmount: input.attemptedAmount },
    });
  }

  // The customer row is fetched + scoped by tenant. A foreign or
  // unknown customerId surfaces as CREDIT_SALE_CUSTOMER_REQUIRED;
  // the caller should have validated this upstream but the helper
  // re-asserts so the invariant cannot be bypassed by a hand-rolled
  // sale row.
  const customer = await input.db
    .select({ creditLimit: customers.creditLimit })
    .from(customers)
    .where(
      and(
        eq(customers.id, input.customerId),
        eq(customers.tenantId, input.tenantId)
      )
    )
    .get();

  if (!customer) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CREDIT_SALE_CUSTOMER_REQUIRED',
      message:
        'Credit sale requires an existing customer attached to the sale',
      details: { customerId: input.customerId },
    });
  }

  const creditLimit = customer.creditLimit ?? 0;

  // Sentinel: 0 = sin cupo (no limit). Skip the projection read so
  // unconstrained customers never pay the SUM cost.
  if (creditLimit <= 0) {
    return {
      creditLimit: 0,
      currentBalance: 0,
      projectedBalance: 0,
      attemptedAmount: input.attemptedAmount,
      overrideApplied: false,
    };
  }

  const balanceRow = await input.db
    .select({
      balance: sql<number>`COALESCE(SUM(${customerLedgerEntries.amount}), 0)`.as(
        'balance'
      ),
    })
    .from(customerLedgerEntries)
    .where(
      and(
        eq(customerLedgerEntries.tenantId, input.tenantId),
        eq(customerLedgerEntries.customerId, input.customerId)
      )
    )
    .get();

  const currentBalance = balanceRow?.balance ?? 0;
  const projectedBalance = currentBalance + input.attemptedAmount;
  const exceedsLimit = projectedBalance > creditLimit;

  if (exceedsLimit && !input.allowOverride) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CREDIT_LIMIT_EXCEEDED',
      message: `Credit sale projection ${projectedBalance} exceeds limit ${creditLimit}`,
      details: {
        creditLimit,
        currentBalance,
        projectedBalance,
        attemptedAmount: input.attemptedAmount,
      },
    });
  }

  return {
    creditLimit,
    currentBalance,
    projectedBalance,
    attemptedAmount: input.attemptedAmount,
    overrideApplied: exceedsLimit && input.allowOverride === true,
  };
}
