import { formatCurrency } from '@/lib/utils';
import { PharmacySavingsTag } from './PharmacyTags';
import { usePharmacyCopy } from './usePharmacyCopy';
import type { GenericAlternative } from './useGenericAlternatives';

/** Cheaper equivalents of the picked medicine that the search did not list. */
export function PharmacyAlternatives({
  alternatives,
  onChoose,
}: {
  alternatives: readonly GenericAlternative[];
  onChoose: (alternative: GenericAlternative) => void;
}) {
  const { t, ready } = usePharmacyCopy();
  if (!ready) return null;
  return (
    <section data-testid="product-generic-alternatives">
      <h4 className="sales-cap mb-2">{t('generic.panelTitle')}</h4>
      <ul className="grid gap-2">
        {alternatives.map(alternative => (
          <li key={alternative.productId}>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-[14px] border border-line/70 bg-surface/92 px-4 py-3 text-left hover:bg-primary-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60"
              aria-label={t('generic.choose', { name: alternative.name })}
              data-testid={`product-generic-choose-${alternative.sku}`}
              onClick={() => onChoose(alternative)}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-secondary-900">
                  {alternative.name}
                </span>
                <span className="mt-1 inline-flex">
                  <PharmacySavingsTag savings={alternative.savings} />
                </span>
              </span>
              <span className="font-numeric text-sm font-bold text-secondary-900">
                {formatCurrency(alternative.price)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
