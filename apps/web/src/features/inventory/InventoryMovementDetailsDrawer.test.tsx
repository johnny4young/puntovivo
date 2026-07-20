/**
 * InventoryMovementDetailsDrawer tests.
 *
 * Pins the row-detail Drawer holding the columns trimmed off the default
 * Movements table:
 * - renders the trimmed fields (stock-after, reference, notes) + the signed
 * delta and type for the given movement;
 * - the Close footer action calls onClose;
 * - stays closed when `item` is null;
 * - no serious accessibility violations.
 *
 * @module features/inventory/InventoryMovementDetailsDrawer.test
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { InventoryMovement } from '@/types';
import { assertNoA11yViolations } from '@/test/a11y';
import { InventoryMovementDetailsDrawer } from './InventoryMovementDetailsDrawer';

const item = {
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
} as InventoryMovement;

describe('InventoryMovementDetailsDrawer', () => {
  it('renders the trimmed movement fields', () => {
    render(<InventoryMovementDetailsDrawer item={item} onClose={vi.fn()} />);

    const drawer = screen.getByTestId('inventory-movement-details-drawer');
    expect(within(drawer).getByText('COM-000001')).toBeInTheDocument(); // reference
    expect(within(drawer).getByText('Partial receipt')).toBeInTheDocument(); // notes
    expect(within(drawer).getByText('23')).toBeInTheDocument(); // stock after
    expect(within(drawer).getByText('+10')).toBeInTheDocument(); // signed delta
    expect(screen.getByRole('heading', { name: 'Arroz Diana 500g' })).toBeInTheDocument();
  });

  it('renders an em-dash for an empty reference and notes', () => {
    const bare: InventoryMovement = { ...item };
    delete (bare as Partial<InventoryMovement>).reference;
    delete (bare as Partial<InventoryMovement>).notes;
    render(<InventoryMovementDetailsDrawer item={bare} onClose={vi.fn()} />);

    const drawer = screen.getByTestId('inventory-movement-details-drawer');
    expect(within(drawer).getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('calls onClose when the Close footer action is clicked', () => {
    const onClose = vi.fn();
    render(<InventoryMovementDetailsDrawer item={item} onClose={onClose} />);

    // The footer Close button (the header X is "Close modal" / "Cerrar modal").
    fireEvent.click(screen.getByRole('button', { name: /^(close|cerrar)$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays closed when item is null', () => {
    render(<InventoryMovementDetailsDrawer item={null} onClose={vi.fn()} />);

    expect(screen.queryByTestId('inventory-movement-details-drawer')).not.toBeInTheDocument();
  });

  it('has no serious accessibility violations', async () => {
    const { baseElement } = render(
      <InventoryMovementDetailsDrawer item={item} onClose={vi.fn()} />
    );
    await assertNoA11yViolations(baseElement);
  });
});
