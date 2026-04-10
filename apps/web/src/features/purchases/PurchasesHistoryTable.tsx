import { useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Eye, RotateCcw } from 'lucide-react';
import { DataTable } from '@/components/tables/DataTable';
import { TableErrorState } from '@/components/tables/TableErrorState';
import { TableLoadingState } from '@/components/tables/TableLoadingState';
import { TableExportActions } from '@/components/tables/TableExportActions';
import { purchaseHistoryExportColumns } from '@/features/purchases/purchaseHistoryExport';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { Purchase } from '@/types';

const purchaseStatusClassNames: Record<Purchase['status'], string> = {
  completed: 'badge-success',
  partial_returned: 'badge-primary',
  returned: 'badge-danger',
  voided: 'badge-warning',
};

interface PurchasesHistoryTableProps {
  purchases: Purchase[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  canManageReturns: boolean;
  onView: (purchaseId: string) => void;
  onReturn: (purchaseId: string) => void;
}

export function PurchasesHistoryTable({
  purchases,
  isLoading,
  error,
  onRetry,
  canManageReturns,
  onView,
  onReturn,
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
        accessorKey: 'status',
        header: 'Status',
        size: 120,
        cell: ({ row }) => (
          <span className={purchaseStatusClassNames[row.original.status]}>
            {row.original.status.replace(/_/g, ' ')}
          </span>
        ),
      },
      {
        id: 'returns',
        header: 'Returns',
        size: 220,
        cell: ({ row }) => {
          const returnedAmount = row.original.returnedAmount ?? 0;
          const returnCount = row.original.returnCount ?? 0;

          if (row.original.status === 'returned') {
            return (
              <div className="space-y-1">
                <p className="text-sm font-medium text-danger-600">Fully returned</p>
                <p className="text-xs text-secondary-500">{formatCurrency(returnedAmount)} reversed</p>
              </div>
            );
          }

          if (row.original.status === 'partial_returned') {
            return (
              <div className="space-y-1">
                <p className="text-sm font-medium text-primary-700">
                  {returnCount} return{returnCount === 1 ? '' : 's'}
                </p>
                <p className="text-xs text-secondary-500">{formatCurrency(returnedAmount)} reversed</p>
                {row.original.returnedAt && (
                  <p className="text-xs text-secondary-500">
                    Latest {formatDateTime(row.original.returnedAt)}
                  </p>
                )}
                {row.original.latestReturnReason && (
                  <p className="line-clamp-2 text-xs text-secondary-500">
                    {row.original.latestReturnReason}
                  </p>
                )}
              </div>
            );
          }

          return <span className="text-sm text-secondary-500">Open</span>;
        },
      },
      {
        accessorKey: 'total',
        header: 'Total',
        size: 120,
        cell: ({ row }) => <span className="font-medium">{formatCurrency(row.original.total)}</span>,
      },
      {
        id: 'actions',
        header: 'Actions',
        size: 132,
        cell: ({ row }) => {
          const canReturnPurchase =
            canManageReturns &&
            (row.original.status === 'completed' || row.original.status === 'partial_returned');

          return (
            <div className="flex items-center justify-end gap-1">
              {canReturnPurchase && (
                <button
                  className="btn-ghost btn-icon h-8 w-8"
                  onClick={() => onReturn(row.original.id)}
                  aria-label={`Return items for ${row.original.purchaseNumber}`}
                  title="Return items"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
              <button
                className="btn-ghost btn-icon h-8 w-8"
                onClick={() => onView(row.original.id)}
                aria-label={`View ${row.original.purchaseNumber}`}
                title="View purchase"
              >
                <Eye className="h-4 w-4" />
              </button>
            </div>
          );
        },
      },
    ],
    [canManageReturns, onReturn, onView]
  );

  return (
    <div className="card p-6">
      {isLoading && <TableLoadingState message="Loading purchases..." rowCount={6} />}
      {error && (
        <TableErrorState title="Unable to load purchases" message={error} onRetry={onRetry} />
      )}
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
