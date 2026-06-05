import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ColumnDef } from '@tanstack/react-table';
import { Eye, RotateCcw } from 'lucide-react';
import { DataTable } from '@/components/tables/DataTable';
import { TableErrorState } from '@/components/tables/TableErrorState';
import { TableLoadingState } from '@/components/tables/TableLoadingState';
import { TableExportActions } from '@/components/tables/TableExportActions';
import { purchaseHistoryExportColumns } from '@/features/purchases/purchaseHistoryExport';
import { formatCurrency } from '@/lib/utils';
import type { Purchase } from '@/types';

const purchaseStatusClassNames: Record<Purchase['status'], string> = {
  draft: 'badge-warning',
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
  const { t } = useTranslation('purchases');

  const columns = useMemo<ColumnDef<Purchase>[]>(
    () => [
      {
        accessorKey: 'purchaseNumber',
        header: t('table.purchaseNumber'),
        size: 140,
        cell: ({ row }) => (
          <span className="font-mono font-medium text-primary-800">
            {row.original.purchaseNumber}
          </span>
        ),
      },
      // ENG-132f — date / site / returns trimmed from the default table;
      // each stays reachable via the View detail modal (created, site,
      // supplier-returns summary + return history). Status keeps the return
      // state legible at a glance.
      {
        accessorKey: 'providerName',
        header: t('table.provider'),
        size: 220,
        cell: ({ row }) => row.original.providerName,
      },
      {
        accessorKey: 'status',
        header: t('table.status'),
        size: 120,
        cell: ({ row }) => (
          <span className={purchaseStatusClassNames[row.original.status]}>
            {t(`status.${row.original.status}`)}
          </span>
        ),
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
                  aria-label={t('table.returnItems', { number: row.original.purchaseNumber })}
                  title={t('table.returnItemsTitle')}
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
              <button
                className="btn-ghost btn-icon h-8 w-8"
                onClick={() => onView(row.original.id)}
                aria-label={t('table.viewPurchase', { number: row.original.purchaseNumber })}
                title={t('table.viewPurchaseTitle')}
              >
                <Eye className="h-4 w-4" />
              </button>
            </div>
          );
        },
      },
    ],
    [canManageReturns, onReturn, onView, t]
  );

  return (
    <div className="card p-6">
      {isLoading && <TableLoadingState message={t('table.loading')} rowCount={6} />}
      {error && (
        <TableErrorState title={t('table.loadError')} message={error} onRetry={onRetry} />
      )}
      {!isLoading && !error && (
        <div className="space-y-4">
          <TableExportActions
            data={purchases}
            columns={purchaseHistoryExportColumns}
            filename="purchase-history"
            title={t('table.exportTitle')}
          />
          <DataTable
            columns={columns}
            data={purchases}
            searchKey="purchaseNumber"
            searchPlaceholder={t('table.searchPlaceholder')}
            pageSize={8}
            // ENG-134f — Enter / Space on the focused row opens the
            // purchase detail modal, mirroring the row's Eye button click.
            onRowActivate={row => onView(row.id)}
          />
        </div>
      )}
    </div>
  );
}
