import { create } from 'zustand';

import type { CustomerDisplayTransfer } from '@/features/surfaces/customerDisplayProjection';

interface CheckoutTransferDisplayState {
  transfer: CustomerDisplayTransfer | null;
  setTransfer: (transfer: CustomerDisplayTransfer | null) => void;
}

/** The transfer QR the cashier is showing, mirrored to the customer display. */
export const useCheckoutTransferDisplay = create<CheckoutTransferDisplayState>(set => ({
  transfer: null,
  setTransfer: transfer => set({ transfer }),
}));
