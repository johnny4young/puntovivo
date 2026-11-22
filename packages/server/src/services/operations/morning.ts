/**
 * The owner's phone before the store opens: how yesterday ended, what the
 * DIAN decided since the seal, whether the backup ran, and what to do before
 * opening. Today's expected curve comes from operations.today.
 *
 * @module services/operations/morning
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import {
  cashSessionHandoffs,
  cashSessions,
  denominationTemplates,
  fiscalDocuments,
  sales,
  sites,
  type FiscalDocumentStatus,
} from '../../db/schema.js';
import { resolveTenantBusinessClock } from '../pharmacy/business-clock.js';
import {
  countFiscalInProgress,
  fiscalDocumentsInWindow,
  zeroFiscalStatusCounts,
} from '../reports/comprehensive-day-close.js';
import {
  carriedForDaySql,
  closedInWindowConditions,
  parkedRetailDraftConditions,
} from '../reports/day-close-checklist.js';
import { getDayCloseSignoff } from '../reports/day-close-signoff.js';
import { addCalendarDays, resolveUtcDayWindow } from '../reports/day-window.js';
import { dailyDatedRevenueSql, type DailyRevenueRow } from '../reports/net-sales.js';
import { roundMoney } from '../../lib/money.js';
import { readBackupStatus, type OwnerBackupStatus } from './backup-status.js';
import { dayCurveIn, type DayCurve } from './today.js';

export interface MorningRegisterToOpen {
  siteId: string;
  siteName: string;
  registerName: string;
  /** The register's standard float, else what it opened with last time. */
  openingFloat: number;
}

export interface MorningCarriedSale {
  id: string;
  saleNumber: string;
  label: string | null;
  total: number;
}

export interface MorningRecap {
  /** Yesterday's business date. */
  date: string;
  yesterday: DayCurve & { total: number; comparisonTotal: number };
  seal: { signedAt: string; netRevenue: number; salesCount: number } | null;
  /** Decisions the DIAN made on yesterday's documents after the seal. */
  fiscal: { accepted: number; rejected: number; inProgress: number } | null;
  backup: OwnerBackupStatus | null;
  registersToOpen: MorningRegisterToOpen[];
  carriedSales: MorningCarriedSale[];
}

/** The same revenue the day curve draws, summed in one pass. */
function dayRevenue(db: DatabaseInstance, tenantId: string, date: string, timezone: string) {
  const [row] = db.all<DailyRevenueRow>(
    dailyDatedRevenueSql(tenantId, [{ date, ...resolveUtcDayWindow(date, timezone) }])
  );
  return row?.revenue ?? 0;
}

function fiscalCounts(
  db: DatabaseInstance,
  tenantId: string,
  window: { startIso: string; endExclusiveIso: string }
): Record<FiscalDocumentStatus, number> {
  const counts = zeroFiscalStatusCounts();
  const rows = db
    .select({ status: fiscalDocuments.status, count: sql<number>`count(*)` })
    .from(fiscalDocuments)
    .where(fiscalDocumentsInWindow(tenantId, window.startIso, window.endExclusiveIso))
    .groupBy(fiscalDocuments.status)
    .all();
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

/** Registers that worked yesterday and are neither open nor waiting to be received. */
function registersToOpen(
  db: DatabaseInstance,
  tenantId: string,
  window: { startIso: string; endExclusiveIso: string }
): MorningRegisterToOpen[] {
  const worked = db
    .select({
      siteId: cashSessions.siteId,
      siteName: sites.name,
      registerName: cashSessions.registerName,
      lastFloat: cashSessions.openingFloat,
      standardFloat: denominationTemplates.openingFloat,
    })
    .from(cashSessions)
    .innerJoin(
      sites,
      and(eq(sites.id, cashSessions.siteId), eq(sites.tenantId, tenantId), eq(sites.isActive, true))
    )
    .leftJoin(
      denominationTemplates,
      and(
        eq(denominationTemplates.tenantId, tenantId),
        eq(denominationTemplates.siteId, cashSessions.siteId),
        eq(denominationTemplates.registerName, cashSessions.registerName),
        eq(denominationTemplates.isActive, true)
      )
    )
    .where(closedInWindowConditions(tenantId, window.startIso, window.endExclusiveIso))
    .orderBy(asc(sites.name), asc(cashSessions.registerName), desc(cashSessions.closedAt))
    .all();

  const live = new Set(
    [
      ...db
        .select({ siteId: cashSessions.siteId, registerName: cashSessions.registerName })
        .from(cashSessions)
        .where(and(eq(cashSessions.tenantId, tenantId), eq(cashSessions.status, 'open')))
        .all(),
      ...db
        .select({
          siteId: cashSessionHandoffs.siteId,
          registerName: cashSessionHandoffs.registerName,
        })
        .from(cashSessionHandoffs)
        .where(
          and(eq(cashSessionHandoffs.tenantId, tenantId), eq(cashSessionHandoffs.status, 'pending'))
        )
        .all(),
    ].map(row => `${row.siteId}\u0000${row.registerName}`)
  );

  const seen = new Set<string>();
  const result: MorningRegisterToOpen[] = [];
  // Rows come latest-closed first per register, so the first one carries its last float.
  for (const row of worked) {
    const key = `${row.siteId}\u0000${row.registerName}`;
    if (seen.has(key) || live.has(key)) continue;
    seen.add(key);
    result.push({
      siteId: row.siteId,
      siteName: row.siteName,
      registerName: row.registerName,
      openingFloat: row.standardFloat ?? row.lastFloat,
    });
  }
  return result;
}

export async function computeMorningRecap(
  db: DatabaseInstance,
  tenantId: string,
  now: Date = new Date()
): Promise<MorningRecap> {
  const { businessDate, timezone } = await resolveTenantBusinessClock(db, tenantId, now);
  const date = addCalendarDays(businessDate, -1);
  const yesterdayWindow = resolveUtcDayWindow(date, timezone);
  const todayWindow = resolveUtcDayWindow(businessDate, timezone);

  const curve = dayCurveIn(db, tenantId, date, timezone);

  const signoff = getDayCloseSignoff(db, tenantId, date);
  let fiscal: MorningRecap['fiscal'] = null;
  if (signoff) {
    const atSeal = signoff.report.fiscal.byStatus;
    const current = fiscalCounts(db, tenantId, yesterdayWindow);
    fiscal = {
      accepted: Math.max(0, current.accepted - atSeal.accepted),
      rejected: Math.max(0, current.rejected - atSeal.rejected),
      inProgress: countFiscalInProgress(current),
    };
  }

  const carriedSales = db
    .select({
      id: sales.id,
      saleNumber: sales.saleNumber,
      label: sales.suspendedLabel,
      total: sales.total,
    })
    .from(sales)
    .where(
      and(
        parkedRetailDraftConditions(tenantId, todayWindow.endExclusiveIso),
        carriedForDaySql(yesterdayWindow.startIso)
      )
    )
    .orderBy(asc(sales.suspendedAt))
    .all();

  return {
    date,
    yesterday: {
      ...curve,
      total: roundMoney(curve.hourly.reduce((sum, row) => sum + row.revenue, 0)),
      comparisonTotal: dayRevenue(db, tenantId, addCalendarDays(date, -7), timezone),
    },
    seal: signoff
      ? {
          signedAt: signoff.signedAt,
          netRevenue: signoff.report.sales.netRevenue,
          salesCount: signoff.report.sales.count,
        }
      : null,
    fiscal,
    backup: readBackupStatus(db, tenantId, now),
    registersToOpen: registersToOpen(db, tenantId, yesterdayWindow),
    carriedSales,
  };
}
