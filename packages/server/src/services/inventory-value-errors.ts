import { throwServerError } from '../lib/errorCodes.js';

/** Translate exact-arithmetic validation failures without leaking implementation errors to POS users. */
export function inventoryValueGuard<T>(
  operation: () => T,
  errorCode: 'INVENTORY_VALUE_INVALID' | 'LOT_COST_INVALID' = 'INVENTORY_VALUE_INVALID'
): T {
  try {
    return operation();
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return throwServerError({
      trpcCode: 'CONFLICT',
      errorCode,
      message: 'Inventory carrying value is outside the exact supported range',
    });
  }
}
