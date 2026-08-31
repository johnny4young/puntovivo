/**
 * Credit-sale orchestration for the `completeSale` use-case,
 * extracted from the former monolithic `completeSale.ts`.
 *
 * Wraps the two credit touchpoints that were inlined in both
 * `runFreshSale` and `runCompleteDraft`:
 *
 * - `runCreditPreflight` — pre-tx cupo invariant (): the
 * customer-required throw + `requireCreditLimitNotExceeded`. Runs
 * BEFORE the sale tx so a cupo violation never decrements stock /
 * inserts a sale row that would have to be voided.
 * - `enforceCreditLimit` + `recordCreditSaleLedgerInTransaction` — the
 * authoritative in-transaction projection and receivable write.
 *
 * The genuine fresh-vs-draft differences (customer source, the fresh
 * `status === 'completed'` gate and the saleId / note) are
 * carried as parameters so each call site reproduces its original
 * behavior exactly.
 *
 * @module application/sales/creditPolicy
 */

import type { DatabaseInstance } from '../../db/index.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { requireCreditLimitNotExceeded } from '../../services/credit-limit.js';
import { recordCreditSaleLedger } from './recordCreditSaleLedger.js';

/** Projection returned by the cupo pre-flight, or null when not run. */
export type CreditPreflightProjection = Awaited<
  ReturnType<typeof requireCreditLimitNotExceeded>
> | null;

/**
 * credit-sale pre-flight. Only the credit portion creates a
 * `customer_ledger_entries.kind='sale'` row; the non-credit tenders
 * settle through the cash session as usual. The invariant + the
 * customer-required throw run BEFORE the sale tx so a cupo violation
 * never decrements stock / inserts a sale row that would have to be
 * voided.
 *
 * `enabled` carries the fresh-only `input.status === 'completed'` gate
 * (the draft path is always completing, so it passes `true`).
 * `customerId` is sourced per-path (fresh: `input.customerId`; draft:
 * 's resolution of `input.customerId ?? existing.customerId`). The
 * draft path MUST pass the resolved value, not the stored one, or a
 * customer attached at payment time would be projected against the wrong
 * cupo — or none at all.
 */
export function enforceCreditLimit(args: {
  db: DatabaseInstance;
  tenantId: string;
  creditSaleAmount: number;
  customerId: string | null | undefined;
  allowOverride: boolean;
  enabled: boolean;
}): CreditPreflightProjection {
  const { db, tenantId, creditSaleAmount, customerId, allowOverride, enabled } = args;
  const hasCreditPortion = creditSaleAmount > 0;
  if (hasCreditPortion && enabled) {
    if (!customerId) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'CREDIT_SALE_CUSTOMER_REQUIRED',
        message: 'Credit sales require a customer to be attached',
      });
    }
    return requireCreditLimitNotExceeded({
      db,
      tenantId,
      customerId,
      attemptedAmount: creditSaleAmount,
      allowOverride,
    });
  }
  return null;
}

/**
 * Fast-fail wrapper kept outside the write transaction for precise UX. The
 * authoritative check MUST run again inside the sale transaction through
 * `enforceCreditLimit`; otherwise two concurrent checkouts can both project
 * against the same stale ledger balance.
 */
export async function runCreditPreflight(args: {
  db: DatabaseInstance;
  tenantId: string;
  creditSaleAmount: number;
  customerId: string | null | undefined;
  allowOverride: boolean;
  enabled: boolean;
}): Promise<CreditPreflightProjection> {
  return enforceCreditLimit(args);
}

/**
 * Persist the receivable as part of the same transaction as the completed
 * sale. This is financial state, not a best-effort side effect: if the row
 * cannot be written, the sale, stock, tenders and cash movement must all
 * roll back together.
 */
export function recordCreditSaleLedgerInTransaction(args: {
  db: DatabaseInstance;
  tenantId: string;
  customerId: string | null | undefined;
  creditSaleAmount: number;
  saleId: string;
  createdBy: string;
  note: string;
  enabled: boolean;
}): void {
  const { db, tenantId, customerId, creditSaleAmount, saleId, createdBy, note, enabled } = args;
  if (creditSaleAmount > 0 && customerId && enabled) {
    recordCreditSaleLedger({
      db,
      tenantId,
      customerId,
      creditAmount: creditSaleAmount,
      saleId,
      createdBy,
      note,
    });
  }
}
