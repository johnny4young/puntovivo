/**
 * comprehensive manager day-close preview.
 *
 * This is intentionally separate from 's per-cash-session ritual. It
 * aggregates the whole tenant-local day and is only exposed through a
 * manager/admin procedure. Every query carries tenant scope explicitly.
 */

import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  auditLogs,
  cashSessions,
  fiscalDocuments,
  salePayments,
  saleReturns,
  sales,
  type FiscalDocumentStatus,
  type TransferConfirmationStatus,
  paymentMethodEnum,
} from '../../db/schema.js';
import { roundMoney, sumMoneySql } from '../../lib/money.js';
import { PAYMENT_SUM_EPSILON } from '../../application/sales/policies.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { detectAnomalies, type AnomalyKind } from '../ai/index.js';
import { resolveTenantLocale } from '../tenant-locale.js';
import { calendarDayInTimeZone, resolveUtcDayWindow } from './day-window.js';
import {
  carriedForDaySql,
  closedInWindowConditions,
  hasCashDifference,
  isUnexplainedDifference,
  openAtDayEndConditions,
  parkedRetailDraftConditions,
} from './day-close-checklist.js';

const ANOMALY_BASELINE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
type PaymentMethod = (typeof paymentMethodEnum)[number];

/** Only a proven confirmation counts as received money. */
const CONFIRMED_TRANSFER_STATUSES: readonly TransferConfirmationStatus[] = [
  'manual_confirmed',
  'provider_confirmed',
];

/** Reported or parked for a human: the money is not proven yet. */
const PENDING_TRANSFER_STATUSES: readonly TransferConfirmationStatus[] = [
  'pending',
  'customer_reported',
  'needs_reconciliation',
];

/** Transfer states that never count as received money. */
const REJECTED_TRANSFER_STATUSES: readonly TransferConfirmationStatus[] = ['rejected', 'cancelled'];

/**
 * Transfer states a replacement can leave behind, and therefore the only states
 * a superseded row is ever judged from.
 *
 * `rejected`/`cancelled` are the rows the adjustment planner abandons. A late
 * authentic provider verdict reopens such a row — only ever into
 * `needs_reconciliation` (`application/sales/transfer-confirmation.ts`), which
 * is why that state is here too — and `needs_reconciliation` is ALSO where a
 * legitimately parked shortfall lives. The state alone never decides anything:
 * see `summarizeTransferConfirmations`.
 */
const SUPERSEDED_CANDIDATE_STATUSES: readonly TransferConfirmationStatus[] = [
  'rejected',
  'cancelled',
  'needs_reconciliation',
];

const TRANSFER_STATUSES: readonly TransferConfirmationStatus[] = [
  'pending',
  'customer_reported',
  'manual_confirmed',
  'provider_confirmed',
  'rejected',
  'needs_reconciliation',
  'cancelled',
];

/** One transfer tender of the day, with the sale total it belongs to. */
export interface TransferTenderRow {
  /** The tender row id, so audit evidence can be matched to it. */
  id: string;
  saleId: string;
  /**
   * The tender method. Only transfers enter the money buckets; the other rows
   * of the sale are read for one reason only: to know whether a rejected
   * transfer was replaced (see `summarizeTransferConfirmations`).
   */
  method: PaymentMethod;
  amount: number;
  reference: string | null;
  confirmationStatus: TransferConfirmationStatus | null;
  destinationSnapshot: { id: string; label: string; kind: string } | null;
  transferDestinationId: string | null;
  saleTotal: number;
}

/**
 * Why a deposit was recorded without applying it to a tender (contract K6).
 *
 * The contract treats the reason as open-ended: any non-empty value means
 * "recorded, never applied". These are the values this build knows how to name;
 * anything else is still money, so it lands in `other` instead of disappearing.
 */
export const NOT_APPLIED_DEPOSIT_REASONS = ['tender_rejected', 'tender_cancelled'] as const;

export type NotAppliedDepositReason = (typeof NOT_APPLIED_DEPOSIT_REASONS)[number];

/** One side of the not-applied split; `other` catches reasons this build lacks. */
export interface NotAppliedDepositBucket {
  count: number;
  amount: number;
}

/**
 * Money the day's deposits reported that no tender could absorb.
 *
 * This is not sale money and never becomes sale money: the tender it arrived
 * against was rejected or cancelled, so the deposit is recorded as evidence
 * with `appliedAmount: 0`. It is counted here, split by why, and nowhere else.
 */
export interface NotAppliedDepositsSummary {
  /** Deposit movements recorded with a reason. */
  count: number;
  /** Money those movements reported, never applied to any tender. */
  amount: number;
  byReason: Record<NotAppliedDepositReason | 'other', NotAppliedDepositBucket>;
}

/** One deposit movement, as `audit_logs` keeps it. */
export interface DepositMovementRow {
  id: string;
  createdAt: string;
  after: unknown;
}

/** What the day's deposit audit chain says without reading a single tender. */
export interface DepositEvidenceSummary {
  /** Received money above a tender that WAS applied to its sale. */
  unapplied: number;
  /** Received money no tender could absorb. */
  notApplied: NotAppliedDepositsSummary;
  /**
   * Tenders the audit chain proves were dead when money was recorded on them.
   * The proof outlives the tender's state: a late provider verdict can reopen a
   * rejected tender, and the movement that recorded its money as not applied is
   * still evidence of what happened.
   */
  deadTenderIds: ReadonlySet<string>;
}

/** One parsed movement. Corrupt evidence never becomes a movement. */
interface ParsedMovement {
  id: string;
  createdAt: string;
  salePaymentId: string;
  /** The movement's own amount, never the tender's running total. */
  verifiedAmount: number;
  /** Non-empty reason when the money was recorded but never applied. */
  notAppliedReason: string | null;
  surplusAmount: number;
}

function zeroNotAppliedDeposits(): NotAppliedDepositsSummary {
  return {
    count: 0,
    amount: 0,
    byReason: {
      tender_rejected: { count: 0, amount: 0 },
      tender_cancelled: { count: 0, amount: 0 },
      other: { count: 0, amount: 0 },
    },
  };
}

function notAppliedReasonBucket(reason: string): NotAppliedDepositReason | 'other' {
  return (NOT_APPLIED_DEPOSIT_REASONS as readonly string[]).includes(reason)
    ? (reason as NotAppliedDepositReason)
    : 'other';
}

function readReason(after: Record<string, unknown>): string | null {
  const reason = after['notAppliedReason'];
  if (typeof reason !== 'string') return null;
  const trimmed = reason.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Read one movement without trusting the payload.
 *
 * The chain is evidence, not a schema: a row can predate a field or come from
 * an older build. A movement without a readable tender and a finite positive
 * amount is skipped instead of counted, so corrupt evidence can never move
 * money.
 */
function parseMovement(row: DepositMovementRow): ParsedMovement | null {
  const after = (row.after ?? null) as Record<string, unknown> | null;
  if (!after) return null;
  const salePaymentId = after['salePaymentId'];
  if (typeof salePaymentId !== 'string' || salePaymentId.length === 0) return null;
  const verified = after['verifiedAmount'];
  if (typeof verified !== 'number' || !Number.isFinite(verified)) return null;
  const verifiedAmount = roundMoney(verified);
  if (verifiedAmount <= 0) return null;
  const surplus = after['surplusAmount'];
  return {
    id: row.id,
    createdAt: row.createdAt,
    salePaymentId,
    verifiedAmount,
    notAppliedReason: readReason(after),
    surplusAmount:
      typeof surplus === 'number' && Number.isFinite(surplus) ? roundMoney(surplus) : 0,
  };
}

/** Chronological order, with the id as the deterministic tie-break. */
function compareMovements(left: ParsedMovement, right: ParsedMovement): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function isRecordedAfter(candidate: ParsedMovement, reference: ParsedMovement): boolean {
  return compareMovements(candidate, reference) > 0;
}

/**
 * Split the day's deposit movements into money above a tender (`unapplied`) and
 * money no tender absorbed (`notApplied`).
 *
 * The two are different facts and never merge: `unapplied` is money the sale did
 * not need and the store kept, while `notApplied` is money the sale could not
 * accept because the tender it arrived for was already rejected or cancelled.
 *
 * Two rules keep the same pesos from being stated twice:
 *  - a movement that declares a reason is never surplus — there is no tender
 *    behind it that could be exceeded — and an unknown reason is still money, so
 *    it lands in `other` instead of being dropped;
 *  - a not-applied movement is NOT counted when the same tender recorded an
 *    applied movement afterwards: that later movement absorbed the money, and
 *    the not-applied row is the history of a movement that was re-applied. The
 *    comparison is chronological because the opposite order is a different fact
 *    (money applied first, more money arriving later against a dead tender).
 *
 * Only `dayMovements` are money. `tenderHistory` is the wider read of the day's
 * sales: it supplies the dead-tender proof and the "applied later" fact, both of
 * which are properties of the tender rather than of the day being closed.
 */
export function summarizeDepositEvidence(input: {
  dayMovements: readonly DepositMovementRow[];
  tenderHistory: readonly DepositMovementRow[];
}): DepositEvidenceSummary {
  const notApplied = zeroNotAppliedDeposits();
  const deadTenderIds = new Set<string>();
  let unapplied = 0;

  const history = input.tenderHistory
    .map(parseMovement)
    .filter((movement): movement is ParsedMovement => movement !== null)
    .sort(compareMovements);
  const appliedByTender = new Map<string, ParsedMovement[]>();
  for (const movement of history) {
    if (movement.notAppliedReason !== null) {
      deadTenderIds.add(movement.salePaymentId);
      continue;
    }
    const applied = appliedByTender.get(movement.salePaymentId);
    if (applied) applied.push(movement);
    else appliedByTender.set(movement.salePaymentId, [movement]);
  }

  const ofDay = input.dayMovements
    .map(parseMovement)
    .filter((movement): movement is ParsedMovement => movement !== null)
    .sort(compareMovements);

  for (const movement of ofDay) {
    if (movement.notAppliedReason === null) {
      unapplied = roundMoney(unapplied + movement.surplusAmount);
      continue;
    }
    const appliedLater = (appliedByTender.get(movement.salePaymentId) ?? []).some(applied =>
      isRecordedAfter(applied, movement)
    );
    if (appliedLater) continue;
    notApplied.count += 1;
    notApplied.amount = roundMoney(notApplied.amount + movement.verifiedAmount);
    const bucket = notApplied.byReason[notAppliedReasonBucket(movement.notAppliedReason)];
    bucket.count += 1;
    bucket.amount = roundMoney(bucket.amount + movement.verifiedAmount);
  }

  return { unapplied, notApplied, deadTenderIds };
}

export interface TransferConfirmationDestinationSummary {
  destinationId: string | null;
  label: string | null;
  kind: string | null;
  /** Proven money for this destination. */
  confirmed: number;
  /** Reported but unproven money for this destination. */
  pending: number;
  /**
   * Active transfer tenders grouped here. A superseded tender is no longer
   * money of this destination, so it is not counted as one.
   */
  count: number;
  /** Distinct bank references the operator recorded, sorted. */
  references: string[];
}

export interface TransferConfirmationSummary {
  /** Total of the day's sales that carry at least one transfer tender. */
  saleTotal: number;
  /**
   * The live transfer tenders of the day, so each peso of tender is counted
   * once. Every transfer row lands either here or in `superseded`, and
   * `reported = confirmed + pending + rejected + legacy` always holds.
   */
  reported: number;
  /** Proven received money. Never merged with `pending`. */
  confirmed: number;
  /** Reported, unproven or parked money. Never merged with `confirmed`. */
  pending: number;
  /**
   * Rejected or cancelled tenders the sale still needs: its other tenders do
   * NOT cover its total, so nothing replaced them and the money they were meant
   * to carry is still unproven. Stays visible as evidence.
   */
  rejected: number;
  /**
   * Tenders written before the confirmation lifecycle existed. They stay their
   * own bucket: reporting them as confirmed would invent evidence, and
   * reporting them as pending would claim money already counted in revenue.
   */
  legacy: number;
  /**
   * Transfer tenders the sale's own money already covered — the leftover row of
   * a replacement (the original leaves `rejected`, or a late verdict reopens it
   * into `needs_reconciliation`, while the re-issued rows stay active).
   *
   * Reported as evidence and deliberately outside every money bucket:
   * `reported + superseded` is the sum of every transfer tender row of the day,
   * so nothing is hidden and no peso is counted twice.
   */
  superseded: number;
  /** Money received above what the sale expected; never applied to a sale. */
  unapplied: number;
  /** Money received that no tender absorbed: never sale money, never revenue. */
  notApplied: NotAppliedDepositsSummary;
  byStatus: Record<TransferConfirmationStatus | 'legacy', number>;
  destinations: TransferConfirmationDestinationSummary[];
}

function zeroTransferStatusCounts(): Record<TransferConfirmationStatus | 'legacy', number> {
  return {
    ...(Object.fromEntries(TRANSFER_STATUSES.map(status => [status, 0])) as Record<
      TransferConfirmationStatus,
      number
    >),
    legacy: 0,
  };
}

/**
 * One sale's tender distribution, as the supersession rule reads it.
 *
 * The rule is per sale because the sale total is the only thing that says how
 * much money the tenders are allowed to state.
 */
interface SaleDistribution {
  saleTotal: number;
  /** Money of this sale that no candidate claims: what it always keeps. */
  liveTotal: number;
  /** The transfer part of `liveTotal`: what the transfer buckets already state. */
  transferLiveTotal: number;
  /** Rows that only the distribution can settle, in row order. */
  candidates: Array<{ id: string; amount: number }>;
}

/**
 * Split the day's transfer tenders into confirmed, pending, rejected and
 * legacy money, per frozen destination. Confirmed and pending are reported
 * separately on purpose: a single transfer figure would let a manager read
 * unconfirmed money as cash in the drawer.
 *
 * `tenders` is the WHOLE tender distribution of the day's sales, not just the
 * transfer rows the buckets are built from. The other methods are needed for
 * one question only: who absorbed the money of a dead transfer? See
 * `supersededTenderIds` below.
 */
export function summarizeTransferConfirmations(
  tenders: readonly TransferTenderRow[],
  evidence: DepositEvidenceSummary
): TransferConfirmationSummary {
  const byStatus = zeroTransferStatusCounts();
  const saleTotals = new Map<string, number>();
  const destinations = new Map<string, TransferConfirmationDestinationSummary>();
  const referencesByDestination = new Map<string, Set<string>>();
  let reported = 0;
  let confirmed = 0;
  let pending = 0;
  let rejected = 0;
  let legacy = 0;
  let superseded = 0;

  // Pass 1 — who could be the leftover of a replacement, and whether the sale's
  // own money already covers its total without them.
  //
  // Two proofs are combined, because neither is enough on its own:
  //  - EVIDENCE places a row in the candidate set: its current state is dead
  //    (`rejected`/`cancelled`) or the audit chain recorded money on it while it
  //    was dead (`deadTenderIds`). Both survive a late provider verdict, which
  //    reopens a rejected tender into `needs_reconciliation` — and a reopen that
  //    left no audit row at all is still a reopen, so the state counts too.
  //  - DISTRIBUTION decides it, on the invariant the adjustment planner asserts
  //    before writing a replacement (`activeTotal` must match the sale total). A
  //    candidate is superseded exactly when the sale has no room for it: the
  //    other tenders already cover the total, or counting it would state more
  //    transfer money than the sale ever asked for. A candidate the sale still
  //    needs — a rejection with nothing behind it, a shortfall parked for a
  //    human — keeps its money visible in its own bucket.
  //
  // Candidates are released one at a time, in row order, so two dead rows that
  // each state the whole sale cannot be two debts: once the first one settles
  // the sale, the second one is the copy.
  const isSupersededCandidate = (row: TransferTenderRow): boolean => {
    if (row.method !== 'transfer') return false;
    if (
      row.confirmationStatus !== null &&
      SUPERSEDED_CANDIDATE_STATUSES.includes(row.confirmationStatus)
    ) {
      return true;
    }
    return evidence.deadTenderIds.has(row.id);
  };
  const perSale = new Map<string, SaleDistribution>();
  for (const row of tenders) {
    const amount = roundMoney(row.amount);
    let aggregate = perSale.get(row.saleId);
    if (!aggregate) {
      aggregate = {
        saleTotal: roundMoney(row.saleTotal),
        liveTotal: 0,
        transferLiveTotal: 0,
        candidates: [],
      };
      perSale.set(row.saleId, aggregate);
    }
    if (isSupersededCandidate(row)) {
      aggregate.candidates.push({ id: row.id, amount });
      continue;
    }
    aggregate.liveTotal = roundMoney(aggregate.liveTotal + amount);
    if (row.method === 'transfer') {
      aggregate.transferLiveTotal = roundMoney(aggregate.transferLiveTotal + amount);
    }
  }
  const supersededTenderIds = new Set<string>();
  for (const aggregate of perSale.values()) {
    if (aggregate.candidates.length === 0) continue;
    // A zero-total sale gives the comparison nothing to hold on to.
    if (aggregate.saleTotal <= 0) continue;
    let liveTotal = aggregate.liveTotal;
    let transferTotal = aggregate.transferLiveTotal;
    for (const candidate of aggregate.candidates) {
      // Covered without it: this is the copy a replacement left behind.
      const saleCovered = liveTotal + PAYMENT_SUM_EPSILON >= aggregate.saleTotal;
      // Or the sale has no room for it: no money bucket may state more transfer
      // money than the sale asked for.
      const noRoom = transferTotal + candidate.amount > aggregate.saleTotal + PAYMENT_SUM_EPSILON;
      if (saleCovered || noRoom) {
        supersededTenderIds.add(candidate.id);
        continue;
      }
      liveTotal = roundMoney(liveTotal + candidate.amount);
      transferTotal = roundMoney(transferTotal + candidate.amount);
    }
  }

  // Pass 2 — money buckets. Non-transfer tenders carry no confirmation state
  // and are not part of this section's money.
  for (const row of tenders) {
    if (row.method !== 'transfer') continue;

    const amount = roundMoney(row.amount);
    saleTotals.set(row.saleId, roundMoney(row.saleTotal));

    const status = row.confirmationStatus;
    if (supersededTenderIds.has(row.id)) {
      // The row is still counted in its lifecycle state…
      if (status === null) byStatus.legacy += 1;
      else byStatus[status] += 1;
      // …but its amount is evidence, never a second copy of the money.
      superseded = roundMoney(superseded + amount);
      continue;
    }

    reported = roundMoney(reported + amount);

    if (status === null) {
      legacy = roundMoney(legacy + amount);
      byStatus.legacy += 1;
    } else {
      byStatus[status] += 1;
      if (CONFIRMED_TRANSFER_STATUSES.includes(status)) {
        confirmed = roundMoney(confirmed + amount);
      } else if (PENDING_TRANSFER_STATUSES.includes(status)) {
        pending = roundMoney(pending + amount);
      } else if (REJECTED_TRANSFER_STATUSES.includes(status)) {
        rejected = roundMoney(rejected + amount);
      }
    }

    // The frozen destination id, falling back to the snapshot's own id so a
    // tender whose indexed column is missing still groups with its snapshot.
    const destinationId = row.transferDestinationId ?? row.destinationSnapshot?.id ?? null;
    const key = destinationId ?? `snapshotless:${row.saleId}`;
    const group = destinations.get(key) ?? {
      destinationId,
      label: row.destinationSnapshot?.label ?? null,
      kind: row.destinationSnapshot?.kind ?? null,
      confirmed: 0,
      pending: 0,
      count: 0,
      references: [],
    };
    group.count += 1;
    if (status !== null && CONFIRMED_TRANSFER_STATUSES.includes(status)) {
      group.confirmed = roundMoney(group.confirmed + amount);
    } else if (status !== null && PENDING_TRANSFER_STATUSES.includes(status)) {
      group.pending = roundMoney(group.pending + amount);
    }
    destinations.set(key, group);

    const reference = row.reference?.trim();
    if (reference) {
      const set = referencesByDestination.get(key) ?? new Set<string>();
      set.add(reference);
      referencesByDestination.set(key, set);
    }
  }

  const destinationRows = [...destinations.entries()]
    .map(([key, group]) => ({
      ...group,
      references: [...(referencesByDestination.get(key) ?? [])].sort(),
    }))
    // Deterministic order: labelled destinations first, then by id.
    .sort((left, right) => {
      const leftLabel = left.label ?? '\uffff';
      const rightLabel = right.label ?? '\uffff';
      return (
        leftLabel.localeCompare(rightLabel) ||
        (left.destinationId ?? '').localeCompare(right.destinationId ?? '')
      );
    });

  let saleTotal = 0;
  for (const total of saleTotals.values()) {
    saleTotal = roundMoney(saleTotal + total);
  }

  return {
    saleTotal,
    reported,
    confirmed,
    pending,
    rejected,
    legacy,
    superseded,
    unapplied: roundMoney(evidence.unapplied),
    notApplied: evidence.notApplied,
    byStatus,
    destinations: destinationRows,
  };
}

const FISCAL_STATUSES: readonly FiscalDocumentStatus[] = [
  'pending',
  'sent',
  'accepted',
  'rejected',
  'contingency',
  'voided',
  'notified_correction',
  'partial_send',
];

/** Sent or queued and not yet decided by the authority. */
const FISCAL_IN_PROGRESS_STATUSES = [
  'pending',
  'sent',
  'contingency',
  'notified_correction',
  'partial_send',
] as const satisfies readonly FiscalDocumentStatus[];

export function countFiscalInProgress(byStatus: Record<FiscalDocumentStatus, number>): number {
  return FISCAL_IN_PROGRESS_STATUSES.reduce((sum, status) => sum + byStatus[status], 0);
}

/** Documents a business day reports: emitted inside its window, whatever their status now. */
export function fiscalDocumentsInWindow(
  tenantId: string,
  startIso: string,
  endExclusiveIso: string
) {
  return and(
    eq(fiscalDocuments.tenantId, tenantId),
    gte(fiscalDocuments.emittedAt, startIso),
    lt(fiscalDocuments.emittedAt, endExclusiveIso)
  );
}

const ANOMALY_KINDS: readonly AnomalyKind[] = [
  'ticketsPerHourSpike',
  'voidRate',
  'refundAmount',
  'noSaleSessions',
];

export type DayCloseReadinessCode =
  | 'open_sessions'
  | 'unexplained_differences'
  | 'unresolved_drafts'
  | 'cash_discrepancies'
  | 'fiscal_pending'
  | 'fiscal_rejected'
  | 'high_anomalies'
  | 'commissions_not_tracked'
  | 'waste_not_tracked';

export interface ComprehensiveDayCloseReport {
  date: string;
  timeZone: string;
  currencyCode: string;
  generatedAt: string;
  window: { start: string; endExclusive: string };
  sales: {
    count: number;
    subtotal: number;
    discounts: number;
    taxes: number;
    tips: number;
    serviceCharges: number;
    grossRevenue: number;
    refundAmount: number;
    netRevenue: number;
  };
  payments: Array<{ method: PaymentMethod; amount: number; transactionCount: number }>;
  /**
   * Transfer confirmation evidence for the day. Additive: it never rewrites
   * `sales`, `payments` or `cash` — those keep their historical meaning.
   *
   * Optional so a close computed (and signed) before the section existed stays
   * structurally valid; the service always fills it for a fresh report.
   */
  transferConfirmations?: TransferConfirmationSummary;
  cash: {
    closedSessions: number;
    openSessions: number;
    expected: number;
    counted: number;
    overShort: number;
    balancedSessions: number;
    discrepancySessions: number;
  };
  fiscal: {
    total: number;
    totalAmount: number;
    byStatus: Record<FiscalDocumentStatus, number>;
  };
  adjustments: {
    voids: { count: number; amount: number };
    refunds: { count: number; amount: number };
  };
  anomalies: {
    total: number;
    high: number;
    medium: number;
    byKind: Record<AnomalyKind, number>;
  };
  capabilities: {
    commissions: 'not_tracked';
    waste: 'not_tracked';
  };
  readiness: {
    readyToSign: boolean;
    blockers: DayCloseReadinessCode[];
    warnings: DayCloseReadinessCode[];
  };
}

export interface ComputeComprehensiveDayCloseInput {
  tenantId: string;
  date: string;
  now?: Date;
}

export function zeroFiscalStatusCounts(): Record<FiscalDocumentStatus, number> {
  return Object.fromEntries(FISCAL_STATUSES.map(status => [status, 0])) as Record<
    FiscalDocumentStatus,
    number
  >;
}

function zeroAnomalyKindCounts(): Record<AnomalyKind, number> {
  return Object.fromEntries(ANOMALY_KINDS.map(kind => [kind, 0])) as Record<AnomalyKind, number>;
}

function grossSales(tenantId: string, start: string, endExclusive: string) {
  return and(
    eq(sales.tenantId, tenantId),
    inArray(sales.status, ['completed', 'voided']),
    gte(sales.createdAt, start),
    lt(sales.createdAt, endExclusive)
  );
}

/** Compute one immutable-ready report preview. No report row is persisted here. */
export async function computeComprehensiveDayCloseReport(
  db: DatabaseInstance,
  input: ComputeComprehensiveDayCloseInput
): Promise<ComprehensiveDayCloseReport> {
  const now = input.now ?? new Date();
  const locale = await resolveTenantLocale(db, input.tenantId);

  if (input.date > calendarDayInTimeZone(now, locale.timezone)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'DAY_CLOSE_FUTURE_DATE',
      message: 'Cannot build a day-close report for a future date',
      details: { date: input.date, timeZone: locale.timezone },
    });
  }
  const { startIso, endExclusiveIso } = resolveUtcDayWindow(input.date, locale.timezone);

  // Gross sales are event-stable: a later void/refund must not erase the sale
  // from the day it occurred. Adjustment events are deducted on their own day.
  const saleFilter = grossSales(input.tenantId, startIso, endExclusiveIso);
  const saleRow = db
    .select({
      count: sql<number>`count(*)`,
      subtotal: sql<number>`coalesce(sum(${sales.subtotal}), 0)`,
      discounts: sql<number>`coalesce(sum(${sales.discountAmount}), 0)`,
      taxes: sql<number>`coalesce(sum(${sales.taxAmount}), 0)`,
      tips: sql<number>`coalesce(sum(${sales.tipAmount}), 0)`,
      serviceCharges: sql<number>`coalesce(sum(${sales.serviceChargeAmount}), 0)`,
      total: sumMoneySql(sales.total),
    })
    .from(sales)
    .where(saleFilter)
    .get();

  const paymentRows = db
    .select({
      method: salePayments.method,
      amount: sumMoneySql(salePayments.amount),
      transactionCount: sql<number>`count(*)`,
    })
    .from(salePayments)
    .innerJoin(sales, eq(salePayments.saleId, sales.id))
    .where(and(eq(salePayments.tenantId, input.tenantId), saleFilter))
    .groupBy(salePayments.method)
    .orderBy(salePayments.method)
    .all();

  // Transfer confirmation evidence. Read straight from the tender rows and the
  // audit trail the confirmation service already writes: no financial service
  // is changed, and the historical `payments` block above keeps its meaning.
  //
  // The whole tender distribution of the day is read, not only the transfer
  // rows: a rejected transfer can only be told apart from a replaced one by the
  // tenders of its own sale (see `summarizeTransferConfirmations`).
  const tenderRows = db
    .select({
      id: salePayments.id,
      saleId: salePayments.saleId,
      method: salePayments.method,
      amount: salePayments.amount,
      reference: salePayments.reference,
      confirmationStatus: salePayments.confirmationStatus,
      destinationSnapshot: salePayments.destinationSnapshot,
      transferDestinationId: salePayments.transferDestinationId,
      saleTotal: sales.total,
    })
    .from(salePayments)
    .innerJoin(sales, eq(salePayments.saleId, sales.id))
    .where(and(eq(salePayments.tenantId, input.tenantId), saleFilter))
    // Oldest first, so the first frozen snapshot seen for a destination is the
    // earliest one the store printed.
    .orderBy(salePayments.createdAt, salePayments.id)
    .all();

  // The movements themselves, on any date: a tender's history is a property of
  // the tender, not of the day being closed.
  const daySaleIds = [...new Set(tenderRows.map(row => row.saleId))];
  const depositColumns = {
    id: auditLogs.id,
    createdAt: auditLogs.createdAt,
    after: auditLogs.after,
  };
  // Money: the tenant's movements recorded inside the day window.
  const dayDepositRows = db
    .select(depositColumns)
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.tenantId, input.tenantId),
        eq(auditLogs.action, 'sale_payment.transfer_manual_confirmed'),
        gte(auditLogs.createdAt, startIso),
        lt(auditLogs.createdAt, endExclusiveIso)
      )
    )
    .orderBy(auditLogs.createdAt, auditLogs.id)
    .all();
  // Proof: everything ever recorded against the day's sales.
  const tenderHistoryRows =
    daySaleIds.length === 0
      ? []
      : db
          .select(depositColumns)
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.tenantId, input.tenantId),
              eq(auditLogs.action, 'sale_payment.transfer_manual_confirmed'),
              inArray(auditLogs.resourceId, daySaleIds)
            )
          )
          .orderBy(auditLogs.createdAt, auditLogs.id)
          .all();
  const transferConfirmations = summarizeTransferConfirmations(
    tenderRows,
    summarizeDepositEvidence({ dayMovements: dayDepositRows, tenderHistory: tenderHistoryRows })
  );

  const closedSessionRows = db
    .select({
      expected: cashSessions.expectedBalance,
      counted: cashSessions.actualCount,
      overShort: cashSessions.overShort,
      differenceReason: cashSessions.differenceReason,
    })
    .from(cashSessions)
    .where(closedInWindowConditions(input.tenantId, startIso, endExclusiveIso))
    .all();

  const openAtDayEnd =
    db
      .select({ count: sql<number>`count(*)` })
      .from(cashSessions)
      .where(openAtDayEndConditions(input.tenantId, endExclusiveIso))
      .get()?.count ?? 0;

  const unresolvedDrafts =
    db
      .select({ count: sql<number>`count(*)` })
      .from(sales)
      .where(
        and(
          parkedRetailDraftConditions(input.tenantId, endExclusiveIso),
          sql`not ${carriedForDaySql(startIso)}`
        )
      )
      .get()?.count ?? 0;

  const fiscalRows = db
    .select({
      status: fiscalDocuments.status,
      source: fiscalDocuments.source,
      count: sql<number>`count(*)`,
      amount: sql<number>`coalesce(sum(${fiscalDocuments.totalAmount}), 0)`,
    })
    .from(fiscalDocuments)
    .where(fiscalDocumentsInWindow(input.tenantId, startIso, endExclusiveIso))
    .groupBy(fiscalDocuments.status, fiscalDocuments.source)
    .all();

  const returnRow = db
    .select({
      count: sql<number>`count(*)`,
      amount: sumMoneySql(saleReturns.refundAmount),
    })
    .from(saleReturns)
    .where(
      and(
        eq(saleReturns.tenantId, input.tenantId),
        gte(saleReturns.createdAt, startIso),
        lt(saleReturns.createdAt, endExclusiveIso)
      )
    )
    .get();

  const voidRow = db
    .select({
      count: sql<number>`count(*)`,
      amount: sumMoneySql(sales.total),
    })
    .from(auditLogs)
    .leftJoin(sales, and(eq(auditLogs.resourceId, sales.id), eq(sales.tenantId, input.tenantId)))
    .where(
      and(
        eq(auditLogs.tenantId, input.tenantId),
        eq(auditLogs.action, 'sale.void'),
        gte(auditLogs.createdAt, startIso),
        lt(auditLogs.createdAt, endExclusiveIso)
      )
    )
    .get();

  const anomalyTo = new Date(Date.parse(endExclusiveIso) - 1);
  const anomalyFrom = new Date(Date.parse(startIso) - (ANOMALY_BASELINE_DAYS - 1) * MS_PER_DAY);
  const anomalyResult = await detectAnomalies(db, {
    tenantId: input.tenantId,
    from: anomalyFrom,
    to: anomalyTo,
  });
  const dayAlerts = anomalyResult.alerts.filter(
    alert => alert.occurredAt >= startIso && alert.occurredAt < endExclusiveIso
  );

  const refundAmount = roundMoney(returnRow?.amount ?? 0);
  const voidAmount = roundMoney(voidRow?.amount ?? 0);
  const grossRevenue = roundMoney(saleRow?.total ?? 0);
  const fiscalByStatus = zeroFiscalStatusCounts();
  let fiscalTotal = 0;
  let fiscalTotalAmount = 0;
  for (const row of fiscalRows) {
    fiscalByStatus[row.status] += row.count;
    fiscalTotal += row.count;
    // Sale documents add to the authority-facing total; credit documents
    // generated by a void/return subtract. Raw fiscal amounts are positive.
    fiscalTotalAmount = roundMoney(
      fiscalTotalAmount + (row.source === 'sale' ? row.amount : -row.amount)
    );
  }

  let expected = 0;
  let counted = 0;
  let overShort = 0;
  let balancedSessions = 0;
  for (const row of closedSessionRows) {
    expected = roundMoney(expected + row.expected);
    counted = roundMoney(counted + (row.counted ?? 0));
    overShort = roundMoney(overShort + (row.overShort ?? 0));
    if (row.counted !== null && row.overShort !== null && !hasCashDifference(row.overShort)) {
      balancedSessions += 1;
    }
  }

  const anomaliesByKind = zeroAnomalyKindCounts();
  let highAnomalies = 0;
  for (const alert of dayAlerts) {
    anomaliesByKind[alert.kind] += 1;
    if (alert.severity === 'high') highAnomalies += 1;
  }

  const discrepancySessions = closedSessionRows.length - balancedSessions;
  const blockers: DayCloseReadinessCode[] = [];
  const warnings: DayCloseReadinessCode[] = [];
  if (openAtDayEnd > 0) blockers.push('open_sessions');
  if (closedSessionRows.some(isUnexplainedDifference)) blockers.push('unexplained_differences');
  if (unresolvedDrafts > 0) blockers.push('unresolved_drafts');
  if (discrepancySessions > 0) warnings.push('cash_discrepancies');
  if (countFiscalInProgress(fiscalByStatus) > 0) warnings.push('fiscal_pending');
  if (fiscalByStatus.rejected > 0) warnings.push('fiscal_rejected');
  if (highAnomalies > 0) warnings.push('high_anomalies');
  // Coverage gaps remain explicit but follow actionable reconciliation risks.
  warnings.push('commissions_not_tracked', 'waste_not_tracked');

  return {
    date: input.date,
    timeZone: locale.timezone,
    currencyCode: locale.currency,
    generatedAt: now.toISOString(),
    window: { start: startIso, endExclusive: endExclusiveIso },
    sales: {
      count: saleRow?.count ?? 0,
      subtotal: roundMoney(saleRow?.subtotal ?? 0),
      discounts: roundMoney(saleRow?.discounts ?? 0),
      taxes: roundMoney(saleRow?.taxes ?? 0),
      tips: roundMoney(saleRow?.tips ?? 0),
      serviceCharges: roundMoney(saleRow?.serviceCharges ?? 0),
      grossRevenue,
      refundAmount,
      netRevenue: roundMoney(grossRevenue - refundAmount - voidAmount),
    },
    payments: paymentRows.map(row => ({
      method: row.method,
      amount: roundMoney(row.amount),
      transactionCount: row.transactionCount,
    })),
    transferConfirmations,
    cash: {
      closedSessions: closedSessionRows.length,
      openSessions: openAtDayEnd,
      expected,
      counted,
      overShort,
      balancedSessions,
      discrepancySessions,
    },
    fiscal: { total: fiscalTotal, totalAmount: fiscalTotalAmount, byStatus: fiscalByStatus },
    adjustments: {
      voids: { count: voidRow?.count ?? 0, amount: voidAmount },
      refunds: { count: returnRow?.count ?? 0, amount: refundAmount },
    },
    anomalies: {
      total: dayAlerts.length,
      high: highAnomalies,
      medium: dayAlerts.length - highAnomalies,
      byKind: anomaliesByKind,
    },
    capabilities: { commissions: 'not_tracked', waste: 'not_tracked' },
    readiness: { readyToSign: blockers.length === 0, blockers, warnings },
  };
}
