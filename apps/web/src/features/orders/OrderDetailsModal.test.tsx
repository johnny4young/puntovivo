import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/test/utils';
import type { Order } from '@/types';
import { OrderDetailsModal } from './OrderDetailsModal';

const { invalidate, mutationCalls, orderState, useCriticalMutationMock } = vi.hoisted(() => ({
  invalidate: vi.fn().mockResolvedValue(undefined),
  mutationCalls: {} as Record<string, unknown[]>,
  orderState: { value: null as Order | null },
  useCriticalMutationMock: vi.fn(),
}));

function makeOrder(status: Order['status']): Order {
  return {
    id: 'order-1',
    tenantId: 'tenant-1',
    orderNumber: 'PED-000010',
    providerId: 'provider-1',
    providerName: 'Supplier',
    siteId: 'site-1',
    siteName: 'Main Store',
    status,
    subtotal: 28,
    total: 28,
    linkedPurchaseCount: 0,
    receivedPurchaseNumber: null,
    createdBy: 'user-1',
    createdAt: '2026-08-31T10:00:00.000Z',
    updatedAt: '2026-08-31T10:00:00.000Z',
    items: [
      {
        id: 'order-item-1',
        orderId: 'order-1',
        productId: 'product-1',
        productName: 'Rice',
        productSku: 'RICE-1',
        tracksSerials: false,
        quantity: 7,
        receivedQuantity: 0,
        remainingQuantity: 7,
        unitId: 'unit-1',
        unitName: 'Unit',
        unitAbbreviation: 'UND',
        unitEquivalence: 1,
        costPerUnit: 4,
        baseUnitCost: 4,
        total: 28,
      },
    ],
  };
}

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { role: 'manager' } }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: useCriticalMutationMock,
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      orders: { list: { invalidate }, getById: { invalidate } },
      purchases: { list: { invalidate }, getById: { invalidate } },
      inventory: {
        listMovements: { invalidate },
        listBalancesBySite: { invalidate },
        listStock: { invalidate },
      },
      products: { list: { invalidate }, search: { invalidate } },
      productSerials: { list: { invalidate }, lookup: { invalidate } },
    }),
    orders: {
      getById: {
        useQuery: () => ({ data: orderState.value, isLoading: false, error: null }),
      },
    },
  },
}));

describe('OrderDetailsModal draft lifecycle', () => {
  beforeEach(() => {
    for (const key of Object.keys(mutationCalls)) delete mutationCalls[key];
    invalidate.mockClear();
    useCriticalMutationMock.mockImplementation(
      (key: string, options?: { onSuccess?: (data: unknown) => void | Promise<void> }) => {
        mutationCalls[key] ??= [];
        const mutateAsync = vi.fn(async (input: unknown) => {
          mutationCalls[key]!.push(input);
          await options?.onSuccess?.(
            key === 'orders.submitDraft' ? { ...orderState.value, status: 'submitted' } : input
          );
          return input;
        });
        return { isPending: false, mutateAsync, mutate: vi.fn() };
      }
    );
  });

  it('labels a draft as estimated and requires confirmation before submission', async () => {
    const user = userEvent.setup();
    orderState.value = makeOrder('draft');
    render(<OrderDetailsModal orderId="order-1" isOpen onClose={vi.fn()} />);

    expect(screen.getByText('Estimated Draft Total')).toBeInTheDocument();
    expect(
      screen.getByText(
        'This draft has not been submitted to the supplier and cannot be received yet.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Receive Items' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Submit draft' }));
    const confirmation = screen.getByRole('dialog', { name: 'Submit purchase-order draft' });
    expect(
      within(confirmation).getByText(
        /enables receiving.*Stock still changes only when goods are received/
      )
    ).toBeInTheDocument();
    await user.click(within(confirmation).getByRole('button', { name: 'Submit draft' }));

    await waitFor(() => expect(mutationCalls['orders.submitDraft']).toEqual([{ id: 'order-1' }]));
  });

  it('lets a manager explicitly discard an abandoned draft without presenting it as a stock action', async () => {
    const user = userEvent.setup();
    orderState.value = makeOrder('draft');
    render(<OrderDetailsModal orderId="order-1" isOpen onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Discard draft' }));
    const confirmation = screen.getByRole('dialog', {
      name: 'Discard purchase-order draft',
    });
    expect(
      within(confirmation).getByText(/does not change stock or contact the supplier/)
    ).toBeInTheDocument();
    await user.click(within(confirmation).getByRole('button', { name: 'Discard draft' }));

    await waitFor(() => expect(mutationCalls['orders.void']).toEqual([{ id: 'order-1' }]));
  });

  it('offers receiving only after the order has been submitted', () => {
    orderState.value = makeOrder('submitted');
    render(<OrderDetailsModal orderId="order-1" isOpen onClose={vi.fn()} />);

    expect(screen.getByText('Committed Total')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Receive Items' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit draft' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard draft' })).not.toBeInTheDocument();
  });
});
