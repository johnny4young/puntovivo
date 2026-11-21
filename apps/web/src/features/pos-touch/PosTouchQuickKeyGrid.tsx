import { useTranslation } from 'react-i18next';
import type { QuickTile } from '@/features/sales/siteQuickKeys';
import { formatCurrency } from '@/lib/utils';
import { PosTouchQuantityBadge } from './PosTouchProductGrid';
import { formatQuantity } from './posTouchQuantity';

interface PosTouchQuickKeyGridProps {
  tiles: QuickTile[];
  isDisabled: boolean;
  /** The «valor…» key whose amount form is open. */
  activeValueKey: string | null;
  /** The product whose weight is being asked. */
  weighingProductId?: string | null;
  cartQuantities: ReadonlyMap<string, number>;
  onSelect: (tile: QuickTile) => void;
}

/** The site's one-touch keys, the same ones the register strip shows. */
export function PosTouchQuickKeyGrid({
  tiles,
  isDisabled,
  activeValueKey,
  weighingProductId = null,
  cartQuantities,
  onSelect,
}: PosTouchQuickKeyGridProps) {
  const { t, i18n } = useTranslation(['posTouch', 'salesQuickAccess']);

  return (
    <div
      data-testid="pos-touch-quick-keys"
      className="grid auto-rows-fr grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
    >
      {tiles.map(tile => {
        const isOpenValue = tile.kind === 'open_value';
        const quantity = cartQuantities.get(tile.productId) ?? 0;
        const quantityLabel = formatQuantity(quantity, i18n.language);
        const name = isOpenValue
          ? t('salesQuickAccess:sellByValue', { name: tile.name })
          : t('grid.tileAriaLabel', { name: tile.name, price: formatCurrency(tile.price) });
        return (
          <button
            key={tile.key}
            type="button"
            data-testid={`pos-touch-key-${tile.sku}-${tile.kind}`}
            aria-pressed={isOpenValue ? activeValueKey === tile.key : undefined}
            aria-label={
              quantity > 0 ? `${name}. ${t('grid.inCart', { count: quantityLabel })}` : name
            }
            disabled={isDisabled}
            onClick={() => onSelect(tile)}
            data-weighing={(!isOpenValue && tile.productId === weighingProductId) || undefined}
            className="relative flex min-h-[96px] flex-col justify-between gap-2 rounded-xl border-[1.5px] border-line bg-surface-1 p-3 text-left transition-colors hover:border-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 aria-pressed:border-primary-600 aria-pressed:bg-accent data-weighing:border-primary-600 data-weighing:bg-accent disabled:cursor-wait disabled:opacity-60"
          >
            {quantity > 0 && <PosTouchQuantityBadge id={tile.key} label={quantityLabel} />}
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
            <span className="flex items-baseline justify-between gap-2">
              <span className="font-display text-lg tabular-nums text-fg1">
                {isOpenValue ? t('salesQuickAccess:openValue') : formatCurrency(tile.price)}
              </span>
              {!isOpenValue && tile.unitAbbreviation && (
                <span className="text-xs font-semibold text-primary-700">
                  {t('grid.perUnit', { unit: tile.unitAbbreviation })}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
