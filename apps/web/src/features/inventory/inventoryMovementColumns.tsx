/**
 * Inventory Movements table columns.
 *
 * Extracted from `InventoryPage` so the column-set test can import a pure
 * function without pulling the heavy page module, and so `InventoryPage`
 * stays a component-only export (react-refresh hygiene). Mirrors
 * `inventoryStockColumns` ().
 *
 * The Movements log renders the smallest useful column set for an at-a-glance
 * scan (date, product, the signed delta, type). Stock-after, reference and
 * notes are secondary detail moved behind the row-detail Drawer
 * (`onViewDetails` → `InventoryMovementDetailsDrawer`); the movement export
 * keeps every field.
 *
 * @module features/inventory/inventoryMovementColumns
 */
import { type ColumnDef } from '@tanstack/react-table';
import i18next from 'i18next';
import { Eye } from 'lucide-react';
import { cn, formatDateTime } from '@/lib/utils';
import type { InventoryMovement, MovementType } from '@/types';

/**
 * Semantic tone per movement type for the type badge — inbound flows read
 * success, outbound reads danger, adjustment warning, transfer primary.
 */
import { Badge } from '@/components/ui';
export const movementBadgeTones: Record<
  MovementType,
  'success' | 'danger' | 'warning' | 'primary'
> = {
  purchase: 'success',
  sale: 'danger',
  adjustment: 'warning',
  transfer: 'primary',
  return: 'success',
};

/**
 * Signed stock delta for a movement row. Sale / transfer rows infer the sign
 * from the previous→new stock direction; adjustments use the raw difference;
 * everything else is a positive inbound quantity. Shared by the table cell and
 * the page-level recent-flow summary so the sign convention lives in one place.
 */
export function getMovementDelta(movement: InventoryMovement): number {
  if (movement.type === 'sale' || movement.type === 'transfer') {
    return movement.previousStock - movement.newStock > 0 ? -movement.quantity : movement.quantity;
  }
  if (movement.type === 'adjustment') {
    return movement.newStock - movement.previousStock;
  }
  return movement.quantity;
}

/**
 * Build the Movements table columns. `onViewDetails` opens the row-detail
 * Drawer that carries the trimmed secondary fields (stock-after, reference,
 * notes); it is wired for every role and focusable in tab order.
 */
export function getMovementColumns(
  onViewDetails: (movement: InventoryMovement) => void
): ColumnDef<InventoryMovement>[] {
  return [
    {
      accessorKey: 'createdAt',
      header: () => i18next.t('inventory:table.date'),
      size: 180,
      cell: ({ row }) => formatDateTime(row.original.createdAt),
    },
    {
      accessorKey: 'productName',
      header: () => i18next.t('inventory:table.product'),
      size: 230,
      cell: ({ row }) => (
        <div>
          <p className="pname">
            {row.original.productName ?? i18next.t('inventory:table.unknownProduct')}
          </p>
          <p className="sku">
            {row.original.productSku ?? i18next.t('inventory:table.noSku')}
            {row.original.categoryName ? ` · ${row.original.categoryName}` : ''}
          </p>
        </div>
      ),
    },
    {
      id: 'delta',
      header: () => i18next.t('inventory:table.movement'),
      size: 120,
      meta: {
        cellClassName: 'num',
        headerClassName: 'num',
      },
      cell: ({ row }) => {
        const delta = getMovementDelta(row.original);
        return (
          <span className={cn('pv-mv text-base', delta > 0 && 'up', delta < 0 && 'down')}>
            {delta > 0 ? '+' : ''}
            {delta.toLocaleString()}
          </span>
        );
      },
    },
    {
      accessorKey: 'type',
      header: () => i18next.t('inventory:table.type'),
      size: 140,
      cell: ({ row }) => {
        const type = row.original.type;
        return (
          <Badge variant={movementBadgeTones[type] ?? 'neutral'}>
            {i18next.t(`inventory:movements.types.${type}`)}
          </Badge>
        );
      },
    },
    // stock-after / reference / notes trimmed into the row-detail
    // Drawer (`onViewDetails`); date + product + delta + type carry the scan.
    {
      id: 'actions',
      header: '',
      size: 64,
      cell: ({ row }) => (
        <div className="flex items-center justify-end">
          <button
            className="btn-ghost btn-icon h-8 w-8"
            onClick={() => onViewDetails(row.original)}
            aria-label={i18next.t('inventory:movements.details.viewAria')}
            title={i18next.t('inventory:movements.details.viewAria')}
          >
            <Eye className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];
}
