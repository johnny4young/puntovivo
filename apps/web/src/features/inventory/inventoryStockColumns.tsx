/**
 * Inventory Stock table columns.
 *
 * Extracted from `InventoryPage` so the column-set test can import a pure
 * function without pulling the heavy page module, and so `InventoryPage`
 * stays a component-only export (react-refresh hygiene).
 *
 * The Stock table renders the smallest useful column set for an at-a-glance
 * scan (name+sku/category, stock, status). Min stock, sell price, valuation
 * and the updated date are secondary detail moved behind the row-detail
 * Drawer (`onViewDetails`); the stock export keeps every field.
 *
 * @module features/inventory/inventoryStockColumns
 */
import { type ColumnDef } from '@tanstack/react-table';
import i18next from 'i18next';
import { Eye, Package, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { InventoryStockItem } from '@/types';

export function getStockColumns(
  onViewDetails: (product: InventoryStockItem) => void,
  onAdjust: (product: InventoryStockItem) => void,
  canManage: boolean
): ColumnDef<InventoryStockItem>[] {
  return [
    {
      accessorKey: 'name',
      header: () => i18next.t('inventory:table.product'),
      size: 250,
      // celda ancla (.pv-table .prod/.pic/.pname/.sku):
      // glifo tonal + nombre fuerte + SKU mono con categoría debajo.
      cell: ({ row }) => (
        <div className="prod">
          <span className="pic">
            <Package className="h-4 w-4" />
          </span>
          <div>
            <p className="pname">{row.original.name}</p>
            <p className="sku">
              {row.original.sku}
              {row.original.categoryName ? ` · ${row.original.categoryName}` : ''}
            </p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'stock',
      header: () => i18next.t('inventory:stock.columns.stock'),
      size: 130,
      // barra de nivel proporcional (.pv-stock); `low` la
      // pinta en danger. Llena al 50% cuando stock == mínimo y crece hacia
      // 100% (2x mínimo), con piso visible para que siempre se lea.
      meta: { cellClassName: 'num', headerClassName: 'num' },
      cell: ({ row }) => {
        const { stock, minStock, isLowStock } = row.original;
        const fill =
          minStock > 0
            ? Math.max(6, Math.min(100, Math.round((stock / minStock) * 50)))
            : stock > 0
              ? 100
              : 6;
        return (
          <span
            className={cn('pv-stock', isLowStock && 'low')}
            title={isLowStock ? i18next.t('inventory:stock.status.lowStock') : undefined}
          >
            <span>{stock.toLocaleString()}</span>
            <span className="bar">
              <i style={{ width: `${fill}%` }} />
            </span>
          </span>
        );
      },
    },
    // minStock / sell price / valuation / updated trimmed into the
    // row-detail Drawer (`onViewDetails`); stock + status carry the scan.
    {
      id: 'status',
      header: () => i18next.t('inventory:stock.columns.status'),
      size: 120,
      cell: ({ row }) => (
        <span className={cn('pv-badge', row.original.isLowStock ? 'danger' : 'success')}>
          {row.original.isLowStock
            ? i18next.t('inventory:stock.status.lowStock')
            : i18next.t('inventory:stock.status.healthy')}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      size: 110,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          {/* Details (Eye) is the progressive-disclosure affordance
              for the trimmed columns; all roles, focusable in tab order. */}
          <button
            className="btn-ghost btn-icon h-8 w-8"
            onClick={() => onViewDetails(row.original)}
            aria-label={i18next.t('inventory:stock.details.viewAria')}
            title={i18next.t('inventory:stock.details.viewAria')}
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            className="btn-ghost btn-icon h-8 w-8"
            onClick={() => onAdjust(row.original)}
            disabled={!canManage}
            aria-label={i18next.t('inventory:stock.adjustStock')}
            title={i18next.t('inventory:stock.adjustStock')}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];
}
