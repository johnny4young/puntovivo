/**
 * Scanner-focus restoration for the SalesPage cashier flow.
 *
 * Keeps the page-level product search input as the focus target so a
 * USB HID barcode scanner always lands keystrokes on the right field
 * across the typical cashier-flow events:
 *
 * - Initial /sales mount — focus the search input so the first scan
 * works without a click.
 * - ProductSearchDialog open → close (with or without selection).
 * - SalePaymentModal open → close (success completing a sale or
 * user-driven cancel).
 * - QuickCreateProductGate mount → unmount (after creating or
 * canceling a quick-create product).
 * - QuickCreateCustomerGate mount → unmount (after creating or
 * canceling a quick-create customer).
 *
 * The restoration is invisible — no toast, no visible indicator. The
 * `useBarcodeWedgeListener` guards against editable inputs (qty,
 * discount, payment amount), so a cashier who intentionally edits a
 * cart field keeps focus there until they explicitly move it.
 *
 * Restoration is deferred via `requestAnimationFrame` so React has a
 * chance to commit the close transition and unmount the modal before
 * we focus the search input.
 *
 * @module features/sales/useScannerFocusRestoration
 */

import { useEffect, useRef, type RefObject } from 'react';

interface ScannerFocusRestorationInput {
  /** Page-level product search input ref (from `useSalesInputFocus`). */
  productInputRef: RefObject<HTMLInputElement | null>;
  /** ProductSearchDialog open state. */
  isProductSearchOpen: boolean;
  /** SalePaymentModal open state. */
  isPaymentModalOpen: boolean;
  /** QuickCreateProductGate mounted state. */
  isQuickCreateProductMounted: boolean;
  /** QuickCreateCustomerGate mounted state. */
  isQuickCreateCustomerMounted: boolean;
}

function focusSearchInput(ref: RefObject<HTMLInputElement | null>) {
  // Defer to next animation frame so React finishes committing the
  // close transition (and any sibling re-renders triggered by the
  // tRPC cache invalidations that ride along a sale completion)
  // before we focus + select the search input.
  requestAnimationFrame(() => {
    const node = ref.current;
    if (!node) return;
    node.focus();
    node.select();
  });
}

export function useScannerFocusRestoration({
  productInputRef,
  isProductSearchOpen,
  isPaymentModalOpen,
  isQuickCreateProductMounted,
  isQuickCreateCustomerMounted,
}: ScannerFocusRestorationInput) {
  // Mount: focus the search input on first render so the cashier can
  // scan immediately. Re-runs only when the page mounts; productInputRef
  // is a stable ref object so referencing it does not retrigger.
  useEffect(() => {
    focusSearchInput(productInputRef);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Transition watcher: when any tracked modal closes (true → false),
  // restore focus to the search input. Open transitions are ignored
  // so the cashier can interact inside the modal normally.
  const prevOpenStateRef = useRef({
    productSearch: false,
    payment: false,
    quickProduct: false,
    quickCustomer: false,
  });
  useEffect(() => {
    const prev = prevOpenStateRef.current;
    const closedAny =
      (prev.productSearch && !isProductSearchOpen) ||
      (prev.payment && !isPaymentModalOpen) ||
      (prev.quickProduct && !isQuickCreateProductMounted) ||
      (prev.quickCustomer && !isQuickCreateCustomerMounted);
    if (closedAny) {
      focusSearchInput(productInputRef);
    }
    prevOpenStateRef.current = {
      productSearch: isProductSearchOpen,
      payment: isPaymentModalOpen,
      quickProduct: isQuickCreateProductMounted,
      quickCustomer: isQuickCreateCustomerMounted,
    };
  }, [
    productInputRef,
    isProductSearchOpen,
    isPaymentModalOpen,
    isQuickCreateProductMounted,
    isQuickCreateCustomerMounted,
  ]);
}
