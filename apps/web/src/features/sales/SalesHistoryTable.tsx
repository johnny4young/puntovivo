import { useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DataTable } from '@/components/tables/DataTable';
import { TableErrorState } from '@/components/tables/TableErrorState';
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
  onRetry: () => void;
  onView: (saleId: string) => void;
  /**
   * ENG-018b — id of the sale row the operator most recently focused
   * (click or keyboard nav). Used by Ctrl+Shift+P in SalesPage to
   * trigger reprint on the picked row. Controlled from the parent so
   * the shortcut handler has access to it.
   */
  selectedSaleId?: string | null;
  onSelectedSaleIdChange?: (saleId: string | null) => void;
}

export function SalesHistoryTable({
  sales,
  isLoading,
  error,
  onRetry,
  onView,
  selectedSaleId,
  onSelectedSaleIdChange,
}: SalesHistoryTableProps) {
  const { t } = useTranslation('sales');
  const columns = useMemo<ColumnDef<Sale>[]>(
    () => [
      {
        accessorKey: 'saleNumber',
        header: t('history.columns.invoiceNumber'),
        size: 130,
        cell: ({ row }) => (
          <span className="font-mono font-medium text-primary-800">{row.original.saleNumber}</span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: t('history.columns.date'),
        size: 180,
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      {
        accessorKey: 'customerName',
        header: t('history.columns.customer'),
        size: 180,
        cell: ({ row }) => row.original.customerName ?? t('history.walkIn'),
      },
      {
        accessorKey: 'total',
        header: t('history.columns.total'),
        size: 120,
        cell: ({ row }) => <span className="font-medium">{formatCurrency(row.original.total)}</span>,
      },
      {
        accessorKey: 'paymentStatus',
        header: t('history.columns.payment'),
        size: 120,
        cell: ({ row }) => (
          <span className={`badge ${paymentStatusColors[row.original.paymentStatus]}`}>
            {t(`paymentStatus.${row.original.paymentStatus}`)}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: t('history.columns.status'),
        size: 110,
        cell: ({ row }) => (
          <span className={`badge ${statusColors[row.original.status]}`}>
            {t(`status.${row.original.status}`)}
          </span>
        ),
      },
      {
        id: 'actions',
        size: 80,
        cell: ({ row }) => (
          <button
            className="btn-ghost btn-icon h-8 w-8"
            onClick={() => onView(row.original.id)}
            aria-label={t('history.viewSale', { number: row.original.saleNumber })}
            title={t('history.viewSaleTitle')}
          >
            <Eye className="h-4 w-4" />
          </button>
        ),
      },
    ],
    [onView, t]
  );

  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="page-kicker text-[0.62rem] tracking-[0.24em]">{t('history.kicker')}</p>
          <div>
            <h2 className="font-display text-3xl text-secondary-950">{t('history.title')}</h2>
            <p className="mt-2 text-sm text-secondary-600">
              {t('history.description')}
            </p>
          </div>
        </div>
        {!isLoading && !error && (
          <span className="badge badge-secondary">{sales.length} {t('history.recordsLoaded')}</span>
        )}
      </div>

      {isLoading && <TableLoadingState message={t('history.loading')} rowCount={6} />}
      {error && <TableErrorState title={t('history.error')} message={error} onRetry={onRetry} />}
      {!isLoading && !error && (
        <div className="space-y-4">
          <TableExportActions
            data={sales}
            columns={saleHistoryExportColumns}
            filename="sales-history"
            title={t('history.exportTitle')}
          />
          <DataTable
            columns={columns}
            data={sales}
            searchKey="saleNumber"
            searchPlaceholder={t('history.search')}
            pageSize={8}
            onRowFocusChange={row => {
              if (onSelectedSaleIdChange) {
                onSelectedSaleIdChange(row ? row.id : null);
              }
            }}
            isRowSelected={row =>
              selectedSaleId != null && row.id === selectedSaleId
            }
          />
        </div>
      )}
    </section>
  );
}
