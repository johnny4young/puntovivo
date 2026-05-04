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
import type {
  CompleteSaleTender,
  SalePaymentMethod,
  SalePaymentStatus,
} from './types.js';

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
}: {
  amountReceived: number | undefined;
  paymentMethod: SalePaymentMethod;
  requestedStatus: SalePaymentStatus;
  total: number;
  isSplit?: boolean;
}): SalePaymentStatus {
  if (isSplit) {
    return 'paid';
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

  return Math.max(0, amountReceived - change);
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
    const sum = args.payments.reduce((acc, payment) => acc + payment.amount, 0);
    if (Math.abs(sum - args.total) >= PAYMENT_SUM_EPSILON) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'SALE_PAYMENTS_SUM_MISMATCH',
        message: 'Sum of payments must equal the sale total',
        details: { sum, total: args.total },
      });
    }

    const dominant = args.payments.reduce((best, payment) =>
      payment.amount > best.amount ? payment : best
    );
    return {
      rows: args.payments.map(payment => ({
        method: payment.method,
        amount: payment.amount,
        reference: payment.reference ?? null,
      })),
      dominantMethod: dominant.method,
    };
  }

  // Legacy single-tender path: one payment row whose amount equals the
  // sale total (cash overage is change, not a tender).
  const legacyAmount = Math.min(args.amountReceived ?? args.total, args.total);
  return {
    rows: [
      {
        method: args.legacyMethod,
        amount: legacyAmount,
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

export const PAYMENT_SUM_EPSILON_VALUE = PAYMENT_SUM_EPSILON;

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
  return sale.total;
}
