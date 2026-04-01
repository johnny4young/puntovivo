import { ColumnDef } from '@tanstack/react-table';
import { Plus, ArrowUpCircle, ArrowDownCircle, RefreshCw } from 'lucide-react';
import { DataTable } from '@/components/tables/DataTable';
import type { InventoryMovement } from '@/types';
import { formatDateTime } from '@/lib/utils';
import { trpc } from '@/lib/trpc';

const typeIcons: Record<string, React.ElementType> = {
  purchase: ArrowDownCircle,
  sale: ArrowUpCircle,
  adjustment: RefreshCw,
  transfer: RefreshCw,
  return: ArrowDownCircle,
};

const typeColors: Record<string, string> = {
  purchase: 'text-success-500',
  sale: 'text-danger-500',
  adjustment: 'text-warning-500',
  transfer: 'text-primary-500',
  return: 'text-success-500',
};

const columns: ColumnDef<InventoryMovement>[] = [
  {
    accessorKey: 'createdAt',
    header: 'Date',
    size: 180,
    cell: ({ row }) => formatDateTime(row.getValue('createdAt')),
  },
  {
    accessorKey: 'type',
    header: 'Type',
    size: 120,
    cell: ({ row }) => {
      const type = row.getValue('type') as string;
      const Icon = typeIcons[type] || RefreshCw;
      return (
        <div className={`flex items-center gap-2 ${typeColors[type]}`}>
          <Icon className="h-4 w-4" />
          <span className="capitalize font-medium">{type}</span>
        </div>
      );
    },
  },
  {
    accessorKey: 'productId',
    header: 'Product',
    size: 150,
    cell: ({ row }) => (
      <span className="text-secondary-900">Product #{row.getValue('productId')}</span>
    ),
  },
  {
    accessorKey: 'quantity',
    header: 'Quantity',
    size: 100,
    cell: ({ row }) => {
      const qty = row.getValue('quantity') as number;
      return (
        <span className={qty >= 0 ? 'text-success-600' : 'text-danger-600'}>
          {qty >= 0 ? '+' : ''}
          {qty}
        </span>
      );
    },
  },
  {
    accessorKey: 'previousStock',
    header: 'Previous',
    size: 100,
    cell: ({ row }) => <span className="text-secondary-500">{row.getValue('previousStock')}</span>,
  },
  {
    accessorKey: 'newStock',
    header: 'New Stock',
    size: 100,
    cell: ({ row }) => (
      <span className="font-medium text-secondary-900">{row.getValue('newStock')}</span>
    ),
  },
  {
    accessorKey: 'reference',
    header: 'Reference',
    size: 120,
    cell: ({ row }) => (
      <span className="font-mono text-sm text-primary-600">{row.getValue('reference') || '-'}</span>
    ),
  },
  {
    accessorKey: 'notes',
    header: 'Notes',
    size: 200,
    cell: ({ row }) => (
      <span className="text-secondary-500 truncate max-w-[200px] block">
        {row.getValue('notes') || '-'}
      </span>
    ),
  },
];

export function InventoryPage() {
  const { data, isLoading, error } = trpc.inventory.listMovements.useQuery({
    page: 1,
    perPage: 50,
  });

  const movements = (data?.items ?? []) as InventoryMovement[];

  // Derive summary values from real data
  const stockIn = movements.filter(m => m.quantity > 0).reduce((sum, m) => sum + m.quantity, 0);
  const stockOut = movements.filter(m => m.quantity < 0).reduce((sum, m) => sum + m.quantity, 0);
  const adjustmentsCount = movements.filter(m => m.type === 'adjustment').length;
  // Low stock: newStock < some threshold — we approximate using products where newStock drops below previousStock significantly
  // Since we don't have minStock on movements, count movements that resulted in newStock === 0 or very low
  const lowStockCount = movements.filter(m => m.newStock < 10 && m.newStock >= 0).length;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Inventory</h1>
          <p className="mt-1 text-sm text-secondary-500">Track stock movements and adjustments</p>
        </div>
        <button className="btn-primary flex items-center gap-2">
          <Plus className="h-5 w-5" />
          New Adjustment
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-success-50">
              <ArrowDownCircle className="h-5 w-5 text-success-600" />
            </div>
            <div>
              <p className="text-sm text-secondary-500">Stock In</p>
              <p className="text-xl font-bold text-secondary-900">
                {isLoading ? '—' : `+${stockIn}`}
              </p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-danger-50">
              <ArrowUpCircle className="h-5 w-5 text-danger-600" />
            </div>
            <div>
              <p className="text-sm text-secondary-500">Stock Out</p>
              <p className="text-xl font-bold text-secondary-900">{isLoading ? '—' : stockOut}</p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-warning-50">
              <RefreshCw className="h-5 w-5 text-warning-600" />
            </div>
            <div>
              <p className="text-sm text-secondary-500">Adjustments</p>
              <p className="text-xl font-bold text-secondary-900">
                {isLoading ? '—' : adjustmentsCount}
              </p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary-50">
              <RefreshCw className="h-5 w-5 text-primary-600" />
            </div>
            <div>
              <p className="text-sm text-secondary-500">Low Stock Items</p>
              <p className="text-xl font-bold text-danger-500">{isLoading ? '—' : lowStockCount}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Movements Table */}
      <div className="card p-6">
        {isLoading && <p className="text-secondary-500 py-4">Loading inventory...</p>}
        {error && <p className="text-danger-500 py-4">{error.message}</p>}
        {!isLoading && !error && (
          <DataTable
            columns={columns}
            data={movements}
            searchKey="reference"
            searchPlaceholder="Search by reference..."
            pageSize={10}
          />
        )}
      </div>
    </div>
  );
}
