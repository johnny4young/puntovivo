import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { playScanError } from '@/lib/sound';
import type { ProductSearchSelection } from '@/types';
import { parseCommandBarMode, quantityFitsProduct } from './commandBarGrammar';
import { useCommandBarCustomers } from './useCommandBarCustomers';
import {
  isTicketCustomerFrozen,
  useCartWorkspaceStore,
  type CartWorkspace,
} from './useCartWorkspaceStore';
import { useQuickCreateStore } from './useQuickCreateStore';

export interface AttachedCustomer {
  id: string;
  name: string;
}

interface UseSalesCommandBarParams {
  /** What is typed in the bar. */
  query: string;
  activeWorkspace: CartWorkspace | null;
  canCreateCustomer: boolean;
  addProduct: (selection: ProductSearchSelection, quantity: number | null) => void;
}

/** State and handlers behind the register command bar's prefixes. */
export function useSalesCommandBar({
  query,
  activeWorkspace,
  canCreateCustomer,
  addProduct,
}: UseSalesCommandBarParams) {
  const { t } = useTranslation('sales');
  const toast = useToast();
  // The ref lets async scan handlers read the latest `N*` without re-subscribing.
  const [pendingQuantity, setPendingQuantityState] = useState<number | null>(null);
  const pendingRef = useRef<number | null>(null);
  const workspaceId = activeWorkspace?.id ?? null;
  const canAttach = activeWorkspace !== null && !isTicketCustomerFrozen(activeWorkspace);
  const mode = parseCommandBarMode(query);
  const customerLookup = useCommandBarCustomers(
    mode.kind === 'customer' ? mode.query : '',
    canAttach && mode.kind === 'customer'
  );

  const setPendingQuantity = useCallback((next: number | null) => {
    pendingRef.current = next;
    setPendingQuantityState(next);
  }, []);

  /** Consumes the pending `N*` for this product; a decimal on a whole-unit product is refused and kept. */
  const takePendingQuantity = useCallback(
    (product: { name: string; sellByFraction: boolean }): number | null | 'rejected' => {
      const quantity = pendingRef.current;
      if (quantity === null) return null;
      if (!quantityFitsProduct(quantity, product)) {
        playScanError();
        toast.warning({ title: t('commandBar.quantity.wholeUnits', { product: product.name }) });
        return 'rejected';
      }
      setPendingQuantity(null);
      return quantity;
    },
    [setPendingQuantity, t, toast]
  );

  return {
    /** Plain text for the product search; empty while an @ or / command is typed. */
    searchText: mode.kind === 'search' ? query : '',
    pendingQuantity,
    setPendingQuantity,
    takePendingQuantity,
    selectProduct: (selection: ProductSearchSelection) => {
      const quantity = takePendingQuantity(selection.product);
      if (quantity !== 'rejected') addProduct(selection, quantity);
    },
    customers: customerLookup.customers,
    isLoadingCustomers: customerLookup.isLoading,
    attachCustomer:
      workspaceId !== null && canAttach
        ? (customer: AttachedCustomer | null) =>
            useCartWorkspaceStore.getState().setCustomer(workspaceId, customer)
        : undefined,
    createCustomer:
      canAttach && canCreateCustomer
        ? (name: string) =>
            useQuickCreateStore.getState().requestCreateCustomer({ defaultName: name })
        : undefined,
  };
}

export type SalesCommandBar = ReturnType<typeof useSalesCommandBar>;
