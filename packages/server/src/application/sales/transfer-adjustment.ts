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

/** The only two states an accumulated deposit can leave a tender in. */
export type DepositAccumulationStatus = 'manual_confirmed' | 'needs_reconciliation';

/** What the deposits recorded against one tender add up to. */
export interface DepositAccumulation {
  /** Everything the store actually received for the tender. */
  receivedAmount: number;
  /** The part of `receivedAmount` the tender can absorb (never above it). */
  appliedAmount: number;
  /** Still owed on this tender. */
  remainingAmount: number;
  /** Received money above the tender: reported, never applied to the sale. */
  surplusAmount: number;
  /** Manual confirmation only when the sum covers the tender with no excess. */
  status: DepositAccumulationStatus;
}

/**
 * The single derivation of "how much of this tender is paid".
 *
 * A transfer tender is confirmed by its MOVEMENTS, not by the last report: the
 * deposits accumulate, so two legitimate 50 instalments complete a 100
 * tender. The sum is capped at the tender (anything above it is surplus, never
 * sale money), and the status stays `needs_reconciliation` for any shortfall or
 * excess because a human has to decide what to do with the difference.
 *
 * Both sides of the database use this function: the write path feeds it the
 * deposits already on record plus the new movement, and the read path feeds it
 * the recorded chain, so the reconciliation surface can never disagree with the
 * tender. Noise is skipped instead of counted: a value that is not a finite
 * positive number is corrupt evidence, not money.
 */
export function summarizeDeposits(
  tenderAmount: number,
  deposits: readonly number[]
): DepositAccumulation {
  const target = roundMoney(tenderAmount);
  let receivedAmount = 0;
  for (const deposit of deposits) {
    const amount = roundMoney(deposit);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    receivedAmount = roundMoney(receivedAmount + amount);
  }
  const appliedAmount = roundMoney(Math.min(receivedAmount, Math.max(target, 0)));
  const remainingAmount = roundMoney(Math.max(0, roundMoney(target - receivedAmount)));
  const surplusAmount = roundMoney(Math.max(0, roundMoney(receivedAmount - target)));
  // Same tolerance the single-deposit path has always used: IEEE-754 drift is
  // not a shortfall, a real cent is.
  const covered = roundMoney(receivedAmount + PAYMENT_SUM_EPSILON) >= target;
  const exact = covered && surplusAmount <= PAYMENT_SUM_EPSILON;
  return {
    receivedAmount,
    appliedAmount,
    remainingAmount,
    surplusAmount,
    status: exact ? 'manual_confirmed' : 'needs_reconciliation',
  };
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
 *
 * The arithmetic is `summarizeDeposits`, the same derivation the deposit write
 * path and the reconciliation read path use; this planner only decides how to
 * distribute the result across tender rows.
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

  const accumulation = summarizeDeposits(target, [verified]);
  const appliedAmount = accumulation.appliedAmount;
  const remainingAmount = accumulation.remainingAmount;
  const surplusAmount = accumulation.surplusAmount;

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
