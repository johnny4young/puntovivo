import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { sales } from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';
import type { CompanionSnapshotOutput } from '../../trpc/schemas/companion.js';
import { computeNeedsAttention } from '../operations/attention.js';
import { getDayCloseSignoffMetadata } from '../reports/day-close-signoff.js';
import { resolveUtcDayWindow } from '../reports/day-window.js';
import { resolveTenantLocale } from '../tenant-locale.js';
import { netSaleTotalSql, windowReturnedAmountSql } from '../reports/net-sales.js';

const RECENT_SALE_LIMIT = 12;

/**
 * Tenant-scoped phone read model. It deliberately excludes customer identity,
 * line detail, charts, inventory rows, and actionable alert identifiers.
 */
export async function getCompanionSnapshot(
  db: DatabaseInstance,
  input: { tenantId: string; date: string; now?: Date }
): Promise<CompanionSnapshotOutput> {
  const locale = await resolveTenantLocale(db, input.tenantId);
  const window = resolveUtcDayWindow(input.date, locale.timezone);
  const completedAt = sql<string>`coalesce(${sales.checkoutCompletedAt}, ${sales.createdAt})`;
  const netSaleTotal = netSaleTotalSql(input.tenantId);
  const completedConditions = [
    eq(sales.tenantId, input.tenantId),
    eq(sales.status, 'completed'),
    sql`(${sales.returnState} is null or ${sales.returnState} != 'refunded')`,
    gte(completedAt, window.startIso),
    lt(completedAt, window.endExclusiveIso),
  ] as const;
  // The day's REVENUE books returns as dated events, so it must not also drop
  // the returned sale from the gross — that would subtract it twice and move
  // it out of the day it was actually sold. The recent-sales list below keeps
  // the eligibility filter and the per-ticket net, which are ticket
  // properties rather than a period figure.
  const datedRevenueConditions = [
    eq(sales.tenantId, input.tenantId),
    eq(sales.status, 'completed'),
    gte(completedAt, window.startIso),
    lt(completedAt, window.endExclusiveIso),
  ] as const;
  const windowRefunds = windowReturnedAmountSql(
    input.tenantId,
    window.startIso,
    window.endExclusiveIso
  );

  const [stats, recentSales, attention] = await Promise.all([
    db
      .select({
        revenue: sql<number>`round(coalesce(sum(${sales.total}), 0) - ${windowRefunds}, 2)`,
        // Throughput keeps its meaning: a fully returned ticket was never
        // counted as an order and still is not.
        orders: sql<number>`sum(case when ${sales.returnState} is null or ${sales.returnState} != 'refunded' then 1 else 0 end)`,
      })
      .from(sales)
      .where(and(...datedRevenueConditions))
      .get(),
    db
      .select({
        id: sales.id,
        saleNumber: sales.saleNumber,
        total: netSaleTotal,
        completedAt,
      })
      .from(sales)
      .where(and(...completedConditions))
      .orderBy(desc(completedAt))
      .limit(RECENT_SALE_LIMIT)
      .all(),
    computeNeedsAttention(db, input.tenantId),
  ]);

  return {
    businessDate: input.date,
    generatedAt: (input.now ?? new Date()).toISOString(),
    stats: {
      revenue: roundMoney(Number(stats?.revenue ?? 0)),
      orders: Number(stats?.orders ?? 0),
    },
    recentSales: recentSales.map(sale => ({
      id: sale.id,
      saleNumber: sale.saleNumber,
      total: sale.total,
      completedAt: sale.completedAt,
    })),
    attention,
    // Integrity verification remains mandatory even though only metadata
    // crosses the wire; a corrupt signed snapshot must never read as signed.
    dayClose: getDayCloseSignoffMetadata(db, input.tenantId, input.date),
  };
}
