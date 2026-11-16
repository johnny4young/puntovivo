/**
 * The guided day close a manager walks inside Hoy: the day in figures, the
 * checklist that must be settled, and the two decisions only a person can
 * take (why a drawer differed, what to do with a parked sale).
 *
 * @module services/reports/close-guide
 */
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';

import { listHandoffsBetween } from '../../application/cash-sessions/handoff.js';
import type { DatabaseInstance } from '../../db/index.js';
import {
  cashMovements,
  cashSessions,
  dayCloseSignoffs,
  salePayments,
  sales,
  users,
  type CashVarianceReason,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { writeAuditLog } from '../audit-logs.js';
import { resolveCashCloseSettings } from '../cash-close-settings.js';
import { resolveTenantBusinessClock } from '../pharmacy/business-clock.js';
import { enqueueSyncInTransaction } from '../sync/enqueue.js';
import { resolveTenantLocale } from '../tenant-locale.js';
import { CASH_BALANCED_EPSILON, listCashDifferences } from './cash-differences.js';
import { computeComprehensiveDayCloseReport } from './comprehensive-day-close.js';
import { getDayCloseSignoff } from './day-close-signoff.js';
import {
  addCalendarDays,
  calendarDayInTimeZone,
  resolveUtcDayWindow,
  type UtcDayWindow,
} from './day-window.js';
import { dailyDatedRevenueSql, type DailyRevenueRow } from './net-sales.js';

const VARIANCE_NOTE_MIN_LENGTH = 3;

export type CloseGuideBlocker = 'open_sessions' | 'unexplained_differences';

/** Payment methods that settle into the bank without passing through a drawer. */
const ELECTRONIC_METHODS = ['card', 'transfer'] as const;

/**
 * Cash the drawers closed today hold beyond their opening float, plus what was
 * skimmed to the safe and minus what the safe lent them. A received drawer
 * opens with the recount as its float, so a handed-over drawer counts once.
 */
function cashToDeposit(db: DatabaseInstance, tenantId: string, window: UtcDayWindow): number {
  const closedInWindow = and(
    eq(cashSessions.tenantId, tenantId),
    eq(cashSessions.status, 'closed'),
    gte(cashSessions.closedAt, window.startIso),
    lt(cashSessions.closedAt, window.endExclusiveIso)
  );
  const drawers = db
    .select({ actualCount: cashSessions.actualCount, openingFloat: cashSessions.openingFloat })
    .from(cashSessions)
    .where(closedInWindow)
    .all();
  // Signed amounts: a skim is stored negative, a replenishment positive.
  const safeTransfers = db
    .select({ amount: cashMovements.amount })
    .from(cashMovements)
    .innerJoin(cashSessions, eq(cashSessions.id, cashMovements.sessionId))
    .where(
      and(
        eq(cashMovements.tenantId, tenantId),
        inArray(cashMovements.type, ['skim', 'replenishment']),
        closedInWindow
      )
    )
    .all();
  const counted = drawers.reduce(
    (sum, row) => roundMoney(sum + roundMoney((row.actualCount ?? 0) - row.openingFloat)),
    0
  );
  return safeTransfers.reduce((sum, row) => roundMoney(sum - row.amount), counted);
}

/** Card and transfer payments of the day's completed sales. */
function electronicTotal(db: DatabaseInstance, tenantId: string, window: UtcDayWindow): number {
  const rows = db
    .select({ amount: salePayments.amount })
    .from(salePayments)
    .innerJoin(sales, and(eq(sales.id, salePayments.saleId), eq(sales.tenantId, tenantId)))
    .where(
      and(
        eq(salePayments.tenantId, tenantId),
        eq(sales.status, 'completed'),
        inArray(salePayments.method, [...ELECTRONIC_METHODS]),
        gte(sales.createdAt, window.startIso),
        lt(sales.createdAt, window.endExclusiveIso)
      )
    )
    .all();
  return rows.reduce((sum, row) => roundMoney(sum + row.amount), 0);
}

function readSignature(db: DatabaseInstance, tenantId: string, date: string) {
  return db
    .select({
      method: dayCloseSignoffs.signatureMethod,
      image: dayCloseSignoffs.signatureImage,
    })
    .from(dayCloseSignoffs)
    .where(and(eq(dayCloseSignoffs.tenantId, tenantId), eq(dayCloseSignoffs.businessDate, date)))
    .get();
}

export async function computeCloseGuide(
  db: DatabaseInstance,
  tenantId: string,
  input: { date?: string | undefined; now?: Date } = {}
) {
  const now = input.now ?? new Date();
  const clock = await resolveTenantBusinessClock(db, tenantId, now);
  const date = input.date ?? clock.businessDate;
  const window = resolveUtcDayWindow(date, clock.timezone);

  const signoff = getDayCloseSignoff(db, tenantId, date);
  const report =
    signoff?.report ?? (await computeComprehensiveDayCloseReport(db, { tenantId, date, now }));
  const { differenceTolerance } = await resolveCashCloseSettings(db, tenantId);
  const differences = listCashDifferences(db, tenantId, window, differenceTolerance);

  const lastClosed = db
    .select({
      registerName: cashSessions.registerName,
      cashierName: users.name,
      closedAt: sql<string>`${cashSessions.closedAt}`,
    })
    .from(cashSessions)
    .innerJoin(users, eq(users.id, cashSessions.cashierId))
    .where(
      and(
        eq(cashSessions.tenantId, tenantId),
        eq(cashSessions.status, 'closed'),
        gte(cashSessions.closedAt, window.startIso),
        lt(cashSessions.closedAt, window.endExclusiveIso)
      )
    )
    .orderBy(sql`${cashSessions.closedAt} desc`)
    .limit(1)
    .get();

  // Table checks stay with the restaurant flow; only retail parked sales are asked about.
  const drafts = db
    .select({
      id: sales.id,
      label: sql<string>`coalesce(${sales.suspendedLabel}, ${sales.saleNumber})`,
      total: sales.total,
      suspendedAt: sql<string>`${sales.suspendedAt}`,
      carriedOverAt: sales.carriedOverAt,
    })
    .from(sales)
    .where(
      and(
        eq(sales.tenantId, tenantId),
        eq(sales.status, 'draft'),
        isNotNull(sales.suspendedAt),
        isNull(sales.tableId),
        lt(sales.suspendedAt, window.endExclusiveIso)
      )
    )
    .orderBy(asc(sales.suspendedAt))
    .all()
    .map(({ carriedOverAt, ...draft }) => ({
      ...draft,
      carriedOver: carriedOverAt !== null && carriedOverAt >= window.startIso,
    }));

  const comparisonDate = addCalendarDays(date, -7);
  const comparison = db.all<DailyRevenueRow>(
    dailyDatedRevenueSql(tenantId, [
      { date: comparisonDate, ...resolveUtcDayWindow(comparisonDate, clock.timezone) },
    ])
  );

  const blockers: CloseGuideBlocker[] = [];
  if (report.cash.openSessions > 0) blockers.push('open_sessions');
  if (differences.some(row => row.needsReason)) blockers.push('unexplained_differences');
  const signature = signoff ? readSignature(db, tenantId, date) : null;

  return {
    date,
    timezone: clock.timezone,
    currencyCode: report.currencyCode,
    isToday: date === clock.businessDate,
    signoff: signoff
      ? {
          id: signoff.id,
          signedAt: signoff.signedAt,
          signedByName: signoff.signedBy.name,
          signatureMethod: signature?.method ?? null,
          signatureImage: signature?.image ?? null,
        }
      : null,
    figures: {
      sold: report.sales.netRevenue,
      salesCount: report.sales.count,
      comparisonTotal: comparison[0]?.revenue ?? 0,
      cashToDeposit: cashToDeposit(db, tenantId, window),
      electronic: electronicTotal(db, tenantId, window),
      cashDifference: report.cash.overShort,
    },
    sessions: {
      closed: report.cash.closedSessions,
      open: report.cash.openSessions,
      lastClosed: lastClosed ?? null,
    },
    differenceTolerance,
    differences,
    drafts,
    fiscal: {
      accepted: report.fiscal.byStatus.accepted,
      inProcess:
        report.fiscal.byStatus.pending +
        report.fiscal.byStatus.sent +
        report.fiscal.byStatus.contingency +
        report.fiscal.byStatus.partial_send,
      rejected: report.fiscal.byStatus.rejected,
    },
    highAnomalies: report.anomalies.high,
    handoffs: listHandoffsBetween(db, tenantId, window.startIso, window.endExclusiveIso),
    blockers,
    // A parked sale needs a decision here even though the server lets the day be signed.
    readyToSign: blockers.length === 0 && drafts.every(draft => draft.carriedOver),
  };
}

async function businessDateOf(db: DatabaseInstance, tenantId: string, instant: Date) {
  const locale = await resolveTenantLocale(db, tenantId);
  return calendarDayInTimeZone(instant, locale.timezone);
}

/** Runs inside the write transaction so a signature cannot land between check and write. */
function assertDayNotSealed(tx: DatabaseInstance, tenantId: string, date: string) {
  const sealed = tx
    .select({ id: dayCloseSignoffs.id })
    .from(dayCloseSignoffs)
    .where(and(eq(dayCloseSignoffs.tenantId, tenantId), eq(dayCloseSignoffs.businessDate, date)))
    .get();
  if (sealed) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'DAY_CLOSE_SEALED',
      message: 'The business day is signed; its close evidence can no longer change',
      details: { date },
    });
  }
}

export interface ExplainCashDifferenceInput {
  tenantId: string;
  actorId: string;
  sessionId: string;
  reason: CashVarianceReason;
  note: string | null;
}

/** Record why a closed drawer differed. Allowed until that day is signed. */
export async function explainCashDifference(
  db: DatabaseInstance,
  input: ExplainCashDifferenceInput
) {
  const note = input.note?.trim() ? input.note.trim() : null;
  if (input.reason === 'other' && (note?.length ?? 0) < VARIANCE_NOTE_MIN_LENGTH) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_VARIANCE_NOTE_REQUIRED',
      message: 'Say what happened when the reason is Other',
    });
  }
  const session = db
    .select({
      id: cashSessions.id,
      status: cashSessions.status,
      overShort: cashSessions.overShort,
      closedAt: cashSessions.closedAt,
      siteId: cashSessions.siteId,
      registerName: cashSessions.registerName,
      reason: cashSessions.varianceReason,
      note: cashSessions.varianceNote,
    })
    .from(cashSessions)
    .where(and(eq(cashSessions.id, input.sessionId), eq(cashSessions.tenantId, input.tenantId)))
    .get();
  if (!session) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'CASH_SESSION_NOT_FOUND',
      message: 'Cash session not found',
      details: { sessionId: input.sessionId },
    });
  }
  if (
    session.status !== 'closed' ||
    session.closedAt === null ||
    Math.abs(session.overShort ?? 0) <= CASH_BALANCED_EPSILON
  ) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_VARIANCE_NOT_APPLICABLE',
      message: 'A reason only applies to a closed session whose count differed',
      details: { sessionId: input.sessionId },
    });
  }
  const date = await businessDateOf(db, input.tenantId, new Date(session.closedAt));

  const at = new Date().toISOString();
  db.transaction(
    tx => {
      assertDayNotSealed(tx as unknown as DatabaseInstance, input.tenantId, date);
      tx.update(cashSessions)
        .set({
          varianceReason: input.reason,
          varianceNote: note,
          varianceExplainedBy: input.actorId,
          varianceExplainedAt: at,
          updatedAt: at,
        })
        .where(and(eq(cashSessions.id, session.id), eq(cashSessions.tenantId, input.tenantId)))
        .run();
      writeAuditLog({
        tx,
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: 'cash_session.variance_explained',
        resourceType: 'cash_session',
        resourceId: session.id,
        before: { reason: session.reason, note: session.note },
        after: { reason: input.reason, note },
        metadata: {
          siteId: session.siteId,
          registerName: session.registerName,
          overShort: session.overShort,
        },
      });
    },
    { behavior: 'immediate' }
  );
  return { sessionId: session.id, reason: input.reason, note };
}

/** Leave a parked sale for tomorrow so today's close stops asking about it. */
export async function carryOverDraft(
  db: DatabaseInstance,
  input: { tenantId: string; actorId: string; saleId: string }
) {
  const now = new Date();
  const at = now.toISOString();
  const today = await businessDateOf(db, input.tenantId, now);
  return db.transaction(
    tx => {
      assertDayNotSealed(tx as unknown as DatabaseInstance, input.tenantId, today);
      const draft = tx
        .select({
          id: sales.id,
          status: sales.status,
          suspendedAt: sales.suspendedAt,
          syncVersion: sales.syncVersion,
        })
        .from(sales)
        .where(and(eq(sales.id, input.saleId), eq(sales.tenantId, input.tenantId)))
        .get();
      if (!draft) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'SALE_NOT_FOUND',
          message: 'Sale not found',
        });
      }
      if (draft.status !== 'draft' || draft.suspendedAt === null) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'SALE_NOT_SUSPENDED',
          message: 'Only a parked sale can be left for tomorrow',
        });
      }
      const syncVersion = (draft.syncVersion ?? 0) + 1;
      tx.update(sales)
        .set({
          carriedOverAt: at,
          carriedOverBy: input.actorId,
          syncStatus: 'pending',
          syncVersion,
          updatedAt: at,
        })
        .where(and(eq(sales.id, draft.id), eq(sales.tenantId, input.tenantId)))
        .run();
      writeAuditLog({
        tx,
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: 'sale.carry_over',
        resourceType: 'sale',
        resourceId: draft.id,
        after: { carriedOverAt: at },
      });
      enqueueSyncInTransaction(
        { db: tx as unknown as DatabaseInstance, tenantId: input.tenantId },
        {
          entityType: 'sales',
          entityId: draft.id,
          operation: 'update',
          data: { id: draft.id, status: 'draft', carriedOverAt: at, syncVersion },
        }
      );
      return { saleId: draft.id, carriedOverAt: at };
    },
    { behavior: 'immediate' }
  );
}
