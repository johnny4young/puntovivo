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
          createPurchase({
            status: 'partial_returned',
            returnedAmount: 18,
            returnedAt: '2026-04-10T11:00:00.000Z',
            returnCount: 1,
            latestReturnReason: 'Damaged boxes',
            latestReturnCreatedByName: 'Admin User',
          }),
          createPurchase({
            id: 'purchase-2',
            purchaseNumber: 'COM-000002',
            status: 'returned',
            returnedAmount: 48,
            latestReturnCreatedByName: 'Manager User',
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

    // ENG-132f — return progress (count / amount / reason / creator) moved into
    // the detail modal; only the returnable order (completed / partial_returned)
    // keeps a Return action.
    await user.click(screen.getByRole('button', { name: 'Return items for COM-000001' }));
    expect(onReturn).toHaveBeenCalledWith('purchase-1');

    expect(
      screen.queryByRole('button', { name: 'Return items for COM-000002' })
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View COM-000001' }));
    expect(onView).toHaveBeenCalledWith('purchase-1');
  });

  it('renders the smallest useful column set — date / site / returns trimmed (ENG-132f)', () => {
    render(
      <PurchasesHistoryTable
        purchases={[createPurchase()]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        canManageReturns={false}
        onView={vi.fn()}
        onReturn={vi.fn()}
      />
    );

    // Core columns stay.
    expect(screen.getByRole('columnheader', { name: 'Purchase #' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Provider' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Total' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();

    // Trimmed columns are gone (reachable via the View detail modal).
    expect(screen.queryByRole('columnheader', { name: 'Date' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Site' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Returns' })).not.toBeInTheDocument();
  });

  it('fires onView with the purchase id when Enter is pressed on a focused row (ENG-134f)', async () => {
    const user = userEvent.setup();
    const onView = vi.fn();

    render(
      <PurchasesHistoryTable
        purchases={[createPurchase()]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        canManageReturns={false}
        onView={onView}
        onReturn={vi.fn()}
      />
    );

    const row = screen.getByRole('row', { name: /COM-000001/ });
    row.focus();
    await user.keyboard('{Enter}');

    expect(onView).toHaveBeenCalledTimes(1);
    expect(onView).toHaveBeenCalledWith('purchase-1');
  });
});
