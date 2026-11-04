/**
 * Touch POS V1 product tile grid.
 *
 * Responsive 2 / 3 / 4 / 6 column grid mirroring
 * `RestaurantFloorMapPreview` and `DeliveryPage`. Each tile
 * normalises height via `auto-rows-fr` so a 7-character product
 * name never makes a row shorter than its neighbours.
 *
 * Touch-first design notes:
 * - Every tile is ≥ 96 × 96 px so the tap target clears the
 * 44 px minimum even with the inner padding.
 * - `truncate` + `line-clamp-2` keep long product names from
 * breaking the grid rhythm.
 * - Prices use `font-display tabular-nums` so the column reads
 * as a single rhythm regardless of locale digit width.
 * - Empty / loading / error states have dedicated visuals so the
 * grid never collapses into a blank gray box.
 */
import { memo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/lib/utils';
import type { Product } from '@/types';

interface PosTouchProductGridProps {
  products: Product[];
  isLoading: boolean;
  isError: boolean;
  isDisabled?: boolean;
  onSelect: (product: Product) => void;
  /** Cart quantity per product id, summed across lines. */
  cartQuantities?: ReadonlyMap<string, number>;
}

const CATEGORY_HUES = [250, 200, 150, 95, 55, 25, 340, 295] as const;

function categoryHue(categoryId: string | null | undefined): number {
  if (!categoryId) return CATEGORY_HUES[0];
  let hash = 0;
  for (const char of categoryId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return CATEGORY_HUES[Math.abs(hash) % CATEGORY_HUES.length] ?? CATEGORY_HUES[0];
}

// The register sells from its own site, so the tenant-wide total is only a fallback.
function getTileStock(product: Product): number {
  return product.siteStock ?? product.stock;
}

function getStockState(product: Product): 'out' | 'low' | 'ok' | null {
  if (product.tracksStock === false) return null;
  const stock = getTileStock(product);
  if (stock <= 0) return 'out';
  return stock <= product.minStock ? 'low' : 'ok';
}

const quantityFormatters = new Map<string, Intl.NumberFormat>();

function formatQuantity(value: number, locale: string): string {
  let formatter = quantityFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    quantityFormatters.set(locale, formatter);
  }
  return formatter.format(value);
}

const STOCK_TONE = {
  out: 'text-danger-700',
  low: 'font-medium text-warning-700',
  ok: 'text-secondary-500',
} as const;

interface PosTouchTileProps {
  product: Product;
  quantity: number;
  isDisabled: boolean;
  onSelect: (product: Product) => void;
}

// memo: a cart tap changes one quantity, so only that tile re-renders out of up to 200.
const PosTouchTile = memo(function PosTouchTile({
  product,
  quantity,
  isDisabled,
  onSelect,
}: PosTouchTileProps) {
  const { t, i18n } = useTranslation('posTouch');
  const stockState = getStockState(product);
  const stockLabel = stockState
    ? t(`grid.stock.${stockState}`, { count: formatQuantity(getTileStock(product), i18n.language) })
    : null;
  const quantityLabel = formatQuantity(quantity, i18n.language);
  const tileLabel = t('grid.tileAriaLabel', {
    name: product.name,
    price: formatCurrency(product.price),
  });

  return (
    <button
      type="button"
      data-testid={`pos-touch-tile-${product.id}`}
      aria-label={[
        tileLabel,
        stockLabel,
        quantity > 0 ? t('grid.inCart', { count: quantityLabel }) : null,
      ]
        .filter(Boolean)
        .join('. ')}
      disabled={isDisabled}
      onClick={() => onSelect(product)}
      className="group relative flex min-h-[96px] flex-col justify-between gap-2 rounded-xl border border-line/70 bg-surface-1 p-3 text-left transition-all hover:border-primary-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 disabled:active:scale-100"
    >
      {quantity > 0 ? (
        <span
          data-testid={`pos-touch-quantity-${product.id}`}
          className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary-600 px-1.5 text-xs font-semibold tabular-nums text-white"
        >
          {quantityLabel}
        </span>
      ) : null}
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="pos-touch-tile-initial flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] text-sm font-semibold"
          style={{ '--tile-hue': categoryHue(product.categoryId) } as CSSProperties}
        >
          {product.name.trim().charAt(0).toUpperCase()}
        </span>
        <span className="line-clamp-2 text-sm font-medium leading-tight text-secondary-900">
          {product.name}
        </span>
      </div>
      {stockState ? (
        <span
          data-testid={`pos-touch-stock-${product.id}`}
          data-stock-state={stockState}
          className={`text-xs ${STOCK_TONE[stockState]}`}
        >
          {stockLabel}
        </span>
      ) : null}
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[10px] uppercase tracking-[0.18em] text-secondary-500">
          {product.sku}
        </span>
        <span className="font-display text-lg tabular-nums text-secondary-900">
          {formatCurrency(product.price)}
        </span>
      </div>
    </button>
  );
});

// memo: skips the 200 prop lookups on screen renders that leave the cart alone.
export const PosTouchProductGrid = memo(function PosTouchProductGrid({
  products,
  isLoading,
  isError,
  isDisabled = false,
  cartQuantities,
  onSelect,
}: PosTouchProductGridProps) {
  const { t } = useTranslation('posTouch');

  if (isLoading) {
    return (
      <div
        data-testid="pos-touch-grid-loading"
        className="rounded-xl border border-line/70 bg-surface-1 p-6 text-sm text-secondary-500"
      >
        {t('page.loadingProducts')}
      </div>
    );
  }

  if (isError) {
    return (
      <div
        role="alert"
        data-testid="pos-touch-grid-error"
        className="rounded-xl border border-danger-300 bg-danger-50 p-6 text-sm text-danger-700"
      >
        {t('page.loadingError')}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div
        data-testid="pos-touch-grid-empty"
        className="rounded-xl border border-dashed border-line bg-surface-1 p-8 text-center text-sm text-secondary-500"
      >
        {t('grid.empty')}
      </div>
    );
  }

  return (
    <div
      data-testid="pos-touch-grid"
      className="grid auto-rows-fr grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
    >
      {products.map(product => (
        <PosTouchTile
          key={product.id}
          product={product}
          quantity={cartQuantities?.get(product.id) ?? 0}
          isDisabled={isDisabled}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
});
