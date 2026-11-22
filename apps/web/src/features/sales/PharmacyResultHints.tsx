import type { PharmacyProductProfile, ProductSearchItem } from '@/types';
import { PharmacyClassTag, PharmacyLotTag, PharmacySavingsTag } from './PharmacyTags';
import { usePharmacyCopy } from './usePharmacyCopy';

/** What a pharmacist decides on in a search row: ingredient, lot, class and savings. */
export function PharmacyResultHints({
  product,
  profile,
  savings,
}: {
  product: ProductSearchItem;
  profile: PharmacyProductProfile;
  savings?: number | undefined;
}) {
  const { t, ready } = usePharmacyCopy();
  const isGeneric = savings !== undefined;
  return (
    <>
      <p className="text-xs text-secondary-500">
        {isGeneric && ready
          ? t('generic.sameIngredient')
          : [profile.activeIngredient, profile.manufacturer].filter(Boolean).join(' · ')}
      </p>
      <span
        className="mt-1 flex flex-wrap items-center gap-1.5"
        data-testid={`product-pharmacy-hints-${product.sku}`}
      >
        {isGeneric && (
          <PharmacySavingsTag savings={savings} testId={`product-generic-savings-${product.sku}`} />
        )}
        {product.nextLot && (
          <PharmacyLotTag lot={product.nextLot} testId={`product-lot-${product.sku}`} />
        )}
        <PharmacyClassTag
          classification={profile.classification}
          testId={`product-class-${product.sku}`}
        />
      </span>
    </>
  );
}
