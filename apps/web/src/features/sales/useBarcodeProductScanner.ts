import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import {
  getCartItemKey,
  mergeCartItem,
  updateCartItem,
  type SaleCartItem,
} from '@/features/sales/saleCart';
import {
  useBarcodeWedgeListener,
  type WedgeConfig,
} from '@/features/sales/useBarcodeWedgeListener';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import type { ProductSearchItem, ProductSearchSelection } from '@/types';

/** Functional or value update for the active cart, mirroring SalesPage's `setCartItems` wrapper. */
type SetCartItemsArg = SaleCartItem[] | ((previous: SaleCartItem[]) => SaleCartItem[]);

/**
 * Params for {@link useBarcodeProductScanner}.
 *
 * `scannerConfig` is derived in SalesPage from the SHARED
 * `peripherals.activeForSite` query (one subscription for scanner +
 * drawer + auto-print — ENG-061), so it is passed in rather than
 * re-queried here. The modal-open flags gate the wedge listener so a scan
 * never fires while a modal owns the keyboard. `productInputRef` is the
 * page search input whitelisted so the wedge keeps firing even when the
 * cashier sees focus on it. The four setters mutate shell-owned state.
 */
interface UseBarcodeProductScannerParams {
  scannerConfig: WedgeConfig;
  isResumedCart: boolean;
  isProductSearchOpen: boolean;
  isPaymentModalOpen: boolean;
  isCashSessionModalOpen: boolean;
  isCashSessionCloseModalOpen: boolean;
  isCashSessionMovementModalOpen: boolean;
  productInputRef: RefObject<HTMLInputElement | null>;
  setCartItems: (update: SetCartItemsArg) => void;
  setSelectedCartItemKey: (key: string | null) => void;
  setProductSearchQuery: Dispatch<SetStateAction<string>>;
  setSaleError: Dispatch<SetStateAction<string | null>>;
}

/**
 * ENG-061 — barcode scanner pipeline.
 *
 * `peripheralsForSiteQuery` is declared once near the top of SalesPage so
 * all peripheral consumers (scanner, cash drawer, auto-print) share a
 * single tRPC subscription; the shell derives `scannerConfig` from it and
 * passes it in. GS1 weight/price-embedded labels override quantity /
 * unitPrice server-side so the cart line reflects the weighed package.
 *
 * Acyclic leaf: the wedge listener calls `handleBarcodeScan`, which calls
 * the injected cart setters; nothing calls back into the scanner.
 */
export function useBarcodeProductScanner({
  scannerConfig,
  isResumedCart,
  isProductSearchOpen,
  isPaymentModalOpen,
  isCashSessionModalOpen,
  isCashSessionCloseModalOpen,
  isCashSessionMovementModalOpen,
  productInputRef,
  setCartItems,
  setSelectedCartItemKey,
  setProductSearchQuery,
  setSaleError,
}: UseBarcodeProductScannerParams) {
  const { t } = useTranslation(['sales', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const { currentSite } = useTenant();

  const handleBarcodeScan = useCallback(
    async (rawCode: string) => {
      if (!currentSite) return;
      if (isResumedCart) {
        toast.info({ title: t('sales:scanner.resumedCartLocked') });
        return;
      }
      try {
        const result = await utils.products.lookupByBarcode.fetch({
          barcode: rawCode,
          gs1Scheme: scannerConfig.gs1Scheme ?? 'generic',
        });
        if (!result) {
          toast.warning({ title: t('sales:scanner.notFound') });
          return;
        }
        // The tRPC output carries SQLite-shaped nullable fields where the
        // ProductSearchItem domain type expects non-null booleans. The
        // `isActive=true` filter on the server makes the cast safe here;
        // mirrors the projection ProductSearchDialog already does.
        const product = result.product as unknown as ProductSearchItem;
        const unitAssignments = product.unitAssignments ?? [];
        const baseUnit =
          unitAssignments.find(u => u.isBase) ?? unitAssignments[0];
        if (!baseUnit) {
          toast.error({ title: t('sales:scanner.noBaseUnit') });
          return;
        }
        // Packaging-barcode scans resolve to a specific unit (a case/pack);
        // select it instead of the base so the cart line carries its
        // equivalence and price. Base-barcode scans leave resolvedUnitId null.
        const scannedUnit =
          result.resolvedUnitId
            ? unitAssignments.find(u => u.unitId === result.resolvedUnitId) ?? baseUnit
            : baseUnit;
        const overridePrice =
          typeof result.suggestedPrice === 'number'
            ? result.suggestedPrice
            : null;
        const overrideQuantity =
          typeof result.suggestedQuantity === 'number'
            ? result.suggestedQuantity
            : null;
        const selection: ProductSearchSelection = {
          product,
          unit: scannedUnit,
          price: overridePrice ?? scannedUnit.price ?? product.price,
        };
        const itemKey = getCartItemKey(selection.product.id, selection.unit.unitId);
        setCartItems(currentItems => {
          const merged = mergeCartItem(currentItems, selection);
          if (overrideQuantity !== null) {
            return merged.map(item =>
              item.key === itemKey
                ? updateCartItem(item, { quantity: overrideQuantity })
                : item
            );
          }
          return merged;
        });
        setSelectedCartItemKey(itemKey);
        setProductSearchQuery('');
        setSaleError(null);
        if (overrideQuantity !== null) {
          toast.success({ title: t('sales:scanner.weightFromLabel') });
        } else if (overridePrice !== null) {
          toast.success({ title: t('sales:scanner.priceFromLabel') });
        }
      } catch (error) {
        const fallback = t('sales:scanner.lookupFailed');
        toast.error({
          title: fallback,
          description: translateServerError(error, t, fallback),
        });
      }
    },
    [
      currentSite,
      isResumedCart,
      setCartItems,
      setSelectedCartItemKey,
      // setProductSearchQuery + setSaleError are stable shell useState
      // setters passed in as props; listed here to satisfy exhaustive-deps
      // now that they are params (identity stable → no behavior change).
      setProductSearchQuery,
      setSaleError,
      t,
      toast,
      utils,
      scannerConfig.gs1Scheme,
    ]
  );

  useBarcodeWedgeListener({
    config: scannerConfig,
    onScan: handleBarcodeScan,
    isProductSearchOpen,
    isPaymentModalOpen,
    isCashSessionModalOpen:
      isCashSessionModalOpen ||
      isCashSessionCloseModalOpen ||
      isCashSessionMovementModalOpen,
    enabled: !!currentSite,
    // ENG-105f — Whitelist the page-level search input so the wedge
    // continues to fire even when the cashier sees focus on it
    // (autofocus on mount + restore after modal close). Manual
    // typing still works because the >30ms inter-character gap
    // resets the buffer before it reaches `minLength`.
    scannerInputRef: productInputRef,
  });
}
