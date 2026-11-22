/** Selected-product details for ProductSearchDialog. */
import { useTranslation } from 'react-i18next';

import { formatCurrency } from '@/lib/utils';
import { ariaKeyshortcutsFor } from '@/lib/shortcuts';
import type { ProductSearchItem, ProductUnitAssignment } from '@/types';

import { PharmacyAlternatives } from '@/features/sales/PharmacyAlternatives';
import type { GenericAlternative } from '@/features/sales/useGenericAlternatives';

import { PRODUCT_SEARCH_UNIT_SELECT_ID } from './productSearchSelection';

interface ProductSearchSelectionPanelProps {
  product: ProductSearchItem | null;
  unit: ProductUnitAssignment | null;
  showUnits?: boolean;
  /** Cheaper equivalents of the pick that the current results do not list. */
  alternatives?: readonly GenericAlternative[];
  onChooseAlternative?: (alternative: GenericAlternative) => void;
  onUnitChange: (unitId: string) => void;
}

export function ProductSearchSelectionPanel({
  product,
  unit,
  showUnits = true,
  alternatives = [],
  onChooseAlternative,
  onUnitChange,
}: ProductSearchSelectionPanelProps) {
  const { t } = useTranslation('common');

  return (
    <aside className="card-inset p-4 sm:p-5 xl:sticky xl:top-0">
      <h3 className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-secondary-500">
        {t('productSearch.selection')}
      </h3>

      {!product || !unit ? (
        <p className="mt-5 text-sm leading-6 text-secondary-500">
          {t('productSearch.chooseProduct')}
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          <div>
            <p className="text-xl font-semibold text-secondary-950">{product.name}</p>
            <p className="mt-1 text-sm text-secondary-500">{product.sku}</p>
          </div>

          <div className="grid gap-3">
            {showUnits && (
              <div>
                <label className="label" htmlFor={PRODUCT_SEARCH_UNIT_SELECT_ID}>
                  {t('productSearch.unit')}
                </label>
                <select
                  id={PRODUCT_SEARCH_UNIT_SELECT_ID}
                  className="input mt-1"
                  value={unit.unitId}
                  aria-keyshortcuts={ariaKeyshortcutsFor('sales.focusUnit')}
                  onChange={event => onUnitChange(event.target.value)}
                >
                  {product.unitAssignments?.map(assignment => (
                    <option key={assignment.unitId} value={assignment.unitId}>
                      {assignment.unitName ?? assignment.unitAbbreviation ?? assignment.unitId}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="rounded-[14px] border border-line/70 bg-surface/92 px-4 py-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-secondary-500">{t('productSearch.price')}</span>
                <span className="font-medium text-secondary-900">{formatCurrency(unit.price)}</span>
              </div>
              {showUnits && (
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-secondary-500">{t('productSearch.equivalence')}</span>
                  <span className="font-medium text-secondary-900">{unit.equivalence}</span>
                </div>
              )}
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-secondary-500">{t('productSearch.availableStock')}</span>
                <span className="font-medium text-secondary-900">
                  {product.tracksStock === false
                    ? t('productSearch.serviceItem')
                    : (product.siteStock ?? product.stock)}
                </span>
              </div>
              {product.sellByFraction && (
                <>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-secondary-500">{t('productSearch.fractionStep')}</span>
                    <span className="font-medium text-secondary-900">
                      {product.fractionStep ?? '—'}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-secondary-500">{t('productSearch.fractionMinimum')}</span>
                    <span className="font-medium text-secondary-900">
                      {product.fractionMinimum ?? '—'}
                    </span>
                  </div>
                </>
              )}
            </div>
            {alternatives.length > 0 && onChooseAlternative && (
              <PharmacyAlternatives alternatives={alternatives} onChoose={onChooseAlternative} />
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
