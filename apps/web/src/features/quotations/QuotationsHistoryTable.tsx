import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type ColumnDef } from '@tanstack/react-table';
import { Eye, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/tables/DataTable';
import { TableErrorState } from '@/components/tables/TableErrorState';
import { TableExportActions } from '@/components/tables/TableExportActions';
import { TableLoadingState } from '@/components/tables/TableLoadingState';
import { ConfirmModal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import type {
  QuotationListEntry,
  QuotationTransitionStatus,
} from '@/types';
import {
  QUOTATION_STATUS_BADGE_CLASSES,
  canDeleteQuotation,
  getAvailableTransitions,
} from './quotationStatus';
import { quotationHistoryExportColumns } from './quotationHistoryExport';

interface QuotationsHistoryTableProps {
  onOpenDetails: (quotationId: string) => void;
}

const TRANSITION_BUTTON_CLASSES: Record<QuotationTransitionStatus, string> = {
  sent: 'btn-primary',
  accepted: 'btn-success',
  rejected: 'btn-danger',
  expired: 'btn-secondary',
  converted: 'btn-primary',
};

/**
 * Phase 5 / Tier-2 #6 step 1 — quotation list with status transitions and a
 * draft-only delete action.
 *
 * Status transitions and deletes both invalidate the list + the active
 * details query so the drawer (if open) reflects the new state without an
 * extra refetch round trip.
 */
export function QuotationsHistoryTable({ onOpenDetails }: QuotationsHistoryTableProps) {
  const { t } = useTranslation(['quotations', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();

  const listQuery = trpc.quotations.list.useQuery(undefined, { staleTime: 30_000 });

  const [confirmingDelete, setConfirmingDelete] = useState<QuotationListEntry | null>(
    null
  );

  async function invalidateAfterMutation(): Promise<void> {
    await Promise.all([
      utils.quotations.list.invalidate(),
      utils.quotations.getById.invalidate(),
    ]);
  }

  const statusMutation = trpc.quotations.updateStatus.useMutation({
    onSuccess: async () => {
      await invalidateAfterMutation();
      toast.success({ title: t('toast.statusSuccess') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'quotations:toast.statusError' }),
  });

  const deleteMutation = trpc.quotations.delete.useMutation({
    onSuccess: async () => {
      await invalidateAfterMutation();
      setConfirmingDelete(null);
      toast.success({ title: t('toast.deleteSuccess') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'quotations:toast.deleteError' }),
  });

  const handleStatusChange = useCallback(
    (id: string, nextStatus: QuotationTransitionStatus) => {
      statusMutation.mutate({ id, status: nextStatus });
    },
    [statusMutation]
  );

  const handleRequestDelete = useCallback((entry: QuotationListEntry) => {
    setConfirmingDelete(entry);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (!confirmingDelete) {
      return;
    }
    deleteMutation.mutate({ id: confirmingDelete.id });
  }, [confirmingDelete, deleteMutation]);

  const handleCancelDelete = useCallback(() => {
    if (deleteMutation.isPending) {
      return;
    }
    setConfirmingDelete(null);
    deleteMutation.reset();
  }, [deleteMutation]);

  const anyMutationPending = statusMutation.isPending || deleteMutation.isPending;

  const columns = useMemo<ColumnDef<QuotationListEntry>[]>(
    () => [
      {
        accessorKey: 'quotationNumber',
        header: () => t('history.columns.number'),
        cell: ({ row }) => (
          <span className="font-mono text-xs text-secondary-700">
            {row.original.quotationNumber}
          </span>
        ),
      },
      {
        accessorKey: 'customerName',
        header: () => t('history.columns.customer'),
        cell: ({ row }) =>
          row.original.customerName ?? (
            <span className="text-secondary-500">{t('history.customerNone')}</span>
          ),
      },
      {
        accessorKey: 'siteName',
        header: () => t('history.columns.site'),
      },
      {
        accessorKey: 'itemCount',
        header: () => t('history.columns.items'),
        cell: ({ row }) => row.original.itemCount.toLocaleString(),
      },
      {
        accessorKey: 'total',
        header: () => t('history.columns.total'),
        cell: ({ row }) => (
          <span className="font-medium text-secondary-900">
            {formatCurrency(row.original.total)}
          </span>
        ),
      },
      {
        accessorKey: 'validUntil',
        header: () => t('history.columns.validUntil'),
        cell: ({ row }) =>
          row.original.validUntil
            ? formatDate(row.original.validUntil)
            : t('history.validUntilNever'),
      },
      {
        accessorKey: 'status',
        header: () => t('history.columns.status'),
        cell: ({ row }) => (
          <span className={QUOTATION_STATUS_BADGE_CLASSES[row.original.status]}>
            {t(`status.${row.original.status}`)}
          </span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: () => t('history.columns.createdAt'),
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      {
        id: 'actions',
        header: () => t('history.columns.actions'),
        cell: ({ row }) => {
          const entry = row.original;
          const transitions = getAvailableTransitions(entry);
          const canDelete = canDeleteQuotation(entry);
          return (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-ghost inline-flex items-center gap-1 py-1 text-sm"
                onClick={() => onOpenDetails(entry.id)}
                aria-label={t('history.actions.view')}
              >
                <Eye className="h-4 w-4" aria-hidden="true" />
                {t('history.actions.view')}
              </button>
              {transitions.map(transition => (
                <button
                  key={transition}
                  type="button"
                  className={`${TRANSITION_BUTTON_CLASSES[transition]} inline-flex items-center gap-1 py-1 text-sm`}
                  disabled={anyMutationPending}
                  onClick={() => handleStatusChange(entry.id, transition)}
                  aria-label={t(`history.actions.${transition}`)}
                >
                  {t(`history.actions.${transition}`)}
                </button>
              ))}
              {canDelete && (
                <button
                  type="button"
                  className="btn-secondary inline-flex items-center gap-1 py-1 text-sm"
                  disabled={anyMutationPending}
                  onClick={() => handleRequestDelete(entry)}
                  aria-label={t('history.actions.delete')}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {t('history.actions.delete')}
                </button>
              )}
            </div>
          );
        },
      },
    ],
    [t, anyMutationPending, onOpenDetails, handleStatusChange, handleRequestDelete]
  );

  const items = listQuery.data?.items ?? [];

  return (
    <>
      <div className="card p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-secondary-900">
              {t('history.title')}
            </h2>
            <p className="text-sm text-secondary-500">{t('history.description')}</p>
          </div>
        </div>

        <div className="mt-4">
          {listQuery.isLoading && (
            <TableLoadingState message={t('history.loading')} rowCount={4} />
          )}
          {listQuery.error && (
            <TableErrorState
              title={t('history.error')}
              message={translateServerError(listQuery.error, t, t('history.error'))}
              onRetry={() => {
                void listQuery.refetch();
              }}
            />
          )}
          {!listQuery.isLoading && !listQuery.error && items.length === 0 && (
            <p className="rounded-xl border border-dashed border-secondary-200 px-4 py-6 text-center text-sm text-secondary-500">
              {t('history.empty')}
            </p>
          )}
          {!listQuery.isLoading && !listQuery.error && items.length > 0 && (
            <div className="space-y-4">
              <TableExportActions
                data={items}
                columns={quotationHistoryExportColumns}
                filename="quotations-history"
                title={t('history.exportTitle')}
              />
              <DataTable
                columns={columns}
                data={items}
                searchKey="customerName"
                searchPlaceholder={t('history.search')}
                pageSize={10}
              />
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmingDelete !== null}
        title={t('confirmDelete.title')}
        message={
          confirmingDelete
            ? t('confirmDelete.message', { number: confirmingDelete.quotationNumber })
            : ''
        }
        confirmText={t('confirmDelete.confirm')}
        cancelText={t('confirmDelete.cancel')}
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={handleConfirmDelete}
        onClose={handleCancelDelete}
      />
    </>
  );
}
