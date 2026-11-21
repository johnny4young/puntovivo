/**
 * Per-register and per-draft rows behind the guided day close. The signed
 * report keeps only totals; these rows are what the manager acts on.
 */
import { and, asc, eq, gte, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import { cashSessions, sales, users } from '../../db/schema.js';
import { isCarriedOverSql } from '../../application/sales/carryDraftOver.js';
import type { DayCloseChecklistOutput } from '../../trpc/schemas/reports.js';
import { resolveTenantLocale } from '../tenant-locale.js';
import { DAY_CLOSE_BALANCED_EPSILON } from './day-close.js';
import { resolveUtcDayWindow } from './day-window.js';

/** Retail drafts parked before the day ended; restaurant checks stay with their table. */
export function parkedRetailDraftConditions(tenantId: string, endExclusiveIso: string) {
  return and(
    eq(sales.tenantId, tenantId),
    eq(sales.status, 'draft'),
    isNotNull(sales.suspendedAt),
    isNull(sales.tableId),
    lt(sales.suspendedAt, endExclusiveIso)
  );
}

/** Sessions the report counts as closed that day. */
export function closedInWindowConditions(
  tenantId: string,
  startIso: string,
  endExclusiveIso: string
) {
  return and(
    eq(cashSessions.tenantId, tenantId),
    eq(cashSessions.status, 'closed'),
    gte(cashSessions.closedAt, startIso),
    lt(cashSessions.closedAt, endExclusiveIso)
  );
}

/** Started before the day ended and either never closed or closed after it. */
export function openAtDayEndConditions(tenantId: string, endExclusiveIso: string) {
  return and(
    eq(cashSessions.tenantId, tenantId),
    lt(cashSessions.openedAt, endExclusiveIso),
    sql`(${cashSessions.closedAt} is null or ${cashSessions.closedAt} >= ${endExclusiveIso})`
  );
}

/** Left for tomorrow by a decision made on or after the day being closed; each close decides again. */
export function carriedForDaySql(startIso: string) {
  return sql<boolean>`(${isCarriedOverSql()} AND ${sales.carriedOverAt} >= ${startIso})`;
}

export function hasCashDifference(overShort: number | null): boolean {
  return overShort !== null && Math.abs(overShort) > DAY_CLOSE_BALANCED_EPSILON;
}

export function isUnexplainedDifference(row: {
  overShort: number | null;
  differenceReason: string | null;
}): boolean {
  return hasCashDifference(row.overShort) && row.differenceReason === null;
}

export async function computeDayCloseChecklist(
  db: DatabaseInstance,
  input: { tenantId: string; date: string }
): Promise<DayCloseChecklistOutput> {
  const locale = await resolveTenantLocale(db, input.tenantId);
  const { startIso, endExclusiveIso } = resolveUtcDayWindow(input.date, locale.timezone);

  const sessionRows = db
    .select({
      id: cashSessions.id,
      status: cashSessions.status,
      registerName: cashSessions.registerName,
      cashierName: users.name,
      closedAt: cashSessions.closedAt,
      actualCount: cashSessions.actualCount,
      openingFloat: cashSessions.openingFloat,
      overShort: cashSessions.overShort,
      differenceReason: cashSessions.differenceReason,
      differenceNote: cashSessions.differenceNote,
    })
    .from(cashSessions)
    .innerJoin(users, eq(users.id, cashSessions.cashierId))
    .where(
      or(
        closedInWindowConditions(input.tenantId, startIso, endExclusiveIso),
        openAtDayEndConditions(input.tenantId, endExclusiveIso)
      )
    )
    .orderBy(asc(cashSessions.openedAt))
    .all();

  const draftRows = db
    .select({
      id: sales.id,
      saleNumber: sales.saleNumber,
      label: sales.suspendedLabel,
      total: sales.total,
      suspendedAt: sales.suspendedAt,
      carriedOver: carriedForDaySql(startIso),
    })
    .from(sales)
    .where(parkedRetailDraftConditions(input.tenantId, endExclusiveIso))
    .orderBy(asc(sales.suspendedAt))
    .all();

  return {
    date: input.date,
    sessions: sessionRows.map(row => {
      const closedInWindow =
        row.status === 'closed' && row.closedAt !== null && row.closedAt < endExclusiveIso;
      return {
        id: row.id,
        registerName: row.registerName,
        cashierName: row.cashierName,
        status: closedInWindow ? 'closed' : 'open',
        closedAt: closedInWindow ? row.closedAt : null,
        counted: closedInWindow && row.actualCount !== null,
        openingFloat: row.openingFloat,
        overShort: closedInWindow ? row.overShort : null,
        hasDifference: closedInWindow && hasCashDifference(row.overShort),
        differenceReason: closedInWindow ? row.differenceReason : null,
        differenceNote: closedInWindow ? row.differenceNote : null,
      };
    }),
    drafts: draftRows.map(row => ({
      id: row.id,
      saleNumber: row.saleNumber,
      label: row.label,
      total: row.total,
      suspendedAt: row.suspendedAt!,
      carriedOver: Boolean(row.carriedOver),
    })),
  };
}
