import type { InventoryMovement } from '@/types';

/**
 * Signed stock delta for a movement row. Sale / transfer rows infer the sign
 * from the previous→new stock direction; adjustments use the raw difference;
 * other movement types preserve their recorded signed quantity. Shared by the table cell and
 * the page-level recent-flow summary so the sign convention lives in one place.
 */
export function getMovementDelta(movement: InventoryMovement): number {
  if (movement.type === 'sale' || movement.type === 'transfer') {
    // Some rows store an outbound quantity as negative, so only the stock direction sets the sign.
    const units = Math.abs(movement.quantity);
    return movement.previousStock - movement.newStock > 0 ? -units : units;
  }
  if (movement.type === 'adjustment') {
    return movement.newStock - movement.previousStock;
  }
  return movement.quantity;
}
