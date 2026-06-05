import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { OrdersHistoryTable } from '@/features/orders/OrdersHistoryTable';
import { render } from '@/test/utils';
import type { Order } from '@/types';

function createOrder(overrides?: Partial<Order>): Order {
  return {
    id: 'order-1',
    tenantId: 'tenant-1',
    orderNumber: 'PED-000001',
    providerId: 'provider-1',
    providerName: 'Supplier Co',
    siteId: 'site-1',
    siteName: 'Main Site',
    status: 'submitted',
    subtotal: 60,
    total: 60,
    linkedPurchaseCount: 0,
    receivedPurchaseNumber: null,
    createdBy: 'user-1',
    createdAt: '2026-04-10T10:00:00.000Z',
    updatedAt: '2026-04-10T10:00:00.000Z',
    ...overrides,
  };
}

describe('OrdersHistoryTable', () => {
  it('exposes a status-gated quick receive action and a view action', async () => {
    const user = userEvent.setup();
    const onView = vi.fn();
    const onReceive = vi.fn();

    render(
      <OrdersHistoryTable
        orders={[
          createOrder({
            linkedPurchaseCount: 2,
            status: 'partial_received',
            receivedPurchaseNumber: 'COM-000015',
          }),
          createOrder({
            id: 'order-2',
            orderNumber: 'PED-000002',
            status: 'received',
            linkedPurchaseCount: 1,
            receivedPurchaseNumber: 'COM-000016',
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        canManageReceipts
        onView={onView}
        onReceive={onReceive}
      />
    );

    // ENG-132e — receipt progress moved into the detail modal; only the
    // open order (submitted / partial_received) keeps a Receive action.
    await user.click(screen.getByRole('button', { name: 'Receive' }));
    expect(onReceive).toHaveBeenCalledWith('order-1');

    expect(screen.queryAllByRole('button', { name: 'Receive' })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'View PED-000001' }));
    expect(onView).toHaveBeenCalledWith('order-1');
  });

  it('renders the smallest useful column set — date / site / receipts trimmed (ENG-132e)', () => {
    render(
      <OrdersHistoryTable
        orders={[createOrder()]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        canManageReceipts={false}
        onView={vi.fn()}
        onReceive={vi.fn()}
      />
    );

    // Core columns stay.
    expect(screen.getByRole('columnheader', { name: 'Order #' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Provider' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Total' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();

    // Trimmed columns are gone (reachable via the View detail modal).
    expect(screen.queryByRole('columnheader', { name: 'Date' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Site' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Receipts' })).not.toBeInTheDocument();
  });

  it('fires onView with the order id when Enter is pressed on a focused row (ENG-134f)', async () => {
    const user = userEvent.setup();
    const onView = vi.fn();

    render(
      <OrdersHistoryTable
        orders={[createOrder()]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        canManageReceipts={false}
        onView={onView}
        onReceive={vi.fn()}
      />
    );

    const row = screen.getByRole('row', { name: /PED-000001/ });
    row.focus();
    await user.keyboard('{Enter}');

    expect(onView).toHaveBeenCalledTimes(1);
    expect(onView).toHaveBeenCalledWith('order-1');
  });
});
