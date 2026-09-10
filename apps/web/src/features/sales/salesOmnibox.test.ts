import { beforeEach, describe, expect, it } from 'vitest';
import type { ProductSearchItem } from '@/types';
import { useCartWorkspaceStore } from './useCartWorkspaceStore';
import {
  addOmniboxSelectionToCart,
  resolveBarcodeCartSelection,
  resolveProductCartSelection,
} from './salesOmnibox';

function product(overrides: Partial<ProductSearchItem> = {}): ProductSearchItem {
  return {
    id: 'product-1',
    tenantId: 'tenant-1',
    name: 'Coffee',
    sku: 'COF-1',
    price: 10,
    price2: 8,
    price3: 7,
    cost: 5,
    marginPercent1: 50,
    marginPercent2: 50,
    marginPercent3: 50,
    marginAmount1: 5,
    marginAmount2: 5,
    marginAmount3: 5,
    taxRate: 0,
    initialCost: 5,
    stock: 20,
    minStock: 1,
    sellByFraction: false,
    tracksLots: false,
    isActive: true,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    unitAssignments: [
      {
        id: 'assignment-base',
        unitId: 'unit-base',
        unitName: 'Unit',
        equivalence: 1,
        price: 10,
        price2: 8,
        price3: 7,
        isBase: true,
      },
      {
        id: 'assignment-case',
        unitId: 'unit-case',
        unitName: 'Case',
        equivalence: 12,
        price: 100,
        isBase: false,
      },
    ],
    ...overrides,
  };
}

describe('sales omnibox cart helpers', () => {
  beforeEach(() => {
    useCartWorkspaceStore.getState().resetAllWorkspaces();
    localStorage.clear();
  });

  it('resolves text results to the base unit', () => {
    const resolved = resolveProductCartSelection(product());
    expect(resolved?.selection.unit.unitId).toBe('unit-base');
    expect(resolved?.selection.price).toBe(10);
    expect(resolved?.quantityOverride).toBeNull();
    expect(resolved?.priceOverride).toBeNull();
  });

  it('preserves packaging units and GS1 quantity/price overrides', () => {
    const resolved = resolveBarcodeCartSelection({
      product: product(),
      resolvedUnitId: 'unit-case',
      suggestedPrice: 95,
      suggestedQuantity: 2.5,
    });
    expect(resolved?.selection.unit.unitId).toBe('unit-case');
    expect(resolved?.selection.price).toBe(95);
    expect(resolved?.quantityOverride).toBe(2.5);
    expect(resolved?.priceOverride).toBe(95);
  });

  it('returns null when a product has no sellable unit', () => {
    expect(resolveProductCartSelection(product({ unitAssignments: [] }))).toBeNull();
  });

  it('adds and merges into the active editable cart owned by the user', () => {
    const ownerKey = 'tenant-1:user-1';
    const workspaceId = useCartWorkspaceStore.getState().createDraft(ownerKey);
    const resolved = resolveProductCartSelection(product());
    if (!resolved) throw new Error('Expected selection');

    addOmniboxSelectionToCart({ ownerKey, ...resolved });
    addOmniboxSelectionToCart({ ownerKey, ...resolved });

    const workspace = useCartWorkspaceStore.getState().workspaces[workspaceId];
    expect(workspace?.items).toHaveLength(1);
    expect(workspace?.items[0]?.quantity).toBe(2);
    expect(workspace?.selectedItemKey).toBe('product-1:unit-base');
  });

  it('applies the active customer tier when the omnibox bypasses SalesPage', () => {
    const ownerKey = 'tenant-1:user-1';
    const store = useCartWorkspaceStore.getState();
    const workspaceId = store.createDraft(ownerKey);
    store.setPriceTier(workspaceId, 2);
    const resolved = resolveProductCartSelection(product());
    if (!resolved) throw new Error('Expected selection');

    addOmniboxSelectionToCart({ ownerKey, ...resolved });

    expect(useCartWorkspaceStore.getState().workspaces[workspaceId]?.items[0]?.unitPrice).toBe(8);
  });

  it('accumulates independently weighed packages in the owned cart', () => {
    const ownerKey = 'tenant-1:user-1';
    const workspaceId = useCartWorkspaceStore.getState().createDraft(ownerKey);
    const resolved = resolveBarcodeCartSelection({
      product: product({
        sellByFraction: true,
        fractionStep: 0.001,
        fractionMinimum: 0.001,
      }),
      resolvedUnitId: null,
      suggestedPrice: null,
      suggestedQuantity: 0.199,
    });
    if (!resolved) throw new Error('Expected selection');

    addOmniboxSelectionToCart({ ownerKey, ...resolved });
    addOmniboxSelectionToCart({
      ownerKey,
      ...resolved,
      quantityOverride: 0.275,
    });

    expect(useCartWorkspaceStore.getState().workspaces[workspaceId]?.items[0]?.quantity).toBe(
      0.474
    );
  });

  it('never edits another user cart, a resumed draft, or an accepted quotation', () => {
    const store = useCartWorkspaceStore.getState();
    const foreignId = store.createDraft('tenant-1:user-other');
    store.updateCart(foreignId, []);
    const resumedId = store.hydrateFromResumed({
      ownerKey: 'tenant-1:user-1',
      serverSaleId: 'sale-1',
      serverSaleNumber: 'VTA-1',
      serverCustomerId: null,
      priceTier: 1,
      label: null,
      items: [],
    });
    const quotationId = store.hydrateFromQuotation({
      ownerKey: 'tenant-1:user-1',
      quotationId: 'quote-1',
      quotationNumber: 'COT-1',
      siteId: 'site-1',
      customerId: null,
      customerName: null,
      priceTier: 1,
      items: [],
    });
    const resolved = resolveProductCartSelection(product());
    if (!resolved) throw new Error('Expected selection');

    const added = addOmniboxSelectionToCart({
      ownerKey: 'tenant-1:user-1',
      ...resolved,
    });
    const state = useCartWorkspaceStore.getState();

    expect(added.workspaceId).not.toBe(foreignId);
    expect(added.workspaceId).not.toBe(resumedId);
    expect(added.workspaceId).not.toBe(quotationId);
    expect(state.activeId).toBe(added.workspaceId);
    expect(state.workspaces[foreignId]?.items).toEqual([]);
    expect(state.workspaces[resumedId]?.items).toEqual([]);
    expect(state.workspaces[quotationId]?.items).toEqual([]);
    expect(state.workspaces[added.workspaceId]?.items).toHaveLength(1);
  });
});
