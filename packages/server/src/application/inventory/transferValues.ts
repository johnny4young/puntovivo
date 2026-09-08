/** Frozen transfer amounts travel separately from mutable catalog costs and site quantities. */
import { inventoryValueGuard } from '../../services/inventory-value-errors.js';
import {
  allocateInventoryValue,
  fromInventoryCents,
  toInventoryCents,
} from '../../services/inventory-valuation.js';
import type { InventoryValueDelta } from '../../services/product-valuation.js';

/** Decode a legacy-null pair or an authoritative non-negative pair, never a partial snapshot. */
export function transferValue(
  inventoryCents: number | null,
  cogsCents: number | null
): InventoryValueDelta | null {
  return inventoryValueGuard(() => {
    if (inventoryCents === null && cogsCents === null) return null;
    if (inventoryCents === null || cogsCents === null || inventoryCents < 0 || cogsCents < 0)
      throw new RangeError('Incomplete transfer carrying value');
    return {
      inventoryValue: fromInventoryCents(inventoryCents),
      cogsValue: fromInventoryCents(cogsCents),
    };
  });
}

/** A declared shortage retains its missing cents; only the actual receipt is credited/restored. */
export function receivedTransferValue(
  value: InventoryValueDelta | null,
  shipped: number,
  received: number
): InventoryValueDelta | null {
  return inventoryValueGuard(() =>
    value === null
      ? null
      : {
          inventoryValue: allocateInventoryValue(value.inventoryValue, shipped, received)
            .consumedValue,
          cogsValue: allocateInventoryValue(value.cogsValue, shipped, received).consumedValue,
        }
  );
}

/** Signed movement evidence for the same physical transfer, including legitimate zero-cost stock. */
export function transferMovementValues(value: InventoryValueDelta | null, sign: 1 | -1) {
  return inventoryValueGuard(() => ({
    inventoryValueDeltaCents: value === null ? null : sign * toInventoryCents(value.inventoryValue),
    cogsValueDeltaCents: value === null ? null : sign * toInventoryCents(value.cogsValue),
  }));
}
