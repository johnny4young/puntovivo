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
  voided: 'badge-warning',
};

interface OrdersHistoryTableProps {
  orders: Order[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onView: (orderId: string) => void;
}

export function OrdersHistoryTable({
  orders,
  isLoading,
  error,
  onRetry,
  onView,
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
          <span className={orderStatusClassNames[row.original.status]}>{row.original.status}</span>
        ),
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
