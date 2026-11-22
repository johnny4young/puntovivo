import { useCartWorkspaceStore } from '@/features/sales/useCartWorkspaceStore';
import type { Sale } from '@/types';

/** Opens the replacement sale linked to a return, keeping the original customer and tier. */
export function startExchange(sale: Sale, returnId: string, ownerKey: string) {
  useCartWorkspaceStore.getState().hydrateFromReturn({
    ownerKey,
    returnId,
    saleNumber: sale.saleNumber,
    customerId: sale.customerId ?? null,
    customerName: sale.customerName ?? sale.customerNameSnapshot ?? null,
    priceTier: sale.priceTier ?? 1,
  });
}
