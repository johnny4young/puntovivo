/**
 * ENG-132c — Inventory Stock detail Drawer.
 *
 * Read-only slide-over that holds the Stock-table fields trimmed off the
 * default table (min stock, sell price, valuation, updated date) plus the
 * SKU + category, so the table can default to the smallest useful column
 * set (name + stock + status). Reuses the shared `Drawer` primitive
 * (ENG-186) for the dialog a11y contract and mirrors `ProductDetailsDrawer`
 * / `CustomerDetailsDrawer`. The optional `onAdjust` footer action is wired
 * only for manager / admin by the caller (mirrors the row's Adjust gating).
 *
 * @module features/inventory/InventoryStockDetailsDrawer
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal } from 'lucide-react';
import { Drawer } from '@/components/feedback/Drawer';
import { cn, formatCurrency, formatDateTime } from '@/lib/utils';
import type { InventoryStockItem } from '@/types';

/**
 * Props for {@link InventoryStockDetailsDrawer}. The Drawer is open exactly
 * when `item` is non-null (the parent owns the open/close state).
 */
export interface InventoryStockDetailsDrawerProps {
  /** The stock row to detail. `null` keeps the Drawer closed. */
  item: InventoryStockItem | null;
  /** Close the Drawer (ESC / backdrop / close button). */
  onClose: () => void;
  /**
   * Open the stock-adjustment flow for this item. Omitted for roles that
   * cannot manage inventory, in which case no Adjust action renders.
   */
  onAdjust?: ((item: InventoryStockItem) => void) | undefined;
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

export function InventoryStockDetailsDrawer({
  item,
  onClose,
  onAdjust,
}: InventoryStockDetailsDrawerProps) {
  const { t } = useTranslation('inventory');

  const footer = item ? (
    <div className="flex justify-end gap-2">
      <button type="button" className="btn-outline" onClick={onClose}>
        {t('stock.details.close')}
      </button>
      {onAdjust && (
        <button
          type="button"
          className="btn-primary flex items-center gap-2"
          onClick={() => onAdjust(item)}
        >
          <SlidersHorizontal className="h-4 w-4" />
          {t('stock.details.adjust')}
        </button>
      )}
    </div>
  ) : undefined;

  return (
    <Drawer
      isOpen={!!item}
      onClose={onClose}
      title={item?.name ?? t('stock.details.title')}
      size="md"
      testId="inventory-stock-details-drawer"
      footer={footer}
    >
      {item && (
        <dl data-testid="inventory-stock-details-fields">
          <DetailField label={t('stock.details.sku')} value={item.sku} />
          <DetailField label={t('stock.details.category')} value={item.categoryName || '-'} />
          <DetailField label={t('stock.columns.stock')} value={item.stock.toLocaleString()} />
          <DetailField
            label={t('stock.columns.minStock')}
            value={item.minStock.toLocaleString()}
          />
          <DetailField label={t('stock.columns.sellPrice')} value={formatCurrency(item.price)} />
          <DetailField
            label={t('stock.columns.valuation')}
            value={formatCurrency(item.inventoryValue)}
          />
          <DetailField
            label={t('stock.columns.updated')}
            value={formatDateTime(item.updatedAt)}
          />
          <DetailField
            label={t('stock.columns.status')}
            value={
              <span className={cn('pv-badge', item.isLowStock ? 'danger' : 'success')}>
                {item.isLowStock ? t('stock.status.lowStock') : t('stock.status.healthy')}
              </span>
            }
          />
        </dl>
      )}
    </Drawer>
  );
}
