/** Financial authority for a physical count under the existing tenant-global cost policy. */
import type { DatabaseInstance } from '../../db/index.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { readProductValuation } from '../../services/product-valuation.js';
import { toInventoryCents } from '../../services/inventory-valuation.js';

/** Null means historical proof is unavailable (or an identity-owned product), never zero value. */
export interface CountValueSnapshot {
  expectedValuationVersion: number | null;
  expectedValuationQuantity: number | null;
  expectedInventoryValueCents: number | null;
  expectedCogsValueCents: number | null;
  cogsUnitCostSnapshot: number | null;
}

/** Observe only; opening a count must not adopt/revalue a product or advance its revision. */
export function snapshotCountValue(
  db: DatabaseInstance,
  tenantId: string,
  productId: string
): CountValueSnapshot {
  const value = readProductValuation(db, tenantId, productId);
  return {
    expectedValuationVersion: value?.version ?? null,
    expectedValuationQuantity: value?.quantity ?? null,
    expectedInventoryValueCents: value ? toInventoryCents(value.inventoryValue) : null,
    expectedCogsValueCents: value ? toInventoryCents(value.cogsValue) : null,
    cogsUnitCostSnapshot: value?.cost ?? null,
  };
}

/** Same site quantity is insufficient when another site or a price edit changed the global basis. */
export function assertCountValueUnchanged(
  db: DatabaseInstance,
  tenantId: string,
  line: CountValueSnapshot & {
    productId: string;
    trackingMode: 'aggregate' | 'lots' | 'serials';
    unitCostSnapshot: number;
  }
): void {
  if (line.trackingMode !== 'aggregate') return;
  const current = readProductValuation(db, tenantId, line.productId);
  if (
    !current ||
    line.expectedValuationVersion === null ||
    line.expectedValuationQuantity !== current.quantity ||
    line.expectedValuationVersion !== current.version ||
    line.expectedInventoryValueCents !== toInventoryCents(current.inventoryValue) ||
    line.expectedCogsValueCents !== toInventoryCents(current.cogsValue) ||
    line.unitCostSnapshot !== current.initialCost ||
    line.cogsUnitCostSnapshot !== current.cost
  ) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'INVENTORY_COUNT_VALUE_CHANGED',
      message:
        'The count has a changed or unverified global value basis; reject it and start a fresh count',
    });
  }
}
