import { useMemo, useState } from 'react';
import { FilePlus2, LoaderCircle, Percent, Search, Settings2, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { useDiscountSuggestions } from '@/features/sales/useDiscountSuggestions';
import { selectionFromHydratedProduct } from '@/features/sales/productSelection';
import {
  MAX_SALES_FAVORITES,
  readSalesFavoriteIds,
  toggleSalesFavoriteId,
  writeSalesFavoriteIds,
} from '@/features/sales/salesFavorites';
import { formatCurrency } from '@/lib/utils';
import { ariaKeyshortcutsFor } from '@/lib/shortcuts';
import { trpc } from '@/lib/trpc';
import type { Product, ProductSearchSelection } from '@/types';

interface SalesQuickAccessProps {
  scopeKey: string;
  siteId: string;
  hasCartItems: boolean;
  canFocusDiscount: boolean;
  lastCompletedSaleId?: string | null;
  onOpenLastReceipt?: () => void;
  onSelectProduct: (selection: ProductSearchSelection) => void;
  onOpenSearch: () => void;
  onFocusDiscount: () => void;
  onNewSale: () => void;
}

export function SalesQuickAccess({
  scopeKey,
  siteId,
  hasCartItems,
  canFocusDiscount,
  lastCompletedSaleId = null,
  onOpenLastReceipt,
  onSelectProduct,
  onOpenSearch,
  onFocusDiscount,
  onNewSale,
}: SalesQuickAccessProps) {
  const { t } = useTranslation(['salesQuickAccess', 'sales', 'receiptShare']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const [configuredIds, setConfiguredIds] = useState<string[] | null>(() =>
    readSalesFavoriteIds(scopeKey)
  );
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loadingProductId, setLoadingProductId] = useState<string | null>(null);
  const shouldLoadCatalog = !hasCartItems && siteId.length > 0;

  const productsQuery = trpc.products.list.useQuery(
    { page: 1, perPage: 80, isActive: true },
    { enabled: shouldLoadCatalog, staleTime: 60_000 }
  );
  const categoriesQuery = trpc.categories.tree.useQuery(undefined, {
    enabled: shouldLoadCatalog,
    staleTime: 60_000,
  });

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
  const categories = categoriesQuery.data?.items ?? [];
  const suggestedIds = useMemo(
    () => products.slice(0, Math.min(6, MAX_SALES_FAVORITES)).map(product => product.id),
    [products]
  );
  const selectedIds = configuredIds ?? suggestedIds;
  const filteredProducts = activeCategoryId
    ? products.filter(product => product.categoryId === activeCategoryId)
    : products;
  const visibleProducts = isEditing
    ? filteredProducts.slice(0, 24)
    : filteredProducts
        .filter(product => selectedIds.includes(product.id))
        .sort((a, b) => selectedIds.indexOf(a.id) - selectedIds.indexOf(b.id))
        .slice(0, MAX_SALES_FAVORITES);
  const discountSuggestions = useDiscountSuggestions(
    shouldLoadCatalog && visibleProducts.length > 0,
    siteId
  );

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
      const hydrated = await utils.products.getById.fetch({ id: product.id });
      const selection = selectionFromHydratedProduct(hydrated as unknown as Product);
      if (!selection) {
        toast.error({ title: t('noSaleUnit') });
        return;
      }
      onSelectProduct(selection);
      toast.success({ title: t('added', { name: product.name }) });
    } catch {
      toast.error({ title: t('addFailed') });
    } finally {
      setLoadingProductId(null);
    }
  };

  if (hasCartItems) {
    return (
      <div
        className="mb-4 flex flex-wrap items-center gap-2 rounded-[12px] border border-line/70 bg-surface-2/55 p-2"
        aria-label={t('safeActions')}
        data-testid="sales-context-actions"
      >
        <button
          type="button"
          className="btn-outline"
          onClick={onOpenSearch}
          aria-keyshortcuts={ariaKeyshortcutsFor('sales.productSearch')}
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          {t('searchAnother')}
        </button>
        {canFocusDiscount && (
          <button
            type="button"
            className="btn-outline"
            onClick={onFocusDiscount}
            aria-keyshortcuts={ariaKeyshortcutsFor('sales.focusDiscount')}
          >
            <Percent className="h-4 w-4" aria-hidden="true" />
            {t('adjustDiscount')}
          </button>
        )}
        <button
          type="button"
          className="btn-ghost"
          onClick={onNewSale}
          aria-keyshortcuts={ariaKeyshortcutsFor('sales.newSale')}
        >
          <FilePlus2 className="h-4 w-4" aria-hidden="true" />
          {t('sales:park.newSale')}
        </button>
      </div>
    );
  }

  return (
    <section
      className="sales-quick-access mb-4 rounded-[14px] border border-line/70 bg-surface-2/55 p-3"
      aria-labelledby="sales-quick-access-title"
      data-testid="sales-quick-access"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-primary-800">
            {configuredIds === null ? t('suggestedKicker') : t('favoritesKicker')}
          </p>
          <h3 id="sales-quick-access-title" className="mt-1 text-base font-semibold text-fg1">
            {t('title')}
          </h3>
          <p className="mt-0.5 text-xs text-fg2">{t('description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lastCompletedSaleId && onOpenLastReceipt && (
            <button
              type="button"
              className="btn-outline"
              onClick={onOpenLastReceipt}
              data-testid="sales-open-last-receipt"
            >
              {t('receiptShare:lastReceipt')}
            </button>
          )}
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setIsEditing(value => !value)}
            aria-pressed={isEditing}
            data-testid="sales-favorites-edit"
          >
            <Settings2 className="h-4 w-4" aria-hidden="true" />
            {isEditing ? t('finishEditing') : t('configure')}
          </button>
        </div>
      </div>

      {categories.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label={t('categories')}>
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

      {productsQuery.isLoading ? (
        <div className="mt-3 grid min-h-24 place-items-center text-sm text-fg2" role="status">
          <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
          <span className="sr-only">{t('loading')}</span>
        </div>
      ) : visibleProducts.length > 0 ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {visibleProducts.map(product => {
            const isFavorite = selectedIds.includes(product.id);
            const discount = discountSuggestions.get(product.id) ?? 0;
            const isLoading = loadingProductId === product.id;
            return (
              <button
                key={product.id}
                type="button"
                className={[
                  'group relative min-h-[4.5rem] rounded-[12px] border px-3 py-2.5 text-left transition-colors',
                  isEditing && isFavorite
                    ? 'border-primary-300 bg-primary-50'
                    : 'border-line/70 bg-surface hover:border-primary-300 hover:bg-primary-50/60',
                ].join(' ')}
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
                  <span className="line-clamp-2 text-sm font-semibold leading-4 text-fg1">
                    {product.name}
                  </span>
                  {isEditing && (
                    <Star
                      className={[
                        'h-4 w-4 shrink-0',
                        isFavorite ? 'fill-primary-600 text-primary-700' : 'text-fg3',
                      ].join(' ')}
                      aria-hidden="true"
                    />
                  )}
                </span>
                <span className="mt-2 flex items-end justify-between gap-2 text-xs">
                  <span className="font-mono font-semibold text-primary-800">
                    {formatCurrency(product.price)}
                  </span>
                  {discount > 0 && (
                    <span className="rounded-md bg-warning-100 px-1.5 py-0.5 font-semibold text-warning-800">
                      -{discount}%
                    </span>
                  )}
                </span>
                {isLoading && (
                  <span className="absolute inset-0 grid place-items-center rounded-[12px] bg-surface/80">
                    <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mt-3 rounded-[12px] border border-dashed border-line p-4 text-center">
          <p className="text-sm text-fg2">
            {isEditing ? t('noCategoryProducts') : t('noFavorites')}
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-outline" onClick={onOpenSearch}>
          <Search className="h-4 w-4" aria-hidden="true" />
          {t('searchCatalog')}
        </button>
      </div>
    </section>
  );
}
