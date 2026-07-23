/**
 * Inventory Entry detail Drawer.
 *
 * Read-only slide-over holding the Entries-table fields trimmed off the default
 * table (unit, normalized quantity, cost, stock-after, notes) plus the mode +
 * counted quantity, so the table can default to the smallest useful column set
 * (date, mode, product, counted qty). Reuses the shared `Drawer` primitive
 * () and mirrors `InventoryStockDetailsDrawer`.
 *
 * @module features/inventory/InventoryEntryDetailsDrawer
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Drawer } from '@/components/feedback/Drawer';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { InitialInventoryEntry } from '@/types';

/**
 * Props for {@link InventoryEntryDetailsDrawer}. The Drawer is open exactly
 * when `item` is non-null (the parent owns the open/close state).
 */
import { Badge } from '@/components/ui';
export interface InventoryEntryDetailsDrawerProps {
  /** The entry row to detail. `null` keeps the Drawer closed. */
  item: InitialInventoryEntry | null;
  /** Close the Drawer (ESC / backdrop / close button). */
  onClose: () => void;
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
export function InventoryEntryDetailsDrawer({ item, onClose }: InventoryEntryDetailsDrawerProps) {
  const { t } = useTranslation('inventory');
  const footer = item ? (
    <div className="flex justify-end">
      <button type="button" className="btn-outline" onClick={onClose}>
        {t('entries.details.close')}
      </button>
    </div>
  ) : undefined;
  return (
    <Drawer
      isOpen={!!item}
      onClose={onClose}
      title={item?.productName ?? t('entries.details.title')}
      size="md"
      testId="inventory-entry-details-drawer"
      footer={footer}
    >
      {item && (
        <dl data-testid="inventory-entry-details-fields">
          <DetailField label={t('table.date')} value={formatDateTime(item.createdAt)} />
          <DetailField
            label={t('table.mode')}
            value={
              <Badge variant={item.mode === 'initial' ? 'primary' : 'warning'}>
                {item.mode === 'initial' ? t('table.initialInventory') : t('table.physicalCount')}
              </Badge>
            }
          />
          <DetailField
            label={t('table.unit')}
            value={item.unitAbbreviation ?? item.unitName ?? '—'}
          />
          <DetailField label={t('table.countedQty')} value={item.quantity.toLocaleString()} />
          <DetailField
            label={t('table.normalized')}
            value={item.normalizedQuantity.toLocaleString()}
          />
          <DetailField label={t('table.cost')} value={formatCurrency(item.cost)} />
          <DetailField label={t('table.stockAfter')} value={item.newStock.toLocaleString()} />
          <DetailField label={t('table.notes')} value={item.notes || '—'} />
        </dl>
      )}
    </Drawer>
  );
}
