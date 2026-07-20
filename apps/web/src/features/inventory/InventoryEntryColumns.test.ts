/**
 * Entries column-set contract.
 *
 * Pins that the Entries table defaults to the smallest useful column set
 * (date / mode / product / counted-qty / actions) and that unit, normalized
 * quantity, cost, stock-after and notes were trimmed into the row-detail
 * Drawer. Pure-function test of the exported `getEntryColumns`.
 *
 * @module features/inventory/InventoryEntryColumns.test
 */
import { describe, expect, it, vi } from 'vitest';
import { getEntryColumns } from './inventoryEntryColumns';

describe('getEntryColumns column set', () => {
  it('renders the smallest useful set — unit / normalized / cost / stock-after / notes trimmed', () => {
    const cols = getEntryColumns(vi.fn());
    const ids = cols.map(
      col =>
        (col as { accessorKey?: string; id?: string }).accessorKey ?? (col as { id?: string }).id
    );

    expect(ids).toEqual(['createdAt', 'mode', 'productName', 'quantity', 'actions']);
    for (const trimmed of ['unitName', 'normalizedQuantity', 'cost', 'newStock', 'notes']) {
      expect(ids).not.toContain(trimmed);
    }
  });
});
