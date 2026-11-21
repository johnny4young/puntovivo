import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import {
  getBarcodeCartItemKey,
  mergeBarcodeCartItem,
  type SaleCartItem,
} from '@/features/sales/saleCart';
import { resolveBarcodeCartSelection } from '@/features/sales/salesOmnibox';
import { parseQuantityPrefix } from '@/features/sales/commandBarGrammar';
import {
  useBarcodeWedgeListener,
  type WedgeConfig,
} from '@/features/sales/useBarcodeWedgeListener';
import { playScanError, playScanSuccess } from '@/lib/sound';
import { extractServerErrorCode, translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import type { ProductSearchItem } from '@/types';

/** Functional or value update for the active cart, mirroring SalesPage's `setCartItems` wrapper. */
type SetCartItemsArg = SaleCartItem[] | ((previous: SaleCartItem[]) => SaleCartItem[]);

/**
 * Params for {@link useBarcodeProductScanner}.
 *
 * `scannerConfig` is derived in SalesPage from the SHARED
 * `peripherals.activeForSite` query (one subscription for scanner +
 * drawer + auto-print — ), so it is passed in rather than
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
  /** Consumes the command bar's `N*` quantity for the scanned product. */
  takePendingQuantity?: (product: ProductSearchItem) => number | null | 'rejected';
}

/**
 * barcode scanner pipeline.
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
  takePendingQuantity,
}: UseBarcodeProductScannerParams) {
  const { t } = useTranslation(['sales', 'scannerErrors', 'errors', 'common']);
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
      // A fast `3*` right before the scan lands in the same burst; the bar already took the quantity.
      const code = parseQuantityPrefix(rawCode)?.rest || rawCode;
      try {
        const result = await utils.products.lookupByBarcode.fetch(
          {
            barcode: code,
            siteId: currentSite.id,
          },
          { retry: false }
        );
        if (!result) {
          playScanError();
          toast.warning({ title: t('sales:scanner.notFound') });
          return;
        }
        // The tRPC output carries SQLite-shaped nullable fields where the
        // ProductSearchItem domain type expects non-null booleans. The
        // `isActive=true` filter on the server makes the cast safe here;
        // mirrors the projection ProductSearchDialog already does.
        const product = result.product as unknown as ProductSearchItem;
        const resolved = resolveBarcodeCartSelection({
          product,
          resolvedUnitId: result.resolvedUnitId,
          suggestedPrice: result.suggestedPrice,
          suggestedQuantity: result.suggestedQuantity,
        });
        if (!resolved) {
          playScanError();
          toast.error({ title: t('sales:scanner.noBaseUnit') });
          return;
        }
        const { selection, quantityOverride: labelQuantity } = resolved;
        // A weight label states its own quantity, so the typed one waits for the next read.
        const commandQuantity =
          labelQuantity === null ? (takePendingQuantity?.(product) ?? null) : null;
        if (commandQuantity === 'rejected') return;
        const overrideQuantity = labelQuantity ?? commandQuantity;
        const overridePrice = result.suggestedPrice;
        const itemKey = getBarcodeCartItemKey(selection, overridePrice);
        setCartItems(currentItems =>
          mergeBarcodeCartItem(currentItems, selection, {
            quantity: overrideQuantity,
            price: overridePrice,
          })
        );
        setSelectedCartItemKey(itemKey);
        setProductSearchQuery('');
        setSaleError(null);
        playScanSuccess();
        if (labelQuantity !== null) {
          toast.success({ title: t('sales:scanner.weightFromLabel') });
        } else if (overridePrice !== null) {
          toast.success({ title: t('sales:scanner.priceFromLabel') });
        }
      } catch (error) {
        playScanError();
        if (extractServerErrorCode(error) === 'GS1_CHECK_DIGIT_INVALID') {
          toast.warning({ title: translateServerError(error, t, t('sales:scanner.notFound')) });
          return;
        }
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
      takePendingQuantity,
      t,
      toast,
      utils,
    ]
  );

  useBarcodeWedgeListener({
    config: scannerConfig,
    onScan: handleBarcodeScan,
    isProductSearchOpen,
    isPaymentModalOpen,
    isCashSessionModalOpen:
      isCashSessionModalOpen || isCashSessionCloseModalOpen || isCashSessionMovementModalOpen,
    enabled: !!currentSite,
    // Whitelist the page-level search input so the wedge
    // continues to fire even when the cashier sees focus on it
    // (autofocus on mount + restore after modal close). Manual
    // typing still works because the >30ms inter-character gap
    // resets the buffer before it reaches `minLength`.
    scannerInputRef: productInputRef,
  });

  return { handleBarcodeScan };
}
