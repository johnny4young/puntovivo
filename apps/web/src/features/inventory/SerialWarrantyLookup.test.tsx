import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import i18n from '@/i18n';
import { render } from '@/test/utils';
import { SerialWarrantyLookup } from './SerialWarrantyLookup';

const queryState = {
  data: {
    items: [
      {
        id: 'serial-1',
        serialNumber: 'SN-001',
        status: 'returned',
        currentSiteId: 'site-1',
        currentSiteName: 'Main site',
        receivedAt: '2026-07-16T10:00:00.000Z',
        soldAt: '2026-07-16T11:00:00.000Z',
        returnedAt: '2026-07-16T12:00:00.000Z',
        warrantyExpiresAt: '2028-12-31',
        productId: 'product-1',
        productName: 'Laptop',
        productSku: 'LAP-001',
        saleId: null,
        saleNumber: null,
        customerId: null,
        customerName: null,
        history: [
          {
            saleItemSerialId: 'history-1',
            saleItemId: 'line-1',
            saleId: 'sale-1',
            saleNumber: 'VTA-000123',
            saleStatus: 'completed',
            paymentStatus: 'refunded',
            customerId: 'customer-1',
            customerName: 'Ana Torres',
            soldAt: '2026-07-16T11:00:00.000Z',
          },
          {
            saleItemSerialId: 'history-2',
            saleItemId: 'line-2',
            saleId: 'sale-2',
            saleNumber: 'VTA-000124',
            saleStatus: 'cancelled',
            paymentStatus: 'pending',
            customerId: 'customer-2',
            customerName: 'Wrong Draft Customer',
            soldAt: '2026-07-16T13:00:00.000Z',
          },
        ],
      },
    ],
  },
  isLoading: false,
};

vi.mock('@/lib/trpc', () => ({
  trpc: {
    productSerials: {
      lookup: { useQuery: () => queryState },
    },
  },
}));

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('SerialWarrantyLookup (ENG-110c)', () => {
  it('keeps the latest historical sale visible after a return clears the current pointer', async () => {
    const user = userEvent.setup();
    render(<SerialWarrantyLookup />);

    await user.type(screen.getByLabelText('Serial number'), 'sn-001');
    await user.click(screen.getByRole('button', { name: 'Look up' }));

    expect(screen.getByText('Laptop')).toBeVisible();
    expect(screen.getByText('Returned')).toBeVisible();
    expect(screen.getByText('VTA-000123')).toBeVisible();
    expect(screen.getByText('Ana Torres')).toBeVisible();
    expect(screen.queryByText('VTA-000124')).not.toBeInTheDocument();
    expect(screen.queryByText('Wrong Draft Customer')).not.toBeInTheDocument();
    expect(screen.getByText('2028-12-31')).toBeVisible();
  });
});
