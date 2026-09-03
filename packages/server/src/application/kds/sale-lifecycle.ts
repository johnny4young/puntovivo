/** Sale-owned kitchen changes commit with the business write, even when the module was disabled. */
import { and, eq, inArray, or } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { kdsOrderLines, saleItems, sales } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  KDS_MAX_LINES,
  loadKitchenSale,
  requireKitchenOrder,
  type KdsWriteScope,
} from './common.js';
import { appendKitchenEvent } from './events.js';
import { adoptLegacyKitchenSale } from './legacy.js';
import { kitchenOrderState, loadKitchenOrderLines, updateKitchenLine } from './line-state.js';

/**
 * Adopt the source BEFORE a split moves sale_items. Then call this for the child.
 * Source item identity never changes: splitting a check moves its destination,
 * not its immutable cooking snapshot, original round, or preparation state.
 * Cancellation uses current ownership, so voiding a source cannot void its split child.
 */
export function reconcileKitchenSaleInTransaction(
  tx: DatabaseInstance,
  scope: KdsWriteScope,
  saleId: string,
  voidReason?: 'discard' | 'void'
): void {
  adoptLegacyKitchenSale(tx, scope, saleId);
  const sourceIds = tx
    .select({ id: saleItems.id })
    .from(saleItems)
    .innerJoin(sales, and(eq(sales.id, saleItems.saleId), eq(sales.tenantId, scope.tenantId)))
    .where(eq(saleItems.saleId, saleId))
    .limit(KDS_MAX_LINES + 1)
    .all()
    .map(row => row.id);
  const affected = tx
    .select()
    .from(kdsOrderLines)
    .where(
      and(
        eq(kdsOrderLines.tenantId, scope.tenantId),
        voidReason
          ? eq(kdsOrderLines.currentSaleId, saleId)
          : or(
              eq(kdsOrderLines.currentSaleId, saleId),
              inArray(kdsOrderLines.sourceSaleItemId, sourceIds)
            )
      )
    )
    .limit(KDS_MAX_LINES + 1)
    .all();
  if (!affected.length) return;
  if (sourceIds.length > KDS_MAX_LINES || affected.length > KDS_MAX_LINES) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'KDS_ORDER_LIMIT_EXCEEDED',
      message: 'Kitchen sale reconciliation exceeds its bound',
    });
  }
  const sale = loadKitchenSale(tx, scope, saleId);
  const idsByOrder = new Map<string, Set<string>>();
  for (const line of affected) {
    const ids = idsByOrder.get(line.orderId) ?? new Set<string>();
    ids.add(line.id);
    idsByOrder.set(line.orderId, ids);
  }
  for (const [orderId, ids] of idsByOrder) {
    const order = requireKitchenOrder(tx, scope, orderId);
    const before = loadKitchenOrderLines(tx, order);
    const changes: Array<{
      id: string;
      fromSaleId: string;
      fromTableId: string | null;
      version: number;
    }> = [];
    const next = before.map(line => {
      if (!ids.has(line.id) || line.status === 'voided') return line;
      if (
        !voidReason &&
        line.currentSaleId === saleId &&
        line.currentTableId === sale.tableId &&
        line.currentTableLabel === sale.tableLabel
      )
        return line;
      changes.push({
        id: line.id,
        fromSaleId: line.currentSaleId,
        fromTableId: line.currentTableId,
        version: line.version,
      });
      return updateKitchenLine(
        tx,
        line,
        voidReason
          ? {
              status: 'voided',
              voidedAt: new Date().toISOString(),
              voidReason,
            }
          : {
              currentSaleId: saleId,
              currentTableId: sale.tableId,
              currentTableLabel: sale.tableLabel,
            }
      );
    });
    if (!changes.length) continue;
    const after = appendKitchenEvent(
      tx,
      order,
      {
        kind: voidReason ? 'voided' : 'relocated',
        actorId: scope.actorId,
        facts: { changes, saleId, tableId: sale.tableId, reason: voidReason ?? null },
      },
      kitchenOrderState(next, scope.actorId)
    );
    writeAuditLog({
      tx,
      tenantId: scope.tenantId,
      actorId: scope.actorId,
      action: voidReason ? 'kds.order.voided' : 'kds.order.relocated',
      resourceType: 'kds_order',
      resourceId: orderId,
      before: { version: order.version, status: order.status },
      after: { version: after.version, status: after.status },
      metadata: { lineIds: changes.map(change => change.id), saleId, reason: voidReason ?? null },
    });
  }
}
