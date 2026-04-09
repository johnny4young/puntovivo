import { useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Eye } from 'lucide-react';
import { DataTable } from '@/components/tables/DataTable';
import { TableLoadingState } from '@/components/tables/TableLoadingState';
import { TableExportActions } from '@/components/tables/TableExportActions';
import { saleHistoryExportColumns } from '@/features/sales/saleHistoryExport';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { Sale } from '@/types';

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

interface SalesHistoryTableProps {
  sales: Sale[];
  isLoading: boolean;
  error: string | null;
  onView: (saleId: string) => void;
}

export function SalesHistoryTable({ sales, isLoading, error, onView }: SalesHistoryTableProps) {
  const columns = useMemo<ColumnDef<Sale>[]>(
    () => [
      {
        accessorKey: 'saleNumber',
        header: 'Invoice #',
        size: 130,
        cell: ({ row }) => (
          <span className="font-mono font-medium text-primary-600">{row.original.saleNumber}</span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: 'Date',
        size: 180,
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      {
        accessorKey: 'customerName',
        header: 'Customer',
        size: 180,
        cell: ({ row }) => row.original.customerName ?? 'Walk-in',
      },
      {
        accessorKey: 'total',
        header: 'Total',
        size: 120,
        cell: ({ row }) => <span className="font-medium">{formatCurrency(row.original.total)}</span>,
      },
      {
        accessorKey: 'paymentStatus',
        header: 'Payment',
        size: 120,
        cell: ({ row }) => (
          <span className={`badge ${paymentStatusColors[row.original.paymentStatus]}`}>
            {row.original.paymentStatus}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        size: 110,
        cell: ({ row }) => (
          <span className={`badge ${statusColors[row.original.status]}`}>{row.original.status}</span>
        ),
      },
      {
        id: 'actions',
        size: 80,
        cell: ({ row }) => (
          <button className="btn-ghost btn-icon h-8 w-8" onClick={() => onView(row.original.id)}>
            <Eye className="h-4 w-4" />
          </button>
        ),
      },
    ],
    [onView]
  );

  return (
    <div className="card p-6">
      {isLoading && <TableLoadingState message="Loading sales..." rowCount={6} />}
      {error && <p className="py-4 text-danger-500">{error}</p>}
      {!isLoading && !error && (
        <div className="space-y-4">
          <TableExportActions
            data={sales}
            columns={saleHistoryExportColumns}
            filename="sales-history"
            title="Sales History"
          />
          <DataTable
            columns={columns}
            data={sales}
            searchKey="saleNumber"
            searchPlaceholder="Search by invoice..."
            pageSize={8}
          />
        </div>
      )}
    </div>
  );
}
