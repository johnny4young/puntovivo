import { useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Plus, Eye, FileText } from 'lucide-react';
import { DataTable } from '@/components/tables/DataTable';
import type { Sale } from '@/types';
import { formatCurrency, formatDateTime } from '@/lib/utils';

// Sample data
const sampleSales: Sale[] = [
  {
    id: '1',
    tenantId: '1',
    saleNumber: 'INV-001',
    customerId: '1',
    items: [],
    subtotal: 119.98,
    taxAmount: 8.4,
    discountAmount: 0,
    total: 128.38,
    paymentMethod: 'card',
    paymentStatus: 'paid',
    status: 'completed',
    createdBy: 'user1',
    createdAt: '2024-01-15T14:30:00Z',
    updatedAt: '2024-01-15T14:30:00Z',
  },
  {
    id: '2',
    tenantId: '1',
    saleNumber: 'INV-002',
    customerId: '2',
    items: [],
    subtotal: 89.99,
    taxAmount: 6.3,
    discountAmount: 10,
    total: 86.29,
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    createdBy: 'user1',
    createdAt: '2024-01-15T15:45:00Z',
    updatedAt: '2024-01-15T15:45:00Z',
  },
  {
    id: '3',
    tenantId: '1',
    saleNumber: 'INV-003',
    customerId: '3',
    items: [],
    subtotal: 249.97,
    taxAmount: 17.5,
    discountAmount: 0,
    total: 267.47,
    paymentMethod: 'transfer',
    paymentStatus: 'pending',
    status: 'completed',
    createdBy: 'user1',
    createdAt: '2024-01-15T16:20:00Z',
    updatedAt: '2024-01-15T16:20:00Z',
  },
  {
    id: '4',
    tenantId: '1',
    saleNumber: 'INV-004',
    items: [],
    subtotal: 39.99,
    taxAmount: 2.8,
    discountAmount: 0,
    total: 42.79,
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'cancelled',
    createdBy: 'user1',
    createdAt: '2024-01-15T17:00:00Z',
    updatedAt: '2024-01-15T17:10:00Z',
  },
];

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
  const [sales] = useState<Sale[]>(sampleSales);

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
          <p className="mt-1 text-2xl font-bold text-secondary-900">$524.93</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-secondary-500">Transactions</p>
          <p className="mt-1 text-2xl font-bold text-secondary-900">4</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-secondary-500">Average Order</p>
          <p className="mt-1 text-2xl font-bold text-secondary-900">$131.23</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-secondary-500">Pending Payments</p>
          <p className="mt-1 text-2xl font-bold text-warning-500">$267.47</p>
        </div>
      </div>

      {/* Sales Table */}
      <div className="card p-6">
        <DataTable
          columns={columns}
          data={sales}
          searchKey="saleNumber"
          searchPlaceholder="Search by invoice..."
          pageSize={10}
        />
      </div>
    </div>
  );
}
