import { throwServerError } from '../lib/errorCodes.js';
import { inventoryValueGuard } from './inventory-value-errors.js';
import { fromInventoryCents, toInventoryCents } from './inventory-valuation.js';

/** A serial owns one whole unit; its cost must already be representable in exact cents. */
export function serialValueCents(unitCost: number): number {
  return inventoryValueGuard(() => {
    if (unitCost < 0) throw new RangeError('Serial carrying cost cannot be negative');
    return toInventoryCents(unitCost);
  });
}

/** Never reprice the returned physical identity from a mutable registry after checkout. */
export function assertSerialValueUnchanged(unitCost: number, frozenCents: number | null): void {
  if (frozenCents === null) return; // Historical sale did not freeze identity cost.
  inventoryValueGuard(() => fromInventoryCents(frozenCents));
  if (serialValueCents(unitCost) !== frozenCents) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'INVENTORY_VALUE_CHANGED',
      message: 'The serialized unit value changed after the sale reserved it',
    });
  }
}
