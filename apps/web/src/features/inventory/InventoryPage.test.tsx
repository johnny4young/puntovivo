import { act, fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/test/utils';
import { InventoryPage } from './InventoryPage';

const { currentSiteState, listMovementsUseQuery } = vi.hoisted(() => ({
  currentSiteState: {
    value: { id: 'site-main', name: 'Main Store' } as { id: string; name: string } | null,
  },
  listMovementsUseQuery: vi.fn(),
}));

const emptyQuery = {
  data: { items: [], summary: undefined },
  error: null,
  isLoading: false,
  refetch: vi.fn(),
};

const mutation = {
  error: null,
  isPending: false,
  mutateAsync: vi.fn(),
  reset: vi.fn(),
};

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { role: 'admin' } }),
}));

vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({ currentSite: currentSiteState.value }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => mutation,
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      inventory: {
        listMovements: { invalidate: vi.fn() },
        listStock: { invalidate: vi.fn() },
        listEntries: { invalidate: vi.fn() },
        listBalancesBySite: { invalidate: vi.fn() },
      },
      products: { list: { invalidate: vi.fn() }, search: { invalidate: vi.fn() } },
      inventoryLots: {
        list: { invalidate: vi.fn() },
        expiring: { invalidate: vi.fn() },
      },
      productSerials: { list: { invalidate: vi.fn() }, lookup: { invalidate: vi.fn() } },
    }),
    categories: { tree: { useQuery: () => emptyQuery } },
    sites: { list: { useQuery: () => emptyQuery } },
    inventory: {
      listMovements: { useQuery: listMovementsUseQuery },
      listStock: { useQuery: () => emptyQuery },
      listEntries: { useQuery: () => emptyQuery },
      recordEntry: { useMutation: () => mutation },
    },
    inventoryLots: { receive: { useMutation: () => mutation } },
    productSerials: { receive: { useMutation: () => mutation } },
  },
}));

vi.mock('@/features/inventory/InventoryHeader', () => ({
  InventoryHeader: () => null,
}));
vi.mock('@/features/inventory/InventorySummaryCards', () => ({
  InventorySummaryCards: () => null,
}));
vi.mock('@/features/inventory/InventoryDataPanel', () => ({
  InventoryDataPanel: ({ movementFilters }: { movementFilters: ReactNode }) => (
    <div>{movementFilters}</div>
  ),
}));
vi.mock('@/features/inventory/SerialWarrantyLookup', () => ({
  SerialWarrantyLookup: () => null,
}));
vi.mock('@/components/dialogs/ProductSearchDialog', () => ({
  ProductSearchDialog: () => null,
}));
vi.mock('@/features/inventory/InventoryAdjustmentModal', () => ({
  InventoryAdjustmentModal: () => null,
}));
vi.mock('@/features/inventory/InventoryStockDetailsDrawer', () => ({
  InventoryStockDetailsDrawer: () => null,
}));
vi.mock('@/features/inventory/InventoryMovementDetailsDrawer', () => ({
  InventoryMovementDetailsDrawer: () => null,
}));
vi.mock('@/features/inventory/InventoryEntryDetailsDrawer', () => ({
  InventoryEntryDetailsDrawer: () => null,
}));

describe('InventoryPage movement site scope', () => {
  beforeEach(() => {
    currentSiteState.value = { id: 'site-main', name: 'Main Store' };
    listMovementsUseQuery.mockReset();
    listMovementsUseQuery.mockReturnValue(emptyQuery);
  });

  it('starts at the current site and can expose all sites plus unattributed history', async () => {
    await act(async () => {
      render(<InventoryPage />);
      await Promise.resolve();
    });

    expect(listMovementsUseQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ siteId: 'site-main' }),
      expect.objectContaining({ enabled: true })
    );

    const selector = screen.getByRole('combobox', { name: /movement site/i });
    expect(selector).toHaveValue('current');
    expect(screen.getByRole('option', { name: /current site.*main store/i })).toBeInTheDocument();

    fireEvent.change(selector, { target: { value: 'all' } });

    expect(listMovementsUseQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ siteId: undefined }),
      expect.objectContaining({ enabled: true })
    );
    expect(selector).toHaveValue('all');
  });

  it('falls back to all-site history when no current site is configured', async () => {
    currentSiteState.value = null;
    await act(async () => {
      render(<InventoryPage />);
      await Promise.resolve();
    });

    expect(listMovementsUseQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ siteId: undefined }),
      expect.objectContaining({ enabled: true })
    );
    expect(screen.getByRole('combobox', { name: /movement site/i })).toHaveValue('all');
  });
});
