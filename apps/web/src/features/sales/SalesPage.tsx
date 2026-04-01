import { ColumnDef } from '@tanstack/react-table';
import { Plus, Eye, FileText } from 'lucide-react';
import { DataTable } from '@/components/tables/DataTable';
import type { Sale } from '@/types';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { trpc } from '@/lib/trpc';

const statusColors: Record<string, string> = {
  completed: 'badge-success',
  draft: 'badge-secondary',
  cancelled: 'badge-danger',
  voided: 'badge-warning',
};

const paymentStatusColors: Record<string, string> = {
  paid: 'badge-success',
  pending: 'badge-warning',
  partial: 'badge-primary',
  refunded: 'badge-danger',
};

const columns: ColumnDef<Sale>[] = [
  {
    accessorKey: 'saleNumber',
    header: 'Invoice #',
    size: 120,
    cell: ({ row }) => (
      <span className="font-mono font-medium text-primary-600">{row.getValue('saleNumber')}</span>
    ),
  },
  {
    accessorKey: 'createdAt',
    header: 'Date',
    size: 180,
    cell: ({ row }) => formatDateTime(row.getValue('createdAt')),
  },
  {
    accessorKey: 'customerId',
    header: 'Customer',
    size: 150,
    cell: ({ row }) => (
      <span className="text-secondary-600">
        {row.original.customerId ? `Customer #${row.original.customerId}` : 'Walk-in'}
      </span>
    ),
  },
  {
    accessorKey: 'total',
    header: 'Total',
    size: 120,
    cell: ({ row }) => <span className="font-medium">{formatCurrency(row.getValue('total'))}</span>,
  },
  {
    accessorKey: 'paymentMethod',
    header: 'Payment',
    size: 100,
    cell: ({ row }) => (
      <span className="capitalize text-secondary-600">{row.getValue('paymentMethod')}</span>
    ),
  },
  {
    accessorKey: 'paymentStatus',
    header: 'Payment Status',
    size: 120,
    cell: ({ row }) => (
      <span className={`badge ${paymentStatusColors[row.getValue('paymentStatus') as string]}`}>
        {row.getValue('paymentStatus')}
      </span>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    size: 100,
    cell: ({ row }) => (
      <span className={`badge ${statusColors[row.getValue('status') as string]}`}>
        {row.getValue('status')}
      </span>
    ),
  },
  {
    id: 'actions',
    size: 80,
    cell: ({ row }) => (
      <div className="flex items-center gap-1">
        <button
          className="btn-ghost btn-icon h-8 w-8"
          onClick={() => console.log('View', row.original)}
        >
          <Eye className="h-4 w-4" />
        </button>
        <button
          className="btn-ghost btn-icon h-8 w-8"
          onClick={() => console.log('Print', row.original)}
        >
          <FileText className="h-4 w-4" />
        </button>
      </div>
    ),
  },
];

export function SalesPage() {
  const { data, isLoading, error } = trpc.sales.list.useQuery({ page: 1, perPage: 50 });

  const items = (data?.items ?? []) as Sale[];

  // Derive summary values from real data
  const today = new Date().toDateString();
  const todayItems = items.filter(s => new Date(s.createdAt).toDateString() === today);
  const todaySalesTotal = todayItems.reduce((sum, s) => sum + s.total, 0);
  const transactionCount = items.length;
  const avgOrder =
    transactionCount > 0 ? items.reduce((sum, s) => sum + s.total, 0) / transactionCount : 0;
  const pendingTotal = items
    .filter(s => s.paymentStatus === 'pending')
    .reduce((sum, s) => sum + s.total, 0);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Sales</h1>
          <p className="mt-1 text-sm text-secondary-500">View and manage your sales transactions</p>
        </div>
        <button className="btn-primary flex items-center gap-2">
          <Plus className="h-5 w-5" />
          New Sale
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="card p-4">
          <p className="text-sm text-secondary-500">Today's Sales</p>
          <p className="mt-1 text-2xl font-bold text-secondary-900">
            {isLoading ? '—' : formatCurrency(todaySalesTotal)}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-secondary-500">Transactions</p>
          <p className="mt-1 text-2xl font-bold text-secondary-900">
            {isLoading ? '—' : transactionCount}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-secondary-500">Average Order</p>
          <p className="mt-1 text-2xl font-bold text-secondary-900">
            {isLoading ? '—' : formatCurrency(avgOrder)}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-secondary-500">Pending Payments</p>
          <p className="mt-1 text-2xl font-bold text-warning-500">
            {isLoading ? '—' : formatCurrency(pendingTotal)}
          </p>
        </div>
      </div>

      {/* Sales Table */}
      <div className="card p-6">
        {isLoading && <p className="text-secondary-500 py-4">Loading sales...</p>}
        {error && <p className="text-danger-500 py-4">{error.message}</p>}
        {!isLoading && !error && (
          <DataTable
            columns={columns}
            data={items}
            searchKey="saleNumber"
            searchPlaceholder="Search by invoice..."
            pageSize={10}
          />
        )}
      </div>
    </div>
  );
}
