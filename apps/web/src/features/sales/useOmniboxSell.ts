import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { NavigateFunction } from 'react-router';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { extractServerErrorCode, translateServerError } from '@/lib/translateServerError';
import { playScanError, playScanSuccess } from '@/lib/sound';
import { trpc } from '@/lib/trpc';
import type { ProductSearchItem } from '@/types';
import { addOmniboxSelectionToCart, resolveBarcodeCartSelection } from './salesOmnibox';

/**
 * () — "la app entera es una caja". Resolves an omnibox query
 * from the command palette into the cashier's active cart:
 *
 * - Exact barcode hit (base or packaging code, same `lookupByBarcode`
 * pipeline the POS scanner uses, including price/weight-label overrides)
 * → merge into the owner's cart workspace and land on /sales with the
 * line already selected.
 * - No exact match → land on /sales with the product-search dialog
 * prefilled with the query (router state, consumed once by SalesPage).
 *
 * The cart write goes STRAIGHT to the zustand workspace store, so it works
 * from ANY screen — SalesPage does not need to be mounted. Resumed drafts and
 * accepted quotations are never touched: when either locked workspace is
 * active, the sale lands in a fresh (or reusable) local draft instead,
 * mirroring the materialization rules of `useSalesCart`.
 */
export function useOmniboxSell() {
  const { t } = useTranslation(['sales', 'scannerErrors', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const { currentTenant, currentSite } = useTenant();

  return useCallback(
    async (rawQuery: string, navigate: NavigateFunction): Promise<void> => {
      const query = rawQuery.trim();
      const ownerKey = currentTenant && user ? `${currentTenant.id}:${user.id}` : null;
      if (!query || !ownerKey || !currentSite) {
        navigate('/sales');
        return;
      }

      let resolved: Awaited<ReturnType<typeof utils.products.lookupByBarcode.fetch>>;
      try {
        resolved = await utils.products.lookupByBarcode.fetch({
          barcode: query,
        }, { retry: false });
      } catch (error) {
        if (extractServerErrorCode(error)) {
          // A deterministic server rejection (for example an incompatible
          // GS1 physical unit) is operator guidance, not a search miss. Keep
          // the cashier on the current screen and surface the safe copy.
          const fallback = t('sales:scanner.lookupFailed');
          playScanError();
          toast.error({
            title: fallback,
            description: translateServerError(error, t, fallback),
          });
          return;
        }
        // Lookup failure degrades to the search-dialog path below — the
        // omnibox must never dead-end the operator on a network hiccup.
        resolved = null;
      }

      if (resolved) {
        // Same projection contract as useBarcodeProductScanner: the
        // isActive=true server filter makes the domain cast safe, and a
        // packaging-barcode hit selects its specific unit.
        const product = resolved.product as unknown as ProductSearchItem;
        const cartSelection = resolveBarcodeCartSelection({
          product,
          resolvedUnitId: resolved.resolvedUnitId,
          suggestedPrice:
            typeof resolved.suggestedPrice === 'number' ? resolved.suggestedPrice : null,
          suggestedQuantity:
            typeof resolved.suggestedQuantity === 'number' ? resolved.suggestedQuantity : null,
        });
        if (cartSelection) {
          addOmniboxSelectionToCart({
            ownerKey,
            ...cartSelection,
          });
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
    [currentTenant, currentSite, user, utils, toast, t]
  );
}
