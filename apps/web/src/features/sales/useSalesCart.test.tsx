import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaleCartItem } from './saleCart';
import { useCartWorkspaceStore } from './useCartWorkspaceStore';
import { useSalesCart } from './useSalesCart';

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

function sampleItem(overrides: Partial<SaleCartItem> = {}): SaleCartItem {
  return {
    key: 'product-1:unit-1',
    productId: 'product-1',
    productName: 'Serialized Product',
    productSku: 'SER-1',
    unitId: 'unit-1',
    unitName: 'Unit',
    unitEquivalence: 1,
    quantity: 1,
    unitPrice: 100,
    discount: 0,
    taxRate: 0,
    availableStock: 4,
    sellByFraction: false,
    fractionStep: null,
    fractionMinimum: null,
    ...overrides,
  };
}

function renderSalesCart() {
  return renderHook(() =>
    useSalesCart({
      ownerKey: 'tenant-1:user-1',
      setProductSearchQuery: vi.fn(),
      setSaleError: vi.fn(),
    })
  );
}

describe('useSalesCart clear cart', () => {
  beforeEach(() => {
    useCartWorkspaceStore.getState().resetAllWorkspaces();
    localStorage.clear();
  });

  it('returns the ticket to a walk-in customer', async () => {
    const { result } = renderSalesCart();
    await waitFor(() => expect(result.current.activeWorkspace).not.toBeNull());
    const id = result.current.activeWorkspace!.id;
    act(() => useCartWorkspaceStore.getState().setCustomer(id, { id: 'c1', name: 'María' }));

    act(() => result.current.handleClearCart());

    expect(useCartWorkspaceStore.getState().workspaces[id]).toMatchObject({
      customerId: null,
      customerName: null,
    });
  });

  it('drops the delivery mark once the ticket is emptied', async () => {
    const { result } = renderSalesCart();
    await waitFor(() => expect(result.current.activeWorkspace).not.toBeNull());
    const id = result.current.activeWorkspace!.id;
    act(() => result.current.setCartItems([sampleItem()]));
    act(() => useCartWorkspaceStore.getState().setDeliveryRequested(id, true));

    act(() => result.current.handleRemoveItem('product-1:unit-1'));
    expect(useCartWorkspaceStore.getState().workspaces[id]?.deliveryRequested).toBe(false);

    act(() => result.current.setCartItems([sampleItem()]));
    act(() => useCartWorkspaceStore.getState().setDeliveryRequested(id, true));
    act(() => result.current.handleClearCart());
    expect(useCartWorkspaceStore.getState().workspaces[id]?.deliveryRequested).toBe(false);
  });
});

describe('useSalesCart locked-workspace mutations', () => {
  beforeEach(() => {
    useCartWorkspaceStore.getState().resetAllWorkspaces();
    localStorage.clear();
  });

  it('rejects its public cart setter for a resumed server draft', async () => {
    const hook = renderSalesCart();
    await waitFor(() => expect(useCartWorkspaceStore.getState().activeId).not.toBeNull());
    let resumedId = '';
    act(() => {
      resumedId = useCartWorkspaceStore.getState().hydrateFromResumed({
        ownerKey: 'tenant-1:user-1',
        serverSaleId: 'sale-1',
        serverSaleNumber: 'VTA-1',
        serverCustomerId: null,
        serverCustomerName: null,
        priceTier: 1,
        label: null,
        items: [sampleItem()],
      });
    });

    act(() => hook.result.current.setCartItems([]));

    expect(useCartWorkspaceStore.getState().workspaces[resumedId]?.items).toEqual([sampleItem()]);
  });

  it('freezes quotation terms while allowing only physical serial selection', async () => {
    const hook = renderSalesCart();
    await waitFor(() => expect(useCartWorkspaceStore.getState().activeId).not.toBeNull());
    const quotationLine = sampleItem({
      tracksSerials: true,
      serialIds: [],
      sourceQuotationItemId: 'quote-line-1',
    });
    let quotationWorkspaceId = '';
    act(() => {
      quotationWorkspaceId = useCartWorkspaceStore.getState().hydrateFromQuotation({
        ownerKey: 'tenant-1:user-1',
        quotationId: 'quote-1',
        quotationNumber: 'COT-1',
        siteId: 'site-1',
        customerId: null,
        customerName: null,
        priceTier: 1,
        items: [quotationLine],
      });
    });

    act(() => hook.result.current.setCartItems(items => [{ ...items[0]!, quantity: 9 }]));
    expect(
      useCartWorkspaceStore.getState().workspaces[quotationWorkspaceId]?.items[0]?.quantity
    ).toBe(1);

    act(() =>
      hook.result.current.handleSerialSelectionChange(quotationLine.key, ['serial-1'], 'site-1')
    );
    expect(
      useCartWorkspaceStore.getState().workspaces[quotationWorkspaceId]?.items[0]
    ).toMatchObject({ quantity: 1, serialIds: ['serial-1'], serialSiteId: 'site-1' });
  });
});

describe('useSalesCart unit change', () => {
  beforeEach(() => {
    useCartWorkspaceStore.getState().resetAllWorkspaces();
    localStorage.clear();
  });

  const units = [
    { unitId: 'unit-1', unitName: 'Unit', equivalence: 1, price: 100, isBase: true },
    { unitId: 'box', unitName: 'Box', equivalence: 10, price: 900, isBase: false },
  ];

  it('moves the line to the new unit and selects it, merging into a line already there', async () => {
    const { result } = renderSalesCart();
    await waitFor(() => expect(result.current.activeWorkspace).not.toBeNull());
    act(() =>
      result.current.setCartItems([
        sampleItem({ quantity: 20, unitOptions: units }),
        sampleItem({
          key: 'product-1:box',
          unitId: 'box',
          unitName: 'Box',
          unitEquivalence: 10,
          unitPrice: 900,
          catalogUnitPrice: 900,
          quantity: 1,
          unitOptions: units,
        }),
      ])
    );

    act(() => result.current.handleUnitChange('product-1:unit-1', 'box'));

    expect(result.current.cartItems).toEqual([
      expect.objectContaining({ key: 'product-1:box', quantity: 3, unitPrice: 900 }),
    ]);
    expect(result.current.activeSelectedCartItemKey).toBe('product-1:box');
  });
});
