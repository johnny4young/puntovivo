/**
 * ENG-087 — Touch POS V1 main surface.
 *
 * 2-col responsive layout for tablet-first checkout:
 *   - Left: category tabs row + product tile grid.
 *   - Right: persistent cart sidebar with customer slot + lines
 *     + Cobrar CTA. Below 1024 px the cart sidebar stacks under
 *     the grid so the tile area can keep its full width.
 *
 * Reuses the same primitives as the desktop sales flow:
 *   - `trpc.products.list` (catalog + category filter)
 *   - `trpc.categories.tree` (sidebar tabs)
 *   - `trpc.cashSessions.getActive` (Cobrar gate)
 *   - `trpc.sales.create` (single-tender cash checkout)
 *   - `mergeCartItem` from features/sales/saleCart for the line
 *     merge + qty math
 *   - `useTenant` from features/tenant/TenantProvider for the
 *     active site context
 *
 * Touch-first quality bar (per ENG-087 plan §8):
 *   - Every interactive element ≥ 44 × 44 px.
 *   - Responsive grid: 2 / 3 / 4 / 6 cols across breakpoints.
 *   - `auto-rows-fr` keeps tile heights uniform across long /
 *     short product names.
 *   - No horizontal overflow at 320 px (tested via Playwright).
 *
 * Loyalty:
 *   - The cart sidebar wires a forward-compatible
 *     `customer.loyaltyProfile` slot. The customers schema does
 *     not carry this today; ENG-087b will land it. Until then
 *     the badge + "Sumar puntos" CTA stay invisible because
 *     `loyaltyProfile` is `undefined`.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useTenant } from '@/features/tenant/TenantProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import {
  getCartSummary,
  mergeCartItem,
  type SaleCartItem,
} from '@/features/sales/saleCart';
import type { Product, ProductSearchSelection } from '@/types';
import { translateServerError } from '@/lib/translateServerError';
import { onErrorToast } from '@/lib/mutationHelpers';
import {
  PosTouchCategoryTabs,
  type PosTouchCategoryOption,
} from './PosTouchCategoryTabs';
import { PosTouchProductGrid } from './PosTouchProductGrid';
import {
  PosTouchCartSidebar,
  type PosTouchCustomer,
} from './PosTouchCartSidebar';

/**
 * Build a `ProductSearchSelection` from a `Product` that already
 * carries `unitAssignments` (typically the result of
 * `trpc.products.getById`). Touch POS V1 always picks the
 * product's base unit at the assignment's price.
 *
 * The grid uses `products.list` which does NOT include unit
 * assignments, so the caller MUST hydrate the product via
 * `products.getById` before calling this helper. Returns `null`
 * when the hydrated product still has no base unit (mis-seeded
 * catalog) so the caller can surface a toast instead of crashing.
 */
function selectionFromProduct(
  product: Product
): ProductSearchSelection | null {
  const baseUnit =
    product.unitAssignments?.find(u => u.isBase) ?? product.unitAssignments?.[0];
  if (!baseUnit) return null;
  const unitPrice = baseUnit.price ?? product.price;

  return {
    product: {
      ...product,
      baseUnitId: baseUnit.unitId,
      baseUnitName: baseUnit.unitName ?? null,
      baseUnitAbbreviation: baseUnit.unitAbbreviation ?? null,
      baseUnitPrice: unitPrice,
    },
    unit: {
      ...baseUnit,
      isBase: baseUnit.isBase ?? true,
    },
    price: unitPrice,
  };
}

export function PosTouchScreen() {
  const { t } = useTranslation('posTouch');
  const { currentSite } = useTenant();
  const toast = useToast();
  const utils = trpc.useUtils();
  const siteId = currentSite?.id ?? '';

  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [cartItems, setCartItems] = useState<SaleCartItem[]>([]);
  // V1: customer attach UI is out of scope (operator can still
  // ring up walk-in sales). The slot stays here so ENG-087b can
  // wire a customer picker without rebuilding the cart sidebar.
  const [selectedCustomer] = useState<PosTouchCustomer | null>(null);

  const productsQuery = trpc.products.list.useQuery(
    {
      page: 1,
      perPage: 200,
      categoryId: activeCategoryId ?? undefined,
      isActive: true,
    },
    { enabled: siteId.length > 0, staleTime: 30_000 }
  );
  // Unfiltered list — drives the All-tab count + the per-category
  // count math below. Fetched once per session and reused. Keep it
  // active-only so unavailable products never show as touch-saleable.
  const allProductsQuery = trpc.products.list.useQuery(
    { page: 1, perPage: 200, isActive: true },
    { enabled: siteId.length > 0, staleTime: 60_000 }
  );
  const categoriesQuery = trpc.categories.tree.useQuery(undefined, {
    enabled: siteId.length > 0,
    staleTime: 60_000,
  });
  const cashSessionQuery = trpc.cashSessions.getActive.useQuery(
    { siteId },
    { enabled: siteId.length > 0 }
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
  const allProducts = useMemo<Product[]>(
    () =>
      (allProductsQuery.data?.items ?? []).map(item => ({
        ...item,
        isActive: item.isActive ?? false,
        syncStatus: item.syncStatus ?? undefined,
        syncVersion: item.syncVersion ?? undefined,
      })) as Product[],
    [allProductsQuery.data]
  );

  const categoryOptions = useMemo<PosTouchCategoryOption[]>(() => {
    const tree = categoriesQuery.data?.items ?? [];
    const counts = new Map<string, number>();
    for (const p of allProducts) {
      if (!p.categoryId) continue;
      counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1);
    }
    return tree.map(node => ({
      id: node.id,
      name: node.name,
      count: counts.get(node.id) ?? 0,
    }));
  }, [categoriesQuery.data, allProducts]);

  const summary = useMemo(() => getCartSummary(cartItems), [cartItems]);

  // ENG-052b — `sales.create` is a critical command (idempotency +
  // command envelope), so we ride the same `useCriticalMutation`
  // helper that SalesPage uses instead of `trpc.sales.create.useMutation`
  // directly. Skipping the helper would surface `MISSING_COMMAND_ENVELOPE`
  // on every Cobrar tap.
  const createMutation = useCriticalMutation('sales.create', {
    onSuccess: async (_data, variables) => {
      await utils.cashSessions.getActive.invalidate();
      await utils.products.list.invalidate();
      toast.success({
        title: t('toast.chargeSuccess'),
        description: t('toast.chargeSuccessDescription', { count: variables.items.length }),
      });
      setCartItems([]);
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'toast.chargeError',
      fallbackKey: 'toast.chargeError',
    }),
  });

  async function handleAddToCart(product: Product) {
    // `products.list` (the grid query) skips unit assignments to
    // keep the catalog payload small. Hydrate the full product via
    // `products.getById` so we can pick the real base-unit id and
    // build a valid `ProductSearchSelection` for `mergeCartItem`.
    try {
      const full = await utils.products.getById.fetch({ id: product.id });
      const selection = selectionFromProduct(full as unknown as Product);
      if (!selection) {
        toast.error({
          title: t('toast.chargeError'),
          description: t('toast.chargeError'),
        });
        return;
      }
      setCartItems(current => mergeCartItem(current, selection));
      toast.success({ title: t('toast.addedToCart', { name: product.name }) });
    } catch (err) {
      toast.error({
        title: t('toast.chargeError'),
        description: translateServerError(err, t, t('toast.chargeError')),
      });
    }
  }

  function handleRemoveLine(key: string) {
    setCartItems(current => current.filter(item => item.key !== key));
  }

  function handleClearCart() {
    setCartItems([]);
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
    if (!canCharge) return;
    try {
      await createMutation.mutateAsync({
        customerId: selectedCustomer?.id || undefined,
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
    }
  }

  if (!siteId) {
    return (
      <section
        data-testid="pos-touch-page"
        className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <p className="text-xs uppercase tracking-[0.18em] text-secondary-500">
          {t('page.kicker')}
        </p>
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
    <section data-testid="pos-touch-page" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-secondary-500">
            {t('page.kicker')}
          </p>
          <h2 className="font-display text-3xl tracking-[-0.02em]">{t('page.title')}</h2>
          <p className="max-w-2xl text-sm text-secondary-600">{t('page.subtitle')}</p>
        </div>
        <Link
          to="/touch/voice"
          data-testid="pos-touch-voice-link"
          className="inline-flex min-h-[44px] items-center gap-2 self-start rounded-full border border-line/70 bg-surface-1 px-4 py-2 text-xs font-medium text-secondary-700 hover:bg-surface-2"
        >
          {t('page.voiceLink')}
        </Link>
      </header>

      <PosTouchCategoryTabs
        categories={categoryOptions}
        activeCategoryId={activeCategoryId}
        onSelectCategory={setActiveCategoryId}
        totalCount={allProducts.length}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr),22rem]">
        <PosTouchProductGrid
          products={products}
          isLoading={productsQuery.isLoading}
          isError={Boolean(productsQuery.error)}
          onSelect={handleAddToCart}
        />
        <PosTouchCartSidebar
          items={cartItems}
          summary={summary}
          customer={selectedCustomer}
          canCharge={canCharge}
          chargeDisabledReason={chargeDisabledReason}
          isCharging={createMutation.isPending}
          onClearCart={handleClearCart}
          onRemoveLine={handleRemoveLine}
          onCharge={handleCharge}
        />
      </div>
    </section>
  );
}
