/**
 * Closed drawers whose count differed, and whether a reason is still owed.
 *
 * @module services/reports/cash-differences
 */
import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import { cashSessions, sites, users } from '../../db/schema.js';
import { resolveCashCloseSettings } from '../cash-close-settings.js';
import { resolveTenantLocale } from '../tenant-locale.js';
import { resolveUtcDayWindow } from './day-window.js';

export const CASH_BALANCED_EPSILON = 0.009;

/** Closed sessions of the day whose count differed, with whether a reason is still owed. */
export function listCashDifferences(
  db: DatabaseInstance,
  tenantId: string,
  window: { startIso: string; endExclusiveIso: string },
  tolerance: number
) {
  return db
    .select({
      sessionId: cashSessions.id,
      registerName: cashSessions.registerName,
      cashierName: users.name,
      siteName: sites.name,
      closedAt: sql<string>`${cashSessions.closedAt}`,
      overShort: sql<number>`${cashSessions.overShort}`,
      reason: cashSessions.varianceReason,
      note: cashSessions.varianceNote,
    })
    .from(cashSessions)
    .innerJoin(users, eq(users.id, cashSessions.cashierId))
    .innerJoin(sites, eq(sites.id, cashSessions.siteId))
    .where(
      and(
        eq(cashSessions.tenantId, tenantId),
        eq(cashSessions.status, 'closed'),
        gte(cashSessions.closedAt, window.startIso),
        lt(cashSessions.closedAt, window.endExclusiveIso),
        sql`abs(coalesce(${cashSessions.overShort}, 0)) > ${CASH_BALANCED_EPSILON}`
      )
    )
    .orderBy(asc(cashSessions.registerName), asc(cashSessions.closedAt))
    .all()
    .map(row => {
      const overTolerance = Math.abs(row.overShort) > tolerance + CASH_BALANCED_EPSILON;
      return { ...row, overTolerance, needsReason: overTolerance && row.reason === null };
    });
}

/** The day's differences with the tolerance they were judged against. */
export async function cashDifferencesForDate(db: DatabaseInstance, tenantId: string, date: string) {
  const locale = await resolveTenantLocale(db, tenantId);
  const { differenceTolerance } = await resolveCashCloseSettings(db, tenantId);
  return {
    tolerance: differenceTolerance,
    rows: listCashDifferences(
      db,
      tenantId,
      resolveUtcDayWindow(date, locale.timezone),
      differenceTolerance
    ),
  };
}
