/**
 * ENG-105c — Quick-create transient state for SalesPage.
 *
 * Coordinates the "request to open ProductFormModal / CustomerFormModal
 * with optional pre-fill" handshake between three places that cannot
 * wire a callback directly:
 * - `ProductSearchDialog` empty-state CTA (open product form with
 *   `defaultName=query`).
 * - `SalePaymentModal` customer-picker empty-state CTA (open customer
 *   form with `defaultName=query`).
 * - `CommandPalette` actions (`Mod+K` → "Create product" / "Create
 *   customer"; may fire from any route, navigates to `/sales` first).
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
  /** Clear both slots without consuming. Used by tests / logout. */
  reset(): void;
}

type QuickCreateStore = QuickCreateState & QuickCreateActions;

export const useQuickCreateStore = create<QuickCreateStore>((set, get) => ({
  requestedCreateProduct: null,
  requestedCreateCustomer: null,

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

  reset() {
    set({ requestedCreateProduct: null, requestedCreateCustomer: null });
  },
}));

// =============================================================================
// Selectors — stable references for component subscribers.
// =============================================================================

export const selectRequestedCreateProduct = (state: QuickCreateStore) =>
  state.requestedCreateProduct;

export const selectRequestedCreateCustomer = (state: QuickCreateStore) =>
  state.requestedCreateCustomer;
