/**
 * Transfer tender adjustments (design V3.3 §1).
 *
 * A verified deposit rarely matches the expected tender to the cent. When it
 * does not, the sale's tender distribution has to be rewritten so the sum
 * invariant (`Σ active tenders = sales.total`) keeps holding while the money
 * actually received is stated truthfully.
 *
 * The rewrite is a pure planning step: it returns the rows a caller must
 * write inside one transaction. Nothing here touches the database, so the
 * arithmetic is testable on its own — which is exactly what a money path
 * needs.
 *
 * @module application/sales/transfer-adjustment
 */
import { roundMoney } from '../../lib/money.js';
import { PAYMENT_SUM_EPSILON } from './policies.js';

export interface PlannedTender {
  method: string;
  amount: number;
  reference: string | null;
  confirmationStatus?: 'pending' | 'manual_confirmed' | 'provider_confirmed' | null;
  confirmationSource?: 'operator' | 'provider_api' | 'provider_webhook' | null;
}

export interface TransferAdjustmentPlan {
  /** The amount now counted as received for the adjusted tender. */
  appliedAmount: number;
  /** The amount still owed by the customer on this tender. */
  remainingAmount: number;
  /** Money received above what the sale expected: never applied to the sale. */
  surplusAmount: number;
  /** Tenders to persist after the adjustment, in order. */
  tenders: PlannedTender[];
  /**
   * Sanity check the caller asserts inside the transaction: the active
   * (non-superseded) tenders must still add up to the sale total.
   */
  activeTotal: number;
  matchesSaleTotal: boolean;
}

export interface TransferAdjustmentInput {
  /** The whole sale's tenders as they stand now, current one included. */
  tenders: readonly PlannedTender[];
  /**
   * Position of the tender being adjusted inside `tenders`. Identity is
   * positional on purpose: two instalments of the same amount are different
   * rows, so matching by amount would replace both.
   */
  targetIndex: number;
  /** What the operator actually verified in the store account. */
  verifiedAmount: number;
  /** Free-form reference of the bank movement. */
  reference: string | null;
  /** Total of the sale, for the invariant check. */
  saleTotal: number;
}

/**
 * Plan the replacement distribution for one transfer tender.
 *
 * Two shapes only, both preserving the invariant:
 *  - **shortfall**  `verified < target`: the original row is superseded
 *    (`rejected`, excluded from every sum) and replaced by a confirmed row of
 *    `verified` plus a `pending` row for the difference, so the actives still
 *    add up to the sale total and the customer can complete the payment.
 *  - **match or surplus** `verified >= target`: a single confirmed row of the
 *    target amount. Money above the target is surplus — reported separately
 *    and never added to the sale.
 */
export function planTransferAdjustment(input: TransferAdjustmentInput): TransferAdjustmentPlan {
  const row = input.tenders[input.targetIndex];
  if (!row) {
    throw new Error(`Transfer adjustment target index ${input.targetIndex} is out of range`);
  }
  const target = roundMoney(row.amount);
  const verified = roundMoney(input.verifiedAmount);
  if (target <= 0) {
    throw new Error('Transfer adjustment requires a positive target amount');
  }
  if (verified <= 0) {
    throw new Error('Transfer adjustment requires a positive verified amount');
  }

  const appliedAmount = roundMoney(Math.min(verified, target));
  const remainingAmount = roundMoney(Math.max(0, roundMoney(target - verified)));
  const surplusAmount = roundMoney(Math.max(0, roundMoney(verified - target)));

  const others = input.tenders.filter((_, index) => index !== input.targetIndex);

  const tenders: PlannedTender[] = [
    ...others,
    {
      method: 'transfer',
      amount: appliedAmount,
      reference: input.reference,
      confirmationStatus: 'manual_confirmed',
      confirmationSource: 'operator',
    },
  ];

  if (remainingAmount > 0) {
    tenders.push({
      method: 'transfer',
      amount: remainingAmount,
      reference: null,
      confirmationStatus: 'pending',
      confirmationSource: null,
    });
  }

  // The caller supersedes the original row (rejected) in the same transaction;
  // it is never part of this plan, so every planned row is active.
  const activeTotal = roundMoney(
    tenders.reduce((sum, tender) => roundMoney(sum + tender.amount), 0)
  );

  return {
    appliedAmount,
    remainingAmount,
    surplusAmount,
    tenders,
    activeTotal,
    matchesSaleTotal: Math.abs(activeTotal - roundMoney(input.saleTotal)) < PAYMENT_SUM_EPSILON,
  };
}
