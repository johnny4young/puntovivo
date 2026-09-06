/** Shared synchronous kitchen invariants, called only inside an owned writer. */
import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  cashSessions,
  kdsOrders,
  restaurantTables,
  sales,
  sites,
  tenants,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { isModuleActiveInSettings } from '../../services/modules/manifest.js';

/** Transaction-authoritative scope derived from the authenticated request. */
export interface KdsWriteScope {
  tenantId: string;
  siteId: string;
  actorId: string;
}
/** Hard submission bounds apply equally to legacy adoption and new preparation. */
export const KDS_MAX_LINES = 200;

/** A disabled module skips new kitchen submissions but never suppresses existing voids. */
export function isKdsActive(tx: DatabaseInstance, tenantId: string): boolean {
  const row = tx
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  return Boolean(row && isModuleActiveInSettings(row.settings, 'kds'));
}

/** Missing, foreign or deactivated site must not widen the kitchen scope. */
export function requireKdsSite(
  tx: DatabaseInstance,
  tenantId: string,
  siteId: string | null
): string {
  const site = siteId
    ? tx
        .select({ id: sites.id })
        .from(sites)
        .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
        .get()
    : undefined;
  if (!site) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'KDS_ORDER_NOT_FOUND',
      message: 'No active kitchen in the current scope',
    });
  }
  return site.id;
}

/** Frozen sale identity and current table data; all joins keep tenant/site ownership explicit. */
export function loadKitchenSale(tx: DatabaseInstance, scope: KdsWriteScope, saleId: string) {
  const sale = tx
    .select({
      id: sales.id,
      saleNumber: sales.saleNumber,
      status: sales.status,
      cashSessionId: sales.cashSessionId,
      sessionSiteId: cashSessions.siteId,
      tableId: sales.tableId,
      notes: sales.notes,
      tableName: restaurantTables.name,
      // sales.suspend writes the operator's free-text label for a ticket with
      // no table (takeaway, delivery). It is the only identity such a ticket
      // has, so the projection has to carry it or the kitchen falls back to
      // the generic untabled label.
      suspendedLabel: sales.suspendedLabel,
    })
    .from(sales)
    .leftJoin(
      cashSessions,
      and(
        eq(cashSessions.id, sales.cashSessionId),
        eq(cashSessions.tenantId, scope.tenantId),
        eq(cashSessions.siteId, scope.siteId)
      )
    )
    .leftJoin(
      restaurantTables,
      and(
        eq(restaurantTables.id, sales.tableId),
        eq(restaurantTables.tenantId, scope.tenantId),
        eq(restaurantTables.siteId, scope.siteId)
      )
    )
    .where(and(eq(sales.id, saleId), eq(sales.tenantId, scope.tenantId)))
    .get();
  if (
    !sale ||
    (sale.cashSessionId && sale.sessionSiteId !== scope.siteId) ||
    // A tableId that joined nothing means the table belongs to another
    // tenant or site. The free-text fallback below must never mask that, so
    // this guard reads the raw joined name rather than the resolved label.
    (sale.tableId && !sale.tableName) ||
    (!sale.cashSessionId && !sale.tableId)
  ) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'KDS_SNAPSHOT_INVALID',
      message: 'Sale scope cannot be verified for kitchen submission',
    });
  }
  // Live table name first: the enqueue hook can fire before sales.suspend has
  // written suspendedLabel, so a seated ticket must not freeze a stale label.
  return { ...sale, tableLabel: sale.tableName ?? sale.suspendedLabel };
}

/** Require an order in this exact kitchen before disclosing any preparation fields. */
export function requireKitchenOrder(tx: DatabaseInstance, scope: KdsWriteScope, id: string) {
  const order = tx
    .select()
    .from(kdsOrders)
    .where(
      and(
        eq(kdsOrders.id, id),
        eq(kdsOrders.tenantId, scope.tenantId),
        eq(kdsOrders.siteId, scope.siteId)
      )
    )
    .get();
  if (!order) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'KDS_ORDER_NOT_FOUND',
      message: 'KDS order not found',
    });
  }
  return order;
}
