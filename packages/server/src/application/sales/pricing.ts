/**
 * ENG-178 — Money computation for the `completeSale` use-case, extracted
 * from the former monolithic `completeSale.ts` during the megafile
 * decomposition.
 *
 * Owns the two pure-ish money operations shared / used by the sale paths:
 *
 * - `resolveFreshSaleTotals` — the fresh-sale header math (subtotal / tax
 *   re-round, header discount + negative-base guard, tip + service charge
 *   folded into `total`). Moved verbatim from the inline fresh block; the
 *   single tenant-settings DB read (`assertServiceChargeMatchesTenant`)
 *   stays inside it. The draft path recomputes its base from the FROZEN
 *   sale row, so it keeps its own inline total math.
 * - `resolveSalePaymentPlan` — tender resolution, credit total, payment
 *   status, change, and cash collected. Folds the block that was inlined
 *   identically in both paths; the ONLY fresh-vs-draft difference (whether
 *   `cashCollectedAmount` is computed) is carried by `collectCash`.
 *
 * @module application/sales/pricing
 */

import type { DatabaseInstance } from '../../db/index.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { assertServiceChargeMatchesTenant } from '../../services/restaurant/settings.js';
import {
  getCashCollectedAmount,
  getPaymentStatus,
  resolveSalePayments,
  type ResolvedSalePayments,
} from './policies.js';
import type {
  CompleteSaleTender,
  FreshSaleStatus,
  SalePaymentMethod,
  SalePaymentStatus,
  SaleTipMethod,
} from './types.js';

/* ------------------------------------------------------------------ */
/*  Fresh-sale header totals.                                         */
/* ------------------------------------------------------------------ */

/** Resolved monetary header for a fresh sale. Every field is 2-decimal. */
export interface FreshSaleTotals {
  subtotal: number;
  taxAmount: number;
  headerDiscount: number;
  tipAmount: number;
  tipMethod: SaleTipMethod | null;
  serviceChargeAmount: number;
  serviceChargeRate: number | null;
  total: number;
}

/**
 * Compute the fresh-sale header totals from the resolved line subtotal /
 * tax plus the header-level discount, tip, and service charge.
 *
 * Invariants:
 * - The line base is already `roundMoney`-ed by `resolveSaleItems`; the
 *   header re-rounds so an external discount cannot reintroduce sub-cent
 *   drift. `tipAmount` and `serviceChargeAmount` are clamped to `>= 0`,
 *   rounded, and folded into `total` AFTER the base so multi-tender
 *   `Σ tenders ≈ total` stays consistent. All 2-decimal, country-agnostic
 *   (see `completeSale`).
 * - A negative base (discount exceeds total) is rejected with
 *   `SALE_DISCOUNT_EXCEEDS_TOTAL` before any write.
 * - The mandatory service charge is enforced on completed fresh sales, and
 *   any draft that explicitly carries a non-zero charge is still validated
 *   so stale amounts cannot be stored.
 */
export async function resolveFreshSaleTotals(args: {
  db: DatabaseInstance;
  tenantId: string;
  resolvedSubtotal: number;
  resolvedTaxAmount: number;
  discountAmount: number | undefined;
  tipAmount: number | undefined;
  tipMethod: SaleTipMethod | null | undefined;
  serviceChargeAmount: number | undefined;
  status: FreshSaleStatus;
}): Promise<FreshSaleTotals> {
  const { db, tenantId, status } = args;

  // ENG-176a-rounding — resolveSaleItems already rounded the per-line
  // accumulations; we round again at the header level so any external
  // discount applied here cannot reintroduce sub-cent drift.
  const subtotal = roundMoney(args.resolvedSubtotal);
  const taxAmount = roundMoney(args.resolvedTaxAmount);
  const headerDiscount = roundMoney(args.discountAmount ?? 0);
  const baseTotal = roundMoney(subtotal + taxAmount - headerDiscount);
  if (baseTotal < 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_DISCOUNT_EXCEEDS_TOTAL',
      message: 'Discount amount cannot exceed the sale total',
    });
  }
  // ENG-039d — tip / propina rolls into `total` so payment validation
  // (Σ tenders ≈ total, amountReceived ≥ total) keeps working without
  // a special case downstream. The Zod refinement already rejects
  // `tipMethod` without a positive amount; we additionally clamp to 0
  // here as a defensive belt against any non-Zod caller.
  const tipAmount = roundMoney(Math.max(0, args.tipAmount ?? 0));
  const tipMethod = tipAmount > 0 ? args.tipMethod ?? null : null;
  // ENG-039d3 — restaurant service charge / propina sugerida. Rolls
  // into `total` after tip so multi-tender Σ stays consistent. The
  // tenant-settings drift check fires below once we know the resolved
  // subtotal.
  const serviceChargeAmount = roundMoney(Math.max(0, args.serviceChargeAmount ?? 0));
  // Draft creation is not checkout yet: it may persist a frozen cart
  // before the customer sees payment. Enforce the mandatory service
  // charge on completed fresh sales, and still validate any draft that
  // explicitly carries a non-zero service charge so stale amounts cannot
  // be stored.
  let serviceChargeRate: number | null = null;
  if (status !== 'draft' || serviceChargeAmount > 0) {
    const restaurantSettings = await assertServiceChargeMatchesTenant({
      db,
      tenantId,
      base: baseTotal,
      serviceChargeAmount,
    });
    serviceChargeRate =
      serviceChargeAmount > 0 ? restaurantSettings.serviceChargeRate : null;
  }
  const total = roundMoney(baseTotal + tipAmount + serviceChargeAmount);

  return {
    subtotal,
    taxAmount,
    headerDiscount,
    tipAmount,
    tipMethod,
    serviceChargeAmount,
    serviceChargeRate,
    total,
  };
}

/* ------------------------------------------------------------------ */
/*  Payment plan — shared by both paths.                              */
/* ------------------------------------------------------------------ */

/**
 * Resolved payment plan shared by the fresh + draft paths.
 *
 * Every monetary field is `roundMoney`-ed (2-decimal, country-agnostic).
 * `cashCollectedAmount` is 0 when the caller passed `collectCash: false`
 * (i.e. a fresh sale persisted as a draft, which never hits the drawer).
 */
export interface SalePaymentPlan {
  amountReceived: number | undefined;
  resolvedPayments: ResolvedSalePayments;
  isSplitPayment: boolean;
  /** ENG-014 — sum of credit-tender amounts (drives status + ledger). */
  creditSaleAmount: number;
  paymentStatus: SalePaymentStatus;
  /** Cash overage handed back; 0 unless paid in cash above total. */
  change: number;
  /** Cash that hits the active session balance; 0 for non-collecting paths. */
  cashCollectedAmount: number;
}

/**
 * Resolve the tender list (split or legacy) into the persisted payment
 * plan: rows + dominant method, credit total, payment status, change,
 * and cash collected. Folds the block that was inlined identically in
 * both `runFreshSale` and `runCompleteDraft`.
 *
 * `collectCash` is the ONE fresh-vs-draft difference: the fresh path
 * only sizes a cash movement when the sale lands `completed` (a draft
 * never touches the drawer), so it passes `input.status === 'completed'`;
 * the draft-completion path is always completing, so it passes `true`.
 * When false, `cashCollectedAmount` is 0 — identical to the original
 * `input.status === 'completed' ? ... : 0` ternary.
 */
export function resolveSalePaymentPlan(args: {
  amountReceived: number | undefined;
  payments: CompleteSaleTender[] | undefined;
  paymentMethod: SalePaymentMethod;
  requestedStatus: SalePaymentStatus;
  total: number;
  collectCash: boolean;
}): SalePaymentPlan {
  const { payments, paymentMethod, requestedStatus, total, collectCash } = args;

  // Auditoría 2026-06 — normalize the legacy tender at the boundary: the
  // Zod schema only enforces >= 0, so a sub-cent amountReceived (99.999)
  // would otherwise drive the paid/partial threshold and the returned
  // change with float noise. Round once here so every consumer below
  // (payment status, change, cash collected, insufficient-cash guard)
  // operates on the cents the cashier actually handles.
  const amountReceived =
    args.amountReceived === undefined ? undefined : roundMoney(args.amountReceived);
  const tenderInputs: CompleteSaleTender[] | undefined = payments?.map(payment => ({
    method: payment.method,
    amount: payment.amount,
    reference: payment.reference ?? null,
  }));
  const resolvedPayments = resolveSalePayments({
    payments: tenderInputs,
    legacyMethod: paymentMethod,
    amountReceived,
    total,
  });
  const isSplitPayment = payments !== undefined && payments.length > 0;
  // ENG-014 — sum credit tenders so the status, invariant, and ledger
  // hook all key off the same number. A split with cash + credit lands
  // here with rows=[{cash, $50}, {credit, $150}], so creditSaleAmount=150.
  const creditSaleAmount = resolvedPayments.rows
    .filter(row => row.method === 'credit')
    .reduce((sum, row) => roundMoney(sum + row.amount), 0);

  const paymentStatus = getPaymentStatus({
    amountReceived,
    paymentMethod: resolvedPayments.dominantMethod,
    requestedStatus,
    total,
    isSplit: isSplitPayment,
    creditAmount: creditSaleAmount,
  });
  // Both operands are 2-decimal by now, but their float difference can
  // still drift (24.00 - 23.80 = 0.20000000000000284) — round the change
  // the cashier hands back.
  const change =
    amountReceived !== undefined && amountReceived > total
      ? roundMoney(amountReceived - total)
      : 0;

  // Cash collected is the sum of cash-method tenders when split, or the
  // legacy amountReceived-minus-change when single-tender.
  // ENG-176a-rounding — each `payment.amount` is already two-decimal
  // (resolveSalePayments rounded it), but IEEE-754 addition of two
  // 2-decimal values can drift (10.10 + 10.20 = 20.299999…). The
  // downstream `insertCashMovement` re-rounds, but defend at the
  // source so a future refactor that bypasses that downstream rounder
  // cannot silently leak drift into cash_movements.amount.
  const cashCollectedAmount = collectCash
    ? isSplitPayment
      ? resolvedPayments.rows
          .filter(payment => payment.method === 'cash')
          .reduce((acc, payment) => roundMoney(acc + payment.amount), 0)
      : getCashCollectedAmount({
          paymentMethod,
          amountReceived,
          total,
          change,
        })
    : 0;

  if (
    !isSplitPayment &&
    amountReceived !== undefined &&
    paymentStatus === 'paid' &&
    amountReceived < total
  ) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_AMOUNT_RECEIVED_BELOW_TOTAL',
      message: 'Amount received cannot be less than the sale total for a paid sale',
    });
  }

  return {
    amountReceived,
    resolvedPayments,
    isSplitPayment,
    creditSaleAmount,
    paymentStatus,
    change,
    cashCollectedAmount,
  };
}
