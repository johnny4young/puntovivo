import { useEffect } from 'react';
import { isEditableShortcutTarget } from '@/features/sales/salesKeyboard';

const SALE_PAYMENT_FORM_ID = 'sale-payment-form';
const PRODUCT_SEARCH_UNIT_SELECT_ID = 'product-search-unit-select';

// ENG-179b — explicit `| undefined` on optional fields.
interface SalesKeyboardShortcutsOptions {
  selectedItemKey: string | null;
  canCharge: boolean;
  isProductSearchOpen: boolean;
  isPaymentModalOpen: boolean;
  onOpenSearch: () => void;
  onOpenPayment: () => void;
  onRemoveSelectedItem: (itemKey: string) => void;
  focusProductInput: () => void;
  focusQuantityInput: (itemKey: string) => void;
  focusDiscountInput: (itemKey: string) => void;
  // ENG-018b — optional Ctrl/Cmd shortcuts. Omitting any of these
  // keeps the corresponding key from firing so consumers that do not
  // (yet) implement the flow are never surprised.
  /**
   * `canSuspend` must be `true` for Ctrl/Cmd+P to call `onSuspend`.
   * Typical caller gates on "cart has items AND the cart is not a
   * resumed server draft" (resumed drafts are finalized, not
   * re-suspended).
   */
  canSuspend?: boolean | undefined;
  onSuspend?: (() => void) | undefined;
  onToggleSuspendedPanel?: (() => void) | undefined;
  /**
   * `canToggleSuspendedPanel` must be `true` for Ctrl/Cmd+R to call
   * `onToggleSuspendedPanel` and preventDefault (blocking browser
   * reload). Without this gate the shortcut would hijack Ctrl+R on
   * the sales page even when no drafts are in flight, surprising
   * cashiers who reflexively hit reload. Callers set it to
   * `suspendedDraftsCount > 0 || isSuspendedPanelOpen`.
   */
  canToggleSuspendedPanel?: boolean | undefined;
  /**
   * Ctrl/Cmd+Shift+P — triggers the reprint flow for the selected
   * history row. The callback is only invoked if wired; the hook
   * itself does not enforce the "row selected" guard because the
   * caller (history table / sales page) knows whether there is
   * something to reprint.
   */
  onReprintSelectedHistoryRow?: (() => void) | undefined;
  /**
   * ENG-105d — Ctrl/Cmd+Z undo for the active cart workspace.
   *
   * The hook never reads the undo stack itself; the callback is
   * always invoked when the user presses the binding outside
   * editable fields and the search / payment modals are closed.
   * It is up to the caller (SalesPage) to look at the workspace
   * store, decide whether anything is undoable, and surface the
   * appropriate toast — success when something was popped, info
   * when the stack was empty. This keeps the hook stateless and
   * lets the caller emit one consistent set of toasts whether the
   * user pressed Mod+Z or clicked the visible "Deshacer" button.
   */
  onUndo?: (() => void) | undefined;
  /**
   * ENG-105e — F2 rapid-cash. Unlike most shortcuts, F2 stays
   * active even when the payment modal is open: outside the modal
   * it opens it in fast-cash mode; inside the modal it re-applies
   * the exact-cash amount on top of whatever was tipped. The
   * caller (SalesPage) routes both cases and owns the toast.
   *
   * The hook still respects `isEditableShortcutTarget` outside the
   * payment modal so typing F2 inside a product/search field keeps
   * the browser default instead of stealing focus. Once the payment
   * modal owns focus, F2 intentionally works from the amount input:
   * that is the cashier's "reset to exact cash" recovery path after
   * typing the wrong amount.
   *
   * F2 also stays suppressed when the product search dialog is
   * open — that overlay owns its own keyboard contract and the
   * cashier would not be reaching for "Cobrar" from inside it.
   */
  onFastCash?: () => void;
}

function focusPaymentForm() {
  const paymentForm = document.getElementById(SALE_PAYMENT_FORM_ID);
  if (paymentForm instanceof HTMLFormElement) {
    paymentForm.requestSubmit();
  }
}

function focusProductUnitSelect() {
  const unitSelect = document.getElementById(PRODUCT_SEARCH_UNIT_SELECT_ID);
  if (unitSelect instanceof HTMLSelectElement) {
    unitSelect.focus();
  }
}

export function useSalesKeyboardShortcuts({
  selectedItemKey,
  canCharge,
  isProductSearchOpen,
  isPaymentModalOpen,
  onOpenSearch,
  onOpenPayment,
  onRemoveSelectedItem,
  focusProductInput,
  focusQuantityInput,
  focusDiscountInput,
  canSuspend = false,
  onSuspend,
  onToggleSuspendedPanel,
  canToggleSuspendedPanel = false,
  onReprintSelectedHistoryRow,
  onUndo,
  onFastCash,
}: SalesKeyboardShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      // ENG-134d — Whitelist the page-level product search input from
      // the editable-target guards below. ENG-105F restores focus to
      // this input after every modal close, so the cashier's natural
      // resting focus is here. Without the whitelist, Mod+Z / F2 from
      // the search input get suppressed and the keyboard-first
      // promise breaks. We keep the broader editable guard for every
      // other input (qty cells, discount cells, payment amount, etc.)
      // because text-level browser behaviours still take priority
      // when the cashier is mid-edit on a numeric field.
      const target = event.target;
      const isSalesSearchInput =
        target instanceof HTMLElement &&
        target.id === 'sales-product-search-input';

      // ENG-018b — Ctrl/Cmd-based shortcuts. These compete with
      // browser defaults (print, reload, devtools) so we
      // `preventDefault()` aggressively when we accept the key. Modal
      // overlays suppress them to avoid cross-talk with the payment
      // form submit key (Enter) etc.
      if (event.metaKey || event.ctrlKey) {
        if (isPaymentModalOpen || isProductSearchOpen) {
          return;
        }
        if (
          !isPaymentModalOpen &&
          !isSalesSearchInput &&
          isEditableShortcutTarget(event.target)
        ) {
          return;
        }

        // Ctrl/Cmd+Shift+P — reprint selected history row. Must come
        // before the bare Ctrl+P check because event.shiftKey alone
        // does not prevent the `key === 'p'` branch below from
        // matching otherwise.
        if (event.shiftKey && key === 'p') {
          if (onReprintSelectedHistoryRow) {
            event.preventDefault();
            onReprintSelectedHistoryRow();
          }
          return;
        }

        if (event.shiftKey) {
          // Any other shift-combo under Ctrl falls through to browser
          // defaults so we do not intercept the operator's
          // text-selection shortcuts.
          return;
        }

        if (key === 'p') {
          if (onSuspend && canSuspend) {
            event.preventDefault();
            onSuspend();
          }
          return;
        }

        if (key === 'r') {
          // Guard: only hijack browser reload when there is actually
          // something for the panel to show (drafts) or the panel is
          // already open and the operator wants to close it.
          if (onToggleSuspendedPanel && canToggleSuspendedPanel) {
            event.preventDefault();
            onToggleSuspendedPanel();
          }
          return;
        }

        if (key === 'z') {
          // ENG-105d — Ctrl/Cmd+Z undo. The
          // `isEditableShortcutTarget` short-circuit above already
          // preserved the browser-native text undo inside inputs,
          // so reaching this branch means the focus is outside an
          // editable field and the cashier intends a cart-level
          // undo. The handler is always called when wired; it
          // owns the "nothing to undo" toast / success toast.
          if (onUndo) {
            event.preventDefault();
            onUndo();
          }
          return;
        }

        return;
      }

      if (event.altKey) {
        if (key === 'u' && isProductSearchOpen) {
          event.preventDefault();
          focusProductUnitSelect();
        } else if (isProductSearchOpen || isPaymentModalOpen) {
          return;
        } else if (key === 'p') {
          event.preventDefault();
          focusProductInput();
        } else if (key === 'c' && selectedItemKey) {
          event.preventDefault();
          focusQuantityInput(selectedItemKey);
        } else if (key === 'd' && selectedItemKey) {
          event.preventDefault();
          focusDiscountInput(selectedItemKey);
        }

        return;
      }

      if (event.key === 'F2') {
        // ENG-105e — F2 fast-cash. Active both with the modal open
        // and closed; the caller decides whether to open the modal
        // (closed-state) or re-apply exact cash on top of the
        // form (open-state). Suppressed inside the product search
        // overlay so the cashier does not jump out of mid-search.
        // ENG-134d — the page-level search input is whitelisted (see
        // isSalesSearchInput above): the cashier's natural focus
        // after a scan is there, and F2 should still fire.
        if (isProductSearchOpen) {
          return;
        }
        if (
          !isPaymentModalOpen &&
          !isSalesSearchInput &&
          isEditableShortcutTarget(event.target)
        ) {
          return;
        }
        if (onFastCash) {
          event.preventDefault();
          onFastCash();
        }
        return;
      }

      if (event.key === 'F5') {
        if (isPaymentModalOpen || isProductSearchOpen) {
          return;
        }

        event.preventDefault();
        onOpenSearch();
        return;
      }

      if (event.key === 'F1') {
        event.preventDefault();

        if (isPaymentModalOpen) {
          focusPaymentForm();
        } else if (canCharge) {
          onOpenPayment();
        }

        return;
      }

      if (isPaymentModalOpen || isProductSearchOpen) {
        return;
      }

      if (
        event.key === 'Delete' &&
        selectedItemKey &&
        !isEditableShortcutTarget(event.target)
      ) {
        event.preventDefault();
        onRemoveSelectedItem(selectedItemKey);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    canCharge,
    canSuspend,
    canToggleSuspendedPanel,
    focusDiscountInput,
    focusProductInput,
    focusQuantityInput,
    isPaymentModalOpen,
    isProductSearchOpen,
    onOpenPayment,
    onOpenSearch,
    onRemoveSelectedItem,
    onReprintSelectedHistoryRow,
    onSuspend,
    onToggleSuspendedPanel,
    onUndo,
    onFastCash,
    selectedItemKey,
  ]);
}
