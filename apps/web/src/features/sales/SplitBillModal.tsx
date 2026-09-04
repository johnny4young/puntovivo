/**
 * SplitBillModal.
 *
 * Lets a manager/admin carve a subset of items out of a suspended
 * draft into a brand-new suspended draft. Wires the server-side
 * `sales.splitDraft` mutation that lands in the same slice.
 *
 * Reads `sales.getById` for the source draft's items (no new read
 * surface) and reuses `restaurantTables.listWithDraftStatus` for the
 * target table picker. The parent
 * (`SuspendedSalesPanel`) is responsible for gating the CTA on role +
 * catalog availability, just like `TransferTableModal`.
 *
 * State strategy follows TransferTableModal: the parent passes
 * `key={target?.id ?? '…'}` so React remounts a fresh instance per
 * draft. Selection state seeds from the lazy `useState` initializer
 * (which runs once on mount) — no setState-in-effect.
 *
 * @module features/sales/SplitBillModal
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { invalidateCommittedGroups } from '@/lib/invalidateGroups';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import type { SuspendedDraftSummary } from './SuspendedSalesPanel';

const SAME_TABLE_VALUE = '__same__';
const CLEAR_TABLE_VALUE = '__clear__';

interface SplitBillModalProps {
  /**
   * The source draft to split. `null` keeps the modal closed. When set,
   * the modal opens pre-seeded with the draft's current `tableId` (or
   * "Misma mesa" when both source and target should share the FK).
   */
  draft: SuspendedDraftSummary | null;
  onClose: () => void;
}

export function SplitBillModal({ draft, onClose }: SplitBillModalProps) {
  const { t } = useTranslation(['restaurants', 'errors', 'common', 'fulfillmentErrors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const { currentSite } = useTenant();

  const itemsQuery = trpc.sales.getById.useQuery(draft ? { id: draft.id } : (undefined as never), {
    enabled: draft !== null,
  });
  const items = itemsQuery.data?.items ?? [];

  const tablesQuery = trpc.restaurantTables.listWithDraftStatus.useQuery(
    currentSite ? { siteId: currentSite.id, includeArchived: false } : (undefined as never),
    { enabled: Boolean(currentSite) && draft !== null }
  );
  const tables = tablesQuery.data?.items ?? [];

  // Selection state. Seeded on mount via the lazy `useState`
  // initializer; the parent's `key={draft?.id}` triggers a remount
  // whenever the operator targets a different draft so the seeds run
  // again. Default selection: empty (operator must opt in to each
  // line). Default target: "Misma mesa" (keep the same FK as the
  // source) — that's the most common restaurant flow ("split the
  // check, leave the table assignment alone"). A table-backed normalized
  // check intentionally has no clear-table option because the server keeps a
  // live restaurant account attached to a physical table.
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(() => new Set());
  const [selectedTableValue, setSelectedTableValue] = useState<string>(() =>
    draft?.tableId ? SAME_TABLE_VALUE : CLEAR_TABLE_VALUE
  );
  const [labelDraft, setLabelDraft] = useState<string>(() => '');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const splitMutation = useCriticalMutation('sales.splitDraft', {
    onSuccess: async data => {
      // `data` is `OutputOfPath<'sales.splitDraft'>` inferred from
      // `AppRouter`. Server returns `{ source, created }` where
      // `created.suspendedLabel` may be null (free-text drafts) and
      // `created.saleNumber` is always present.
      const createdLabel = data.created.suspendedLabel ?? data.created.saleNumber;
      const successTitle = t('restaurants:split.successToast', { label: createdLabel });
      // Both checks already exist once onSuccess starts. Close before cache
      // work so a projection failure cannot invite a second split command.
      onClose();
      const refreshed = await invalidateCommittedGroups(utils, [
        u => u.sales.listDrafts,
        u => u.restaurantTables.listWithDraftStatus,
        u => u.restaurantServices.getTableState,
      ]);
      if (refreshed) {
        toast.success({ title: successTitle });
      } else {
        toast.warning({
          title: successTitle,
          description: t('common:toast.committedRefreshWarning'),
        });
      }
    },
    onError: error => {
      setErrorMessage(translateServerError(error, t, t('errors:server.unknown')));
    },
  });

  if (!draft) {
    return null;
  }

  const toggleItem = (id: string) => {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const currentLabel = draft.tableName ?? draft.label ?? draft.saleNumber;
  const showLabelInput = !draft.tableId && selectedTableValue === CLEAR_TABLE_VALUE;
  const allSelected = items.length > 0 && selectedItemIds.size === items.length;
  const wouldEmptyRestaurantCheck = Boolean(draft.tableId) && allSelected;

  const handleConfirm = () => {
    if (splitMutation.isPending) return;
    if (selectedItemIds.size === 0) {
      setErrorMessage(t('restaurants:split.errorEmptySelection'));
      return;
    }
    if (wouldEmptyRestaurantCheck) {
      setErrorMessage(t('restaurants:split.errorSourceWouldBeEmpty'));
      return;
    }
    setErrorMessage(null);
    const tableId =
      selectedTableValue === SAME_TABLE_VALUE
        ? (draft.tableId ?? null)
        : selectedTableValue === CLEAR_TABLE_VALUE
          ? null
          : selectedTableValue;
    splitMutation.mutate({
      sourceSaleId: draft.id,
      saleItemIds: [...selectedItemIds],
      tableId,
      label: tableId === null && labelDraft.trim().length > 0 ? labelDraft.trim() : undefined,
    });
  };

  const handleClose = () => {
    if (splitMutation.isPending) return;
    onClose();
  };

  return (
    <Modal
      isOpen={draft !== null}
      onClose={handleClose}
      title={t('restaurants:split.title')}
      size="md"
      footer={
        <>
          <ModalButton onClick={handleClose} disabled={splitMutation.isPending}>
            {t('common:actions.cancel')}
          </ModalButton>
          <ModalButton
            variant="primary"
            onClick={handleConfirm}
            disabled={
              splitMutation.isPending || selectedItemIds.size === 0 || wouldEmptyRestaurantCheck
            }
          >
            {splitMutation.isPending
              ? t('restaurants:split.confirming')
              : t('restaurants:split.confirm')}
          </ModalButton>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-secondary-50 p-3 text-sm text-secondary-700">
          <p className="font-semibold text-secondary-950">{draft.saleNumber}</p>
          <p className="mt-1 text-xs text-secondary-600" data-testid="split-modal-current-label">
            {t('restaurants:split.currentLine', { current: currentLabel })}
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">
              {t('restaurants:split.selectItemsLabel')}
            </p>
            {items.length > 0 && (
              <button
                type="button"
                className="text-xs font-medium text-primary-800 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  if (splitMutation.isPending) return;
                  if (allSelected) {
                    setSelectedItemIds(new Set());
                  } else {
                    setSelectedItemIds(new Set(items.map(row => row.id)));
                  }
                }}
                disabled={splitMutation.isPending}
                data-testid="split-modal-toggle-all"
              >
                {allSelected ? t('restaurants:split.clearAll') : t('restaurants:split.selectAll')}
              </button>
            )}
          </div>
          {itemsQuery.isLoading ? (
            <p className="mt-2 text-sm text-secondary-500" data-testid="split-modal-items-loading">
              {t('restaurants:split.loading')}
            </p>
          ) : itemsQuery.isError ? (
            <p
              className="mt-2 text-sm text-danger-600"
              data-testid="split-modal-items-error"
              role="alert"
            >
              {translateServerError(itemsQuery.error, t, t('errors:server.unknown'))}
            </p>
          ) : items.length === 0 ? (
            <p className="mt-2 text-sm text-secondary-500" data-testid="split-modal-items-empty">
              {t('restaurants:split.emptyItems')}
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
              {items.map(item => {
                const checked = selectedItemIds.has(item.id);
                return (
                  <li key={item.id} className="px-3 py-2">
                    <label className="flex cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleItem(item.id)}
                        disabled={splitMutation.isPending}
                        data-testid={`split-modal-item-${item.id}`}
                      />
                      <span className="flex-1 text-sm text-secondary-700">
                        {t('restaurants:split.itemRow', {
                          name: item.productName ?? item.productId,
                          quantity: item.quantity,
                          unitPrice: item.unitPrice.toFixed(2),
                        })}
                      </span>
                      <span className="text-sm font-semibold text-secondary-950">
                        {item.total.toFixed(2)}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {wouldEmptyRestaurantCheck && (
            <p className="mt-2 text-xs text-warning-700" data-testid="split-modal-source-required">
              {t('restaurants:split.errorSourceWouldBeEmpty')}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="split-modal-table-select"
            className="block text-xs font-medium uppercase tracking-wide text-secondary-500"
          >
            {t('restaurants:split.selectTableLabel')}
          </label>
          {tablesQuery.isLoading ? (
            <p className="mt-2 text-sm text-secondary-500" data-testid="split-modal-tables-loading">
              {t('restaurants:split.loading')}
            </p>
          ) : tablesQuery.isError ? (
            <p
              className="mt-2 text-sm text-danger-600"
              data-testid="split-modal-tables-error"
              role="alert"
            >
              {translateServerError(tablesQuery.error, t, t('errors:server.unknown'))}
            </p>
          ) : (
            <select
              id="split-modal-table-select"
              data-testid="split-modal-table-select"
              className="input mt-1 w-full"
              value={selectedTableValue}
              onChange={event => setSelectedTableValue(event.target.value)}
              disabled={splitMutation.isPending}
            >
              {draft.tableId && (
                <option value={SAME_TABLE_VALUE}>
                  {t('restaurants:split.sameTableOption', {
                    tableName: draft.tableName ?? currentLabel,
                  })}
                </option>
              )}
              {!draft.tableId && (
                <option value={CLEAR_TABLE_VALUE}>{t('restaurants:split.clearOption')}</option>
              )}
              {tables.map(row => {
                // A normalized check shares service-level diners with every
                // account at its table. Moving only selected lines to another
                // table would invent a party allocation the operator never
                // supplied, so keep that split inside the current service.
                if (draft.hasRestaurantCheck) return null;
                const isSource = row.id === draft.tableId;
                const isOccupiedElsewhere = !isSource && row.openDraft !== null;
                const suffix = isSource
                  ? t('restaurants:split.currentSuffix')
                  : isOccupiedElsewhere
                    ? t('restaurants:split.occupiedSuffix')
                    : '';
                return (
                  <option key={row.id} value={row.id}>
                    {suffix ? `${row.name} ${suffix}` : row.name}
                  </option>
                );
              })}
            </select>
          )}
          {draft.hasRestaurantCheck && (
            <p
              className="mt-2 text-xs text-secondary-600"
              data-testid="split-modal-same-table-hint"
            >
              {t('restaurants:split.sameTableOnlyHint')}
            </p>
          )}
        </div>

        {showLabelInput && (
          <div>
            <label
              htmlFor="split-modal-label-input"
              className="block text-xs font-medium uppercase tracking-wide text-secondary-500"
            >
              {t('restaurants:split.labelInputLabel')}
            </label>
            <input
              id="split-modal-label-input"
              data-testid="split-modal-label-input"
              className="input mt-1 w-full"
              type="text"
              maxLength={80}
              value={labelDraft}
              onChange={event => setLabelDraft(event.target.value)}
              disabled={splitMutation.isPending}
              placeholder={t('restaurants:split.labelInputPlaceholder')}
            />
          </div>
        )}

        {errorMessage && (
          <p
            className="rounded-xl border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700"
            data-testid="split-modal-error"
            role="alert"
          >
            {errorMessage}
          </p>
        )}
      </div>
    </Modal>
  );
}
