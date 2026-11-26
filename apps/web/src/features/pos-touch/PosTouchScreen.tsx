/**
 * Touch POS V1 main surface.
 *
 * 2-col responsive layout for tablet-first checkout:
 * - Left: category tabs row + product tile grid.
 * - Right: persistent cart sidebar with customer slot + lines
 * + Cobrar CTA. Below 1024 px the cart sidebar stacks under
 * the grid so the tile area can keep its full width.
 *
 * Reuses the same primitives as the desktop sales flow:
 * - `trpc.products.list` (catalog + category filter)
 * - `trpc.categories.tree` (sidebar tabs)
 * - `trpc.cashSessions.getActive` (Cobrar gate)
 * - `trpc.sales.create` (single-tender cash checkout)
 * - `useElectronicInvoiceAvailability` + `SaleElectronicInvoiceSection`
 * (buyer asked for an electronic invoice), shared with the drawer
 * - `mergeCartItem` from features/sales/saleCart for the line
 * merge + qty math
 * - `useTenant` from features/tenant/TenantProvider for the
 * active site context
 *
 * Touch-first quality bar (per  plan §8):
 * - Every interactive element ≥ 44 × 44 px.
 * - Responsive grid: 2 / 3 / 4 / 6 cols across breakpoints.
 * - `auto-rows-fr` keeps tile heights uniform across long /
 * short product names.
 * - No horizontal overflow at 320 px (tested via Playwright).
 *
 * Loyalty:
 * - The cart sidebar wires a forward-compatible
 * `customer.loyaltyProfile` slot. The customers schema does
 * not carry this today;  will land it. Until then
 * the badge + "Sumar puntos" CTA stay invisible because
 * `loyaltyProfile` is `undefined`.
 */
import {
  lazy,
  Suspense,
  useCallback,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent,
  type SetStateAction,
} from 'react';
import { usePriceIncludesTax } from '@/features/pricing/PricingContext';
import { useBarcodeProductScanner } from '@/features/sales/useBarcodeProductScanner';
import { deriveScannerConfig } from '@/features/sales/useBarcodeWedgeListener';
import { keepPreviousData } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { PageLoadingState } from '@/components/feedback/LoadingState';
import { useDebouncedValue } from '@/hooks';
import { useTenant } from '@/features/tenant/TenantProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { invalidateCommittedGroups, SALE_COMPLETION_INVALIDATIONS } from '@/lib/invalidateGroups';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import {
  applyPriceTier,
  mergeBarcodeCartItem,
  mergeCartItem,
  replaceCartItemUnit,
  type SaleCartItem,
} from '@/features/sales/saleCart';
import { getCartSummary, getPayableCartTotal } from '@/features/sales/saleCartTotals';
import { useResolvedLocale } from '@/features/locale/LocaleProvider';
import { selectionFromHydratedProduct } from '@/features/sales/productSelection';
import { QuickKeyValueForm } from '@/features/sales/QuickKeyValueForm';
import { useWeighedItem } from '@/features/sales/useWeighedItem';
import {
  useQuickTileSelection,
  useSiteQuickKeys,
  type QuickTile,
} from '@/features/sales/siteQuickKeys';
import type { TouchSaleCreateInput } from './PosTouchModals';
import type { Customer, Product, ProductSearchSelection } from '@/types';
import { translateServerError } from '@/lib/translateServerError';
import { onErrorToast } from '@/lib/mutationHelpers';
import { useIsModuleActive } from '@/features/modules';
import { PosTouchCategoryTabs, type PosTouchCategoryOption } from './PosTouchCategoryTabs';
import { PosTouchProductGrid } from './PosTouchProductGrid';
import { PosTouchQuickKeyGrid } from './PosTouchQuickKeyGrid';
import { PosTouchCartSidebar, type PosTouchCustomer } from './PosTouchCartSidebar';
import { useEmbeddedServerState } from '@/hooks/useEmbeddedServerState';

const LazyPosTouchModals = lazy(() =>
  import('./PosTouchModals').then(module => ({
    default: module.PosTouchModals,
  }))
);

const CATALOG_PAGE_SIZE = 24;
const CATALOG_SEARCH_DEBOUNCE_MS = 250;

export function PosTouchScreen() {
  const priceIncludesTax = usePriceIncludesTax();
  const { t } = useTranslation(['posTouch', 'common', 'fulfillmentErrors', 'salesQuickAccess']);
  const { currentSite, isLoadingSites } = useTenant();
  const toast = useToast();
  const utils = trpc.useUtils();
  const catalogRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const siteId = currentSite?.id ?? '';
  const dineInActive = useIsModuleActive('dine-in');

  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [catalogPage, setCatalogPage] = useState(1);
  const search = useDebouncedValue(searchText.trim(), CATALOG_SEARCH_DEBOUNCE_MS);
  const [cartItems, setCartItems] = useState<SaleCartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<PosTouchCustomer | null>(null);
  const [activePriceTier, setActivePriceTier] = useState<1 | 2 | 3>(1);
  const activePriceTierRef = useRef<1 | 2 | 3>(1);
  const [isCheckoutLocked, setIsCheckoutLocked] = useState(false);
  const checkoutLockedRef = useRef(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentModalKey, setPaymentModalKey] = useState(0);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isCashSessionModalOpen, setIsCashSessionModalOpen] = useState(false);
  const ticketEpochRef = useRef(0);
  const valueTicketEpochRef = useRef(0);
  const { query: quickKeysQuery, tiles: quickTiles } = useSiteQuickKeys(siteId);

  const setTieredCartItems = useCallback<Dispatch<SetStateAction<SaleCartItem[]>>>(update => {
    setCartItems(current => {
      if (checkoutLockedRef.current) return current;
      const next = typeof update === 'function' ? update(current) : update;
      return applyPriceTier(next, activePriceTierRef.current);
    });
  }, []);
  const resolveQuickTile = useQuickTileSelection(siteId);
  // The site's keys open first; a category tab or a search switches to the catalog.
  const [showQuickKeys, setShowQuickKeys] = useState(true);
  const [valueTile, setValueTile] = useState<QuickTile | null>(null);
  // The raw text, not the debounced one, so the keys tab answers on the first tap.
  const quickKeysView = showQuickKeys && quickTiles.length > 0 && !searchText.trim();
  // Holding the grid until the keys arrive keeps a tap from landing on a swapping layout.
  const quickKeysPending = showQuickKeys && quickKeysQuery.isLoading;

  const productsQuery = trpc.products.list.useQuery(
    {
      page: catalogPage,
      perPage: CATALOG_PAGE_SIZE,
      categoryId: activeCategoryId ?? undefined,
      isActive: true,
      siteId,
      search: search || undefined,
    },
    {
      enabled: siteId.length > 0 && !quickKeysView && !quickKeysPending,
      staleTime: 30_000,
      placeholderData: keepPreviousData,
    }
  );
  const categoryCountsQuery = trpc.products.categoryCounts.useQuery(undefined, {
    enabled: siteId.length > 0,
    staleTime: 60_000,
  });
  const categoriesQuery = trpc.categories.tree.useQuery(undefined, {
    enabled: siteId.length > 0,
    staleTime: 60_000,
  });
  const cashSessionQuery = trpc.cashSessions.getActive.useQuery(
    { siteId },
    { enabled: siteId.length > 0 }
  );
  const customersQuery = trpc.customers.list.useQuery(
    { page: 1, perPage: 100, isActive: true },
    { enabled: siteId.length > 0, staleTime: 30_000 }
  );
  const customerOptions = useMemo<PosTouchCustomer[]>(
    () =>
      (customersQuery.data?.items ?? []).map(customer => ({
        id: customer.id,
        name: customer.name,
        priceTier: customer.priceTier === 2 || customer.priceTier === 3 ? customer.priceTier : 1,
      })),
    [customersQuery.data]
  );

  const products = useMemo<Product[]>(
    () =>
      (productsQuery.data?.items ?? []).map(item => ({
        ...item,
        isActive: item.isActive ?? false,
        syncStatus: item.syncStatus ?? undefined,
        syncVersion: item.syncVersion ?? undefined,
      })) as Product[],
    [productsQuery.data]
  );
  const categoryOptions = useMemo<PosTouchCategoryOption[]>(() => {
    const tree = categoriesQuery.data?.items ?? [];
    const counts = new Map(
      (categoryCountsQuery.data?.categories ?? []).map(entry => [entry.categoryId, entry.count])
    );
    return tree.map(node => ({
      id: node.id,
      name: node.name,
      count: counts.get(node.id) ?? 0,
    }));
  }, [categoriesQuery.data, categoryCountsQuery.data]);

  const cartQuantities = useMemo(() => {
    const quantities = new Map<string, number>();
    for (const item of cartItems) {
      quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
    }
    return quantities;
  }, [cartItems]);

  const { currency } = useResolvedLocale();
  // Shown and tendered as the payable total, the amount sales.create completes.
  const summary = useMemo(() => {
    const cart = getCartSummary(cartItems, priceIncludesTax);
    return { ...cart, total: getPayableCartTotal(cart, currency).total };
  }, [cartItems, currency, priceIncludesTax]);

  // The grid query is capped at perPage: 200 — surface the truncation
  // instead of silently hiding the tail of a bigger catalog.
  const catalogTotal = productsQuery.data?.totalItems ?? products.length;
  const catalogPages = productsQuery.data?.totalPages ?? 1;
  const currentCatalogPage = Math.min(catalogPage, Math.max(catalogPages, 1));
  // The catalog can shrink under an open page; follow it instead of showing an empty grid.
  if (catalogPage > currentCatalogPage) setCatalogPage(currentCatalogPage);

  // `sales.create` is a critical command (idempotency +
  // command envelope), so we ride the same `useCriticalMutation`
  // helper that SalesPage uses instead of `trpc.sales.create.useMutation`
  // directly. Skipping the helper would surface `MISSING_COMMAND_ENVELOPE`
  // on every Cobrar tap.
  const createMutation = useCriticalMutation('sales.create', {
    onSuccess: async (_data, variables) => {
      // Same set the desktop epilogue uses — a touch sale must refresh
      // sales history, inventory, cash session, and ledger caches too,
      // or /sales and /inventory show pre-sale data for staleTime.
      // Clear the durable ticket locally before refreshing projections so an
      // invalidation failure cannot leave a chargeable duplicate cart.
      setCartItems([]);
      setSelectedCustomer(null);
      setIsPaymentModalOpen(false);
      setPaymentError(null);
      activePriceTierRef.current = 1;
      setActivePriceTier(1);
      const refreshed = await invalidateCommittedGroups(utils, SALE_COMPLETION_INVALIDATIONS);
      const title = t('posTouch:toast.chargeSuccess');
      const description = t('posTouch:toast.chargeSuccessDescription', {
        count: variables.items.length,
      });
      if (refreshed) {
        toast.success({ title, description });
      } else {
        toast.warning({
          title,
          description: `${description} ${t('common:toast.committedRefreshWarning')}`,
        });
      }
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'toast.chargeError',
      fallbackKey: 'toast.chargeError',
      extra: description => setPaymentError(description),
    }),
  });
  const isServerRestarting = useEmbeddedServerState() === 'restarting';
  const checkoutLocked = isCheckoutLocked || createMutation.isPending;
  const {
    open: openWeighing,
    close: closeWeighing,
    panel: weighPanel,
    weighingProductId,
  } = useWeighedItem({
    cartItems,
    setCartItems: setTieredCartItems,
    locked: checkoutLocked,
    priceTier: activePriceTier,
    // Pinned under the tiles so it never pushes them away from the finger.
    className: 'sticky bottom-0 z-10 mt-3 shadow-[0_-12px_24px_-18px_rgb(10_18_33/0.35)]',
  });

  const addSelection = useCallback(
    (selection: ProductSearchSelection, name: string, quantity: number | null = null) => {
      setCartItems(current =>
        applyPriceTier(
          quantity === null
            ? mergeCartItem(current, selection)
            : mergeBarcodeCartItem(current, selection, { quantity, price: null }),
          activePriceTierRef.current
        )
      );
      toast.success({ title: t('toast.addedToCart', { name }) });
    },
    [toast, t]
  );

  /** Hydrates a tapped product and adds it unless a charge or a new ticket started meanwhile. */
  const addHydrated = useCallback(
    async (load: () => Promise<ProductSearchSelection | null>, name: string) => {
      if (checkoutLockedRef.current) return;
      const ticketEpoch = ticketEpochRef.current;
      try {
        const selection = await load();
        if (checkoutLockedRef.current || ticketEpoch !== ticketEpochRef.current) return;
        if (!selection) {
          toast.error({
            title: t('toast.chargeError'),
            description: t('toast.chargeError'),
          });
          return;
        }
        if (openWeighing(selection)) {
          setValueTile(null);
        } else {
          closeWeighing();
          addSelection(selection, name);
        }
      } catch (err) {
        if (checkoutLockedRef.current || ticketEpoch !== ticketEpochRef.current) return;
        toast.error({
          title: t('toast.chargeError'),
          description: translateServerError(err, t, t('toast.chargeError')),
        });
      }
    },
    [addSelection, closeWeighing, openWeighing, toast, t]
  );

  // useCallback keeps every memoized tile from re-rendering on a cart tick;
  // only the tile whose quantity changed renders again.
  const handleAddToCart = useCallback(
    (product: Product) =>
      // `products.list` skips unit assignments to keep the grid payload small.
      addHydrated(async () => {
        const full = await utils.products.getById.fetch({ id: product.id, siteId });
        return selectionFromHydratedProduct(full as unknown as Product);
      }, product.name),
    [addHydrated, utils, siteId]
  );

  function handleQuickTile(tile: QuickTile) {
    if (checkoutLockedRef.current) return;
    if (tile.kind === 'open_value') {
      valueTicketEpochRef.current = ticketEpochRef.current;
      closeWeighing();
      setValueTile(tile);
    } else void addHydrated(() => resolveQuickTile(tile), tile.name);
  }

  function handleValueAdd(selection: ProductSearchSelection, quantity: number) {
    if (checkoutLockedRef.current || !valueTile) return;
    if (valueTicketEpochRef.current !== ticketEpochRef.current) {
      setValueTile(null);
      return;
    }
    addSelection(selection, valueTile.name, quantity);
    setValueTile(null);
  }

  const handlePriceTierChange = useCallback((tier: 1 | 2 | 3) => {
    if (checkoutLockedRef.current) return;
    activePriceTierRef.current = tier;
    setActivePriceTier(tier);
    setCartItems(current => applyPriceTier(current, tier));
  }, []);

  // GS1 scanner on the touch surface. The touch screen has no
  // modals or page-level search input competing for the keyboard, so the
  // wedge listener is active whenever the screen is mounted; scans ride
  // the SAME pipeline as the classic register (lookupByBarcode with
  // embedded-weight/price overrides resolved server-side).
  const peripheralsForSiteQuery = trpc.peripherals.activeForSite.useQuery(
    { siteId },
    { enabled: siteId.length > 0, staleTime: 5 * 60 * 1000 }
  );
  const scannerConfig = deriveScannerConfig(peripheralsForSiteQuery.data);
  // The hook toasts every scan failure itself and only ever CLEARS the
  // sale error (setSaleError(null)); the touch surface has no sale-error
  // banner, so an honest no-op is the whole adapter.
  const ignoreSaleError = useCallback<Dispatch<SetStateAction<string | null>>>(() => {}, []);
  useBarcodeProductScanner({
    scannerConfig,
    isResumedCart: false,
    isProductSearchOpen: false,
    // While sales.create is in flight the charge owns the cart: a scan
    // landing mid-mutation would beep success and then be wiped by the
    // onSuccess setCartItems([]) - silent un-charged merchandise.
    isPaymentModalOpen: checkoutLocked || isPaymentModalOpen,
    isCashSessionModalOpen,
    isCashSessionCloseModalOpen: false,
    isCashSessionMovementModalOpen: false,
    // The search field stays focused between scans; a scan must not land in it as text.
    productInputRef: searchInputRef,
    setCartItems: setTieredCartItems,
    setSelectedCartItemKey: () => {},
    setProductSearchQuery: () => {},
    setSaleError: ignoreSaleError,
  });

  function handleUpdateQuantity(key: string, quantity: number) {
    if (checkoutLockedRef.current) return;
    setCartItems(current => current.map(item => (item.key === key ? { ...item, quantity } : item)));
  }

  function handleUnitChange(key: string, unitId: string) {
    if (checkoutLockedRef.current) return;
    setCartItems(current =>
      applyPriceTier(replaceCartItemUnit(current, key, unitId), activePriceTierRef.current)
    );
  }

  function handleRemoveLine(key: string) {
    if (checkoutLockedRef.current) return;
    setCartItems(current => current.filter(item => item.key !== key));
  }

  function handleClearCart() {
    if (checkoutLockedRef.current) return;
    setCartItems([]);
    closeWeighing();
  }

  function handleCustomerChange(customerId: string) {
    if (checkoutLockedRef.current) return;
    setSelectedCustomer(customerOptions.find(customer => customer.id === customerId) ?? null);
  }

  function handleCategoryChange(categoryId: string | null) {
    if (checkoutLockedRef.current) return;
    setShowQuickKeys(false);
    setValueTile(null);
    setActiveCategoryId(categoryId);
    setCatalogPage(1);
  }

  function handleShowQuickKeys() {
    if (checkoutLockedRef.current) return;
    setShowQuickKeys(true);
    setSearchText('');
  }

  function handleSearchChange(value: string) {
    setSearchText(value);
    setCatalogPage(1);
  }

  function handleCatalogPageChange(page: number) {
    setCatalogPage(page);
    if (catalogRef.current) catalogRef.current.scrollTop = 0;
  }

  function deriveChargeDisabledReason(): 'noSite' | 'noSession' | 'noItems' | null {
    if (!siteId) return 'noSite';
    if (!cashSessionQuery.data) return 'noSession';
    if (cartItems.length === 0) return 'noItems';
    return null;
  }
  const chargeDisabledReason = deriveChargeDisabledReason();
  // A restarting server pauses charging only; the ticket stays editable.
  const canCharge = chargeDisabledReason === null && !isServerRestarting;

  function handleCharge() {
    if (!canCharge || checkoutLockedRef.current) return;
    setPaymentError(null);
    setPaymentModalKey(current => current + 1);
    setIsPaymentModalOpen(true);
  }

  async function handleSubmitSale(payload: TouchSaleCreateInput) {
    if (!canCharge || checkoutLockedRef.current) return;
    checkoutLockedRef.current = true;
    ticketEpochRef.current += 1;
    setValueTile(null);
    setIsCheckoutLocked(true);
    setPaymentError(null);
    try {
      await createMutation.mutateAsync(payload);
    } catch {
      // onError already surfaces a toast and inline error; no rethrow.
    } finally {
      checkoutLockedRef.current = false;
      setIsCheckoutLocked(false);
    }
  }

  // Leaving mid-charge would orphan the in-flight sale.
  const headerLinkProps = {
    'aria-disabled': checkoutLocked,
    tabIndex: checkoutLocked ? -1 : undefined,
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (checkoutLockedRef.current) event.preventDefault();
    },
    className: `inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line/70 bg-surface-1 px-4 py-2 text-xs font-medium text-secondary-700 hover:bg-surface-2 ${checkoutLocked ? 'pointer-events-none cursor-wait opacity-60' : ''}`,
  };

  if (!siteId && isLoadingSites) {
    return (
      <PageLoadingState
        title={t('common:loading.pageTitle')}
        description={t('common:loading.pageDescription')}
      />
    );
  }

  if (!siteId) {
    return (
      <section
        data-testid="pos-touch-page"
        className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <p className="text-xs uppercase tracking-[0.18em] text-secondary-500">{t('page.kicker')}</p>
        <h2 className="font-display text-3xl">{t('page.title')}</h2>
        <p
          data-testid="pos-touch-no-site"
          className="max-w-md rounded-xl border border-warning-300 bg-warning-50 p-4 text-sm text-warning-700"
        >
          {t('page.noActiveSite')}
        </p>
        <Link to="/sales" data-testid="pos-touch-till-link" {...headerLinkProps}>
          {t('page.tillLink')}
        </Link>
      </section>
    );
  }

  return (
    <section data-testid="pos-touch-page" className="flex flex-col gap-3 lg:h-[calc(100dvh-4rem)]">
      <header className="flex items-center justify-between gap-2">
        <h2 className="font-display text-xl tracking-[-0.02em] sm:text-2xl">{t('page.title')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {dineInActive && (
            <Link to="/touch/voice" data-testid="pos-touch-voice-link" {...headerLinkProps}>
              {t('page.voiceLink')}
            </Link>
          )}
          <Link to="/sales" data-testid="pos-touch-till-link" {...headerLinkProps}>
            {t('page.tillLink')}
          </Link>
        </div>
      </header>

      <PosTouchCategoryTabs
        categories={categoryOptions}
        activeCategoryId={activeCategoryId}
        onSelectCategory={handleCategoryChange}
        totalCount={categoryCountsQuery.data?.total ?? 0}
        isDisabled={checkoutLocked}
        quickKeys={{
          count: quickTiles.length,
          active: quickKeysView,
          onSelect: handleShowQuickKeys,
        }}
      />

      <div
        data-testid="pos-touch-layout"
        className="grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[minmax(0,1fr)]"
      >
        <div
          ref={catalogRef}
          data-testid="pos-touch-catalog"
          className="min-w-0 lg:-m-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:p-1 scrollbar-thin"
        >
          <label className="mb-2 block">
            <span className="sr-only">{t('grid.searchLabel')}</span>
            <span className="relative block">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary-500"
                aria-hidden="true"
              />
              <input
                ref={searchInputRef}
                type="search"
                data-testid="pos-touch-search"
                className="input min-h-[44px] w-full pl-9"
                placeholder={t('grid.searchPlaceholder')}
                value={searchText}
                disabled={checkoutLocked}
                onChange={event => handleSearchChange(event.target.value)}
              />
            </span>
          </label>
          {quickKeysView && valueTile && (
            <QuickKeyValueForm
              key={valueTile.key}
              className="mb-2"
              tile={valueTile}
              resolveSelection={resolveQuickTile}
              onAdd={handleValueAdd}
              onCancel={() => setValueTile(null)}
            />
          )}
          {quickKeysView ? (
            <PosTouchQuickKeyGrid
              tiles={quickTiles}
              isDisabled={checkoutLocked}
              activeValueKey={valueTile?.key ?? null}
              weighingProductId={weighingProductId}
              cartQuantities={cartQuantities}
              onSelect={handleQuickTile}
            />
          ) : (
            <PosTouchProductGrid
              products={products}
              isLoading={productsQuery.isLoading || quickKeysPending}
              isError={Boolean(productsQuery.error)}
              isDisabled={checkoutLocked}
              onSelect={handleAddToCart}
              weighingProductId={weighingProductId}
              cartQuantities={cartQuantities}
              emptyMessage={search ? t('grid.noMatches') : undefined}
            />
          )}
          {!quickKeysView && catalogPages > 1 && (
            <nav
              aria-label={t('grid.paginationLabel')}
              data-testid="pos-touch-pagination"
              className="mt-3 flex items-center justify-between gap-2"
            >
              <button
                type="button"
                data-testid="pos-touch-page-previous"
                className="btn-outline min-h-[44px]"
                disabled={currentCatalogPage <= 1 || checkoutLocked}
                onClick={() => handleCatalogPageChange(currentCatalogPage - 1)}
              >
                {t('grid.previous')}
              </button>
              <p
                data-testid="pos-touch-page-status"
                className="text-xs tabular-nums text-secondary-600"
                aria-live="polite"
              >
                {t('grid.pagination', {
                  page: currentCatalogPage,
                  pages: catalogPages,
                  count: catalogTotal,
                })}
              </p>
              <button
                type="button"
                data-testid="pos-touch-page-next"
                className="btn-outline min-h-[44px]"
                disabled={currentCatalogPage >= catalogPages || checkoutLocked}
                onClick={() => handleCatalogPageChange(currentCatalogPage + 1)}
              >
                {t('grid.next')}
              </button>
            </nav>
          )}
          {weighPanel}
        </div>
        <PosTouchCartSidebar
          items={cartItems}
          summary={summary}
          customer={selectedCustomer}
          customers={customerOptions}
          priceTier={activePriceTier}
          canCharge={canCharge}
          chargeDisabledReason={chargeDisabledReason}
          isCharging={checkoutLocked}
          onClearCart={handleClearCart}
          onCustomerChange={handleCustomerChange}
          onPriceTierChange={handlePriceTierChange}
          onUpdateQuantity={handleUpdateQuantity}
          onUnitChange={handleUnitChange}
          onRemoveLine={handleRemoveLine}
          onCharge={handleCharge}
          onOpenCashSession={
            !cashSessionQuery.data && !isServerRestarting
              ? () => setIsCashSessionModalOpen(true)
              : undefined
          }
        />
      </div>

      {(isPaymentModalOpen || isCashSessionModalOpen) && (
        <Suspense fallback={null}>
          <LazyPosTouchModals
            isPaymentModalOpen={isPaymentModalOpen}
            paymentModalKey={paymentModalKey}
            isCashSessionModalOpen={isCashSessionModalOpen}
            cartItems={cartItems}
            summary={summary}
            customers={(customersQuery.data?.items ?? []) as unknown as Customer[]}
            selectedCustomerId={selectedCustomer?.id ?? null}
            currency={currency}
            activePriceTier={activePriceTier}
            isCheckoutLocked={checkoutLocked}
            paymentError={paymentError}
            onCustomerPriceTierChange={handlePriceTierChange}
            onClosePayment={() => {
              if (checkoutLockedRef.current) return;
              setIsPaymentModalOpen(false);
            }}
            onCloseCashSession={() => setIsCashSessionModalOpen(false)}
            onSubmitSale={handleSubmitSale}
          />
        </Suspense>
      )}
    </section>
  );
}
