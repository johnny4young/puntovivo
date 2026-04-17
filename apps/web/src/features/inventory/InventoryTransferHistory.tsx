import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type ColumnDef } from '@tanstack/react-table';
import { PackageCheck, Undo2 } from 'lucide-react';
import { DataTable } from '@/components/tables/DataTable';
import { TableErrorState } from '@/components/tables/TableErrorState';
import { TableLoadingState } from '@/components/tables/TableLoadingState';
import { ConfirmModal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { formatDateTime } from '@/lib/utils';
import type { TransferHistoryEntry, TransferHistoryStatus } from '@/types';

const statusBadgeClasses: Record<TransferHistoryStatus, string> = {
  completed: 'inline-flex items-center rounded-full bg-success-100 px-2 py-0.5 text-xs text-success-700',
  in_transit: 'inline-flex items-center rounded-full bg-warning-100 px-2 py-0.5 text-xs text-warning-800',
  void: 'inline-flex items-center rounded-full bg-secondary-100 px-2 py-0.5 text-xs text-secondary-700',
};

/**
 * Phase 2 API-102 — transfer history table with a void action.
 *
 * Consumes `transfers.list` and invalidates balances + the list itself when a
 * void succeeds. Void requires a confirmation step so the operator cannot
 * reverse stock movements accidentally.
 */
export function InventoryTransferHistory() {
  const { t } = useTranslation(['inventory', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();

  const [confirmingVoidId, setConfirmingVoidId] = useState<string | null>(null);

  const historyQuery = trpc.transfers.list.useQuery(undefined, {
    // Keep the list fresh while the user interacts with transfers elsewhere.
    staleTime: 30_000,
  });

  async function invalidateAfterMutation(): Promise<void> {
    await Promise.all([
      utils.transfers.list.invalidate(),
      utils.inventory.listBalancesBySite.invalidate(),
    ]);
  }

  const voidMutation = trpc.transfers.void.useMutation({
    onSuccess: async () => {
      await invalidateAfterMutation();
      setConfirmingVoidId(null);
      toast.success({ title: t('transferHistory.voidSuccess') });
    },
    onError: error => {
      toast.error({
        title: t('transferHistory.voidError'),
        description: translateServerError(error, t, t('errors:server.unknown')),
      });
    },
  });

  const receiveMutation = trpc.transfers.receive.useMutation({
    onSuccess: async () => {
      await invalidateAfterMutation();
      toast.success({ title: t('transferHistory.receiveSuccess') });
    },
    onError: error => {
      toast.error({
        title: t('transferHistory.receiveError'),
        description: translateServerError(error, t, t('errors:server.unknown')),
      });
    },
  });

  const handleRequestVoid = useCallback((id: string) => {
    setConfirmingVoidId(id);
  }, []);

  const handleConfirmVoid = useCallback(() => {
    if (!confirmingVoidId) {
      return;
    }
    voidMutation.mutate({ transferId: confirmingVoidId });
  }, [confirmingVoidId, voidMutation]);

  const handleCancelVoid = useCallback(() => {
    if (voidMutation.isPending) {
      return;
    }
    setConfirmingVoidId(null);
    voidMutation.reset();
  }, [voidMutation]);

  const handleReceive = useCallback(
    (id: string) => {
      receiveMutation.mutate({ transferId: id });
    },
    [receiveMutation]
  );

  const columns = useMemo<ColumnDef<TransferHistoryEntry>[]>(
    () => [
      {
        accessorKey: 'createdAt',
        header: () => t('transferHistory.columns.date'),
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      {
        accessorKey: 'fromSiteName',
        header: () => t('transferHistory.columns.from'),
      },
      {
        accessorKey: 'toSiteName',
        header: () => t('transferHistory.columns.to'),
      },
      {
        accessorKey: 'itemCount',
        header: () => t('transferHistory.columns.items'),
        cell: ({ row }) => row.original.itemCount.toLocaleString(),
      },
      {
        accessorKey: 'totalQuantity',
        header: () => t('transferHistory.columns.totalQty'),
        cell: ({ row }) => row.original.totalQuantity.toLocaleString(),
      },
      {
        accessorKey: 'status',
        header: () => t('transferHistory.columns.status'),
        cell: ({ row }) => (
          <span className={statusBadgeClasses[row.original.status]}>
            {t(`transferHistory.status.${row.original.status}`)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => t('transferHistory.columns.actions'),
        cell: ({ row }) => {
          const isVoid = row.original.status === 'void';
          const isInTransit = row.original.status === 'in_transit';
          const anyMutationPending = voidMutation.isPending || receiveMutation.isPending;
          return (
            <div className="flex items-center gap-2">
              {isInTransit && (
                <button
                  type="button"
                  className="btn-primary inline-flex items-center gap-1 py-1 text-sm"
                  disabled={anyMutationPending}
                  onClick={() => handleReceive(row.original.id)}
                  aria-label={t('transferHistory.receiveAction')}
                >
                  <PackageCheck className="h-4 w-4" />
                  {t('transferHistory.receiveAction')}
                </button>
              )}
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-1 py-1 text-sm"
                disabled={isVoid || anyMutationPending}
                onClick={() => handleRequestVoid(row.original.id)}
                aria-label={t('transferHistory.voidAction')}
              >
                <Undo2 className="h-4 w-4" />
                {t('transferHistory.voidAction')}
              </button>
            </div>
          );
        },
      },
    ],
    [t, voidMutation.isPending, receiveMutation.isPending, handleRequestVoid, handleReceive]
  );

  const items = historyQuery.data?.items ?? [];
  const confirmingEntry =
    confirmingVoidId !== null
      ? items.find(item => item.id === confirmingVoidId) ?? null
      : null;

  return (
    <>
      <div className="card p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-secondary-900">
              {t('transferHistory.title')}
            </h2>
            <p className="text-sm text-secondary-500">
              {t('transferHistory.description')}
            </p>
          </div>
        </div>

        <div className="mt-4">
          {historyQuery.isLoading && (
            <TableLoadingState message={t('transferHistory.loading')} rowCount={4} />
          )}
          {historyQuery.error && (
            <TableErrorState
              title={t('transferHistory.error')}
              message={translateServerError(
                historyQuery.error,
                t,
                t('transferHistory.error')
              )}
              onRetry={() => {
                void historyQuery.refetch();
              }}
            />
          )}
          {!historyQuery.isLoading && !historyQuery.error && (
            <DataTable
              columns={columns}
              data={items}
              searchKey="fromSiteName"
              searchPlaceholder={t('transferHistory.search')}
              pageSize={10}
            />
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmingVoidId !== null}
        title={t('transferHistory.confirmVoidTitle')}
        message={
          confirmingEntry
            ? t('transferHistory.confirmVoidMessage', {
                from: confirmingEntry.fromSiteName,
                to: confirmingEntry.toSiteName,
                quantity: confirmingEntry.totalQuantity.toLocaleString(),
              })
            : t('transferHistory.confirmVoidGeneric')
        }
        confirmText={t('transferHistory.confirmVoidConfirm')}
        cancelText={t('transferHistory.confirmVoidCancel')}
        variant="danger"
        loading={voidMutation.isPending}
        onConfirm={handleConfirmVoid}
        onClose={handleCancelVoid}
      />
    </>
  );
}
