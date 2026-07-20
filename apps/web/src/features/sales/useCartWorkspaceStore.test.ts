import { beforeEach, describe, expect, it } from 'vitest';
import {
  HISTORY_CAP,
  selectActiveIsResumed,
  selectActiveUndoDepth,
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
    expect(active?.checkoutStartedAt).toBeNull();
  });

  it('filters workspaces by ownerKey so two cashiers on the same machine stay isolated', () => {
    const store = useCartWorkspaceStore.getState();
    store.createDraft('tenant-1:user-a');
    store.createDraft('tenant-1:user-a');
    store.createDraft('tenant-1:user-b');

    const ownedA = selectOwnedWorkspaces(useCartWorkspaceStore.getState(), 'tenant-1:user-a');
    const ownedB = selectOwnedWorkspaces(useCartWorkspaceStore.getState(), 'tenant-1:user-b');
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
      serverCustomerId: 'customer-42',
      label: 'Mesa 5',
      items: [sampleItem()],
    });

    const state = useCartWorkspaceStore.getState();
    expect(state.activeId).toBe(id);
    expect(state.workspaces[id]?.serverSaleId).toBe('sale-123');
    expect(state.workspaces[id]?.serverCustomerId).toBe('customer-42');
    expect(state.workspaces[id]?.serverSaleNumber).toBe('VTA-000042');
    expect(state.workspaces[id]?.label).toBe('Mesa 5');
    expect(Date.parse(state.workspaces[id]?.checkoutStartedAt ?? '')).not.toBeNaN();
    expect(selectActiveIsResumed(state)).toBe(true);
  });

  it('starts checkout on the first cart item and resets after the cart empties', () => {
    const store = useCartWorkspaceStore.getState();
    const id = store.createDraft('tenant-1:user-a');

    store.updateCart(id, [sampleItem()]);
    const firstStart = useCartWorkspaceStore.getState().workspaces[id]?.checkoutStartedAt;
    expect(Date.parse(firstStart ?? '')).not.toBeNaN();

    store.updateCart(id, [sampleItem({ quantity: 2 })]);
    expect(useCartWorkspaceStore.getState().workspaces[id]?.checkoutStartedAt).toBe(firstStart);

    store.updateCart(id, []);
    expect(useCartWorkspaceStore.getState().workspaces[id]?.checkoutStartedAt).toBeNull();

    store.updateCart(id, [sampleItem()]);
    expect(
      Date.parse(useCartWorkspaceStore.getState().workspaces[id]?.checkoutStartedAt ?? '')
    ).not.toBeNaN();
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
    expect(Object.values(parsed.state?.workspaces ?? {}).length).toBeGreaterThan(0);
  });

  // undo/recovery history stack.
  describe(' undo history', () => {
    it('starts a fresh draft with an empty historyStack and undo depth 0', () => {
      const store = useCartWorkspaceStore.getState();
      const id = store.createDraft('tenant-1:user-a');
      const ws = useCartWorkspaceStore.getState().workspaces[id];
      expect(ws?.historyStack).toEqual([]);
      expect(selectActiveUndoDepth(useCartWorkspaceStore.getState())).toBe(0);
    });

    it('pushes the previous items onto the stack on every real updateCart', () => {
      const store = useCartWorkspaceStore.getState();
      const id = store.createDraft('tenant-1:user-a');

      const itemsA = [sampleItem({ quantity: 1 })];
      const itemsB = [sampleItem({ quantity: 2 })];
      store.updateCart(id, itemsA);
      store.updateCart(id, itemsB);

      const ws = useCartWorkspaceStore.getState().workspaces[id];
      expect(ws?.items).toBe(itemsB);
      // First push captured the initial empty array; second push
      // captured `itemsA`.
      expect(ws?.historyStack).toHaveLength(2);
      expect(ws?.historyStack[0]).toEqual([]);
      expect(ws?.historyStack[1]).toBe(itemsA);
    });

    it('does NOT push a snapshot when updateCart is called with the same array reference', () => {
      const store = useCartWorkspaceStore.getState();
      const id = store.createDraft('tenant-1:user-a');

      const items = [sampleItem()];
      store.updateCart(id, items);
      const depthAfterFirst = useCartWorkspaceStore.getState().workspaces[id]?.historyStack.length;
      // Re-applying the SAME reference is a no-op and must not
      // inflate history.
      store.updateCart(id, items);
      const depthAfterSecond = useCartWorkspaceStore.getState().workspaces[id]?.historyStack.length;
      expect(depthAfterSecond).toBe(depthAfterFirst);
    });

    it('undoCart pops the stack, restores items, and reports success', () => {
      const store = useCartWorkspaceStore.getState();
      const id = store.createDraft('tenant-1:user-a');

      const itemsA = [sampleItem({ quantity: 1 })];
      const itemsB = [sampleItem({ quantity: 2 })];
      store.updateCart(id, itemsA);
      store.updateCart(id, itemsB);

      const restored = store.undoCart(id);
      expect(restored).toBe(true);
      const ws = useCartWorkspaceStore.getState().workspaces[id];
      expect(ws?.items).toBe(itemsA);
      expect(ws?.historyStack).toHaveLength(1);
      expect(ws?.historyStack[0]).toEqual([]);

      const restoredAgain = store.undoCart(id);
      expect(restoredAgain).toBe(true);
      expect(useCartWorkspaceStore.getState().workspaces[id]?.items).toEqual([]);
    });

    it('undoCart returns false when the stack is empty', () => {
      const store = useCartWorkspaceStore.getState();
      const id = store.createDraft('tenant-1:user-a');
      expect(store.undoCart(id)).toBe(false);
      expect(store.undoCart('does-not-exist')).toBe(false);
    });

    it('caps the stack at HISTORY_CAP via FIFO eviction', () => {
      const store = useCartWorkspaceStore.getState();
      const id = store.createDraft('tenant-1:user-a');

      // Push HISTORY_CAP + 3 unique snapshots — the first 3 must be
      // evicted, the most-recent HISTORY_CAP survive.
      for (let i = 0; i < HISTORY_CAP + 3; i += 1) {
        store.updateCart(id, [sampleItem({ quantity: i + 1 })]);
      }
      const ws = useCartWorkspaceStore.getState().workspaces[id];
      expect(ws?.historyStack).toHaveLength(HISTORY_CAP);
      // The very first snapshot we recorded was an empty array
      // (initial items). After 3 evictions it must be gone — the
      // oldest survivor is the snapshot whose `items` came from the
      // 3rd updateCart (qty=3).
      expect(ws?.historyStack[0]?.[0]?.quantity).toBe(3);
    });

    it('hydrateFromResumed resets the history stack to empty', () => {
      const store = useCartWorkspaceStore.getState();
      const seed = store.createDraft('tenant-1:user-a');
      store.updateCart(seed, [sampleItem({ quantity: 7 })]);
      expect(useCartWorkspaceStore.getState().workspaces[seed]?.historyStack).toHaveLength(1);

      const id = store.hydrateFromResumed({
        ownerKey: 'tenant-1:user-a',
        serverSaleId: 'sale-xyz',
        serverSaleNumber: 'VTA-9',
        serverCustomerId: null,
        label: null,
        items: [sampleItem()],
      });
      expect(useCartWorkspaceStore.getState().workspaces[id]?.historyStack).toEqual([]);
    });

    it('resetAllWorkspaces clears history along with the workspaces', () => {
      const store = useCartWorkspaceStore.getState();
      const id = store.createDraft('tenant-1:user-a');
      store.updateCart(id, [sampleItem()]);
      store.resetAllWorkspaces();
      expect(selectActiveUndoDepth(useCartWorkspaceStore.getState())).toBe(0);
    });

    it('keeps history independent across two workspaces of the same owner', () => {
      const store = useCartWorkspaceStore.getState();
      const a = store.createDraft('tenant-1:user-a');
      const b = store.createDraft('tenant-1:user-a');

      store.updateCart(a, [sampleItem({ quantity: 1 })]);
      store.updateCart(a, [sampleItem({ quantity: 2 })]);
      store.updateCart(b, [sampleItem({ quantity: 9 })]);

      const wsA = useCartWorkspaceStore.getState().workspaces[a];
      const wsB = useCartWorkspaceStore.getState().workspaces[b];
      expect(wsA?.historyStack).toHaveLength(2);
      expect(wsB?.historyStack).toHaveLength(1);

      store.undoCart(b);
      const wsBAfter = useCartWorkspaceStore.getState().workspaces[b];
      expect(wsBAfter?.items).toEqual([]);
      // workspace A history untouched
      expect(useCartWorkspaceStore.getState().workspaces[a]?.historyStack).toHaveLength(2);
    });

    it('selectActiveUndoDepth tracks the active workspace', () => {
      const store = useCartWorkspaceStore.getState();
      const a = store.createDraft('tenant-1:user-a');
      // Create a second draft so we can exercise switching.
      store.createDraft('tenant-1:user-a');
      store.updateCart(a, [sampleItem()]);
      store.updateCart(a, [sampleItem({ quantity: 5 })]);
      // The second createDraft is active and carries depth 0.
      expect(selectActiveUndoDepth(useCartWorkspaceStore.getState())).toBe(0);
      store.setActive(a);
      expect(selectActiveUndoDepth(useCartWorkspaceStore.getState())).toBe(2);
    });
  });
});
