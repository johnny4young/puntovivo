import { useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Eye } from 'lucide-react';
import { DataTable } from '@/components/tables/DataTable';
import { TableExportActions } from '@/components/tables/TableExportActions';
import { purchaseHistoryExportColumns } from '@/features/purchases/purchaseHistoryExport';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { Purchase } from '@/types';

interface PurchasesHistoryTableProps {
  purchases: Purchase[];
  isLoading: boolean;
  error: string | null;
  onView: (purchaseId: string) => void;
}

export function PurchasesHistoryTable({
  purchases,
  isLoading,
  error,
  onView,
}: PurchasesHistoryTableProps) {
  const columns = useMemo<ColumnDef<Purchase>[]>(
    () => [
      {
        accessorKey: 'purchaseNumber',
        header: 'Purchase #',
        size: 140,
        cell: ({ row }) => (
          <span className="font-mono font-medium text-primary-600">
            {row.original.purchaseNumber}
          </span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: 'Date',
        size: 180,
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      {
        accessorKey: 'providerName',
        header: 'Provider',
        size: 220,
        cell: ({ row }) => row.original.providerName,
      },
      {
        accessorKey: 'siteName',
        header: 'Site',
        size: 160,
        cell: ({ row }) => row.original.siteName,
      },
      {
        accessorKey: 'total',
        header: 'Total',
        size: 120,
        cell: ({ row }) => <span className="font-medium">{formatCurrency(row.original.total)}</span>,
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
      {isLoading && <p className="py-4 text-secondary-500">Loading purchases...</p>}
      {error && <p className="py-4 text-danger-500">{error}</p>}
      {!isLoading && !error && (
        <div className="space-y-4">
          <TableExportActions
            data={purchases}
            columns={purchaseHistoryExportColumns}
            filename="purchase-history"
            title="Purchase History"
          />
          <DataTable
            columns={columns}
            data={purchases}
            searchKey="purchaseNumber"
            searchPlaceholder="Search by purchase number..."
            pageSize={8}
          />
        </div>
      )}
    </div>
  );
}
