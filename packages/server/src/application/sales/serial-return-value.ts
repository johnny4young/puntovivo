import { throwServerError } from '../../lib/errorCodes.js';
import { inventoryValueGuard } from '../../services/inventory-value-errors.js';
import {
  addInventoryValues,
  fromInventoryCents,
  toInventoryCents,
} from '../../services/inventory-valuation.js';

/** Reconcile frozen identity values before selecting the exact serials returned by the buyer. */
export function resolveSerialReturnValue(input: {
  original: Array<{ id: string; costCents: number | null }>;
  selected: Array<{ saleItemSerialId: string; costCents: number | null }>;
  prior: Map<string, number | null>;
  inventoryCostCents: number | null;
  cogsCostCents: number | null;
  priorInventoryValue: number;
  priorCogsValue: number;
  originalBaseQuantity: number;
  priorBaseQuantity: number;
}): number | null {
  if (input.original.length === 0) return null;
  if (
    input.inventoryCostCents === null &&
    input.cogsCostCents === null &&
    input.original.every(row => row.costCents === null)
  )
    return null;
  return inventoryValueGuard(() => {
    const changed = () =>
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'INVENTORY_VALUE_CHANGED',
        message: 'Serialized return cost provenance does not reconcile with the frozen sale',
      });
    const value = (costCents: number | null): number => {
      if (costCents === null || costCents < 0) return changed();
      return fromInventoryCents(costCents);
    };
    const originalValue = addInventoryValues(...input.original.map(row => value(row.costCents)));
    const returned = input.original.filter(row => input.prior.has(row.id));
    if (
      Math.abs(input.original.length - input.originalBaseQuantity) > 1e-8 ||
      Math.abs(returned.length - input.priorBaseQuantity) > 1e-8 ||
      toInventoryCents(originalValue) !== input.inventoryCostCents ||
      toInventoryCents(originalValue) !== input.cogsCostCents ||
      returned.some(row => input.prior.get(row.id) !== row.costCents)
    )
      return changed();
    const returnedValue = addInventoryValues(...returned.map(row => value(row.costCents)));
    if (returnedValue !== input.priorInventoryValue || returnedValue !== input.priorCogsValue)
      return changed();
    return addInventoryValues(...input.selected.map(row => value(row.costCents)));
  });
}
