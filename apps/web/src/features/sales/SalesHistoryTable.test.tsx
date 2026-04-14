import { render, screen } from '@testing-library/react';
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
});
