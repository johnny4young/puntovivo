import { act, fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/test/utils';
import { InventoryPage } from './InventoryPage';

const {
  authState,
  currentSiteState,
  listMovementsUseQuery,
  pharmacyContextUseQuery,
  criticalMutationUse,
} = vi.hoisted(() => ({
  authState: {
    value: {
      user: { role: 'admin' },
      tenant: { settings: { businessType: 'retail' } },
    },
  },
  currentSiteState: {
    value: { id: 'site-main', name: 'Main Store' } as { id: string; name: string } | null,
  },
  listMovementsUseQuery: vi.fn(),
  pharmacyContextUseQuery: vi.fn(),
  criticalMutationUse: vi.fn(),
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
  useAuth: () => authState.value,
}));

vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({ currentSite: currentSiteState.value }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (path: string) => {
    criticalMutationUse(path);
    return mutation;
  },
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
    pharmacy: { context: { useQuery: pharmacyContextUseQuery } },
  },
}));

vi.mock('@/features/inventory/InventoryHeader', () => ({
  InventoryHeader: ({
    showPharmacy,
    onViewChange,
  }: {
    showPharmacy: boolean;
    onViewChange: (view: 'pharmacy') => void;
  }) =>
    showPharmacy ? (
      <button type="button" onClick={() => onViewChange('pharmacy')}>
        Pharmacy safety
      </button>
    ) : null,
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
vi.mock('@/features/inventory/PharmacyOperationsPanel', () => ({
  PharmacyOperationsPanel: () => <div>Pharmacy operations loaded</div>,
}));

describe('InventoryPage movement site scope', () => {
  beforeEach(() => {
    authState.value = {
      user: { role: 'admin' },
      tenant: { settings: { businessType: 'retail' } },
    };
    currentSiteState.value = { id: 'site-main', name: 'Main Store' };
    listMovementsUseQuery.mockReset();
    listMovementsUseQuery.mockReturnValue(emptyQuery);
    pharmacyContextUseQuery.mockReset();
    pharmacyContextUseQuery.mockReturnValue({
      data: { hasOperationalData: false },
      error: null,
    });
    criticalMutationUse.mockClear();
  });

  it('keeps pharmacy safety reachable after a tenant with durable records changes preset', async () => {
    pharmacyContextUseQuery.mockReturnValue({
      data: { hasOperationalData: true },
      error: null,
    });
    await act(async () => {
      render(<InventoryPage />);
      await Promise.resolve();
    });

    expect(pharmacyContextUseQuery).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ enabled: true, staleTime: 0, refetchOnMount: 'always' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pharmacy safety' }));

    expect(await screen.findByText('Pharmacy operations loaded')).toBeVisible();
  });

  it('opens an authorized inventory view from a readiness deep link', async () => {
    authState.value = {
      user: { role: 'admin' },
      tenant: { settings: { businessType: 'pharmacy' } },
    };
    await act(async () => {
      render(<InventoryPage />, { initialEntries: ['/inventory?view=pharmacy'] });
      await Promise.resolve();
    });

    expect(await screen.findByText('Pharmacy operations loaded')).toBeVisible();
  });

  it('does not treat a failed pharmacy relevance probe as proof that no recovery UI is needed', async () => {
    pharmacyContextUseQuery.mockReturnValue({
      data: undefined,
      error: new Error('context unavailable'),
    });
    await act(async () => {
      render(<InventoryPage />);
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: 'Pharmacy safety' })).toBeVisible();
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
    expect(criticalMutationUse).toHaveBeenCalledWith('inventoryLots.receive');

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
