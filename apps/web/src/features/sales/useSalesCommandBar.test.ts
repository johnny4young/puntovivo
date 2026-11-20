import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ProductSearchSelection } from '@/types';
import { useCartWorkspaceStore } from './useCartWorkspaceStore';
import { useQuickCreateStore } from './useQuickCreateStore';

const toast = vi.hoisted(() => ({ warning: vi.fn() }));
vi.mock('@/components/feedback/ToastProvider', () => ({ useToast: () => toast }));
vi.mock('@/lib/sound', () => ({ playScanError: vi.fn() }));
const lookup = vi.hoisted(() => ({ calls: [] as Array<[string, boolean]> }));
vi.mock('./useCommandBarCustomers', () => ({
  useCommandBarCustomers: (query: string, enabled: boolean) => {
    lookup.calls.push([query, enabled]);
    return { customers: [], isLoading: false };
  },
}));

import { useSalesCommandBar } from './useSalesCommandBar';

function selection(sellByFraction = false) {
  return {
    product: { id: 'p1', name: 'Arroz', sellByFraction },
    unit: { unitId: 'u1' },
    price: 3200,
  } as unknown as ProductSearchSelection;
}

function setup(
  overrides: { frozen?: boolean; canCreateCustomer?: boolean; query?: string } = {}
) {
  const store = useCartWorkspaceStore.getState();
  const workspaceId = overrides.frozen
    ? store.hydrateFromResumed({
        ownerKey: 'tenant-1:user-1',
        serverSaleId: 'sale-1',
        serverSaleNumber: 'V-1',
        serverCustomerId: null,
        serverCustomerName: null,
        priceTier: 1,
        label: null,
        items: [],
      })
    : store.createDraft('tenant-1:user-1');
  const addProduct = vi.fn();
  const hook = renderHook(() =>
    useSalesCommandBar({
      query: overrides.query ?? '',
      activeWorkspace: useCartWorkspaceStore.getState().workspaces[workspaceId] ?? null,
      canCreateCustomer: overrides.canCreateCustomer ?? true,
      addProduct,
    })
  );
  return { ...hook, addProduct, workspaceId };
}

beforeEach(() => {
  useCartWorkspaceStore.getState().resetAllWorkspaces();
  useQuickCreateStore.getState().reset();
  toast.warning.mockReset();
  lookup.calls = [];
});

describe('useSalesCommandBar', () => {
  it('adds one pick with the pending quantity, then goes back to single units', () => {
    const { result, addProduct } = setup();

    act(() => result.current.setPendingQuantity(4));
    act(() => result.current.selectProduct(selection()));
    expect(addProduct).toHaveBeenLastCalledWith(selection(), 4);
    expect(result.current.pendingQuantity).toBeNull();

    act(() => result.current.selectProduct(selection()));
    expect(addProduct).toHaveBeenLastCalledWith(selection(), null);
  });

  it('keeps a fractional quantity pending when the product sells whole units', () => {
    const { result, addProduct } = setup();

    act(() => result.current.setPendingQuantity(0.5));
    act(() => result.current.selectProduct(selection()));

    expect(addProduct).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledOnce();
    expect(result.current.pendingQuantity).toBe(0.5);

    act(() => result.current.selectProduct(selection(true)));
    expect(addProduct).toHaveBeenCalledWith(selection(true), 0.5);
  });

  it('attaches the customer to the active ticket and asks to create one by name', () => {
    const { result, workspaceId } = setup();

    act(() => result.current.attachCustomer?.({ id: 'c1', name: 'María' }));
    expect(useCartWorkspaceStore.getState().workspaces[workspaceId]?.customerName).toBe('María');

    act(() => result.current.createCustomer?.('Rosa'));
    expect(useQuickCreateStore.getState().requestedCreateCustomer).toEqual({ defaultName: 'Rosa' });
  });

  it('gives the product search only plain text', () => {
    expect(setup({ query: 'arroz' }).result.current.searchText).toBe('arroz');
    expect(setup({ query: '/susp' }).result.current.searchText).toBe('');
    expect(setup({ query: '@ana' }).result.current.searchText).toBe('');
  });

  it('offers no customer handlers on a frozen ticket and no create without the role', () => {
    expect(setup({ frozen: true }).result.current.attachCustomer).toBeUndefined();
    const cashier = setup({ canCreateCustomer: false }).result.current;
    expect(cashier.attachCustomer).toBeTypeOf('function');
    expect(cashier.createCustomer).toBeUndefined();
  });

  it('looks customers up only for @ text on a ticket that can take one', () => {
    setup({ query: '@ mar' });
    expect(lookup.calls.at(-1)).toEqual(['mar', true]);
    setup({ query: 'arroz' });
    expect(lookup.calls.at(-1)).toEqual(['', false]);
    setup({ query: '@ana', frozen: true });
    expect(lookup.calls.at(-1)).toEqual(['ana', false]);
  });
});
