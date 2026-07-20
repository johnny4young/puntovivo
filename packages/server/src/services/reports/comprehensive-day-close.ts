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
  paymentMethodEnum,
} from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { detectAnomalies, type AnomalyKind } from '../ai/index.js';
import { resolveTenantLocale } from '../tenant-locale.js';
import { calendarDayInTimeZone, resolveUtcDayWindow } from './day-window.js';

const CASH_BALANCED_EPSILON = 0.009;
const ANOMALY_BASELINE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
type PaymentMethod = (typeof paymentMethodEnum)[number];

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

const ANOMALY_KINDS: readonly AnomalyKind[] = [
  'ticketsPerHourSpike',
  'voidRate',
  'refundAmount',
  'noSaleSessions',
];

export type DayCloseReadinessCode =
  | 'open_sessions'
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

function zeroFiscalStatusCounts(): Record<FiscalDocumentStatus, number> {
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
      total: sql<number>`coalesce(sum(${sales.total}), 0)`,
    })
    .from(sales)
    .where(saleFilter)
    .get();

  const paymentRows = db
    .select({
      method: salePayments.method,
      amount: sql<number>`coalesce(sum(${salePayments.amount}), 0)`,
      transactionCount: sql<number>`count(*)`,
    })
    .from(salePayments)
    .innerJoin(sales, eq(salePayments.saleId, sales.id))
    .where(and(eq(salePayments.tenantId, input.tenantId), saleFilter))
    .groupBy(salePayments.method)
    .orderBy(salePayments.method)
    .all();

  const closedSessionRows = db
    .select({
      expected: cashSessions.expectedBalance,
      counted: cashSessions.actualCount,
      overShort: cashSessions.overShort,
    })
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.tenantId, input.tenantId),
        eq(cashSessions.status, 'closed'),
        gte(cashSessions.closedAt, startIso),
        lt(cashSessions.closedAt, endExclusiveIso)
      )
    )
    .all();

  // A session was open at local day-end when it started before the boundary
  // and either never closed or closed on/after that boundary.
  const openAtDayEnd =
    db
      .select({ count: sql<number>`count(*)` })
      .from(cashSessions)
      .where(
        and(
          eq(cashSessions.tenantId, input.tenantId),
          lt(cashSessions.openedAt, endExclusiveIso),
          sql`(${cashSessions.closedAt} is null or ${cashSessions.closedAt} >= ${endExclusiveIso})`
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
    .where(
      and(
        eq(fiscalDocuments.tenantId, input.tenantId),
        gte(fiscalDocuments.emittedAt, startIso),
        lt(fiscalDocuments.emittedAt, endExclusiveIso)
      )
    )
    .groupBy(fiscalDocuments.status, fiscalDocuments.source)
    .all();

  const returnRow = db
    .select({
      count: sql<number>`count(*)`,
      amount: sql<number>`coalesce(sum(${saleReturns.refundAmount}), 0)`,
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
      amount: sql<number>`coalesce(sum(${sales.total}), 0)`,
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
    if (
      row.counted !== null &&
      row.overShort !== null &&
      Math.abs(row.overShort) <= CASH_BALANCED_EPSILON
    ) {
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
  if (discrepancySessions > 0) warnings.push('cash_discrepancies');
  if (
    fiscalByStatus.pending +
      fiscalByStatus.sent +
      fiscalByStatus.contingency +
      fiscalByStatus.notified_correction +
      fiscalByStatus.partial_send >
    0
  ) {
    warnings.push('fiscal_pending');
  }
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
