import { inventoryValueGuard } from '../../services/inventory-value-errors.js';
import {
  addInventoryValues,
  allocateInventoryValue,
  fromInventoryCents,
  toInventoryCents,
} from '../../services/inventory-valuation.js';
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

/** Frozen book value of a slice of a receipt line, cumulative so repeated partial returns sum exactly. */
export function frozenReceiptSlice(
  line: { inventoryValueCents: number | null; cogsValueCents: number | null; quantity: number },
  returnedBefore: number,
  quantity: number
): InventoryValueDelta | null {
  const { inventoryValueCents, cogsValueCents } = line;
  if (inventoryValueCents === null || cogsValueCents === null || line.quantity <= 0) return null;
  return inventoryValueGuard(() => {
    const before = Math.min(returnedBefore, line.quantity);
    const after = Math.min(before + quantity, line.quantity);
    const share = (cents: number) => {
      const value = fromInventoryCents(cents);
      const consumed = (upTo: number) =>
        upTo <= 0 ? 0 : allocateInventoryValue(value, line.quantity, upTo).consumedValue;
      return addInventoryValues(consumed(after), -consumed(before));
    };
    return { inventoryValue: share(inventoryValueCents), cogsValue: share(cogsValueCents) };
  });
}
