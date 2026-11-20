import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MAX_SITE_QUICK_KEYS } from '@puntovivo/shared/quick-keys';
import { useToast } from '@/components/feedback/ToastProvider';
import { useDiscountSuggestions } from '@/features/sales/useDiscountSuggestions';
import { QuickKeyValueForm } from '@/features/sales/QuickKeyValueForm';
import {
  clearSalesFavoriteIds,
  readDismissedSuggestions,
  readSalesFavoriteIds,
  writeDismissedSuggestions,
} from '@/features/sales/salesFavorites';
import {
  productTile,
  useQuickTileSelection,
  useSiteQuickKeys,
  type QuickTile,
} from '@/features/sales/siteQuickKeys';
import { onErrorToast } from '@/lib/mutationHelpers';
import { formatCurrency } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import type { ProductSearchSelection } from '@/types';

const SiteQuickKeysEditor = lazy(() =>
  import('@/features/sales/SiteQuickKeysEditor').then(module => ({
    default: module.SiteQuickKeysEditor,
  }))
);

interface SalesQuickAccessProps {
  scopeKey: string;
  siteId: string;
  /** Managers and admins choose the site's keys; cashiers only use them. */
  canEdit?: boolean;
  /** Mid-sale the strip stays quiet: no favourite suggestion. */
  hasCartItems?: boolean;
  onSelectProduct: (selection: ProductSearchSelection, quantity?: number) => void;
}

export function SalesQuickAccess({
  scopeKey,
  siteId,
  canEdit = false,
  hasCartItems = false,
  onSelectProduct,
}: SalesQuickAccessProps) {
  const { t } = useTranslation('salesQuickAccess');
  const toast = useToast();
  const utils = trpc.useUtils();
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [valueTile, setValueTile] = useState<QuickTile | null>(null);
  const [legacyIds] = useState(() => readSalesFavoriteIds(scopeKey));
  const enabled = siteId.length > 0;
  const resolveSelection = useQuickTileSelection(siteId);

  const { query: keysQuery, keys, tiles: keyTiles } = useSiteQuickKeys(siteId);
  const importMutation = trpc.quickKeys.importLocal.useMutation({
    onSuccess: list => {
      clearSalesFavoriteIds(scopeKey);
      utils.quickKeys.list.setData({ siteId }, list);
    },
  });
  const setMutation = trpc.quickKeys.set.useMutation({
    onSuccess: list => utils.quickKeys.list.setData({ siteId }, list),
    onError: onErrorToast(toast, t, { titleKey: 'saveFailed' }),
  });

  const needsImport = keysQuery.isSuccess && keys.length === 0 && (legacyIds?.length ?? 0) > 0;
  const { mutate: importLocal, isIdle: importIdle, isPending: importing } = importMutation;
  useEffect(() => {
    if (needsImport && importIdle) importLocal({ siteId, productIds: legacyIds ?? [] });
  }, [importIdle, importLocal, legacyIds, needsImport, siteId]);
  // A site that already has keys never imports, so its old local favourites go now.
  const siteHasKeys = keys.length > 0;
  useEffect(() => {
    if (siteHasKeys && legacyIds) clearSalesFavoriteIds(scopeKey);
  }, [legacyIds, scopeKey, siteHasKeys]);

  // An import that settles with no usable favourite leaves the site empty, so the fallback shows then too.
  const importSettled = !importIdle && !importing;
  const showsFallback = keysQuery.isSuccess && !siteHasKeys && (!needsImport || importSettled);
  const topSellingQuery = trpc.products.topSelling.useQuery(
    { siteId, limit: MAX_SITE_QUICK_KEYS },
    {
      enabled: enabled && (showsFallback || (canEdit && siteHasKeys && !hasCartItems)),
      staleTime: 5 * 60_000,
    }
  );
  const productsQuery = trpc.products.list.useQuery(
    { page: 1, perPage: MAX_SITE_QUICK_KEYS, isActive: true },
    {
      enabled: enabled && showsFallback,
      staleTime: 60_000,
      placeholderData: keepPreviousData,
    }
  );
  const categoriesQuery = trpc.categories.tree.useQuery(undefined, {
    enabled: enabled && !hasCartItems,
    staleTime: 60_000,
  });
  const [dismissedSuggestions, setDismissedSuggestions] = useState(() =>
    readDismissedSuggestions(scopeKey)
  );

  // Without keys the strip offers what this site sells most, topped up from the catalog.
  const fallbackTiles = useMemo(() => {
    const sellers = (topSellingQuery.data ?? []).map(item =>
      productTile({ ...item, id: item.productId })
    );
    const sellerIds = new Set(sellers.map(tile => tile.productId));
    const catalog = (productsQuery.data?.items ?? [])
      .filter(item => item.isActive && item.catalogType !== 'variant_parent')
      .map(productTile)
      .filter(tile => !sellerIds.has(tile.productId));
    return [...sellers, ...catalog].slice(0, MAX_SITE_QUICK_KEYS);
  }, [productsQuery.data, topSellingQuery.data]);
  const productKeyIds = useMemo(
    () => new Set(keys.flatMap(key => (key.kind === 'product' ? [key.productId] : []))),
    [keys]
  );

  // Mid-sale the category chips are hidden, so a filter picked earlier must not linger.
  const categoryFilter = hasCartItems ? null : activeCategoryId;
  const visibleTiles = (siteHasKeys ? keyTiles : fallbackTiles).filter(
    tile => !categoryFilter || tile.categoryId === categoryFilter
  );
  const discountSuggestions = useDiscountSuggestions(enabled && visibleTiles.length > 0, siteId);

  // The fallback already shows the top sellers, so the banner waits for the site's own keys.
  const suggestion =
    canEdit && siteHasKeys && !hasCartItems && keys.length < MAX_SITE_QUICK_KEYS
      ? topSellingQuery.data?.find(
          item =>
            !productKeyIds.has(item.productId) && !dismissedSuggestions.includes(item.productId)
        )
      : undefined;
  const dismissSuggestion = (productId: string) => {
    const next = [...dismissedSuggestions, productId];
    setDismissedSuggestions(next);
    writeDismissedSuggestions(scopeKey, next);
  };

  const addTile = async (tile: QuickTile) => {
    setLoadingKey(tile.key);
    try {
      const selection = await resolveSelection(tile);
      if (selection) onSelectProduct(selection);
      else toast.error({ title: t('noSaleUnit') });
    } catch {
      toast.error({ title: t('addFailed') });
    } finally {
      setLoadingKey(null);
    }
  };

  const handleTile = (tile: QuickTile) => {
    if (tile.kind === 'open_value') setValueTile(tile);
    else void addTile(tile);
  };

  const categories = categoriesQuery.data?.items ?? [];
  const isLoading =
    keysQuery.isLoading ||
    importing ||
    (showsFallback && (topSellingQuery.isLoading || productsQuery.isLoading));

  return (
    <section
      className="sales-quick-access lg:shrink-0"
      aria-labelledby="sales-quick-access-title"
      data-testid="sales-quick-access"
    >
      <div className="flex min-h-9 items-center justify-between gap-3">
        <h3 id="sales-quick-access-title" className="sales-cap">
          {t('barTitle')}
        </h3>
        {canEdit && (
          <button
            type="button"
            className="sales-quick-choose"
            onClick={() => setIsEditorOpen(true)}
            aria-haspopup="dialog"
            data-testid="sales-favorites-edit"
          >
            {t('choose')}
          </button>
        )}
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
            onClick={() => setMutation.mutate({ siteId, productId: suggestion.productId })}
            disabled={setMutation.isPending}
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

      {!hasCartItems && categories.length > 0 && (
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

      {keysQuery.isError && (
        <div className="mt-2 rounded-xl border border-line p-3 text-sm" role="alert">
          <p>{t('favoritesLoadError')}</p>
          <button type="button" className="btn-outline mt-2" onClick={() => keysQuery.refetch()}>
            {t('retryFavorites')}
          </button>
        </div>
      )}
      {isLoading ? (
        <div className="sales-quick-keys-loading mt-2" role="status">
          <LoaderCircle className="h-5 w-5 motion-safe:animate-spin text-fg3" aria-hidden="true" />
          <span className="sr-only">{t('loading')}</span>
        </div>
      ) : visibleTiles.length > 0 ? (
        <div className="sales-quick-keys mt-2">
          {visibleTiles.map(tile => {
            const discount = discountSuggestions.get(tile.productId) ?? 0;
            const isOpenValue = tile.kind === 'open_value';
            return (
              <button
                key={tile.key}
                type="button"
                className="sales-quick-key"
                aria-pressed={isOpenValue ? valueTile?.key === tile.key : undefined}
                onClick={() => handleTile(tile)}
                disabled={loadingKey === tile.key}
                aria-label={t(isOpenValue ? 'sellByValue' : 'addProduct', { name: tile.name })}
                data-testid={`sales-quick-${isOpenValue ? 'value' : 'product'}-${tile.sku}`}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="line-clamp-2 text-sm font-semibold leading-tight text-fg1">
                    {tile.name}
                  </span>
                  {tile.colour && (
                    <span
                      className="sales-quick-key-swatch"
                      data-colour={tile.colour}
                      aria-hidden="true"
                    />
                  )}
                </span>
                <span className="flex items-end justify-between gap-2">
                  <span className="font-numeric text-base font-bold text-fg1">
                    {isOpenValue ? t('openValue') : formatCurrency(tile.price)}
                  </span>
                  {discount > 0 && !isOpenValue && (
                    <span className="sales-tag bg-warning-50 text-warning-700">-{discount}%</span>
                  )}
                </span>
                {loadingKey === tile.key && (
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
          <p className="text-sm text-fg2">{t('noFavorites')}</p>
        </div>
      )}

      {valueTile && (
        <QuickKeyValueForm
          key={valueTile.key}
          className="mt-2"
          tile={valueTile}
          resolveSelection={resolveSelection}
          onAdd={(selection, quantity) => {
            onSelectProduct(selection, quantity);
            setValueTile(null);
          }}
          onCancel={() => setValueTile(null)}
        />
      )}

      {isEditorOpen && (
        <Suspense fallback={null}>
          <SiteQuickKeysEditor siteId={siteId} onClose={() => setIsEditorOpen(false)} />
        </Suspense>
      )}
    </section>
  );
}
