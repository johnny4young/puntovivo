import { beforeEach, describe, expect, it } from 'vitest';
import {
  selectActiveIsResumed,
  selectActiveWorkspace,
  selectOwnedWorkspaces,
  useCartWorkspaceStore,
} from './useCartWorkspaceStore';
import type { SaleCartItem } from './saleCart';

function sampleItem(overrides?: Partial<SaleCartItem>): SaleCartItem {
  return {
    key: 'sku-42:unit-1',
    productId: 'sku-42',
    productName: 'Sample Product',
    productSku: 'SP-42',
    unitId: 'unit-1',
    unitName: 'Unidad',
    unitEquivalence: 1,
    quantity: 1,
    unitPrice: 10,
    discount: 0,
    taxRate: 0,
    availableStock: 50,
    sellByFraction: false,
    fractionStep: null,
    fractionMinimum: null,
    ...overrides,
  };
}

describe('useCartWorkspaceStore', () => {
  beforeEach(() => {
    // Reset the store between tests to keep workspaces from leaking.
    // Also clear the persist-middleware's localStorage entry so a
    // subsequent test starts fresh instead of rehydrating from a
    // prior case.
    useCartWorkspaceStore.getState().resetAllWorkspaces();
    localStorage.clear();
  });

  it('creates a draft, sets it active, and owns it to the caller', () => {
    const ownerKey = 'tenant-1:user-a';
    const id = useCartWorkspaceStore.getState().createDraft(ownerKey);

    const state = useCartWorkspaceStore.getState();
    expect(state.activeId).toBe(id);
    const active = selectActiveWorkspace(state);
    expect(active?.ownerKey).toBe(ownerKey);
    expect(active?.items).toEqual([]);
    expect(active?.serverSaleId).toBeNull();
  });

  it('filters workspaces by ownerKey so two cashiers on the same machine stay isolated', () => {
    const store = useCartWorkspaceStore.getState();
    store.createDraft('tenant-1:user-a');
    store.createDraft('tenant-1:user-a');
    store.createDraft('tenant-1:user-b');

    const ownedA = selectOwnedWorkspaces(
      useCartWorkspaceStore.getState(),
      'tenant-1:user-a'
    );
    const ownedB = selectOwnedWorkspaces(
      useCartWorkspaceStore.getState(),
      'tenant-1:user-b'
    );
    expect(ownedA).toHaveLength(2);
    expect(ownedB).toHaveLength(1);
    expect(ownedA.every(w => w.ownerKey === 'tenant-1:user-a')).toBe(true);
  });

  it('updates items and selected row without mutating other workspaces', () => {
    const store = useCartWorkspaceStore.getState();
    const a = store.createDraft('tenant-1:user-a');
    const b = store.createDraft('tenant-1:user-a');

    store.updateCart(a, [sampleItem({ quantity: 2 })]);
    store.setSelectedItem(a, 'sku-42:unit-1');

    const state = useCartWorkspaceStore.getState();
    expect(state.workspaces[a]?.items).toHaveLength(1);
    expect(state.workspaces[a]?.items[0]?.quantity).toBe(2);
    expect(state.workspaces[a]?.selectedItemKey).toBe('sku-42:unit-1');
    expect(state.workspaces[b]?.items).toEqual([]);
    expect(state.workspaces[b]?.selectedItemKey).toBeNull();
  });

  it('hydrates a resumed draft with serverSaleId and treats it as resumed', () => {
    const store = useCartWorkspaceStore.getState();
    const id = store.hydrateFromResumed({
      ownerKey: 'tenant-1:user-a',
      serverSaleId: 'sale-123',
      serverSaleNumber: 'VTA-000042',
      label: 'Mesa 5',
      items: [sampleItem()],
    });

    const state = useCartWorkspaceStore.getState();
    expect(state.activeId).toBe(id);
    expect(state.workspaces[id]?.serverSaleId).toBe('sale-123');
    expect(state.workspaces[id]?.serverSaleNumber).toBe('VTA-000042');
    expect(state.workspaces[id]?.label).toBe('Mesa 5');
    expect(selectActiveIsResumed(state)).toBe(true);
  });

  it('removeWorkspace clears activeId when the removed workspace was active', () => {
    const store = useCartWorkspaceStore.getState();
    const a = store.createDraft('tenant-1:user-a');
    const b = store.createDraft('tenant-1:user-a');

    store.removeWorkspace(b);
    expect(useCartWorkspaceStore.getState().activeId).toBeNull();
    expect(useCartWorkspaceStore.getState().workspaces[b]).toBeUndefined();
    expect(useCartWorkspaceStore.getState().workspaces[a]).toBeDefined();
  });

  it('removeWorkspace preserves activeId when removing a non-active workspace', () => {
    const store = useCartWorkspaceStore.getState();
    const a = store.createDraft('tenant-1:user-a');
    const b = store.createDraft('tenant-1:user-a');
    store.setActive(a);

    store.removeWorkspace(b);
    expect(useCartWorkspaceStore.getState().activeId).toBe(a);
  });

  it('setActive rejects an unknown id to keep the state consistent', () => {
    const store = useCartWorkspaceStore.getState();
    const a = store.createDraft('tenant-1:user-a');
    store.setActive('does-not-exist');
    expect(useCartWorkspaceStore.getState().activeId).toBe(a);
  });

  it('resetAllWorkspaces wipes the store on logout', () => {
    const store = useCartWorkspaceStore.getState();
    store.createDraft('tenant-1:user-a');
    store.createDraft('tenant-1:user-b');

    store.resetAllWorkspaces();
    const state = useCartWorkspaceStore.getState();
    expect(state.activeId).toBeNull();
    expect(Object.keys(state.workspaces)).toHaveLength(0);
  });

  it('persists workspaces to localStorage so a refresh restores them', () => {
    const store = useCartWorkspaceStore.getState();
    store.createDraft('tenant-1:user-a');

    const raw = localStorage.getItem('cart-workspace-store');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw ?? '{}');
    expect(parsed.state?.activeId).toBeTruthy();
    expect(
      Object.values(parsed.state?.workspaces ?? {}).length
    ).toBeGreaterThan(0);
  });
});
