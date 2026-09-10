import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import {
  applyPriceTier,
  getCartItemKey,
  mergeCartItem,
  updateCartItem,
  type SaleCartItem,
} from '@/features/sales/saleCart';
import { getActiveCartSelectionKey } from '@/features/sales/salesKeyboard';
import {
  selectActiveWorkspace,
  useCartWorkspaceStore,
} from '@/features/sales/useCartWorkspaceStore';

/**
 * Params for {@link useSalesCart}.
 *
 * slice 16b-1 — the cart-edit handlers + the two store-wrapper
 * callbacks were extracted verbatim from SalesPage. The cart-edit path
 * reads/writes the active workspace through `useCartWorkspaceStore`; the
 * hook receives only the `ownerKey` (to materialize/own the active cart)
 * and the two shell setters `handleProductSelect` touches, so the
 * dependency direction stays shell → hook (deps in) and hook → shell
 * (setter calls out), never hook ↔ hook.
 */
export interface UseSalesCartParams {
  /** `${tenantId}:${userId}` or null when signed out — drives the cart materialization + ownership filter. */
  ownerKey: string | null;
  /** Cleared on a successful add so the search box is empty for the next scan/lookup. */
  setProductSearchQuery: Dispatch<SetStateAction<string>>;
  /** Cleared on a successful add so a stale checkout error does not linger over a fresh line. */
  setSaleError: Dispatch<SetStateAction<string | null>>;
}

/** A `useState`-style updater accepted by {@link useSalesCart}'s `setCartItems`
 * wrapper: either the next item array or a function of the previous array. */
type SetCartItemsArg = SaleCartItem[] | ((previous: SaleCartItem[]) => SaleCartItem[]);

/**
 * Owns the active-cart lifecycle for SalesPage: materializes a fresh local
 * draft for the signed-in cashier, exposes `useState`-style `setCartItems` /
 * `setSelectedCartItemKey` wrappers over the workspace store, derives the
 * cart view values, and provides the six cart-edit handlers (add/merge,
 * quantity, discount, remove, clear, undo). Resumed-draft carts are locked,
 * so every edit handler short-circuits on `isResumedCart`. Handlers stay
 * plain closures (matching their prior shell form); the two wrappers and
 * `handleUndoCart` keep their exact `useCallback` dep arrays.
 */
export function useSalesCart({
  ownerKey,
  setProductSearchQuery,
  setSaleError,
}: UseSalesCartParams) {
  const { t } = useTranslation(['sales', 'errors', 'common']);
  const toast = useToast();

  const activeWorkspace = useCartWorkspaceStore(selectActiveWorkspace);
  const allWorkspaces = useCartWorkspaceStore(state => state.workspaces);
  // Ensure SalesPage always has a cart ready for the signed-in cashier:
  // if no active workspace exists or the active one belongs to a
  // different owner (ex: a prior cashier signed out and a new one
  // logged in on the same machine), materialize a fresh local draft.
  useEffect(() => {
    if (!ownerKey) {
      return;
    }
    const state = useCartWorkspaceStore.getState();
    const active = state.activeId ? (state.workspaces[state.activeId] ?? null) : null;
    if (active && active.ownerKey === ownerKey) {
      return;
    }
    const reusableOwned = Object.values(state.workspaces).find(
      workspace =>
        workspace.ownerKey === ownerKey &&
        workspace.serverSaleId === null &&
        workspace.sourceQuotationId === null
    );
    if (reusableOwned) {
      state.setActive(reusableOwned.id);
      return;
    }
    state.createDraft(ownerKey);
  }, [ownerKey]);

  const cartItems = activeWorkspace?.items ?? [];
  const ownedWorkspaces = ownerKey
    ? Object.values(allWorkspaces)
        .filter(workspace => workspace.ownerKey === ownerKey)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];
  const selectedCartItemKey = activeWorkspace?.selectedItemKey ?? null;
  const isResumedCart = activeWorkspace?.serverSaleId != null;
  const isQuotationCart = activeWorkspace?.sourceQuotationId != null;
  const itemsLocked = isResumedCart || isQuotationCart;
  const canUndoActiveCart = !itemsLocked && (activeWorkspace?.historyStack.length ?? 0) > 0;

  const setCartItems = useCallback((update: SetCartItemsArg) => {
    const state = useCartWorkspaceStore.getState();
    const activeId = state.activeId;
    if (!activeId) {
      return;
    }
    const workspace = state.workspaces[activeId];
    // This public setter is also handed to scanners and quick-create gates.
    // Re-check the current store snapshot here instead of trusting render-time
    // flags so an out-of-band callback can never mutate a resumed draft or an
    // accepted quotation while the active workspace is switching.
    if (!workspace || workspace.serverSaleId !== null || workspace.sourceQuotationId !== null) {
      return;
    }
    const current = workspace.items;
    const next = typeof update === 'function' ? update(current) : update;
    // Single choke point for the ticket's price tier: EVERY cart
    // mutation (manual add, barcode scan, omnibox, quick-create, undo)
    // flows through this wrapper, so a P2 ticket can never accumulate
    // tier-1 lines through a path that forgot to reprice. applyPriceTier
    // is idempotent and only touches lines sitting on the tier grid, so
    // label-embedded and hand-edited prices survive.
    state.updateCart(activeId, applyPriceTier(next, workspace?.priceTier ?? 1));
  }, []);
  const setSelectedCartItemKey = useCallback((key: string | null) => {
    const state = useCartWorkspaceStore.getState();
    const activeId = state.activeId;
    if (!activeId) {
      return;
    }
    state.setSelectedItem(activeId, key);
  }, []);

  const activeSelectedCartItemKey = getActiveCartSelectionKey(cartItems, selectedCartItemKey);

  // resumed carts (serverSaleId set) have server-locked
  // items: the server-side `sales.completeDraft` contract re-finalizes
  // the draft as-is. Any client edit to quantity, discount, add, or
  // remove would be silently discarded at Charge time and the amount
  // collected could diverge from the server total. Guard every edit
  // handler so the "items locked" banner on the UI matches the actual
  // enforcement. If the cashier wants different items, they discard
  // the draft and start a fresh one.
  const handleProductSelect = (selection: Parameters<typeof mergeCartItem>[1]) => {
    if (itemsLocked) return;
    // The setCartItems choke point applies the ticket's active tier.
    setCartItems(currentItems => mergeCartItem(currentItems, selection));
    setSelectedCartItemKey(getCartItemKey(selection.product.id, selection.unit.unitId));
    setProductSearchQuery('');
    setSaleError(null);
  };

  /**
   * Switch the ticket's price tier: remembers the choice on the
   * workspace, then pushes an identity update through the setCartItems
   * choke point, which reprices every eligible line at the NEW tier.
   * Resumed carts are server-locked and never repriced.
   */
  const handlePriceTierChange = (tier: 1 | 2 | 3) => {
    if (itemsLocked) return;
    const state = useCartWorkspaceStore.getState();
    const activeId = state.activeId;
    if (!activeId) return;
    state.setPriceTier(activeId, tier);
    setCartItems(currentItems => currentItems);
  };

  const handleQuantityChange = (itemKey: string, quantity: number) => {
    if (itemsLocked) return;
    setCartItems(currentItems =>
      currentItems.map(item =>
        item.key === itemKey
          ? updateCartItem(item, {
              quantity,
              serialIds: item.tracksSerials
                ? (item.serialIds ?? []).slice(
                    0,
                    Math.max(0, Math.floor(quantity * item.unitEquivalence))
                  )
                : (item.serialIds ?? []),
            })
          : item
      )
    );
  };

  const handleSerialSelectionChange = (itemKey: string, serialIds: string[], siteId: string) => {
    // A resumed server draft already owns its serial snapshots. An accepted
    // quotation, in contrast, freezes commercial terms but deliberately does
    // not choose the physical serials; the cashier must select those here.
    if (isResumedCart) return;
    if (isQuotationCart) {
      const state = useCartWorkspaceStore.getState();
      const activeId = state.activeId;
      if (!activeId) return;
      state.setQuotationSerialSelection(activeId, itemKey, serialIds, siteId);
      return;
    }
    setCartItems(currentItems =>
      currentItems.map(item =>
        item.key === itemKey ? updateCartItem(item, { serialIds, serialSiteId: siteId }) : item
      )
    );
  };

  const handleDiscountChange = (itemKey: string, discount: number) => {
    if (itemsLocked) return;
    setCartItems(currentItems =>
      currentItems.map(item => (item.key === itemKey ? updateCartItem(item, { discount }) : item))
    );
  };

  const handleRemoveItem = (itemKey: string) => {
    if (itemsLocked) return;
    setCartItems(currentItems => currentItems.filter(item => item.key !== itemKey));
  };

  const handleClearCart = () => {
    if (itemsLocked) return;
    setCartItems([]);
    setSelectedCartItemKey(null);
  };

  // undo the last cart mutation on the active workspace.
  // Routed by both the Mod+Z shortcut (via `useSalesKeyboardShortcuts`)
  // and the visible "Deshacer" button on the cart toolbar so the
  // toast surface is identical in both paths. Resumed-draft carts
  // are locked (items cannot be edited), and the same lock applies
  // to undo — there is no history to walk anyway, but we short-circuit
  // explicitly to avoid surfacing the "nothing to undo" toast in a
  // state where it could read as a UX bug.
  const handleUndoCart = useCallback(() => {
    if (itemsLocked) return;
    const state = useCartWorkspaceStore.getState();
    const activeId = state.activeId;
    if (!activeId) return;
    const popped = state.undoCart(activeId);
    if (popped) {
      // After an undo the previously-selected row may no longer
      // exist (e.g. the user undid a "remove item" so the row is
      // back, or the user undid an "add item" so the row is gone).
      // Drop the selection — the user can re-select via click or
      // Alt+P/Alt+C/Alt+D. Keeping it pointed at a deleted row
      // makes the keyboard nav surfaces fail silently.
      state.setSelectedItem(activeId, null);
      toast.success({ title: t('sales:undo.cartActionUndone') });
    } else {
      toast.info({ title: t('sales:undo.nothingToUndo') });
    }
  }, [itemsLocked, t, toast]);

  return {
    activeWorkspace: activeWorkspace ?? null,
    cartItems,
    ownedWorkspaces,
    isResumedCart,
    isQuotationCart,
    itemsLocked,
    canUndoActiveCart,
    activeSelectedCartItemKey,
    setCartItems,
    setSelectedCartItemKey,
    handleProductSelect,
    handlePriceTierChange,
    activePriceTier: activeWorkspace?.priceTier ?? 1,
    handleQuantityChange,
    handleDiscountChange,
    handleSerialSelectionChange,
    handleRemoveItem,
    handleClearCart,
    handleUndoCart,
  };
}
