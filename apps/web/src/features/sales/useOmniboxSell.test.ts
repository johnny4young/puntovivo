/**
 * ENG-203 — omnibox sell resolution contract.
 *
 * The hook writes straight into the cart workspace store (no SalesPage
 * mount), so the suite drives the REAL zustand store and asserts the
 * workspace mutations plus the navigation outcome per branch: exact
 * barcode hit, packaging-unit hit with overrides, miss (search prefill),
 * and the resumed-draft guard.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { NavigateFunction } from 'react-router-dom';
import { useCartWorkspaceStore } from './useCartWorkspaceStore';
import { useOmniboxSell } from './useOmniboxSell';

const lookupFetch = vi.fn();
const toastSuccess = vi.fn();

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      products: {
        lookupByBarcode: { fetch: lookupFetch },
      },
    }),
  },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-1', role: 'cashier', tenantId: 'tenant-1' } }),
}));

vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({
    currentTenant: { id: 'tenant-1' },
    currentSite: { id: 'site-1' },
  }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('@/lib/sound', () => ({
  playScanSuccess: vi.fn(),
}));

const OWNER_KEY = 'tenant-1:user-1';

function makeLookupResult(overrides: Record<string, unknown> = {}) {
  return {
    product: {
      id: 'p-1',
      name: 'Arroz Diana 500g',
      sku: 'ABR-0001',
      price: 3200,
      taxRate: 0,
      stock: 12,
      sellByFraction: false,
      fractionStep: null,
      fractionMinimum: null,
      unitAssignments: [
        {
          unitId: 'u-base',
          unitName: 'Unidad',
          unitAbbreviation: 'UND',
          equivalence: 1,
          price: 3200,
          isBase: true,
        },
        {
          unitId: 'u-case',
          unitName: 'Caja x12',
          unitAbbreviation: 'CJ',
          equivalence: 12,
          price: 36000,
          isBase: false,
        },
      ],
    },
    resolvedUnitId: null,
    suggestedPrice: null,
    suggestedQuantity: null,
    ...overrides,
  };
}

describe('useOmniboxSell (ENG-203)', () => {
  let navigate: NavigateFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    useCartWorkspaceStore.getState().resetAllWorkspaces();
    navigate = vi.fn() as unknown as NavigateFunction;
  });

  it('merges an exact barcode hit into a fresh owned workspace and lands on /sales', async () => {
    lookupFetch.mockResolvedValue(makeLookupResult());
    const { result } = renderHook(() => useOmniboxSell());

    await result.current('7702001', navigate);

    const state = useCartWorkspaceStore.getState();
    const active = state.activeId ? state.workspaces[state.activeId] : null;
    expect(active?.ownerKey).toBe(OWNER_KEY);
    expect(active?.items).toHaveLength(1);
    expect(active?.items[0]).toMatchObject({
      productId: 'p-1',
      unitId: 'u-base',
      quantity: 1,
      unitPrice: 3200,
    });
    expect(active?.selectedItemKey).toBe('p-1:u-base');
    expect(toastSuccess).toHaveBeenCalledWith({
      title: expect.stringContaining('Arroz Diana 500g'),
    });
    expect(navigate).toHaveBeenCalledWith('/sales');
  });

  it('selects the packaging unit and applies label overrides on a packaging hit', async () => {
    lookupFetch.mockResolvedValue(
      makeLookupResult({ resolvedUnitId: 'u-case', suggestedQuantity: 2 })
    );
    const { result } = renderHook(() => useOmniboxSell());

    await result.current('CASE-CODE', navigate);

    const state = useCartWorkspaceStore.getState();
    const active = state.activeId ? state.workspaces[state.activeId] : null;
    expect(active?.items[0]).toMatchObject({
      unitId: 'u-case',
      unitEquivalence: 12,
      unitPrice: 36000,
      quantity: 2,
    });
  });

  it('lands on /sales with the search prefill when nothing matches', async () => {
    lookupFetch.mockResolvedValue(null);
    const { result } = renderHook(() => useOmniboxSell());

    await result.current('yogur fresa', navigate);

    expect(useCartWorkspaceStore.getState().activeId).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/sales', {
      state: { omniboxQuery: 'yogur fresa' },
    });
  });

  it('degrades a lookup failure to the search prefill instead of dead-ending', async () => {
    lookupFetch.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useOmniboxSell());

    await result.current('7702001', navigate);

    expect(navigate).toHaveBeenCalledWith('/sales', {
      state: { omniboxQuery: '7702001' },
    });
  });

  it('never writes into a resumed draft — the sale lands in a fresh workspace', async () => {
    const store = useCartWorkspaceStore.getState();
    const resumedId = store.createDraft(OWNER_KEY);
    useCartWorkspaceStore.setState(state => ({
      workspaces: {
        ...state.workspaces,
        [resumedId]: {
          ...state.workspaces[resumedId]!,
          serverSaleId: 'sale-77',
          serverSaleNumber: 'VTA-77',
        },
      },
    }));
    lookupFetch.mockResolvedValue(makeLookupResult());
    const { result } = renderHook(() => useOmniboxSell());

    await result.current('7702001', navigate);

    const state = useCartWorkspaceStore.getState();
    expect(state.workspaces[resumedId]?.items).toHaveLength(0);
    const active = state.activeId ? state.workspaces[state.activeId] : null;
    expect(active?.id).not.toBe(resumedId);
    expect(active?.items).toHaveLength(1);
  });
});
