/**
 * Movements column-set + delta contract.
 *
 * Pins that the Movements table defaults to the smallest useful column set
 * (date / product / delta / type / actions) and that stock-after, reference
 * and notes were trimmed into the row-detail Drawer. Also pins the signed-delta
 * convention shared by the table cell and the page recent-flow summary. Pure
 * functions — no heavy InventoryPage render required.
 *
 * @module features/inventory/InventoryMovementColumns.test
 */
import { describe, expect, it, vi } from 'vitest';
import type { InventoryMovement } from '@/types';
import { getMovementColumns, isFutureDated } from './inventoryMovementColumns';
import { getMovementDelta } from './inventoryMovementDelta';

function makeMovement(overrides?: Partial<InventoryMovement>): InventoryMovement {
  return {
    id: 'm-1',
    tenantId: 't-1',
    productId: 'p-1',
    productName: 'Arroz Diana 500g',
    productSku: 'ABR-0001',
    categoryName: 'Abarrotes',
    type: 'purchase',
    quantity: 10,
    previousStock: 13,
    newStock: 23,
    reference: 'COM-000001',
    notes: 'Partial receipt',
    createdBy: 'u-1',
    createdAt: '2026-06-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('getMovementColumns column set', () => {
  it('renders the smallest useful set — stock-after / reference / notes trimmed', () => {
    const cols = getMovementColumns(vi.fn());
    const ids = cols.map(
      col =>
        (col as { accessorKey?: string; id?: string }).accessorKey ?? (col as { id?: string }).id
    );

    expect(ids).toEqual(['createdAt', 'productName', 'delta', 'type', 'actions']);
    for (const trimmed of ['newStock', 'reference', 'notes']) {
      expect(ids).not.toContain(trimmed);
    }
  });
});

describe('getMovementDelta sign convention', () => {
  it('treats a purchase as a positive inbound quantity', () => {
    expect(getMovementDelta(makeMovement({ type: 'purchase', quantity: 10 }))).toBe(10);
  });

  it('infers a negative delta for a sale that lowered stock', () => {
    expect(
      getMovementDelta(makeMovement({ type: 'sale', quantity: 4, previousStock: 23, newStock: 19 }))
    ).toBe(-4);
  });

  it('keeps outbound rows negative when their quantity is stored as negative', () => {
    expect(
      getMovementDelta(
        makeMovement({ type: 'transfer', quantity: -6, previousStock: 20, newStock: 14 })
      )
    ).toBe(-6);
    expect(
      getMovementDelta(makeMovement({ type: 'sale', quantity: -1, previousStock: 5, newStock: 4 }))
    ).toBe(-1);
  });

  it('flags only movements dated after now', () => {
    const now = Date.parse('2026-10-17T12:00:00.000Z');
    expect(isFutureDated('2026-10-21T12:57:00.000Z', now)).toBe(true);
    expect(isFutureDated('2026-10-17T11:59:00.000Z', now)).toBe(false);
    expect(isFutureDated('not a date', now)).toBe(false);
  });

  it('uses the raw difference for an adjustment', () => {
    expect(
      getMovementDelta(
        makeMovement({ type: 'adjustment', quantity: 0, previousStock: 23, newStock: 20 })
      )
    ).toBe(-3);
  });
});
