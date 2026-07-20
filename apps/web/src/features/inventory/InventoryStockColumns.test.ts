/**
 * Stock column-set contract.
 *
 * Pins that the Stock table defaults to the smallest useful column set
 * (name / stock / status / actions) and that min stock, sell price,
 * valuation and the updated date were trimmed into the row-detail Drawer.
 * A pure-function test of the exported `getStockColumns` — no heavy
 * InventoryPage render required.
 *
 * @module features/inventory/InventoryStockColumns.test
 */
import { describe, expect, it, vi } from 'vitest';
import { getStockColumns } from './inventoryStockColumns';

describe('getStockColumns column set', () => {
  it('renders the smallest useful set — minStock / price / valuation / updated trimmed', () => {
    const cols = getStockColumns(vi.fn(), vi.fn(), true);
    const ids = cols.map(
      col =>
        (col as { accessorKey?: string; id?: string }).accessorKey ?? (col as { id?: string }).id
    );

    expect(ids).toEqual(['name', 'stock', 'status', 'actions']);
    for (const trimmed of ['minStock', 'price', 'inventoryValue', 'updatedAt']) {
      expect(ids).not.toContain(trimmed);
    }
  });
});
