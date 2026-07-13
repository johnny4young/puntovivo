/**
 * ENG-209 — private cashier pace metrics.
 *
 * The caller never supplies a cashier id: tenant/user/site ownership comes
 * from the authenticated tRPC context. Suspended drafts are absent until they
 * complete and bind to a cash session; voided sales are excluded so the HUD
 * cannot reward reversible volume.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { cashSessions, saleItems, sales } from '../../db/schema.js';
import { MAX_CHECKOUT_DURATION_MS } from '../../application/sales/checkout-timing.js';
import { getActiveCashSessionForCashier } from '../cash-session.js';
import { calculateCashierItemsPerMinute } from './cashier-pace-math.js';

interface CashierPaceArgs {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string;
  cashierId: string;
  now?: Date;
}

export interface CashierPaceMetrics {
  sessionId: string;
  completedSales: number;
  itemCount: number;
  itemsPerMinute: number;
  averageCheckoutSeconds: number | null;
  personalBestItemsPerMinute: number | null;
}

function getDurationMs(openedAtIso: string, endedAtIso: string): number | null {
  const openedAt = Date.parse(openedAtIso);
  const endedAt = Date.parse(endedAtIso);
  if (!Number.isFinite(openedAt) || !Number.isFinite(endedAt) || endedAt <= openedAt) {
    return null;
  }
  return endedAt - openedAt;
}

function getAverageCheckoutSeconds(
  rows: Array<{ checkoutStartedAt: string | null; checkoutCompletedAt: string | null }>
): number | null {
  const durations = rows.flatMap(row => {
    if (!row.checkoutStartedAt || !row.checkoutCompletedAt) return [];
    const durationMs = Date.parse(row.checkoutCompletedAt) - Date.parse(row.checkoutStartedAt);
    return Number.isFinite(durationMs) && durationMs >= 0 && durationMs <= MAX_CHECKOUT_DURATION_MS
      ? [durationMs]
      : [];
  });
  if (durations.length === 0) return null;
  return Math.round(
    durations.reduce((sum, duration) => sum + duration, 0) / durations.length / 1000
  );
}

/** Return pace for the authenticated operator's active session, or null. */
export async function computeCashierPace({
  db,
  tenantId,
  siteId,
  cashierId,
  now = new Date(),
}: CashierPaceArgs): Promise<CashierPaceMetrics | null> {
  const activeSession = await getActiveCashSessionForCashier(db, tenantId, siteId, cashierId);
  if (!activeSession) {
    return null;
  }

  const active = await db
    .select({
      completedSales: sql<number>`count(distinct ${sales.id})`.mapWith(Number),
      itemCount: sql<number>`coalesce(sum(${saleItems.quantity}), 0)`.mapWith(Number),
    })
    .from(sales)
    .leftJoin(saleItems, eq(saleItems.saleId, sales.id))
    .where(
      and(
        eq(sales.tenantId, tenantId),
        eq(sales.cashSessionId, activeSession.id),
        eq(sales.status, 'completed')
      )
    )
    .get();

  const activeDurationMs = getDurationMs(activeSession.openedAt, now.toISOString());
  if (activeDurationMs === null) {
    return null;
  }

  const liveRate = calculateCashierItemsPerMinute(active?.itemCount ?? 0, activeDurationMs);
  if (liveRate === null) {
    return null;
  }

  const personalBestRow = await db
    .select({
      value: sql<number | null>`max(${cashSessions.paceItemsPerMinute})`,
    })
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.tenantId, tenantId),
        eq(cashSessions.siteId, siteId),
        eq(cashSessions.cashierId, cashierId),
        eq(cashSessions.status, 'closed')
      )
    )
    .get();
  const personalBestValue = personalBestRow?.value;
  const personalBest =
    typeof personalBestValue === 'number' && personalBestValue > 0 ? personalBestValue : null;

  const checkoutRows = await db
    .select({
      checkoutStartedAt: sales.checkoutStartedAt,
      checkoutCompletedAt: sales.checkoutCompletedAt,
    })
    .from(sales)
    .where(
      and(
        eq(sales.tenantId, tenantId),
        eq(sales.cashSessionId, activeSession.id),
        eq(sales.status, 'completed')
      )
    );

  return {
    sessionId: activeSession.id,
    completedSales: active?.completedSales ?? 0,
    itemCount: Math.round((active?.itemCount ?? 0) * 100) / 100,
    itemsPerMinute: liveRate,
    averageCheckoutSeconds: getAverageCheckoutSeconds(checkoutRows),
    personalBestItemsPerMinute: personalBest,
  };
}
