import { useState } from 'react';
import { canAccessRole, salesRoles } from '@/features/auth/roleAccess';
import { useIsModuleActive } from '@/features/modules';
import { useRegisterZone } from '@/features/modules/useRegisterZone';
import type { UserRole } from '@/types';
import type { CompletedSaleSummary } from './SaleCompleteStrip';
import { useCartWorkspaceStore, type CartWorkspace } from './useCartWorkspaceStore';

interface UseSaleDeliveryArgs {
  activeWorkspace: Pick<CartWorkspace, 'id' | 'deliveryRequested'> | null;
  hasItems: boolean;
  /** The sale on the completion strip, deliverable until the next ticket starts. */
  completedSale: CompletedSaleSummary | null;
  hasCashSession: boolean;
  userRole: UserRole | undefined;
}

/**
 * «Entregar en obra»: a ticket with lines is marked to go out once charged; with the
 * ticket empty the key sends the sale just charged.
 */
export function useSaleDelivery({
  activeWorkspace,
  hasItems,
  completedSale,
  hasCashSession,
  userRole,
}: UseSaleDeliveryArgs) {
  const zoneOn = useRegisterZone('quote-delivery');
  const moduleOn = useIsModuleActive('delivery');
  const [sale, setSale] = useState<CompletedSaleSummary | null>(null);
  // A sale takes one delivery; the server refuses a second one.
  const [deliveredSaleId, setDeliveredSaleId] = useState<string | null>(null);

  const shown = zoneOn && moduleOn && hasCashSession && canAccessRole(userRole, salesRoles);
  const ticket = activeWorkspace && hasItems ? activeWorkspace : null;
  const pendingSale = completedSale && completedSale.id !== deliveredSaleId ? completedSale : null;
  const pressKey = () => {
    if (ticket) {
      useCartWorkspaceStore.getState().setDeliveryRequested(ticket.id, !ticket.deliveryRequested);
    } else {
      setSale(pendingSale);
    }
  };

  const onSaleCompleted = (completed: CompletedSaleSummary) => {
    if (shown && completed.deliveryRequested) setSale(completed);
  };
  const close = (created: boolean) => {
    if (created && sale) setDeliveredSaleId(sale.id);
    setSale(null);
  };

  return {
    shown,
    active: ticket?.deliveryRequested ?? false,
    onKey: shown && (ticket || pendingSale) ? pressKey : undefined,
    sale,
    close,
    onSaleCompleted,
  };
}

export type SaleDelivery = ReturnType<typeof useSaleDelivery>;
