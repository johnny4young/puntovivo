import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const historyMocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  table: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    sales: {
      list: {
        useQuery: (...args: unknown[]) => historyMocks.useQuery(...args),
      },
    },
  },
}));

vi.mock('@/features/sales/SalesHistoryTable', () => ({
  SalesHistoryTable: (props: Record<string, unknown>) => {
    historyMocks.table(props);
    return (
      <button type="button" data-testid="history-retry" onClick={props.onRetry as () => void}>
        Retry
      </button>
    );
  },
}));

import { SalesHistoryDrawerContent } from '@/features/sales/SalesHistoryDrawerContent';

describe('SalesHistoryDrawerContent', () => {
  beforeEach(() => {
    historyMocks.useQuery.mockReset();
    historyMocks.table.mockReset();
    historyMocks.refetch.mockReset();
  });

  it('loads history only when the drawer content mounts and forwards the result', () => {
    const onView = vi.fn();
    historyMocks.useQuery.mockReturnValue({
      data: { items: [{ id: 'sale-1' }] },
      isLoading: false,
      error: null,
      refetch: historyMocks.refetch,
    });

    render(<SalesHistoryDrawerContent onView={onView} />);

    expect(historyMocks.useQuery).toHaveBeenCalledWith(
      { page: 1, perPage: 50 },
      { placeholderData: expect.any(Function) }
    );
    expect(historyMocks.table).toHaveBeenCalledWith(
      expect.objectContaining({
        sales: [{ id: 'sale-1' }],
        isLoading: false,
        error: null,
        onView,
      })
    );
  });

  it('forwards query errors and retries through the query observer', () => {
    historyMocks.useQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('history unavailable'),
      refetch: historyMocks.refetch,
    });

    render(<SalesHistoryDrawerContent onView={vi.fn()} />);
    fireEvent.click(screen.getByTestId('history-retry'));

    expect(historyMocks.table).toHaveBeenCalledWith(
      expect.objectContaining({
        sales: [],
        error: 'history unavailable',
      })
    );
    expect(historyMocks.refetch).toHaveBeenCalledTimes(1);
  });
});
