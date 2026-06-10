/**
 * ENG-054 — Pure policy functions extracted from the sales tRPC router.
 *
 * Every function here is pure: same inputs → same output, no DB access,
 * no logging, no side effects. They encode the business rules around
 * payment status, cash collection, and tender resolution that BOTH the
 * fresh-sale path and the draft-completion path apply.
 *
 * Lift the move-only refactor: the implementations below are
 * byte-equivalent to what lived inline in `trpc/routers/sales.ts`
 * before ENG-054. Tests in `sales.test.ts` and
 * `sales-park-and-reprint.test.ts` continue to pass without touching
 * a single assertion.
 *
 * @module application/sales/policies
 */

import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import type {
  CompleteSaleTender,
  SalePaymentMethod,
  SalePaymentStatus,
} from './types.js';

/**
 * Tolerance for Σ(tenders) vs sale total. Tender amounts are 2-decimal
 * by schema, but their FLOAT sum can drift by ~1e-16 per addition
 * (0.10 + 0.20 = 0.30000000000000004), so an exact equality check would
 * reject legitimate split payments. Half a cent is the tightest bound
 * that absorbs that drift while still rejecting any real 1-cent
 * mismatch — do NOT widen it; see the PAYMENT_SUM_EPSILON regression
 * tests in application-sales-completeSale.test.ts (ENG-176a context).
 */
const PAYMENT_SUM_EPSILON = 0.005;

/**
 * Decide the persisted `paymentStatus` of a sale at completion time.
 *
 * - Split payments are validated up-front to sum exactly to the sale
 *   total, so the moment we reach here the sale is fully paid by
 *   construction.
 * - Credit (on-account) tenders honor whatever the client requested —
 *   the cashier may post a credit sale as `pending` until the customer
 *   pays it down.
 * - Single-tender sales derive `paid` / `partial` / `pending` from
 *   `amountReceived` against `total`.
 */
export function getPaymentStatus({
  amountReceived,
  paymentMethod,
  requestedStatus,
  total,
  isSplit,
  creditAmount,
}: {
  amountReceived: number | undefined;
  paymentMethod: SalePaymentMethod;
  requestedStatus: SalePaymentStatus;
  total: number;
  isSplit?: boolean;
  /**
   * ENG-014 — sum of credit-tender amounts within the resolved payments
   * list. When a split sale carries a credit portion (cash + credit
   * mix, "apartado") the persisted status flips to `'partial'`: some
   * tenders settle at the register, the rest land on the customer
   * ledger as an IOU. A pure split (cash + card, no credit) keeps
   * the legacy `'paid'` outcome.
   */
  creditAmount?: number;
}): SalePaymentStatus {
  if (isSplit) {
    return (creditAmount ?? 0) > 0 ? 'partial' : 'paid';
  }

  if (paymentMethod === 'credit') {
    return requestedStatus;
  }

  if (amountReceived === undefined) {
    return requestedStatus;
  }

  if (amountReceived >= total) {
    return 'paid';
  }

  if (amountReceived > 0) {
    return 'partial';
  }

  return requestedStatus;
}

/**
 * Cash actually collected at the register, used to size the cash
 * movement that hits the active session balance. Non-cash tenders
 * contribute nothing here; cash overage is accounted for as `change`,
 * not as collected cash.
 */
export function getCashCollectedAmount({
  paymentMethod,
  amountReceived,
  total,
  change,
}: {
  paymentMethod: SalePaymentMethod;
  amountReceived: number | undefined;
  total: number;
  change: number;
}): number {
  if (paymentMethod !== 'cash') {
    return 0;
  }

  if (amountReceived === undefined) {
    return total;
  }

  return roundMoney(Math.max(0, amountReceived - change));
}

export interface ResolvedSalePayments {
  rows: CompleteSaleTender[];
  dominantMethod: SalePaymentMethod;
}

/**
 * Normalize the two create-sale input modes into a single list of
 * payment rows the persistence layer can write verbatim:
 *
 * - Multi-tender: caller supplied `args.payments`. Validate that the
 *   sum matches the sale total within a cent of tolerance.
 * - Legacy single-tender: derive one row from `legacyMethod`, cap its
 *   amount at the total (cash tenders may receive > total — the
 *   overage is change, not a persisted tender).
 *
 * Returns the normalized list plus the dominant `paymentMethod` to
 * echo onto `sales.paymentMethod`. For split payments the dominant
 * tender is the one with the largest amount, breaking ties with the
 * first-supplied entry.
 */
export function resolveSalePayments(args: {
  payments: CompleteSaleTender[] | undefined;
  legacyMethod: SalePaymentMethod;
  amountReceived: number | undefined;
  total: number;
}): ResolvedSalePayments {
  if (args.payments && args.payments.length > 0) {
    const rows = args.payments.map(payment => ({
      method: payment.method,
      amount: roundMoney(payment.amount),
      reference: payment.reference ?? null,
    }));
    const sum = rows.reduce((acc, payment) => roundMoney(acc + payment.amount), 0);
    if (Math.abs(sum - args.total) >= PAYMENT_SUM_EPSILON) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'SALE_PAYMENTS_SUM_MISMATCH',
        message: 'Sum of payments must equal the sale total',
        details: { sum, total: args.total },
      });
    }

    // ENG-014 — when split tender mixes credit with other methods,
    // the dominant `paymentMethod` echoed onto `sales.payment_method`
    // must NOT be 'credit'. The operator thinks of the sale through
    // the lens of the initial-installment tender (cash / card), not
    // the IOU portion. Demote credit from the dominant pick when at
    // least one non-credit tender exists; otherwise keep the legacy
    // behavior (single-tender credit OR all-credit split still echoes
    // 'credit').
    const nonCreditTenders = rows.filter(p => p.method !== 'credit');
    const dominantPool = nonCreditTenders.length > 0 ? nonCreditTenders : rows;
    const dominant = dominantPool.reduce((best, payment) =>
      payment.amount > best.amount ? payment : best
    );
    return {
      rows,
      dominantMethod: dominant.method,
    };
  }

  // Legacy single-tender path: one payment row whose amount equals the
  // sale total (cash overage is change, not a tender). Credit tenders
  // ignore `amountReceived` entirely because the customer pays nothing
  // at the register — the whole sale lands on the ledger (ENG-090).
  const legacyAmount =
    args.legacyMethod === 'credit'
      ? args.total
      : Math.min(args.amountReceived ?? args.total, args.total);
  return {
    rows: [
      {
        method: args.legacyMethod,
        amount: roundMoney(legacyAmount),
        reference: null,
      },
    ],
    dominantMethod: args.legacyMethod,
  };
}

/**
 * Normalize quantity-against-equivalence into the value persisted to
 * `sale_items.normalized_quantity` and used for stock decrement.
 *
 * Used by the resolver inside the use-case service. Throws when the
 * resulting normalized quantity is non-positive (the unit equivalence
 * was zero, NaN, or the unit price was hostile).
 */
export function getNormalizedSaleQuantity(quantity: number, equivalence: number): number {
  const normalizedQuantity = quantity * equivalence;

  if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_QUANTITY_NONPOSITIVE',
      message: 'The selected quantity must resolve to a positive stock quantity',
    });
  }

  return normalizedQuantity;
}

/**
 * Concatenate a "Voided: <reason>" suffix onto an existing sale's
 * notes string. Pure: no DB access. Returns the original notes when
 * `reason` is empty so the column never gets a trailing separator
 * with nothing after it.
 *
 * Originally inlined in `trpc/routers/sales.ts`; ENG-055 promoted to
 * the policies module for reuse by `voidSale`.
 */
export function buildVoidedSaleNotes(
  existingNotes: string | null,
  reason: string | undefined | null
): string | null {
  if (!reason) {
    return existingNotes;
  }
  return `${existingNotes ? `${existingNotes} | ` : ''}Voided: ${reason}`;
}

/**
 * Concatenate a "Refunded: <reason>" suffix onto an existing sale's
 * notes string. Pure: no DB access. Returns the original notes when
 * `reason` is empty.
 *
 * Originally inlined in `trpc/routers/sales.ts`; ENG-055 promoted to
 * the policies module for reuse by `returnSale`.
 */
export function buildReturnedSaleNotes(
  existingNotes: string | null,
  reason: string | undefined | null
): string | null {
  if (!reason) {
    return existingNotes;
  }
  return `${existingNotes ? `${existingNotes} | ` : ''}Refunded: ${reason}`;
}

/**
 * Compute the cash amount that was effectively persisted to the cash
 * session for a completed sale. Used by the void / refund paths to
 * size the reversal cash movement.
 *
 * - Non-cash tenders contribute zero.
 * - Pending or refunded sales contribute zero (no cash actually
 *   landed in the drawer for them).
 * - Otherwise the full sale total is the persisted cash contribution.
 */
export function getPersistedCashContribution(sale: {
  paymentMethod: SalePaymentMethod;
  paymentStatus: SalePaymentStatus;
  total: number;
}): number {
  if (sale.paymentMethod !== 'cash') {
    return 0;
  }
  if (sale.paymentStatus === 'pending' || sale.paymentStatus === 'refunded') {
    return 0;
  }
  // ENG-014 — `'partial'` covers two distinct cases since the
  // credit-mix slice landed: legacy single-tender cash with
  // `amountReceived < total`, AND split sales with a credit portion.
  // For partial sales the sale.total no longer matches the actual
  // cash deposited at the register, so this synchronous fallback
  // cannot trust it. The primary lookup in
  // `getPersistedSaleCashContribution` reads `cash_movements`
  // directly and is preferred; this fallback only fires when the
  // movement row is missing (data corruption), in which case the
  // safe direction is under-refund (operator reconciles) rather
  // than over-refund (drawer short).
  if (sale.paymentStatus === 'partial') {
    return 0;
  }
  return sale.total;
}
