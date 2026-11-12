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
import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { usePriceIncludesTax } from '@/features/pricing/PricingContext';
import { useBarcodeProductScanner } from '@/features/sales/useBarcodeProductScanner';
import { deriveScannerConfig } from '@/features/sales/useBarcodeWedgeListener';
import { keepPreviousData } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useDebouncedValue } from '@/hooks';
import { useTenant } from '@/features/tenant/TenantProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { invalidateCommittedGroups, SALE_COMPLETION_INVALIDATIONS } from '@/lib/invalidateGroups';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { applyPriceTier, mergeCartItem, type SaleCartItem } from '@/features/sales/saleCart';
import { getCartSummary } from '@/features/sales/saleCartTotals';
import { selectionFromHydratedProduct } from '@/features/sales/productSelection';
import type { Product } from '@/types';
import { translateServerError } from '@/lib/translateServerError';
import { onErrorToast } from '@/lib/mutationHelpers';
import { useIsModuleActive } from '@/features/modules';
import { PosTouchCategoryTabs, type PosTouchCategoryOption } from './PosTouchCategoryTabs';
import { PosTouchProductGrid } from './PosTouchProductGrid';
import { PosTouchCartSidebar, type PosTouchCustomer } from './PosTouchCartSidebar';

const CATALOG_PAGE_SIZE = 24;
const CATALOG_SEARCH_DEBOUNCE_MS = 250;

export function PosTouchScreen() {
  const priceIncludesTax = usePriceIncludesTax();
  const { t } = useTranslation(['posTouch', 'common', 'fulfillmentErrors']);
  const { currentSite } = useTenant();
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
  const ticketEpochRef = useRef(0);

  const productsQuery = trpc.products.list.useQuery(
    {
      page: catalogPage,
      perPage: CATALOG_PAGE_SIZE,
      categoryId: activeCategoryId ?? undefined,
      isActive: true,
      siteId,
      search: search || undefined,
    },
    { enabled: siteId.length > 0, staleTime: 30_000, placeholderData: keepPreviousData }
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

  const summary = useMemo(
    () => getCartSummary(cartItems, priceIncludesTax),
    [cartItems, priceIncludesTax]
  );

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
      // A completed ticket ends the customer/pricing context too. Keeping
      // either selection would silently attach the next walk-in sale to the
      // previous customer or carry wholesale pricing into a new transaction.
      setSelectedCustomer(null);
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
    }),
  });
  const checkoutLocked = isCheckoutLocked || createMutation.isPending;

  // useCallback keeps every memoized tile from re-rendering on a cart tick;
  // only the tile whose quantity changed renders again.
  const handleAddToCart = useCallback(
    async (product: Product) => {
      if (checkoutLockedRef.current) return;
      const ticketEpoch = ticketEpochRef.current;
      // `products.list` (the grid query) skips unit assignments to
      // keep the catalog payload small. Hydrate the full product via
      // `products.getById` so we can pick the real base-unit id and
      // build a valid `ProductSearchSelection` for `mergeCartItem`.
      try {
        const full = await utils.products.getById.fetch({ id: product.id, siteId });
        if (checkoutLockedRef.current || ticketEpoch !== ticketEpochRef.current) return;
        const selection = selectionFromHydratedProduct(full as unknown as Product);
        if (!selection) {
          toast.error({
            title: t('toast.chargeError'),
            description: t('toast.chargeError'),
          });
          return;
        }
        setCartItems(current =>
          applyPriceTier(mergeCartItem(current, selection), activePriceTierRef.current)
        );
        toast.success({ title: t('toast.addedToCart', { name: product.name }) });
      } catch (err) {
        if (checkoutLockedRef.current || ticketEpoch !== ticketEpochRef.current) return;
        toast.error({
          title: t('toast.chargeError'),
          description: translateServerError(err, t, t('toast.chargeError')),
        });
      }
    },
    [utils, toast, t, siteId]
  );

  const setTieredCartItems = useCallback<Dispatch<SetStateAction<SaleCartItem[]>>>(update => {
    setCartItems(current => {
      if (checkoutLockedRef.current) return current;
      const next = typeof update === 'function' ? update(current) : update;
      return applyPriceTier(next, activePriceTierRef.current);
    });
  }, []);

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
    isPaymentModalOpen: checkoutLocked,
    isCashSessionModalOpen: false,
    isCashSessionCloseModalOpen: false,
    isCashSessionMovementModalOpen: false,
    // The search field stays focused between scans; a scan must not land in it as text.
    productInputRef: searchInputRef,
    setCartItems: setTieredCartItems,
    setSelectedCartItemKey: () => {},
    setProductSearchQuery: () => {},
    setSaleError: ignoreSaleError,
  });

  function handleRemoveLine(key: string) {
    if (checkoutLockedRef.current) return;
    setCartItems(current => current.filter(item => item.key !== key));
  }

  function handleClearCart() {
    if (checkoutLockedRef.current) return;
    setCartItems([]);
  }

  function handleCustomerChange(customerId: string) {
    if (checkoutLockedRef.current) return;
    setSelectedCustomer(customerOptions.find(customer => customer.id === customerId) ?? null);
  }

  function handleCategoryChange(categoryId: string | null) {
    if (checkoutLockedRef.current) return;
    setActiveCategoryId(categoryId);
    setCatalogPage(1);
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
  const canCharge = chargeDisabledReason === null;

  async function handleCharge() {
    if (!canCharge || checkoutLockedRef.current) return;
    checkoutLockedRef.current = true;
    ticketEpochRef.current += 1;
    setIsCheckoutLocked(true);
    try {
      await createMutation.mutateAsync({
        customerId: selectedCustomer?.id || undefined,
        priceTier: activePriceTier,
        items: cartItems.map(item => ({
          productId: item.productId,
          unitId: item.unitId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          taxRate: item.taxRate,
        })),
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: summary.total,
        discountAmount: 0,
      });
    } catch {
      // onError already surfaces a toast; no rethrow.
    } finally {
      checkoutLockedRef.current = false;
      setIsCheckoutLocked(false);
    }
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
      </section>
    );
  }

  return (
    <section data-testid="pos-touch-page" className="flex flex-col gap-4 lg:h-[calc(100dvh-4rem)]">
      <header className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-secondary-500">
            {t('page.kicker')}
          </p>
          <h2 className="font-display text-3xl tracking-[-0.02em]">{t('page.title')}</h2>
          <p className="max-w-2xl text-sm text-secondary-600">{t('page.subtitle')}</p>
        </div>
        {dineInActive && (
          <Link
            to="/touch/voice"
            data-testid="pos-touch-voice-link"
            aria-disabled={checkoutLocked}
            tabIndex={checkoutLocked ? -1 : undefined}
            onClick={event => {
              if (checkoutLockedRef.current) event.preventDefault();
            }}
            className={`inline-flex min-h-[44px] items-center gap-2 self-start rounded-full border border-line/70 bg-surface-1 px-4 py-2 text-xs font-medium text-secondary-700 hover:bg-surface-2 ${checkoutLocked ? 'pointer-events-none cursor-wait opacity-60' : ''}`}
          >
            {t('page.voiceLink')}
          </Link>
        )}
      </header>

      <PosTouchCategoryTabs
        categories={categoryOptions}
        activeCategoryId={activeCategoryId}
        onSelectCategory={handleCategoryChange}
        totalCount={categoryCountsQuery.data?.total ?? 0}
        isDisabled={checkoutLocked}
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
          <PosTouchProductGrid
            products={products}
            isLoading={productsQuery.isLoading}
            isError={Boolean(productsQuery.error)}
            isDisabled={checkoutLocked}
            onSelect={handleAddToCart}
            cartQuantities={cartQuantities}
            emptyMessage={search ? t('grid.noMatches') : undefined}
          />
          {catalogPages > 1 && (
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
          onRemoveLine={handleRemoveLine}
          onCharge={handleCharge}
        />
      </div>
    </section>
  );
}
