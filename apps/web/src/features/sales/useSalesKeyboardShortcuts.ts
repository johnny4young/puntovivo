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
}: SalesKeyboardShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) {
        return;
      }

      const key = event.key.toLowerCase();

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
    focusDiscountInput,
    focusProductInput,
    focusQuantityInput,
    isPaymentModalOpen,
    isProductSearchOpen,
    onOpenPayment,
    onOpenSearch,
    onRemoveSelectedItem,
    selectedItemKey,
  ]);
}
