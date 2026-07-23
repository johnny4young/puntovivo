/**
 * Product detail Drawer.
 *
 * Read-only slide-over that holds the product fields trimmed off the
 * default `ProductsPage` table (provider, location, tier-2 / tier-3
 * prices, SKU, min-stock) so the table can default to the smallest useful
 * column set. Reuses the shared `Drawer` primitive () for the
 * dialog a11y contract (focus-trap / ESC / labelled-by title). The
 * optional `onEdit` footer action is wired only for manager / admin by the
 * caller, so viewer / cashier see a read-only panel.
 *
 * @module features/products/ProductDetailsDrawer
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Boxes, Pencil } from 'lucide-react';
import { Drawer } from '@/components/feedback/Drawer';
import { formatCurrency } from '@/lib/utils';
import type { Product } from '@/types';

/**
 * Props for {@link ProductDetailsDrawer}. The Drawer is open exactly when
 * `product` is non-null (the parent owns the open/close state).
 */
import { Badge } from '@/components/ui';
export interface ProductDetailsDrawerProps {
  /** The product to detail. `null` keeps the Drawer closed. */
  product: Product | null;
  /** Close the Drawer (ESC / backdrop / close button). */
  onClose: () => void;
  /**
   * Open the edit form for this product. Omitted for roles that cannot
   * manage products, in which case no Edit action renders.
   */
  onEdit?: ((product: Product) => void) | undefined;
  /** Create or inspect the product's immutable variant matrix. */
  onManageVariants?: ((product: Product) => void) | undefined;
}

/** One label/value row in the read-only detail list. */
function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line/60 py-2 last:border-0">
      <dt className="text-sm text-secondary-500">{label}</dt>
      <dd className="text-right text-sm font-medium text-secondary-900">{value}</dd>
    </div>
  );
}
export function ProductDetailsDrawer({
  product,
  onClose,
  onEdit,
  onManageVariants,
}: ProductDetailsDrawerProps) {
  const { t } = useTranslation('products');
  const footer = product ? (
    <div className="flex justify-end gap-2">
      <button type="button" className="btn-outline" onClick={onClose}>
        {t('details.close')}
      </button>
      {onManageVariants && product.catalogType !== 'variant' && !product.tracksSerials && (
        <button
          type="button"
          className="btn-outline flex items-center gap-2"
          onClick={() => onManageVariants(product)}
        >
          <Boxes className="h-4 w-4" />
          {product.catalogType === 'variant_parent'
            ? t('details.viewVariants')
            : t('details.createVariants')}
        </button>
      )}
      {onEdit && product.catalogType !== 'variant_parent' && (
        <button
          type="button"
          className="btn-primary flex items-center gap-2"
          onClick={() => onEdit(product)}
        >
          <Pencil className="h-4 w-4" />
          {t('details.edit')}
        </button>
      )}
    </div>
  ) : undefined;
  return (
    <Drawer
      isOpen={!!product}
      onClose={onClose}
      title={product?.name ?? t('details.title')}
      size="md"
      testId="product-details-drawer"
      footer={footer}
    >
      {product && (
        <dl data-testid="product-details-fields">
          <DetailField label={t('details.sku')} value={product.sku} />
          <DetailField
            label={t('details.catalogType')}
            value={
              <Badge variant="neutral">
                {t(`details.catalogTypes.${product.catalogType ?? 'standard'}`)}
              </Badge>
            }
          />
          {product.catalogType === 'variant' && product.variantValues && (
            <DetailField
              label={t('details.variantValues')}
              value={Object.entries(product.variantValues)
                .map(([axis, value]) => `${axis}: ${value}`)
                .join(' · ')}
            />
          )}
          <DetailField label={t('table.category')} value={product.categoryName ?? '-'} />
          <DetailField label={t('table.provider')} value={product.providerName ?? '-'} />
          <DetailField label={t('table.location')} value={product.locationName ?? '-'} />
          <DetailField label={t('table.tier1')} value={formatCurrency(product.price)} />
          <DetailField label={t('table.tier2')} value={formatCurrency(product.price2)} />
          <DetailField label={t('table.tier3')} value={formatCurrency(product.price3)} />
          <DetailField label={t('table.stock')} value={product.stock.toLocaleString()} />
          <DetailField
            label={t('details.lotTracking')}
            value={
              <Badge variant={product.tracksLots ? 'success' : 'neutral'}>
                {product.tracksLots
                  ? t('details.lotTrackingEnabled')
                  : t('details.lotTrackingDisabled')}
              </Badge>
            }
          />
          <DetailField
            label={t('details.serialTracking')}
            value={
              <Badge variant={product.tracksSerials ? 'success' : 'neutral'}>
                {product.tracksSerials
                  ? t('details.serialTrackingEnabled')
                  : t('details.serialTrackingDisabled')}
              </Badge>
            }
          />
          <DetailField label={t('details.minStock')} value={product.minStock.toLocaleString()} />
          <DetailField
            label={t('table.status')}
            value={
              <Badge
                variant={
                  product.catalogType === 'variant_parent'
                    ? 'info'
                    : product.isActive
                      ? 'success'
                      : 'neutral'
                }
              >
                {product.catalogType === 'variant_parent'
                  ? t('table.matrixParent')
                  : product.isActive
                    ? t('table.active')
                    : t('table.inactive')}
              </Badge>
            }
          />
        </dl>
      )}
    </Drawer>
  );
}
