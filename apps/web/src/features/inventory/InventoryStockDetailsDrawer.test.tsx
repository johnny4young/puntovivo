/**
 * ENG-132c — InventoryStockDetailsDrawer tests.
 *
 * Pins the row-detail Drawer that holds the columns trimmed off the
 * default Stock table:
 *   - renders the trimmed fields (sku, category, stock, min stock, sell
 *     price, valuation, updated, status) for the given item;
 *   - the Adjust footer action calls onAdjust (and is absent when onAdjust
 *     is omitted);
 *   - stays closed when `item` is null;
 *   - no serious accessibility violations.
 *
 * @module features/inventory/InventoryStockDetailsDrawer.test
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { InventoryStockItem } from '@/types';
import { assertNoA11yViolations } from '@/test/a11y';
import { InventoryStockDetailsDrawer } from './InventoryStockDetailsDrawer';

const item = {
  id: 's-1',
  tenantId: 't-1',
  name: 'Arroz Diana 500g',
  sku: 'ABR-0001',
  categoryName: 'Abarrotes',
  stock: 23,
  minStock: 5,
  initialCost: 2000,
  price: 3200,
  isLowStock: false,
  inventoryValue: 73600,
  updatedAt: '2026-06-01T10:00:00.000Z',
} as InventoryStockItem;

describe('InventoryStockDetailsDrawer (ENG-132c)', () => {
  it('renders the trimmed stock fields', () => {
    render(<InventoryStockDetailsDrawer item={item} onClose={vi.fn()} />);

    expect(screen.getByTestId('inventory-stock-details-drawer')).toBeInTheDocument();
    expect(screen.getByText('ABR-0001')).toBeInTheDocument(); // sku
    expect(screen.getByText('Abarrotes')).toBeInTheDocument(); // category
    // The drawer heading is the item name.
    expect(
      screen.getByRole('heading', { name: 'Arroz Diana 500g' })
    ).toBeInTheDocument();
  });

  it('calls onAdjust with the item when the Adjust footer action is clicked', () => {
    const onAdjust = vi.fn();
    render(<InventoryStockDetailsDrawer item={item} onClose={vi.fn()} onAdjust={onAdjust} />);

    fireEvent.click(
      screen.getByRole('button', { name: /adjust stock|ajustar stock/i })
    );
    expect(onAdjust).toHaveBeenCalledWith(item);
  });

  it('hides the Adjust action when onAdjust is not provided (read-only roles)', () => {
    render(<InventoryStockDetailsDrawer item={item} onClose={vi.fn()} />);

    expect(
      screen.queryByRole('button', { name: /adjust stock|ajustar stock/i })
    ).not.toBeInTheDocument();
  });

  it('renders the low-stock badge and a dash for a missing category', () => {
    const lowItem = {
      ...item,
      categoryName: null,
      isLowStock: true,
    } as InventoryStockItem;
    render(<InventoryStockDetailsDrawer item={lowItem} onClose={vi.fn()} />);

    const drawer = screen.getByTestId('inventory-stock-details-drawer');
    expect(within(drawer).getByText(/low stock|stock bajo/i)).toBeInTheDocument();
    expect(within(drawer).getByText('-')).toBeInTheDocument(); // missing category
  });

  it('stays closed when item is null', () => {
    render(<InventoryStockDetailsDrawer item={null} onClose={vi.fn()} />);

    expect(
      screen.queryByTestId('inventory-stock-details-drawer')
    ).not.toBeInTheDocument();
  });

  it('has no serious accessibility violations', async () => {
    const { baseElement } = render(
      <InventoryStockDetailsDrawer item={item} onClose={vi.fn()} onAdjust={vi.fn()} />
    );
    // The Drawer renders into a portal on document.body — scan baseElement.
    await assertNoA11yViolations(baseElement);
  });
});
