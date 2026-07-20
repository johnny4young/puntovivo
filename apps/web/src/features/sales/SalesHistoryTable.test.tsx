import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SalesHistoryTable } from '@/features/sales/SalesHistoryTable';
import type { Sale } from '@/types';

const sale: Sale = {
  id: 'sale-1',
  tenantId: 'tenant-1',
  saleNumber: 'VTA-000001',
  customerId: null,
  customerName: null,
  subtotal: 100,
  taxAmount: 19,
  total: 119,
  paymentMethod: 'cash',
  paymentStatus: 'refunded',
  status: 'voided',
  discountAmount: 0,
  notes: null,
  createdBy: 'user-1',
  createdAt: '2026-04-13T22:00:00.000Z',
  updatedAt: '2026-04-13T22:00:00.000Z',
  items: [],
};

describe('SalesHistoryTable', () => {
  it('renders translated payment and sale statuses', () => {
    render(
      <SalesHistoryTable
        sales={[sale]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        onView={vi.fn()}
      />
    );

    expect(screen.getByText('Refunded')).toBeInTheDocument();
    expect(screen.getByText('Voided')).toBeInTheDocument();
  });

  it('fires onView with the sale id when Enter is pressed on a focused row', async () => {
    const user = userEvent.setup();
    const onView = vi.fn();

    render(
      <SalesHistoryTable
        sales={[sale]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        onView={onView}
      />
    );

    const row = screen.getByRole('row', { name: /VTA-000001/ });
    row.focus();
    await user.keyboard('{Enter}');

    expect(onView).toHaveBeenCalledTimes(1);
    expect(onView).toHaveBeenCalledWith('sale-1');
  });
});
