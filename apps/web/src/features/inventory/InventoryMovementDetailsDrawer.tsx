/**
 * Inventory Movement detail Drawer.
 *
 * Read-only slide-over holding the Movements-table fields trimmed off the
 * default table (stock-after, reference, notes) plus the type + signed delta,
 * so the table can default to the smallest useful column set (date, product,
 * movement, type). Reuses the shared `Drawer` primitive () for the
 * dialog a11y contract and mirrors `InventoryStockDetailsDrawer`.
 *
 * @module features/inventory/InventoryMovementDetailsDrawer
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Drawer } from '@/components/feedback/Drawer';
import { cn, formatDateTime } from '@/lib/utils';
import type { InventoryMovement } from '@/types';
import {
  getMovementDelta,
  movementBadgeTones,
} from '@/features/inventory/inventoryMovementColumns';

/**
 * Props for {@link InventoryMovementDetailsDrawer}. The Drawer is open exactly
 * when `item` is non-null (the parent owns the open/close state).
 */
import { Badge } from '@/components/ui';
export interface InventoryMovementDetailsDrawerProps {
  /** The movement row to detail. `null` keeps the Drawer closed. */
  item: InventoryMovement | null;
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
export function InventoryMovementDetailsDrawer({
  item,
  onClose,
}: InventoryMovementDetailsDrawerProps) {
  const { t } = useTranslation('inventory');
  const footer = item ? (
    <div className="flex justify-end">
      <button type="button" className="btn-outline" onClick={onClose}>
        {t('movements.details.close')}
      </button>
    </div>
  ) : undefined;
  const delta = item ? getMovementDelta(item) : 0;
  return (
    <Drawer
      isOpen={!!item}
      onClose={onClose}
      title={item?.productName ?? t('movements.details.title')}
      size="md"
      testId="inventory-movement-details-drawer"
      footer={footer}
    >
      {item && (
        <dl data-testid="inventory-movement-details-fields">
          <DetailField label={t('table.date')} value={formatDateTime(item.createdAt)} />
          <DetailField
            label={t('table.type')}
            value={
              <Badge variant={movementBadgeTones[item.type] ?? 'neutral'}>
                {t(`movements.types.${item.type}`)}
              </Badge>
            }
          />
          <DetailField
            label={t('table.movement')}
            value={
              <span className={cn('pv-mv', delta > 0 && 'up', delta < 0 && 'down')}>
                {delta > 0 ? '+' : ''}
                {delta.toLocaleString()}
              </span>
            }
          />
          <DetailField label={t('table.stockAfter')} value={item.newStock.toLocaleString()} />
          <DetailField label={t('table.reference')} value={item.reference || '—'} />
          <DetailField label={t('table.notes')} value={item.notes || '—'} />
        </dl>
      )}
    </Drawer>
  );
}
