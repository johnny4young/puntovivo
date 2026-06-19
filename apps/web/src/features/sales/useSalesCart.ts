import {
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import {
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
 * ENG-178 slice 16b-1 — the cart-edit handlers + the two store-wrapper
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
type SetCartItemsArg =
  | SaleCartItem[]
  | ((previous: SaleCartItem[]) => SaleCartItem[]);

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
    const active = state.activeId
      ? state.workspaces[state.activeId] ?? null
      : null;
    if (active && active.ownerKey === ownerKey) {
      return;
    }
    const reusableOwned = Object.values(state.workspaces).find(
      workspace =>
        workspace.ownerKey === ownerKey && workspace.serverSaleId === null
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
  const canUndoActiveCart =
    !isResumedCart && (activeWorkspace?.historyStack.length ?? 0) > 0;

  const setCartItems = useCallback(
    (update: SetCartItemsArg) => {
      const state = useCartWorkspaceStore.getState();
      const activeId = state.activeId;
      if (!activeId) {
        return;
      }
      const current = state.workspaces[activeId]?.items ?? [];
      const next =
        typeof update === 'function' ? update(current) : update;
      state.updateCart(activeId, next);
    },
    []
  );
  const setSelectedCartItemKey = useCallback(
    (key: string | null) => {
      const state = useCartWorkspaceStore.getState();
      const activeId = state.activeId;
      if (!activeId) {
        return;
      }
      state.setSelectedItem(activeId, key);
    },
    []
  );

  const activeSelectedCartItemKey = getActiveCartSelectionKey(cartItems, selectedCartItemKey);

  // ENG-018b — resumed carts (serverSaleId set) have server-locked
  // items: the server-side `sales.completeDraft` contract re-finalizes
  // the draft as-is. Any client edit to quantity, discount, add, or
  // remove would be silently discarded at Charge time and the amount
  // collected could diverge from the server total. Guard every edit
  // handler so the "items locked" banner on the UI matches the actual
  // enforcement. If the cashier wants different items, they discard
  // the draft and start a fresh one.
  const handleProductSelect = (selection: Parameters<typeof mergeCartItem>[1]) => {
    if (isResumedCart) return;
    setCartItems(currentItems => mergeCartItem(currentItems, selection));
    setSelectedCartItemKey(getCartItemKey(selection.product.id, selection.unit.unitId));
    setProductSearchQuery('');
    setSaleError(null);
  };

  const handleQuantityChange = (itemKey: string, quantity: number) => {
    if (isResumedCart) return;
    setCartItems(currentItems =>
      currentItems.map(item =>
        item.key === itemKey ? updateCartItem(item, { quantity }) : item
      )
    );
  };

  const handleDiscountChange = (itemKey: string, discount: number) => {
    if (isResumedCart) return;
    setCartItems(currentItems =>
      currentItems.map(item =>
        item.key === itemKey ? updateCartItem(item, { discount }) : item
      )
    );
  };

  const handleRemoveItem = (itemKey: string) => {
    if (isResumedCart) return;
    setCartItems(currentItems => currentItems.filter(item => item.key !== itemKey));
  };

  const handleClearCart = () => {
    if (isResumedCart) return;
    setCartItems([]);
    setSelectedCartItemKey(null);
  };

  // ENG-105d — undo the last cart mutation on the active workspace.
  // Routed by both the Mod+Z shortcut (via `useSalesKeyboardShortcuts`)
  // and the visible "Deshacer" button on the cart toolbar so the
  // toast surface is identical in both paths. Resumed-draft carts
  // are locked (items cannot be edited), and the same lock applies
  // to undo — there is no history to walk anyway, but we short-circuit
  // explicitly to avoid surfacing the "nothing to undo" toast in a
  // state where it could read as a UX bug.
  const handleUndoCart = useCallback(() => {
    if (isResumedCart) return;
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
  }, [isResumedCart, t, toast]);

  return {
    activeWorkspace: activeWorkspace ?? null,
    cartItems,
    ownedWorkspaces,
    isResumedCart,
    canUndoActiveCart,
    activeSelectedCartItemKey,
    setCartItems,
    setSelectedCartItemKey,
    handleProductSelect,
    handleQuantityChange,
    handleDiscountChange,
    handleRemoveItem,
    handleClearCart,
    handleUndoCart,
  };
}
