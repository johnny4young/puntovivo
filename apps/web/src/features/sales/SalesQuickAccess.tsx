import { useMemo, useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { LoaderCircle, Settings2, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { useDiscountSuggestions } from '@/features/sales/useDiscountSuggestions';
import { selectionFromHydratedProduct } from '@/features/sales/productSelection';
import {
  MAX_SALES_FAVORITES,
  readDismissedSuggestions,
  readSalesFavoriteIds,
  writeDismissedSuggestions,
  toggleSalesFavoriteId,
  writeSalesFavoriteIds,
} from '@/features/sales/salesFavorites';
import { formatCurrency } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import type { Product, ProductSearchSelection } from '@/types';

interface SalesQuickAccessProps {
  scopeKey: string;
  siteId: string;
  /** Mid-sale the strip stays quiet: no favourite suggestion. */
  hasCartItems?: boolean;
  onSelectProduct: (selection: ProductSearchSelection) => void;
}

// The register boot only shows suggested tiles; the wider catalog is for the favorites editor.
const SUGGESTION_CATALOG_SIZE = 12;
const EDITOR_CATALOG_SIZE = 80;

export function SalesQuickAccess({
  scopeKey,
  siteId,
  hasCartItems = false,
  onSelectProduct,
}: SalesQuickAccessProps) {
  const { t } = useTranslation('salesQuickAccess');
  const toast = useToast();
  const utils = trpc.useUtils();
  const [configuredIds, setConfiguredIds] = useState<string[] | null>(() =>
    readSalesFavoriteIds(scopeKey)
  );
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loadingProductId, setLoadingProductId] = useState<string | null>(null);
  const shouldLoadCatalog = siteId.length > 0;

  const productsQuery = trpc.products.list.useQuery(
    { page: 1, perPage: isEditing ? EDITOR_CATALOG_SIZE : SUGGESTION_CATALOG_SIZE, isActive: true },
    { enabled: shouldLoadCatalog, staleTime: 60_000, placeholderData: keepPreviousData }
  );
  const categoriesQuery = trpc.categories.tree.useQuery(undefined, {
    enabled: shouldLoadCatalog,
    staleTime: 60_000,
  });

  const favoriteQueries = trpc.useQueries(t =>
    (shouldLoadCatalog ? [...new Set(configuredIds ?? [])].slice(0, MAX_SALES_FAVORITES) : []).map(
      id => t.products.getById({ id, siteId }, { staleTime: 60_000, retry: false })
    )
  );
  const products = useMemo<Product[]>(() => {
    const byId = new Map<string, Product>();
    for (const item of [
      ...(productsQuery.data?.items ?? []),
      ...favoriteQueries.flatMap(query => (query.data ? [query.data] : [])),
    ]) {
      if (!item.isActive || item.catalogType === 'variant_parent') continue;
      byId.set(item.id, {
        ...item,
        isActive: item.isActive ?? false,
        syncStatus: item.syncStatus ?? undefined,
        syncVersion: item.syncVersion ?? undefined,
      } as Product);
    }
    return [...byId.values()];
  }, [productsQuery.data, favoriteQueries]);
  const topSellingQuery = trpc.products.topSelling.useQuery(
    { siteId },
    { enabled: shouldLoadCatalog, staleTime: 5 * 60_000 }
  );
  const [dismissedSuggestions, setDismissedSuggestions] = useState(() =>
    readDismissedSuggestions(scopeKey)
  );
  const favoritesLoading = favoriteQueries.some(query => query.isLoading);
  // A favorite that no longer resolves drops out like an inactive one; retrying cannot restore it.
  const favoritesError = favoriteQueries.some(
    query => query.isError && query.error?.data?.code !== 'NOT_FOUND'
  );
  const categories = categoriesQuery.data?.items ?? [];
  const suggestedIds = useMemo(
    () => products.slice(0, Math.min(6, MAX_SALES_FAVORITES)).map(product => product.id),
    [products]
  );
  const selectedIds = configuredIds ?? suggestedIds;
  // Mid-sale the category chips are hidden, so a filter picked earlier must not linger.
  const categoryFilter = isEditing || !hasCartItems ? activeCategoryId : null;
  const filteredProducts = categoryFilter
    ? products.filter(product => product.categoryId === categoryFilter)
    : products;
  const visibleProducts = isEditing
    ? [...filteredProducts]
        .sort((a, b) => Number(selectedIds.includes(b.id)) - Number(selectedIds.includes(a.id)))
        .slice(0, 24)
    : filteredProducts
        .filter(product => selectedIds.includes(product.id))
        .sort((a, b) => selectedIds.indexOf(a.id) - selectedIds.indexOf(b.id))
        .slice(0, MAX_SALES_FAVORITES);
  const discountSuggestions = useDiscountSuggestions(
    shouldLoadCatalog && visibleProducts.length > 0,
    siteId
  );

  const suggestion =
    !hasCartItems && selectedIds.length < MAX_SALES_FAVORITES
      ? topSellingQuery.data?.find(
          item =>
            !selectedIds.includes(item.productId) && !dismissedSuggestions.includes(item.productId)
        )
      : undefined;
  const dismissSuggestion = (productId: string) => {
    const next = [...dismissedSuggestions, productId];
    setDismissedSuggestions(next);
    writeDismissedSuggestions(scopeKey, next);
  };

  const persistSelection = (productId: string) => {
    const base = configuredIds ?? suggestedIds;
    const next = toggleSalesFavoriteId(base, productId);
    setConfiguredIds(next);
    writeSalesFavoriteIds(scopeKey, next);
  };

  const handleProductAction = async (product: Product) => {
    if (isEditing) {
      persistSelection(product.id);
      return;
    }

    setLoadingProductId(product.id);
    try {
      // The favorite lookups share this cache entry; the cart must use the current product.
      const hydrated = await utils.products.getById.fetch(
        { id: product.id, siteId },
        { staleTime: 0 }
      );
      const selection = selectionFromHydratedProduct(hydrated as unknown as Product);
      if (!selection) {
        toast.error({ title: t('noSaleUnit') });
        return;
      }
      onSelectProduct(selection);
    } catch {
      toast.error({ title: t('addFailed') });
    } finally {
      setLoadingProductId(null);
    }
  };

  return (
    <section
      className="sales-quick-access lg:shrink-0"
      aria-labelledby="sales-quick-access-title"
      data-testid="sales-quick-access"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id="sales-quick-access-title" className="sales-cap">
          {t('barTitle')}
        </h3>
        <button
          type="button"
          className="btn-ghost min-h-9 gap-1.5 px-2 py-1 text-xs"
          onClick={() => setIsEditing(value => !value)}
          aria-pressed={isEditing}
          data-testid="sales-favorites-edit"
        >
          <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
          {isEditing ? t('finishEditing') : t('configure')}
        </button>
      </div>

      {suggestion && (
        <div
          className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-accent px-3 py-1.5 text-sm text-accent-foreground"
          data-testid="sales-quick-suggestion"
        >
          <p className="min-w-0 flex-1">
            {t('suggestion.text', {
              name: suggestion.name,
              count: Math.round(suggestion.quantity),
            })}
          </p>
          <button
            type="button"
            className="btn-outline min-h-11"
            onClick={() => persistSelection(suggestion.productId)}
            data-testid="sales-quick-suggestion-add"
          >
            {t('suggestion.add')}
          </button>
          <button
            type="button"
            className="btn-ghost min-h-11"
            onClick={() => dismissSuggestion(suggestion.productId)}
            data-testid="sales-quick-suggestion-dismiss"
          >
            {t('suggestion.dismiss')}
          </button>
        </div>
      )}

      {(isEditing || !hasCartItems) && categories.length > 0 && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1" aria-label={t('categories')}>
          <button
            type="button"
            className={activeCategoryId === null ? 'btn-secondary' : 'btn-outline'}
            onClick={() => setActiveCategoryId(null)}
            aria-pressed={activeCategoryId === null}
          >
            {t('allCategories')}
          </button>
          {categories.slice(0, 8).map(category => (
            <button
              key={category.id}
              type="button"
              className={activeCategoryId === category.id ? 'btn-secondary' : 'btn-outline'}
              onClick={() => setActiveCategoryId(category.id)}
              aria-pressed={activeCategoryId === category.id}
            >
              {category.name}
            </button>
          ))}
        </div>
      )}

      {favoritesError && (
        <div className="mt-2 rounded-xl border border-line p-3 text-sm" role="alert">
          <p>{t('favoritesLoadError')}</p>
          <button
            type="button"
            className="btn-outline mt-2"
            onClick={() => {
              for (const query of favoriteQueries) {
                if (query.isError) void query.refetch();
              }
            }}
          >
            {t('retryFavorites')}
          </button>
        </div>
      )}
      {productsQuery.isLoading || favoritesLoading ? (
        <div className="sales-quick-keys-loading mt-2" role="status">
          <LoaderCircle className="h-5 w-5 motion-safe:animate-spin text-fg3" aria-hidden="true" />
          <span className="sr-only">{t('loading')}</span>
        </div>
      ) : visibleProducts.length > 0 ? (
        <div className={`mt-2 ${isEditing ? 'sales-quick-keys-editing' : 'sales-quick-keys'}`}>
          {visibleProducts.map(product => {
            const isFavorite = selectedIds.includes(product.id);
            const discount = discountSuggestions.get(product.id) ?? 0;
            const isLoading = loadingProductId === product.id;
            return (
              <button
                key={product.id}
                type="button"
                className="sales-quick-key"
                data-picked={isEditing && isFavorite}
                onClick={() => {
                  void handleProductAction(product);
                }}
                disabled={isLoading}
                aria-label={
                  isEditing
                    ? t(isFavorite ? 'removeFavorite' : 'addFavorite', {
                        name: product.name,
                      })
                    : t('addProduct', { name: product.name })
                }
                data-testid={`sales-quick-product-${product.sku}`}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="line-clamp-2 text-sm font-semibold leading-tight text-fg1">
                    {product.name}
                  </span>
                  {isEditing && (
                    <Star
                      className={[
                        'h-4 w-4 shrink-0',
                        isFavorite ? 'fill-primary-600 text-primary-600' : 'text-fg3',
                      ].join(' ')}
                      aria-hidden="true"
                    />
                  )}
                </span>
                <span className="flex items-end justify-between gap-2">
                  <span className="font-numeric text-base font-bold text-fg1">
                    {formatCurrency(product.price)}
                  </span>
                  {discount > 0 && (
                    <span className="sales-tag bg-warning-50 text-warning-700">-{discount}%</span>
                  )}
                </span>
                {isLoading && (
                  <span className="absolute inset-0 grid place-items-center rounded-[inherit] bg-card/80">
                    <LoaderCircle className="h-5 w-5 motion-safe:animate-spin" aria-hidden="true" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="sales-quick-keys-loading mt-2 border border-dashed border-line">
          <p className="text-sm text-fg2">
            {isEditing ? t('noCategoryProducts') : t('noFavorites')}
          </p>
        </div>
      )}
    </section>
  );
}
