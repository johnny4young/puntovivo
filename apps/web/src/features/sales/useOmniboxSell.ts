import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { NavigateFunction } from 'react-router-dom';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { playScanSuccess } from '@/lib/sound';
import { trpc } from '@/lib/trpc';
import type { ProductSearchItem, ProductSearchSelection } from '@/types';
import { getCartItemKey, mergeCartItem, updateCartItem } from './saleCart';
import { useCartWorkspaceStore } from './useCartWorkspaceStore';

/**
 * ENG-203 (WC-C5) — "la app entera es una caja". Resolves an omnibox query
 * from the command palette into the cashier's active cart:
 *
 * - Exact barcode hit (base or packaging code, same `lookupByBarcode`
 *   pipeline the POS scanner uses, including price/weight-label overrides)
 *   → merge into the owner's cart workspace and land on /sales with the
 *   line already selected.
 * - No exact match → land on /sales with the product-search dialog
 *   prefilled with the query (router state, consumed once by SalesPage).
 *
 * The cart write goes STRAIGHT to the zustand workspace store, so it works
 * from ANY screen — SalesPage does not need to be mounted. Resumed drafts
 * (server-locked items) are never touched: when the active workspace is
 * resumed, the sale lands in a fresh (or reusable) local draft instead,
 * mirroring the materialization rules of `useSalesCart`.
 */
export function useOmniboxSell() {
  const { t } = useTranslation(['sales', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const { currentTenant, currentSite } = useTenant();

  /**
   * Pick (or materialize) the workspace the omnibox sale should land in and
   * make it active. Mirrors `useSalesCart`'s owner materialization, plus the
   * resumed-cart guard: a workspace with `serverSaleId` is never written.
   */
  const ensureWritableWorkspace = useCallback((ownerKey: string): string => {
    const state = useCartWorkspaceStore.getState();
    const active = state.activeId ? (state.workspaces[state.activeId] ?? null) : null;
    if (active && active.ownerKey === ownerKey && active.serverSaleId === null) {
      return active.id;
    }
    const reusableOwned = Object.values(state.workspaces).find(
      workspace => workspace.ownerKey === ownerKey && workspace.serverSaleId === null
    );
    if (reusableOwned) {
      state.setActive(reusableOwned.id);
      return reusableOwned.id;
    }
    return state.createDraft(ownerKey);
  }, []);

  return useCallback(
    async (rawQuery: string, navigate: NavigateFunction): Promise<void> => {
      const query = rawQuery.trim();
      const ownerKey = currentTenant && user ? `${currentTenant.id}:${user.id}` : null;
      if (!query || !ownerKey || !currentSite) {
        navigate('/sales');
        return;
      }

      let resolved: Awaited<ReturnType<typeof utils.products.lookupByBarcode.fetch>> = null;
      try {
        resolved = await utils.products.lookupByBarcode.fetch({
          barcode: query,
          gs1Scheme: 'generic',
        });
      } catch {
        // Lookup failure degrades to the search-dialog path below — the
        // omnibox must never dead-end the operator on a network hiccup.
        resolved = null;
      }

      if (resolved) {
        // Same projection contract as useBarcodeProductScanner: the
        // isActive=true server filter makes the domain cast safe, and a
        // packaging-barcode hit selects its specific unit.
        const product = resolved.product as unknown as ProductSearchItem;
        const unitAssignments = product.unitAssignments ?? [];
        const baseUnit = unitAssignments.find(u => u.isBase) ?? unitAssignments[0];
        if (baseUnit) {
          const scannedUnit = resolved.resolvedUnitId
            ? (unitAssignments.find(u => u.unitId === resolved.resolvedUnitId) ?? baseUnit)
            : baseUnit;
          const overridePrice =
            typeof resolved.suggestedPrice === 'number' ? resolved.suggestedPrice : null;
          const overrideQuantity =
            typeof resolved.suggestedQuantity === 'number' ? resolved.suggestedQuantity : null;
          const selection: ProductSearchSelection = {
            product,
            unit: scannedUnit,
            price: overridePrice ?? scannedUnit.price ?? product.price,
          };

          const workspaceId = ensureWritableWorkspace(ownerKey);
          const store = useCartWorkspaceStore.getState();
          const itemKey = getCartItemKey(selection.product.id, selection.unit.unitId);
          const currentItems = store.workspaces[workspaceId]?.items ?? [];
          let nextItems = mergeCartItem(currentItems, selection);
          if (overrideQuantity !== null) {
            nextItems = nextItems.map(item =>
              item.key === itemKey ? updateCartItem(item, { quantity: overrideQuantity }) : item
            );
          }
          store.updateCart(workspaceId, nextItems);
          store.setSelectedItem(workspaceId, itemKey);
          playScanSuccess();
          toast.success({
            title: t('sales:omnibox.added', { product: product.name }),
          });
          navigate('/sales');
          return;
        }
      }

      // No exact match (or no sellable unit): land on the register with the
      // product-search dialog prefilled so the operator finishes by name.
      navigate('/sales', { state: { omniboxQuery: query } });
    },
    [currentTenant, currentSite, user, utils, toast, t, ensureWritableWorkspace]
  );
}
