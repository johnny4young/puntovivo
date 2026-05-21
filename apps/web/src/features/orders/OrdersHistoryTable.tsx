import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('orders');

  const columns = useMemo<ColumnDef<Order>[]>(
    () => [
      {
        accessorKey: 'orderNumber',
        header: t('table.orderNumber'),
        size: 140,
        cell: ({ row }) => (
          <span className="font-mono font-medium text-primary-800">{row.original.orderNumber}</span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: t('table.date'),
        size: 180,
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      {
        accessorKey: 'providerName',
        header: t('table.provider'),
        size: 220,
        cell: ({ row }) => row.original.providerName,
      },
      {
        accessorKey: 'siteName',
        header: t('table.site'),
        size: 160,
        cell: ({ row }) => row.original.siteName,
      },
      {
        accessorKey: 'status',
        header: t('table.status'),
        size: 120,
        cell: ({ row }) => (
          <span className={orderStatusClassNames[row.original.status]}>
            {t(`status.${row.original.status}`)}
          </span>
        ),
      },
      {
        id: 'receipts',
        header: t('table.receipts'),
        size: 180,
        cell: ({ row }) => {
          const receiptCount = row.original.linkedPurchaseCount ?? 0;

          if (receiptCount === 0) {
            return <span className="text-sm text-secondary-500">{t('table.noReceipts')}</span>;
          }

          return (
            <div className="space-y-1">
              <p className="text-sm font-medium text-secondary-900">
                {t('table.receiptCount', { count: receiptCount })}
              </p>
              <p className="text-xs text-secondary-500">
                {t('table.latestReceipt', { number: row.original.receivedPurchaseNumber ?? '—' })}
              </p>
            </div>
          );
        },
      },
      {
        accessorKey: 'total',
        header: t('table.total'),
        size: 120,
        cell: ({ row }) => <span className="font-medium">{formatCurrency(row.original.total)}</span>,
      },
      {
        id: 'actions',
        header: t('table.actions'),
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
                  {t('table.receive')}
                </button>
              )}
              <button
                className="btn-ghost btn-icon h-8 w-8"
                onClick={() => onView(row.original.id)}
                aria-label={t('table.viewOrder', { number: row.original.orderNumber })}
                title={t('table.viewOrderTitle')}
              >
                <Eye className="h-4 w-4" />
              </button>
            </div>
          );
        },
      },
    ],
    [canManageReceipts, onReceive, onView, t]
  );

  return (
    <div className="card p-6">
      {isLoading && <TableLoadingState message={t('table.loading')} rowCount={6} />}
      {error && (
        <TableErrorState title={t('table.loadError')} message={error} onRetry={onRetry} />
      )}
      {!isLoading && !error && (
        <DataTable
          columns={columns}
          data={orders}
          searchKey="orderNumber"
          searchPlaceholder={t('table.searchPlaceholder')}
          pageSize={8}
        />
      )}
    </div>
  );
}
