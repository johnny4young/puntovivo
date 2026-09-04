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
      hook.result.current.handleSerialSelectionChange(
        quotationLine.key,
        ['serial-1'],
        'site-1'
      )
    );
    expect(
      useCartWorkspaceStore.getState().workspaces[quotationWorkspaceId]?.items[0]
    ).toMatchObject({ quantity: 1, serialIds: ['serial-1'], serialSiteId: 'site-1' });
  });
});
