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

/** Superseded tenders: replaced by a correction, never money owed. */
const REJECTED_TRANSFER_STATUSES: readonly TransferConfirmationStatus[] = ['rejected', 'cancelled'];

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
  saleId: string;
  amount: number;
  reference: string | null;
  confirmationStatus: TransferConfirmationStatus | null;
  destinationSnapshot: { id: string; label: string; kind: string } | null;
  transferDestinationId: string | null;
  saleTotal: number;
}

export interface TransferConfirmationDestinationSummary {
  destinationId: string | null;
  label: string | null;
  kind: string | null;
  /** Proven money for this destination. */
  confirmed: number;
  /** Reported but unproven money for this destination. */
  pending: number;
  /** Transfer tenders grouped here, whatever their state. */
  count: number;
  /** Distinct bank references the operator recorded, sorted. */
  references: string[];
}

export interface TransferConfirmationSummary {
  /** Total of the day's sales that carry at least one transfer tender. */
  saleTotal: number;
  /** Every transfer tender of the day: nothing is dropped from the evidence. */
  reported: number;
  /** Proven received money. Never merged with `pending`. */
  confirmed: number;
  /** Reported, unproven or parked money. Never merged with `confirmed`. */
  pending: number;
  /** Superseded tenders, kept visible so the totals reconcile. */
  rejected: number;
  /**
   * Tenders written before the confirmation lifecycle existed. They stay their
   * own bucket: reporting them as confirmed would invent evidence, and
   * reporting them as pending would claim money already counted in revenue.
   */
  legacy: number;
  /** Money received above what the sale expected; never applied to a sale. */
  unapplied: number;
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
 * Split the day's transfer tenders into confirmed, pending, rejected and
 * legacy money, per frozen destination. Confirmed and pending are reported
 * separately on purpose: a single transfer figure would let a manager read
 * unconfirmed money as cash in the drawer.
 */
export function summarizeTransferConfirmations(
  rows: readonly TransferTenderRow[],
  unapplied: number
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

  for (const row of rows) {
    const amount = roundMoney(row.amount);
    reported = roundMoney(reported + amount);
    saleTotals.set(row.saleId, roundMoney(row.saleTotal));

    const status = row.confirmationStatus;
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
    unapplied: roundMoney(unapplied),
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
  const transferRows = db
    .select({
      saleId: salePayments.saleId,
      amount: salePayments.amount,
      reference: salePayments.reference,
      confirmationStatus: salePayments.confirmationStatus,
      destinationSnapshot: salePayments.destinationSnapshot,
      transferDestinationId: salePayments.transferDestinationId,
      saleTotal: sales.total,
    })
    .from(salePayments)
    .innerJoin(sales, eq(salePayments.saleId, sales.id))
    .where(
      and(
        eq(salePayments.tenantId, input.tenantId),
        eq(salePayments.method, 'transfer'),
        saleFilter
      )
    )
    // Oldest first, so the first frozen snapshot seen for a destination is the
    // earliest one the store printed.
    .orderBy(salePayments.createdAt, salePayments.id)
    .all();

  const surplusRows = db
    .select({ after: auditLogs.after })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.tenantId, input.tenantId),
        eq(auditLogs.action, 'sale_payment.transfer_manual_confirmed'),
        gte(auditLogs.createdAt, startIso),
        lt(auditLogs.createdAt, endExclusiveIso)
      )
    )
    .all();
  let unapplied = 0;
  for (const row of surplusRows) {
    const surplus = (row.after as { surplusAmount?: unknown } | null)?.surplusAmount;
    if (typeof surplus === 'number' && Number.isFinite(surplus)) {
      unapplied = roundMoney(unapplied + surplus);
    }
  }
  const transferConfirmations = summarizeTransferConfirmations(transferRows, unapplied);

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
