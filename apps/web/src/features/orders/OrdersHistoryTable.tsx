import { useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Eye } from 'lucide-react';
import { DataTable } from '@/components/tables/DataTable';
import { TableErrorState } from '@/components/tables/TableErrorState';
import { TableLoadingState } from '@/components/tables/TableLoadingState';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { Order } from '@/types';

const orderStatusClassNames: Record<Order['status'], string> = {
  submitted: 'badge-primary',
  partial_received: 'badge-warning',
  received: 'badge-success',
  voided: 'badge-warning',
};

interface OrdersHistoryTableProps {
  orders: Order[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  canManageReceipts: boolean;
  onView: (orderId: string) => void;
  onReceive: (orderId: string) => void;
}

export function OrdersHistoryTable({
  orders,
  isLoading,
  error,
  onRetry,
  canManageReceipts,
  onView,
  onReceive,
}: OrdersHistoryTableProps) {
  const columns = useMemo<ColumnDef<Order>[]>(
    () => [
      {
        accessorKey: 'orderNumber',
        header: 'Order #',
        size: 140,
        cell: ({ row }) => (
          <span className="font-mono font-medium text-primary-600">{row.original.orderNumber}</span>
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
          <span className={orderStatusClassNames[row.original.status]}>
            {row.original.status.replace(/_/g, ' ')}
          </span>
        ),
      },
      {
        id: 'receipts',
        header: 'Receipts',
        size: 180,
        cell: ({ row }) => {
          const receiptCount = row.original.linkedPurchaseCount ?? 0;

          if (receiptCount === 0) {
            return <span className="text-sm text-secondary-500">No receipts yet</span>;
          }

          return (
            <div className="space-y-1">
              <p className="text-sm font-medium text-secondary-900">
                {receiptCount} receipt{receiptCount === 1 ? '' : 's'}
              </p>
              <p className="text-xs text-secondary-500">
                Latest {row.original.receivedPurchaseNumber ?? 'purchase recorded'}
              </p>
            </div>
          );
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
        size: 160,
        cell: ({ row }) => {
          const canReceiveOrder =
            canManageReceipts &&
            (row.original.status === 'submitted' || row.original.status === 'partial_received');

          return (
            <div className="flex items-center justify-end gap-2">
              {canReceiveOrder && (
                <button
                  className="btn-outline h-8 px-3 text-xs"
                  onClick={() => onReceive(row.original.id)}
                >
                  Receive
                </button>
              )}
              <button
                className="btn-ghost btn-icon h-8 w-8"
                onClick={() => onView(row.original.id)}
                aria-label={`View ${row.original.orderNumber}`}
                title="View order"
              >
                <Eye className="h-4 w-4" />
              </button>
            </div>
          );
        },
      },
    ],
    [canManageReceipts, onReceive, onView]
  );

  return (
    <div className="card p-6">
      {isLoading && <TableLoadingState message="Loading purchase orders..." rowCount={6} />}
      {error && (
        <TableErrorState title="Unable to load purchase orders" message={error} onRetry={onRetry} />
      )}
      {!isLoading && !error && (
        <DataTable
          columns={columns}
          data={orders}
          searchKey="orderNumber"
          searchPlaceholder="Search by order number..."
          pageSize={8}
        />
      )}
    </div>
  );
}
