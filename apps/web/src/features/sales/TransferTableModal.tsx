/**
 * Transfer-to-table modal.
 *
 * Wires the `sales.changeTable` mutation (shipped in ) into a
 * dialog a manager/admin opens from `SuspendedSalesPanel`. The mutation
 * already validates tenant + site scope + role server-side; this UI
 * exists only to pick the target table and surface the resolved outcome
 * (success toast + cache invalidation; localized error hint with the
 * modal kept open).
 *
 * Reads `restaurantTables.listWithDraftStatus` so the operator can
 * see which tables already have an open draft — those rows get an
 * "(ocupada)" suffix but stay selectable. The server has the final
 * say (one draft per table is not yet enforced in this slice; that
 * conflict-resolution work travels with the deferred
 * split-bill slice).
 *
 * Defensive: when the catalog is empty / errors / loading, the parent
 * panel hides the CTA — this component assumes a non-empty catalog.
 * The "Liberar mesa" option always renders so the operator can detach
 * a draft back to a free-text label even when the only catalog row
 * is the draft's current table.
 *
 * @module features/sales/TransferTableModal
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { invalidateGroups } from '@/lib/invalidateGroups';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import type { SuspendedDraftSummary } from './SuspendedSalesPanel';

const CLEAR_TABLE_VALUE = '__clear__';

interface TransferTableModalProps {
  /**
   * The draft to transfer. `null` keeps the modal closed; setting it
   * to a draft opens the dialog with that draft's current `tableId`
   * pre-selected (or "Liberar mesa" if the draft has no FK yet).
   */
  draft: SuspendedDraftSummary | null;
  onClose: () => void;
}

export function TransferTableModal({ draft, onClose }: TransferTableModalProps) {
  const { t } = useTranslation(['restaurants', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const { currentSite } = useTenant();

  const tablesQuery = trpc.restaurantTables.listWithDraftStatus.useQuery(
    currentSite ? { siteId: currentSite.id, includeArchived: false } : (undefined as never),
    { enabled: Boolean(currentSite) && draft !== null }
  );
  const tables = tablesQuery.data?.items ?? [];

  // Selection state. The `<select>` value is either a real tableId or
  // the sentinel CLEAR_TABLE_VALUE. We map the sentinel back to `null`
  // on confirm — the server's `changeTable` mutation accepts
  // `{ tableId: string | null }` per the  contract.
  //
  // The parent (`SuspendedSalesPanel`) wraps this component with a
  // `key={draft?.id}` so React remounts a fresh instance whenever the
  // operator opens the modal against a different draft — the
  // initializer below then runs once with the right seed. This
  // sidesteps the React Compiler `set-state-in-effect` rule cleanly:
  // no `useEffect` needed to mirror props into state.
  const [selectedValue, setSelectedValue] = useState<string>(
    () => draft?.tableId ?? CLEAR_TABLE_VALUE
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const transferMutation = useCriticalMutation('sales.changeTable', {
    onSuccess: async (_data, variables) => {
      await invalidateGroups(utils, [
        u => u.sales.listDrafts,
        u => u.restaurantTables.listWithDraftStatus,
      ]);
      const resolvedName =
        variables && 'tableId' in variables && variables.tableId
          ? (tables.find(row => row.id === variables.tableId)?.name ?? null)
          : null;
      toast.success({
        title: resolvedName
          ? t('restaurants:transfer.successToast', { tableName: resolvedName })
          : t('restaurants:transfer.successToastCleared'),
      });
      onClose();
    },
    onError: error => {
      setErrorMessage(translateServerError(error, t, t('errors:server.unknown')));
    },
  });

  if (!draft) {
    return null;
  }

  const handleConfirm = () => {
    if (transferMutation.isPending) return;
    const tableId = selectedValue === CLEAR_TABLE_VALUE ? null : selectedValue;
    if (tableId === (draft.tableId ?? null)) {
      // No-op change — close without firing the mutation to avoid an
      // empty audit row.
      onClose();
      return;
    }
    setErrorMessage(null);
    transferMutation.mutate({ saleId: draft.id, tableId });
  };

  const handleClose = () => {
    if (transferMutation.isPending) return;
    onClose();
  };

  const currentLabel = draft.tableName ?? draft.label ?? draft.saleNumber;

  return (
    <Modal
      isOpen={draft !== null}
      onClose={handleClose}
      title={t('restaurants:transfer.title')}
      size="sm"
      footer={
        <>
          <ModalButton onClick={handleClose} disabled={transferMutation.isPending}>
            {t('common:actions.cancel')}
          </ModalButton>
          <ModalButton
            variant="primary"
            onClick={handleConfirm}
            disabled={transferMutation.isPending}
          >
            {transferMutation.isPending
              ? t('restaurants:transfer.confirming')
              : t('restaurants:transfer.confirm')}
          </ModalButton>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-secondary-50 p-3 text-sm text-secondary-700">
          <p className="font-semibold text-secondary-950">{draft.saleNumber}</p>
          <p className="mt-1 text-xs text-secondary-600" data-testid="transfer-modal-current-label">
            {t('restaurants:transfer.currentLine', { current: currentLabel })}
          </p>
        </div>

        <div>
          <label
            htmlFor="transfer-modal-table-select"
            className="block text-xs font-medium uppercase tracking-wide text-secondary-500"
          >
            {t('restaurants:transfer.selectLabel')}
          </label>
          {tablesQuery.isLoading ? (
            <p className="mt-2 text-sm text-secondary-500" data-testid="transfer-modal-loading">
              {t('restaurants:transfer.loading')}
            </p>
          ) : tablesQuery.isError ? (
            <p
              className="mt-2 text-sm text-danger-600"
              data-testid="transfer-modal-load-error"
              role="alert"
            >
              {translateServerError(tablesQuery.error, t, t('errors:server.unknown'))}
            </p>
          ) : (
            <select
              id="transfer-modal-table-select"
              data-testid="transfer-modal-table-select"
              className="input mt-1 w-full"
              value={selectedValue}
              onChange={event => setSelectedValue(event.target.value)}
              disabled={transferMutation.isPending}
            >
              <option value={CLEAR_TABLE_VALUE}>{t('restaurants:transfer.clearOption')}</option>
              {tables.map(row => {
                const isCurrent = row.id === draft.tableId;
                const isOccupiedElsewhere = !isCurrent && row.openDraft !== null;
                const suffix = isCurrent
                  ? t('restaurants:transfer.currentSuffix')
                  : isOccupiedElsewhere
                    ? t('restaurants:transfer.occupiedSuffix')
                    : '';
                return (
                  <option key={row.id} value={row.id}>
                    {suffix ? `${row.name} ${suffix}` : row.name}
                  </option>
                );
              })}
            </select>
          )}
        </div>

        {errorMessage && (
          <p
            className="rounded-xl border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700"
            data-testid="transfer-modal-error"
            role="alert"
          >
            {errorMessage}
          </p>
        )}
      </div>
    </Modal>
  );
}
