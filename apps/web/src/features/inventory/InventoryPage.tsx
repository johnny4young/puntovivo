import { useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Plus, ArrowUpCircle, ArrowDownCircle, RefreshCw } from 'lucide-react';
import { DataTable } from '@/components/tables/DataTable';
import type { InventoryMovement } from '@/types';
import { formatDateTime } from '@/lib/utils';

// Sample data
const sampleMovements: InventoryMovement[] = [
  {
    id: '1',
    tenantId: '1',
    productId: '1',
    type: 'purchase',
    quantity: 50,
    previousStock: 100,
    newStock: 150,
    reference: 'PO-001',
    notes: 'Restocking order',
    createdBy: 'user1',
    createdAt: '2024-01-15T09:00:00Z',
  },
  {
    id: '2',
    tenantId: '1',
    productId: '1',
    type: 'sale',
    quantity: -2,
    previousStock: 150,
    newStock: 148,
    reference: 'INV-001',
    createdBy: 'user1',
    createdAt: '2024-01-15T14:30:00Z',
  },
  {
    id: '3',
    tenantId: '1',
    productId: '2',
    type: 'adjustment',
    quantity: -5,
    previousStock: 80,
    newStock: 75,
    notes: 'Damaged items removed',
    createdBy: 'user1',
    createdAt: '2024-01-15T11:00:00Z',
  },
  {
    id: '4',
    tenantId: '1',
    productId: '3',
    type: 'return',
    quantity: 3,
    previousStock: 197,
    newStock: 200,
    reference: 'RET-001',
    notes: 'Customer return',
    createdBy: 'user1',
    createdAt: '2024-01-15T16:00:00Z',
  },
];

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
  const [movements] = useState<InventoryMovement[]>(sampleMovements);

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
              <p className="text-xl font-bold text-secondary-900">+53</p>
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
              <p className="text-xl font-bold text-secondary-900">-7</p>
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
              <p className="text-xl font-bold text-secondary-900">1</p>
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
              <p className="text-xl font-bold text-danger-500">1</p>
            </div>
          </div>
        </div>
      </div>

      {/* Movements Table */}
      <div className="card p-6">
        <DataTable
          columns={columns}
          data={movements}
          searchKey="reference"
          searchPlaceholder="Search by reference..."
          pageSize={10}
        />
      </div>
    </div>
  );
}
