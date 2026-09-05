import { screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';

import { render } from '@/test/utils';
import { PurchaseDetailsModal } from './PurchaseDetailsModal';

const { purchaseQueryOptions, purchaseQueryState } = vi.hoisted(() => ({
  purchaseQueryOptions: {
    value: undefined as { enabled?: boolean; staleTime?: number } | undefined,
  },
  purchaseQueryState: {
    value: {
      data: undefined as unknown,
      isLoading: false,
      isFetching: false,
      error: null as unknown,
    },
  },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { role: 'manager' } }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => ({ isPending: false, mutateAsync: vi.fn(), mutate: vi.fn() }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({}),
    purchases: {
      getById: {
        useQuery: (
          _input: unknown,
          options: { enabled?: boolean; staleTime?: number } | undefined
        ) => {
          purchaseQueryOptions.value = options;
          return purchaseQueryState.value;
        },
      },
    },
  },
}));

describe('PurchaseDetailsModal query freshness', () => {
  beforeAll(async () => i18next.changeLanguage('en'));

  it('hides internal transport diagnostics behind neutral operator copy', () => {
    purchaseQueryState.value = {
      data: {
        id: 'purchase-1',
        purchaseNumber: 'COM-STALE',
        status: 'completed',
        items: [{ returnableQuantity: 4 }],
      },
      isLoading: false,
      isFetching: false,
      error: {
        message: 'SQLITE_ERROR: no such column purchase_item_lots.secret',
        data: { code: 'INTERNAL_SERVER_ERROR' },
      },
    };

    render(<PurchaseDetailsModal purchaseId="purchase-1" isOpen onClose={vi.fn()} />);

    expect(purchaseQueryOptions.value).toEqual({ enabled: true, staleTime: 0 });
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
    expect(screen.queryByText('COM-STALE')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Return Items' })).not.toBeInTheDocument();
    expect(screen.queryByText(/SQLITE_ERROR|purchase_item_lots\.secret/)).not.toBeInTheDocument();
  });

  it('does not expose cached return controls while the current record refetches', () => {
    purchaseQueryState.value = {
      data: {
        id: 'purchase-1',
        purchaseNumber: 'COM-CACHED',
        status: 'completed',
        items: [{ returnableQuantity: 4 }],
      },
      isLoading: false,
      isFetching: true,
      error: null,
    };

    render(<PurchaseDetailsModal purchaseId="purchase-1" isOpen onClose={vi.fn()} />);

    expect(screen.getByText('Loading purchase details...')).toBeInTheDocument();
    expect(screen.queryByText('COM-CACHED')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Return Items' })).not.toBeInTheDocument();
  });
});
