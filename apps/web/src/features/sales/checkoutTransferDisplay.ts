import { create } from 'zustand';

import type { CustomerDisplayTransfer } from '@/features/surfaces/customerDisplayProjection';

interface CheckoutTransferDisplayState {
  transfer: CustomerDisplayTransfer | null;
  /** The checkout that put this QR on screen, so it cannot clear another's. */
  ownerId: string | null;
  setTransfer: (transfer: CustomerDisplayTransfer | null, ownerId?: string | null) => void;
  clearTransfer: (ownerId: string) => void;
}

/** The transfer QR the cashier is showing, mirrored to the customer display. */
export const useCheckoutTransferDisplay = create<CheckoutTransferDisplayState>(set => ({
  transfer: null,
  ownerId: null,
  setTransfer: (transfer, ownerId = null) => set({ transfer, ownerId }),
  /**
   * Two checkouts on the same site share one display slot. A QR may only be
   * taken down by the checkout that put it there; otherwise a second till
   * closing its own transfer would blank a QR the customer is paying against.
   */
  clearTransfer: ownerId =>
    set(state => (state.ownerId === ownerId ? { transfer: null, ownerId: null } : state)),
}));
