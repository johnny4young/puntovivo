/** Explicit catalog revaluation is not a conservative stock transformation. */
import { roundQuantity } from '@puntovivo/shared/unit-math';
import { inventoryValueGuard } from './inventory-value-errors.js';
import type { DatabaseInstance } from '../db/index.js';
import { writeAuditLog } from './audit-logs.js';
import {
  addInventoryValues,
  allocateInventoryValue,
  legacyInventoryValue,
  toInventoryCents,
} from './inventory-valuation.js';
import {
  adoptProductValuation,
  applyProductValueDelta,
  type ProductValuationState,
} from './product-valuation.js';

interface RevaluationAudit {
  actorId: string;
  source: 'product_update' | 'purchase' | 'order_receipt' | 'inventory_entry';
  referenceId: string;
  operationId?: string | null | undefined;
}

function applyRevaluation(
  db: DatabaseInstance,
  before: ProductValuationState,
  target: { inventoryValue: number; cogsValue: number; initialCost: number; cost: number },
  audit: RevaluationAudit
): void {
  const delta = {
    inventoryValue: addInventoryValues(target.inventoryValue, -before.inventoryValue),
    cogsValue: addInventoryValues(target.cogsValue, -before.cogsValue),
  };
  applyProductValueDelta(db, before, 0, delta);
  if (delta.inventoryValue === 0 && delta.cogsValue === 0) return;
  writeAuditLog({
    tx: db,
    tenantId: before.tenantId,
    actorId: audit.actorId,
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
      initialCost: target.initialCost,
      cost: target.cost,
      inventoryValueCents: toInventoryCents(target.inventoryValue),
      cogsValueCents: toInventoryCents(target.cogsValue),
    },
    metadata: {
      source: audit.source,
      referenceId: audit.referenceId,
      inventoryDeltaCents: toInventoryCents(delta.inventoryValue),
      cogsDeltaCents: toInventoryCents(delta.cogsValue),
    },
    operationId: audit.operationId,
  });
}

/** Call after the catalog basis update but before any physical adjustment, in the same transaction. */
export function rebaseProductValuation(
  db: DatabaseInstance,
  input: RevaluationAudit & {
    before: ProductValuationState | null;
    initialCost: number;
    cost: number;
    source: 'product_update';
  }
): void {
  return inventoryValueGuard(() => {
    const before = input.before;
    if (!before) return;
    // An unrelated product edit must not erase a residual merely because the form submits the same price.
    const replaceInventory = input.initialCost !== before.initialCost;
    const replaceCogs = input.cost !== before.cost;
    if (!replaceInventory && !replaceCogs) return;
    applyRevaluation(
      db,
      before,
      {
        inventoryValue: replaceInventory
          ? legacyInventoryValue(before.quantity, input.initialCost)
          : before.inventoryValue,
        cogsValue: replaceCogs
          ? legacyInventoryValue(before.quantity, input.cost)
          : before.cogsValue,
        initialCost: input.initialCost,
        cost: input.cost,
      },
      input
    );
  }, 'INVENTORY_VALUE_INVALID');
}

/**
 * Prepare a pool for a receipt before its balance update. Oversold units are repriced at the
 * receipt cost so the shortfall neither skews the new average nor leaves value on an empty pool.
 * A shortfall the receipt does not cover stays on each pool's post-receipt basis, so the next
 * default credit at that basis cancels it exactly.
 */
export function prepareProductReceipt(
  db: DatabaseInstance,
  input: RevaluationAudit & {
    before: ProductValuationState | null;
    receipt: { quantity: number; value: number; basis: { inventory: number; cogs: number } };
    source: 'purchase' | 'order_receipt' | 'inventory_entry';
  }
): void {
  return inventoryValueGuard(() => {
    const before = input.before;
    if (!before) return;
    const { receipt } = input;
    if (before.quantity >= 0 || receipt.quantity <= 0) {
      adoptProductValuation(db, before);
      return;
    }
    const shortfall = -before.quantity;
    const covered = shortfall <= receipt.quantity;
    const uncovered = roundQuantity(shortfall - receipt.quantity, 12);
    const target = (basis: number) =>
      covered
        ? -allocateInventoryValue(receipt.value, receipt.quantity, shortfall).consumedValue
        : -addInventoryValues(receipt.value, legacyInventoryValue(uncovered, basis));
    applyRevaluation(
      db,
      before,
      {
        inventoryValue: target(receipt.basis.inventory),
        cogsValue: target(receipt.basis.cogs),
        initialCost: before.initialCost,
        cost: before.cost,
      },
      input
    );
  }, 'INVENTORY_VALUE_INVALID');
}
