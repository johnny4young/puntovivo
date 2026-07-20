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
 * - `safelyRecordCreditSaleLedger` — post-tx best-effort ledger write
 * (): a ledger failure NEVER rolls the (already committed) sale
 * back; it is logged and left for operator retry.
 *
 * The genuine fresh-vs-draft differences (customer source, the fresh
 * `status === 'completed'` gate, the saleId / note / log-label) are
 * carried as parameters so each call site reproduces its original
 * behavior exactly.
 *
 * @module application/sales/creditPolicy
 */

import type { DatabaseInstance } from '../../db/index.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { requireCreditLimitNotExceeded } from '../../services/credit-limit.js';
import { recordCreditSaleLedger } from './recordCreditSaleLedger.js';
import type { CompleteSaleLogger } from './types.js';

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
export async function runCreditPreflight(args: {
  db: DatabaseInstance;
  tenantId: string;
  creditSaleAmount: number;
  customerId: string | null | undefined;
  allowOverride: boolean;
  enabled: boolean;
}): Promise<CreditPreflightProjection> {
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
 * write the customer ledger receivable for credit sales.
 * Best-effort post-tx: a ledger write failure does not roll back the
 * sale (the sale tx already committed). Operators can retry the ledger
 * write from the Cuenta corriente panel via `customerLedger.addAdjustment`
 * if this branch ever fails. `projectedBalance` is captured for the
 * future audit-metadata wire-up (becomes the receipt's saldo posterior
 * when the renderer integration lands as ).
 *
 * `enabled` carries the fresh-only `input.status === 'completed'` gate;
 * the draft path passes `true`. `logLabel` distinguishes the warn line
 * between the two paths.
 */
export async function safelyRecordCreditSaleLedger(args: {
  db: DatabaseInstance;
  log: CompleteSaleLogger;
  tenantId: string;
  customerId: string | null | undefined;
  creditSaleAmount: number;
  saleId: string;
  createdBy: string;
  note: string;
  projectedBalance: number | null;
  enabled: boolean;
  logLabel: string;
}): Promise<void> {
  const {
    db,
    log,
    tenantId,
    customerId,
    creditSaleAmount,
    saleId,
    createdBy,
    note,
    projectedBalance,
    enabled,
    logLabel,
  } = args;

  if (creditSaleAmount > 0 && customerId && enabled) {
    try {
      await recordCreditSaleLedger({
        db,
        tenantId,
        customerId,
        creditAmount: creditSaleAmount,
        saleId,
        createdBy,
        note,
      });
    } catch (err) {
      log.warn(
        {
          err,
          saleId,
          customerId,
          creditSaleAmount,
          projectedBalance,
        },
        `${logLabel} failed to write credit-sale ledger row`
      );
    }
  }
}
