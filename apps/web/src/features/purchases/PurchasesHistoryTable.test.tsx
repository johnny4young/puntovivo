import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { PurchasesHistoryTable } from '@/features/purchases/PurchasesHistoryTable';
import { render } from '@/test/utils';
import type { Purchase } from '@/types';

function createPurchase(overrides?: Partial<Purchase>): Purchase {
  return {
    id: 'purchase-1',
    tenantId: 'tenant-1',
    purchaseNumber: 'COM-000001',
    providerId: 'provider-1',
    providerName: 'Inbound Supply Co',
    siteId: 'site-1',
    siteName: 'Main Warehouse',
    status: 'completed',
    subtotal: 48,
    total: 48,
    createdBy: 'user-1',
    createdAt: '2026-04-10T10:00:00.000Z',
    updatedAt: '2026-04-10T10:00:00.000Z',
    ...overrides,
  };
}

describe('PurchasesHistoryTable', () => {
  it('shows a quick return action only for returnable purchases', async () => {
    const user = userEvent.setup();
    const onView = vi.fn();
    const onReturn = vi.fn();

    render(
      <PurchasesHistoryTable
        purchases={[
          createPurchase(),
          createPurchase({
            id: 'purchase-2',
            purchaseNumber: 'COM-000002',
            status: 'returned',
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        canManageReturns
        onView={onView}
        onReturn={onReturn}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Return items for COM-000001' }));
    expect(onReturn).toHaveBeenCalledWith('purchase-1');

    expect(
      screen.queryByRole('button', { name: 'Return items for COM-000002' })
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View COM-000001' }));
    expect(onView).toHaveBeenCalledWith('purchase-1');
  });
});
