/** Explicit catalog/purchase revaluation is not a conservative stock transformation. */
import { inventoryValueGuard } from './inventory-value-errors.js';
import type { DatabaseInstance } from '../db/index.js';
import { writeAuditLog } from './audit-logs.js';
import {
  addInventoryValues,
  legacyInventoryValue,
  toInventoryCents,
} from './inventory-valuation.js';
import { applyProductValueDelta, type ProductValuationState } from './product-valuation.js';

/** Call after the catalog basis update but before any physical receipt/adjustment, in the same transaction. */
export function rebaseProductValuation(
  db: DatabaseInstance,
  input: {
    before: ProductValuationState | null;
    initialCost: number;
    cost: number;
    actorId: string;
    source: 'product_update' | 'purchase' | 'order_receipt' | 'inventory_entry';
    referenceId: string;
    operationId?: string | null | undefined;
  }
): void {
  return inventoryValueGuard(() => {
    const before = input.before;
    if (!before) return;
    // A purchase deliberately replaces both baselines. An unrelated product edit
    // must not erase a residual merely because the form submits the same price.
    const replacesBothBaselines = input.source === 'purchase' || input.source === 'order_receipt';
    const replaceInventory = replacesBothBaselines || input.initialCost !== before.initialCost;
    const replaceCogs = replacesBothBaselines || input.cost !== before.cost;
    if (!replaceInventory && !replaceCogs) return;
    const inventoryValue = replaceInventory
      ? legacyInventoryValue(before.quantity, input.initialCost)
      : before.inventoryValue;
    const cogsValue = replaceCogs
      ? legacyInventoryValue(before.quantity, input.cost)
      : before.cogsValue;
    const delta = {
      inventoryValue: addInventoryValues(inventoryValue, -before.inventoryValue),
      cogsValue: addInventoryValues(cogsValue, -before.cogsValue),
    };
    applyProductValueDelta(db, before, 0, delta);
    if (delta.inventoryValue === 0 && delta.cogsValue === 0) return;
    writeAuditLog({
      tx: db,
      tenantId: before.tenantId,
      actorId: input.actorId,
      action: 'inventory.revalue',
      resourceType: 'product',
      resourceId: before.productId,
      before: {
        quantity: before.quantity,
        initialCost: before.initialCost,
        cost: before.cost,
        inventoryValueCents: toInventoryCents(before.inventoryValue),
        cogsValueCents: toInventoryCents(before.cogsValue),
      },
      after: {
        quantity: before.quantity,
        initialCost: input.initialCost,
        cost: input.cost,
        inventoryValueCents: toInventoryCents(inventoryValue),
        cogsValueCents: toInventoryCents(cogsValue),
      },
      metadata: {
        source: input.source,
        referenceId: input.referenceId,
        inventoryDeltaCents: toInventoryCents(delta.inventoryValue),
        cogsDeltaCents: toInventoryCents(delta.cogsValue),
      },
      operationId: input.operationId,
    });
  }, 'INVENTORY_VALUE_INVALID');
}
