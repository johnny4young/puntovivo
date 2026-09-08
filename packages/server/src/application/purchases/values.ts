import { inventoryValueGuard } from '../../services/inventory-value-errors.js';
import { fromInventoryCents, toInventoryCents } from '../../services/inventory-valuation.js';
import type { InventoryValueDelta } from '../../services/product-valuation.js';

/** Book value is frozen independently from the supplier invoice/refund amount. */
export function freezePurchaseValue(value: InventoryValueDelta | null, direction: 1 | -1) {
  return inventoryValueGuard(() => {
    if (!value) throw new RangeError('Purchase stock mutation has no value evidence');
    const inventoryValueCents = direction * toInventoryCents(value.inventoryValue) || 0;
    const cogsValueCents = direction * toInventoryCents(value.cogsValue) || 0;
    if (inventoryValueCents < 0 || cogsValueCents < 0) {
      throw new RangeError('Purchase value evidence has the wrong direction');
    }
    return { inventoryValueCents, cogsValueCents };
  });
}

/** Unknown historical receipts keep their conservative original-cost restriction. */
export function hasExactPurchaseLotValue(value: number | null): boolean {
  if (value === null) return false;
  return inventoryValueGuard(() => {
    if (fromInventoryCents(value) < 0) throw new RangeError('Receipt value cannot be negative');
    return true;
  });
}
