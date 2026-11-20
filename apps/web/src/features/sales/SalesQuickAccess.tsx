import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { LoaderCircle, Settings2, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  MAX_SITE_QUICK_KEYS,
  type SiteQuickKeyColour,
  type SiteQuickKeyKind,
} from '@puntovivo/shared/quick-keys';
import { useToast } from '@/components/feedback/ToastProvider';
import { useDiscountSuggestions } from '@/features/sales/useDiscountSuggestions';
import { quantityForAmount, selectionFromHydratedProduct } from '@/features/sales/productSelection';
import {
  clearSalesFavoriteIds,
  readDismissedSuggestions,
  readSalesFavoriteIds,
  writeDismissedSuggestions,
} from '@/features/sales/salesFavorites';
import { onErrorToast } from '@/lib/mutationHelpers';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import type { Product, ProductSearchSelection } from '@/types';

interface SalesQuickAccessProps {
  scopeKey: string;
  siteId: string;
  /** Managers and admins choose the site's keys; cashiers only use them. */
  canEdit?: boolean;
  /** Mid-sale the strip stays quiet: no favourite suggestion. */
  hasCartItems?: boolean;
  onSelectProduct: (selection: ProductSearchSelection, quantity?: number) => void;
}

interface ValueEntry {
  tile: QuickTile;
  amount: string;
  error: string | null;
}

interface QuickTile {
  key: string;
  kind: SiteQuickKeyKind;
  productId: string;
  unitId: string | null;
  sku: string;
  name: string;
  price: number;
  categoryId: string | null;
  colour: SiteQuickKeyColour | null;
  /** False for keys whose product can no longer be sold; only the editor shows them. */
  sellable: boolean;
}

// A site without keys shows the first catalog products; the editor needs a wider page.
const SUGGESTION_CATALOG_SIZE = 12;
const EDITOR_CATALOG_SIZE = 80;
const FALLBACK_TILES = 6;

function productTile(
  product: Pick<Product, 'id' | 'sku' | 'name' | 'price'> & { categoryId?: string | null }
): QuickTile {
  return {
    key: product.id,
    kind: 'product',
    productId: product.id,
    unitId: null,
    sku: product.sku,
    name: product.name,
    price: product.price,
    categoryId: product.categoryId ?? null,
    colour: null,
    sellable: true,
  };
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
  const [isEditing, setIsEditing] = useState(false);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [valueEntry, setValueEntry] = useState<ValueEntry | null>(null);
  const [legacyIds] = useState(() => readSalesFavoriteIds(scopeKey));
  const enabled = siteId.length > 0;
  const editing = canEdit && isEditing;

  const keysQuery = trpc.quickKeys.list.useQuery({ siteId }, { enabled, staleTime: 60_000 });
  const keys = useMemo(() => keysQuery.data ?? [], [keysQuery.data]);
  const editOptions = {
    onSuccess: (list: typeof keys) => utils.quickKeys.list.setData({ siteId }, list),
    onError: onErrorToast(toast, t, { titleKey: 'saveFailed' }),
  };
  const importMutation = trpc.quickKeys.importLocal.useMutation({
    onSuccess: list => {
      clearSalesFavoriteIds(scopeKey);
      utils.quickKeys.list.setData({ siteId }, list);
    },
  });
  const setMutation = trpc.quickKeys.set.useMutation(editOptions);
  const removeMutation = trpc.quickKeys.remove.useMutation(editOptions);

  const needsImport = keysQuery.isSuccess && keys.length === 0 && (legacyIds?.length ?? 0) > 0;
  const {
    mutate: importLocal,
    isIdle: importIdle,
    isPending: importing,
  } = importMutation;
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
  const productsQuery = trpc.products.list.useQuery(
    { page: 1, perPage: editing ? EDITOR_CATALOG_SIZE : SUGGESTION_CATALOG_SIZE, isActive: true },
    {
      enabled: enabled && (editing || showsFallback),
      staleTime: 60_000,
      placeholderData: keepPreviousData,
    }
  );
  const categoriesQuery = trpc.categories.tree.useQuery(undefined, {
    enabled: enabled && (editing || !hasCartItems),
    staleTime: 60_000,
  });
  const topSellingQuery = trpc.products.topSelling.useQuery(
    { siteId },
    { enabled: enabled && canEdit, staleTime: 5 * 60_000 }
  );
  const [dismissedSuggestions, setDismissedSuggestions] = useState(() =>
    readDismissedSuggestions(scopeKey)
  );

  const keyTiles = useMemo<QuickTile[]>(
    () =>
      keys.map(key => ({
        key: key.id,
        kind: key.kind,
        productId: key.productId,
        unitId: key.unitId,
        sku: key.productSku,
        name: key.label ?? key.productName,
        price: key.catalogPrice,
        categoryId: key.categoryId,
        colour: key.colour,
        sellable: key.sellable,
      })),
    [keys]
  );
  const catalogTiles = useMemo(
    () =>
      (productsQuery.data?.items ?? [])
        .filter(item => item.isActive && item.catalogType !== 'variant_parent')
        .map(productTile),
    [productsQuery.data]
  );
  // Amount keys are not edited here; the editor toggles plain product keys.
  const productKeyIds = useMemo(
    () => new Set(keys.flatMap(key => (key.kind === 'product' ? [key.productId] : []))),
    [keys]
  );

  // Mid-sale the category chips are hidden, so a filter picked earlier must not linger.
  const categoryFilter = editing || !hasCartItems ? activeCategoryId : null;
  const byCategory = (tile: QuickTile) => !categoryFilter || tile.categoryId === categoryFilter;
  const visibleTiles = editing
    ? [
        ...keyTiles.filter(tile => tile.kind === 'product'),
        ...catalogTiles.filter(tile => !productKeyIds.has(tile.productId)),
      ]
        .filter(byCategory)
        .slice(0, 24)
    : (siteHasKeys
        ? keyTiles.filter(tile => tile.sellable)
        : catalogTiles.slice(0, FALLBACK_TILES)
      ).filter(byCategory);
  const discountSuggestions = useDiscountSuggestions(enabled && visibleTiles.length > 0, siteId);

  const suggestion =
    canEdit && !hasCartItems && keys.length < MAX_SITE_QUICK_KEYS
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

  const addKey = (productId: string) => {
    if (keys.length >= MAX_SITE_QUICK_KEYS) {
      toast.error({ title: t('limitReached') });
      return;
    }
    setMutation.mutate({ siteId, productId });
  };

  const toggleKey = (productId: string) => {
    const existing = keys.find(key => key.kind === 'product' && key.productId === productId);
    if (existing) removeMutation.mutate({ siteId, id: existing.id });
    else addKey(productId);
  };

  /** Hydrates the tile's product for the cart and reports what blocks the add. */
  const withSelection = async (
    tile: QuickTile,
    addToCart: (selection: ProductSearchSelection) => void
  ) => {
    setLoadingKey(tile.key);
    try {
      // Tiles carry list data only; the cart needs the current product and its units.
      const hydrated = await utils.products.getById.fetch(
        { id: tile.productId, siteId },
        { staleTime: 0 }
      );
      const selection = selectionFromHydratedProduct(hydrated as unknown as Product, tile.unitId);
      if (selection) addToCart(selection);
      else toast.error({ title: t('noSaleUnit') });
    } catch {
      toast.error({ title: t('addFailed') });
    } finally {
      setLoadingKey(null);
    }
  };

  const handleTile = (tile: QuickTile) => {
    if (editing) toggleKey(tile.productId);
    else if (tile.kind === 'open_value') setValueEntry({ tile, amount: '', error: null });
    else void withSelection(tile, selection => onSelectProduct(selection));
  };

  const submitValue = (event: FormEvent) => {
    event.preventDefault();
    if (!valueEntry) return;
    const showError = (error: string) =>
      setValueEntry(entry => (entry ? { ...entry, error } : entry));
    const amount = Number(valueEntry.amount);
    if (!(amount > 0)) {
      showError(t('value.invalid'));
      return;
    }
    void withSelection(valueEntry.tile, selection => {
      const result = quantityForAmount(amount, selection.price, selection.product);
      if ('error' in result) {
        showError(
          t(`value.${result.error}`, {
            price: formatCurrency(selection.price),
            minimum: 'minimum' in result ? formatNumber(result.minimum) : '',
            unit: selection.unit.unitAbbreviation ?? '',
          })
        );
        return;
      }
      onSelectProduct(selection, result.quantity);
      setValueEntry(null);
    });
  };

  const categories = categoriesQuery.data?.items ?? [];
  const isLoading = keysQuery.isLoading || importing || (showsFallback && productsQuery.isLoading);

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
            className="btn-ghost min-h-9 gap-1.5 px-2 py-1 text-xs"
            onClick={() => setIsEditing(value => !value)}
            aria-pressed={isEditing}
            data-testid="sales-favorites-edit"
          >
            <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
            {isEditing ? t('finishEditing') : t('configure')}
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
            onClick={() => addKey(suggestion.productId)}
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

      {(editing || !hasCartItems) && categories.length > 0 && (
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
        <div className={`mt-2 ${editing ? 'sales-quick-keys-editing' : 'sales-quick-keys'}`}>
          {visibleTiles.map(tile => {
            const isKey = productKeyIds.has(tile.productId);
            const discount = discountSuggestions.get(tile.productId) ?? 0;
            const isOpenValue = tile.kind === 'open_value';
            return (
              <button
                key={tile.key}
                type="button"
                className="sales-quick-key"
                data-picked={editing && isKey}
                aria-pressed={
                  !editing && isOpenValue ? valueEntry?.tile.key === tile.key : undefined
                }
                onClick={() => handleTile(tile)}
                disabled={loadingKey === tile.key}
                aria-label={
                  editing
                    ? t(isKey ? 'removeFavorite' : 'addFavorite', { name: tile.name })
                    : t(isOpenValue ? 'sellByValue' : 'addProduct', { name: tile.name })
                }
                data-testid={`sales-quick-${isOpenValue ? 'value' : 'product'}-${tile.sku}`}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="line-clamp-2 text-sm font-semibold leading-tight text-fg1">
                    {tile.name}
                  </span>
                  {editing ? (
                    <Star
                      className={[
                        'h-4 w-4 shrink-0',
                        isKey ? 'fill-primary-600 text-primary-600' : 'text-fg3',
                      ].join(' ')}
                      aria-hidden="true"
                    />
                  ) : (
                    tile.colour && (
                      <span
                        className="sales-quick-key-swatch"
                        data-colour={tile.colour}
                        aria-hidden="true"
                      />
                    )
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
          <p className="text-sm text-fg2">{editing ? t('noCategoryProducts') : t('noFavorites')}</p>
        </div>
      )}

      {valueEntry && !editing && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2 rounded-xl bg-accent p-3"
          onSubmit={submitValue}
          data-testid="sales-quick-value-form"
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-semibold text-fg1">
            {t('value.title', { name: valueEntry.tile.name })}
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              className="input min-h-11"
              value={valueEntry.amount}
              onChange={event => {
                const amount = event.target.value;
                setValueEntry(entry => (entry ? { ...entry, amount, error: null } : entry));
              }}
              aria-invalid={valueEntry.error !== null}
              aria-describedby={valueEntry.error ? 'sales-quick-value-error' : undefined}
              // The form opens from a deliberate tap; typing the amount is the next step.
              autoFocus
              data-testid="sales-quick-value-amount"
            />
          </label>
          <button
            type="submit"
            className="btn-primary min-h-11"
            disabled={loadingKey === valueEntry.tile.key}
          >
            {t('value.add')}
          </button>
          <button type="button" className="btn-ghost min-h-11" onClick={() => setValueEntry(null)}>
            {t('value.cancel')}
          </button>
          {valueEntry.error && (
            <p id="sales-quick-value-error" className="w-full text-sm text-danger-700" role="alert">
              {valueEntry.error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
