/**
 * InventoryEntryDetailsDrawer tests.
 *
 * Pins the row-detail Drawer holding the columns trimmed off the default
 * Entries table:
 * - renders the trimmed fields (unit, normalized, cost, stock-after, notes);
 * - the Close footer action calls onClose;
 * - stays closed when `item` is null;
 * - no serious accessibility violations.
 *
 * @module features/inventory/InventoryEntryDetailsDrawer.test
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { InitialInventoryEntry } from '@/types';
import { assertNoA11yViolations } from '@/test/a11y';
import { InventoryEntryDetailsDrawer } from './InventoryEntryDetailsDrawer';

const item = {
  id: 'e-1',
  tenantId: 't-1',
  productId: 'p-1',
  unitId: 'u-1',
  mode: 'initial',
  quantity: 12,
  unitEquivalence: 1,
  normalizedQuantity: 12,
  cost: 2100,
  previousStock: 0,
  newStock: 12,
  notes: 'Initial load',
  createdBy: 'usr-1',
  createdAt: '2026-06-01T10:00:00.000Z',
  productName: 'Arroz Diana 500g',
  productSku: 'ABR-0001',
  unitName: 'Unidad',
  unitAbbreviation: 'UND',
} as InitialInventoryEntry;

describe('InventoryEntryDetailsDrawer', () => {
  it('renders the trimmed entry fields', () => {
    render(<InventoryEntryDetailsDrawer item={item} onClose={vi.fn()} />);

    const drawer = screen.getByTestId('inventory-entry-details-drawer');
    expect(within(drawer).getByText('UND')).toBeInTheDocument(); // unit abbreviation
    expect(within(drawer).getByText('Initial load')).toBeInTheDocument(); // notes
    // counted qty + normalized both render 12 -> at least two occurrences.
    expect(within(drawer).getAllByText('12').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('heading', { name: 'Arroz Diana 500g' })).toBeInTheDocument();
  });

  it('falls back to the unit name when no abbreviation is present', () => {
    const noAbbrev = { ...item, unitAbbreviation: null } as InitialInventoryEntry;
    render(<InventoryEntryDetailsDrawer item={noAbbrev} onClose={vi.fn()} />);

    expect(
      within(screen.getByTestId('inventory-entry-details-drawer')).getByText('Unidad')
    ).toBeInTheDocument();
  });

  it('calls onClose when the Close footer action is clicked', () => {
    const onClose = vi.fn();
    render(<InventoryEntryDetailsDrawer item={item} onClose={onClose} />);

    // The footer Close button (the header X is "Close modal" / "Cerrar modal").
    fireEvent.click(screen.getByRole('button', { name: /^(close|cerrar)$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays closed when item is null', () => {
    render(<InventoryEntryDetailsDrawer item={null} onClose={vi.fn()} />);

    expect(screen.queryByTestId('inventory-entry-details-drawer')).not.toBeInTheDocument();
  });

  it('has no serious accessibility violations', async () => {
    const { baseElement } = render(<InventoryEntryDetailsDrawer item={item} onClose={vi.fn()} />);
    await assertNoA11yViolations(baseElement);
  });
});
