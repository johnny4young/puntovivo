import { useEffect } from 'react';
import { isEditableShortcutTarget } from '@/features/sales/salesKeyboard';

const SALE_PAYMENT_FORM_ID = 'sale-payment-form';
const PRODUCT_SEARCH_UNIT_SELECT_ID = 'product-search-unit-select';

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
  canSuspend?: boolean;
  onSuspend?: () => void;
  onToggleSuspendedPanel?: () => void;
  /**
   * `canToggleSuspendedPanel` must be `true` for Ctrl/Cmd+R to call
   * `onToggleSuspendedPanel` and preventDefault (blocking browser
   * reload). Without this gate the shortcut would hijack Ctrl+R on
   * the sales page even when no drafts are in flight, surprising
   * cashiers who reflexively hit reload. Callers set it to
   * `suspendedDraftsCount > 0 || isSuspendedPanelOpen`.
   */
  canToggleSuspendedPanel?: boolean;
  /**
   * Ctrl/Cmd+Shift+P — triggers the reprint flow for the selected
   * history row. The callback is only invoked if wired; the hook
   * itself does not enforce the "row selected" guard because the
   * caller (history table / sales page) knows whether there is
   * something to reprint.
   */
  onReprintSelectedHistoryRow?: () => void;
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
}: SalesKeyboardShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      // ENG-018b — Ctrl/Cmd-based shortcuts. These compete with
      // browser defaults (print, reload, devtools) so we
      // `preventDefault()` aggressively when we accept the key. Modal
      // overlays suppress them to avoid cross-talk with the payment
      // form submit key (Enter) etc.
      if (event.metaKey || event.ctrlKey) {
        if (isPaymentModalOpen || isProductSearchOpen) {
          return;
        }
        if (isEditableShortcutTarget(event.target)) {
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
    selectedItemKey,
  ]);
}
