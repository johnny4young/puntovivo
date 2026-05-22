/**
 * ENG-105c — Quick-create transient state for SalesPage.
 *
 * Coordinates the "request to open ProductFormModal / CustomerFormModal
 * with optional pre-fill" handshake between three places that cannot
 * wire a callback directly:
 * - `ProductSearchDialog` empty-state CTA (open product form with
 *   `defaultName=query`).
 * - `CommandPalette` actions (`Mod+K` → "Create product" / "Create
 *   customer"; may fire from any route, navigates to `/sales` first).
 * - Customer quick-create dispatchers that need the resulting customer
 *   attached when the payment modal opens.
 *
 * `SalesPage` subscribes to both slots, mounts the appropriate modal
 * when the slot has a value, and calls `consume*()` on close so the
 * slot resets. The store is intentionally NOT persisted — these are
 * one-shot requests, not durable state.
 *
 * @module features/sales/useQuickCreateStore
 */

import { create } from 'zustand';

export interface QuickCreateRequest {
  /**
   * Optional value used to pre-fill the corresponding name field in
   * the form modal. `null` means open the modal with empty defaults
   * (palette dispatch path).
   */
  defaultName: string | null;
}

interface QuickCreateState {
  requestedCreateProduct: QuickCreateRequest | null;
  requestedCreateCustomer: QuickCreateRequest | null;
  /**
   * ENG-105c2 — id of the customer most recently created via the
   * quick-create flow, waiting to be auto-attached to the next
   * `SalePaymentModal` mount. `null` means nothing pending. The
   * payment modal consumes this slot on its open transition so the
   * customer is selected without a second pick from the cashier.
   */
  pendingCustomerAttachId: string | null;
}

interface QuickCreateActions {
  /** Open the product modal. Existing pending request is overwritten. */
  requestCreateProduct(request: QuickCreateRequest): void;
  /** Open the customer modal. Existing pending request is overwritten. */
  requestCreateCustomer(request: QuickCreateRequest): void;
  /**
   * Return the pending product request and clear the slot. Callers
   * use this after consuming the request to mount the modal.
   * Returns `null` if nothing is queued.
   */
  consumeCreateProduct(): QuickCreateRequest | null;
  /** Mirror of `consumeCreateProduct` for the customer slot. */
  consumeCreateCustomer(): QuickCreateRequest | null;
  /**
   * ENG-105c2 — flag a freshly-created customer for auto-attach to
   * the next `SalePaymentModal` mount. Overwrites any previous
   * pending id (last-created wins).
   */
  setPendingCustomerAttach(id: string): void;
  /**
   * ENG-105c2 — read and clear the auto-attach slot. Returns the
   * pending id or `null` when nothing is waiting. Called from
   * SalePaymentModal on the open transition.
   */
  consumePendingCustomerAttach(): string | null;
  /** Clear all slots without consuming. Used by tests / logout. */
  reset(): void;
}

type QuickCreateStore = QuickCreateState & QuickCreateActions;

export const useQuickCreateStore = create<QuickCreateStore>((set, get) => ({
  requestedCreateProduct: null,
  requestedCreateCustomer: null,
  pendingCustomerAttachId: null,

  requestCreateProduct(request) {
    set({ requestedCreateProduct: request });
  },

  requestCreateCustomer(request) {
    set({ requestedCreateCustomer: request });
  },

  consumeCreateProduct() {
    const pending = get().requestedCreateProduct;
    if (pending) {
      set({ requestedCreateProduct: null });
    }
    return pending;
  },

  consumeCreateCustomer() {
    const pending = get().requestedCreateCustomer;
    if (pending) {
      set({ requestedCreateCustomer: null });
    }
    return pending;
  },

  setPendingCustomerAttach(id) {
    set({ pendingCustomerAttachId: id });
  },

  consumePendingCustomerAttach() {
    const pending = get().pendingCustomerAttachId;
    if (pending) {
      set({ pendingCustomerAttachId: null });
    }
    return pending;
  },

  reset() {
    set({
      requestedCreateProduct: null,
      requestedCreateCustomer: null,
      pendingCustomerAttachId: null,
    });
  },
}));

// =============================================================================
// Selectors — stable references for component subscribers.
// =============================================================================

export const selectRequestedCreateProduct = (state: QuickCreateStore) =>
  state.requestedCreateProduct;

export const selectRequestedCreateCustomer = (state: QuickCreateStore) =>
  state.requestedCreateCustomer;

export const selectPendingCustomerAttachId = (state: QuickCreateStore) =>
  state.pendingCustomerAttachId;
