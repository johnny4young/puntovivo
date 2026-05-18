/**
 * ENG-087 — Touch POS V1 product tile grid.
 *
 * Responsive 2 / 3 / 4 / 6 column grid mirroring
 * `RestaurantFloorMapPreview` and `DeliveryPage`. Each tile
 * normalises height via `auto-rows-fr` so a 7-character product
 * name never makes a row shorter than its neighbours.
 *
 * Touch-first design notes:
 *  - Every tile is ≥ 96 × 96 px so the tap target clears the
 *    44 px minimum even with the inner padding.
 *  - `truncate` + `line-clamp-2` keep long product names from
 *    breaking the grid rhythm.
 *  - Prices use `font-display tabular-nums` so the column reads
 *    as a single rhythm regardless of locale digit width.
 *  - Empty / loading / error states have dedicated visuals so the
 *    grid never collapses into a blank gray box.
 */
import { useTranslation } from 'react-i18next';
import { Boxes } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import type { Product } from '@/types';

interface PosTouchProductGridProps {
  products: Product[];
  isLoading: boolean;
  isError: boolean;
  onSelect: (product: Product) => void;
}

export function PosTouchProductGrid({
  products,
  isLoading,
  isError,
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
        <button
          key={product.id}
          type="button"
          data-testid={`pos-touch-tile-${product.id}`}
          aria-label={t('grid.tileAriaLabel', {
            name: product.name,
            price: formatCurrency(product.price),
          })}
          onClick={() => onSelect(product)}
          className="group flex min-h-[96px] flex-col justify-between gap-2 rounded-xl border border-line/70 bg-surface-1 p-3 text-left transition-all hover:border-primary-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 active:scale-[0.98]"
        >
          <div className="flex items-start gap-2">
            <span className="glyph-tile flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] bg-primary-50 text-primary-700">
              <Boxes className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="line-clamp-2 text-sm font-medium leading-tight text-secondary-900">
              {product.name}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[10px] uppercase tracking-[0.18em] text-secondary-500">
              {product.sku}
            </span>
            <span className="font-display text-base tabular-nums text-secondary-900">
              {formatCurrency(product.price)}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
