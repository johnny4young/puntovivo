/**
 * Inventory Entries (initial inventory / physical count) table columns.
 *
 * Extracted from `InventoryPage` so the column-set test can import a pure
 * function without the heavy page module, and to keep `InventoryPage` a
 * component-only export. Mirrors `inventoryStockColumns` ().
 *
 * The Entries log renders the smallest useful column set (date, mode, product,
 * counted quantity). Unit, normalized quantity, cost, stock-after and notes are
 * secondary detail moved behind the row-detail Drawer (`onViewDetails` →
 * `InventoryEntryDetailsDrawer`); the entry export keeps every field.
 *
 * @module features/inventory/inventoryEntryColumns
 */
import { type ColumnDef } from '@tanstack/react-table';
import i18next from 'i18next';
import { Eye, Package } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import type { InitialInventoryEntry } from '@/types';

/**
 * Build the Entries table columns. `onViewDetails` opens the row-detail Drawer
 * carrying the trimmed fields (unit, normalized qty, cost, stock-after, notes).
 */
import { Badge } from '@/components/ui';
export function getEntryColumns(
  onViewDetails: (entry: InitialInventoryEntry) => void
): ColumnDef<InitialInventoryEntry>[] {
  return [
    {
      accessorKey: 'createdAt',
      header: () => i18next.t('inventory:table.date'),
      size: 180,
      cell: ({ row }) => <span className="muted">{formatDateTime(row.original.createdAt)}</span>,
    },
    {
      accessorKey: 'mode',
      header: () => i18next.t('inventory:table.mode'),
      size: 160,
      cell: ({ row }) => (
        <Badge variant={row.original.mode === 'initial' ? 'primary' : 'warning'}>
          {row.original.mode === 'initial'
            ? i18next.t('inventory:table.initialInventory')
            : i18next.t('inventory:table.physicalCount')}
        </Badge>
      ),
    },
    {
      accessorKey: 'productName',
      header: () => i18next.t('inventory:table.product'),
      size: 240,
      cell: ({ row }) => (
        <div className="prod">
          <span className="pic">
            <Package className="h-4 w-4" />
          </span>
          <div>
            <p className="pname">
              {row.original.productName ?? i18next.t('inventory:table.unknownProduct')}
            </p>
            <p className="sku">{row.original.productSku ?? i18next.t('inventory:table.noSku')}</p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'quantity',
      header: () => i18next.t('inventory:table.countedQty'),
      size: 110,
      meta: {
        cellClassName: 'num',
        headerClassName: 'num',
      },
      cell: ({ row }) => row.original.quantity.toLocaleString(),
    },
    // unit / normalized / cost / stock-after / notes trimmed into the
    // row-detail Drawer (`onViewDetails`); date + mode + product + qty carry the scan.
    {
      id: 'actions',
      header: '',
      size: 64,
      cell: ({ row }) => (
        <div className="flex items-center justify-end">
          <button
            className="btn-ghost btn-icon h-8 w-8"
            onClick={() => onViewDetails(row.original)}
            aria-label={i18next.t('inventory:entries.details.viewAria')}
            title={i18next.t('inventory:entries.details.viewAria')}
          >
            <Eye className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];
}
