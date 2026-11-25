import { formatCurrency, formatNumber } from '@/lib/utils';
import type { ProductSearchItem } from '@/types';
import { unitLabel } from './saleCart';
import { useHardwareCopy } from './useHardwareCopy';

/** The site with the most stock after this one, where a transfer would come from. */
export function OtherSiteStock({ product }: { product: ProductSearchItem }) {
  const { t, ready } = useHardwareCopy();
  const site = product.otherSites?.[0];
  if (!ready || !site) return null;
  return (
    <span
      className="block text-xs text-secondary-500"
      data-testid={`product-other-site-${product.sku}`}
    >
      {t('search.atSite', { onHand: formatNumber(site.onHand), site: site.siteName })}
    </span>
  );
}

/** The product's other units with their price; one tap picks the product in that unit. */
export function UnitPriceChips({
  product,
  defaultUnitId,
  selectedUnitId,
  focusable,
  onSelectUnit,
}: {
  product: ProductSearchItem;
  defaultUnitId: string | undefined;
  /** The unit picked for this product, when it is the selected row. */
  selectedUnitId: string | undefined;
  focusable: boolean;
  onSelectUnit: (unitId: string) => void;
}) {
  const { t, ready } = useHardwareCopy();
  const others = (product.unitAssignments ?? []).filter(unit => unit.unitId !== defaultUnitId);
  if (!ready || others.length === 0) return null;
  return (
    <span
      className="mt-1 flex flex-wrap items-center gap-1.5"
      data-testid={`product-unit-chips-${product.sku}`}
    >
      {others.map(unit => (
        <button
          key={unit.unitId}
          type="button"
          className="sales-unit-chip"
          aria-pressed={selectedUnitId === unit.unitId}
          tabIndex={focusable ? 0 : -1}
          data-testid={`product-unit-chip-${product.sku}-${unit.unitId}`}
          onClick={event => {
            event.stopPropagation();
            onSelectUnit(unit.unitId);
          }}
        >
          {t(unit.equivalence === 1 ? 'search.unitChipSingle' : 'search.unitChip', {
            unit: unitLabel(unit),
            equivalence: formatNumber(unit.equivalence),
            price: formatCurrency(unit.price),
          })}
        </button>
      ))}
    </span>
  );
}
