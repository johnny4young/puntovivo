/**
 * ENG-018b — SuspendedSalesPanel.
 *
 * Renders the server-side list of suspended drafts owned by the
 * signed-in cashier (or every draft under the tenant for manager /
 * admin, per the `sales.listDrafts` role scope). Exposes two actions
 * per row:
 *
 * - Resume: calls `sales.resume` and lets the parent (SalesPage)
 *   hydrate the returned items into a fresh workspace via
 *   `useCartWorkspaceStore.hydrateFromResumed`.
 * - Discard: opens a ConfirmModal, then calls `sales.discardDraft`.
 *   ENG-018c makes that server-side procedure reverse stock so
 *   cancelling a parked sale no longer leaks inventory.
 *
 * The panel is a plain `<aside>` — the parent decides when to render
 * it. A typical host toggles it via Ctrl+R.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Clock, PlayCircle, RotateCw, Trash2, Users } from 'lucide-react';
import { ConfirmModal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { invalidateGroups } from '@/lib/invalidateGroups';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { formatDateTime } from '@/lib/utils';

export interface SuspendedDraftSummary {
  id: string;
  saleNumber: string;
  label: string | null;
  suspendedAt: string | null;
  suspendedBy: string | null;
  customerName: string | null;
  total: number;
  itemCount: number;
}

interface SuspendedSalesPanelProps {
  /** When `false`, the panel renders nothing. */
  isOpen: boolean;
  onClose: () => void;
  /**
   * Fired when the operator picks a draft to resume. The parent is
   * responsible for calling `sales.resume`, hydrating the workspace
   * store, and (usually) closing this panel afterwards.
   */
  onResume: (draft: SuspendedDraftSummary) => void | Promise<void>;
}

export function SuspendedSalesPanel({
  isOpen,
  onClose,
  onResume,
}: SuspendedSalesPanelProps) {
  const { t } = useTranslation(['sales', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();

  const [discardTarget, setDiscardTarget] = useState<
    SuspendedDraftSummary | null
  >(null);

  const listQuery = trpc.sales.listDrafts.useQuery(
    { page: 1, perPage: 50 },
    { enabled: isOpen, staleTime: 5_000 }
  );

  const discardMutation = trpc.sales.discardDraft.useMutation({
    onSuccess: async () => {
      await invalidateGroups(utils, [
        u => u.sales.listDrafts,
        u => u.inventory.listStock,
        u => u.products.list,
      ]);
      setDiscardTarget(null);
      toast.success({ title: t('sales:park.toastDiscardTitle') });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'sales:park.toastErrorTitle',
    }),
  });

  if (!isOpen) {
    return null;
  }

  const drafts = (listQuery.data?.items ?? []).map(item => ({
    id: item.id,
    saleNumber: item.saleNumber,
    label: item.suspendedLabel ?? null,
    suspendedAt: item.suspendedAt ?? null,
    suspendedBy: item.suspendedBy ?? null,
    customerName: item.customerName ?? null,
    total: item.total,
    itemCount: Number(item.itemCount ?? 0),
  })) satisfies SuspendedDraftSummary[];

  return (
    <>
      <aside
        className="card p-5 sm:p-6"
        data-testid="suspended-sales-panel"
        role="region"
        aria-label={t('sales:park.panelTitle')}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="page-kicker text-[0.62rem] tracking-[0.24em]">
              {t('sales:park.panelTitle')}
            </p>
            <h2 className="mt-2 font-display text-2xl text-secondary-950">
              {t('sales:park.panelTitle')}{' '}
              <span className="text-secondary-500">({drafts.length})</span>
            </h2>
            <p className="mt-1 text-sm text-secondary-600">
              {t('sales:park.panelDescription')}
            </p>
          </div>
          <button
            type="button"
            className="btn-outline btn-icon h-10 w-10"
            onClick={onClose}
            aria-label={t('common:actions.close')}
          >
            ×
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {listQuery.isLoading && (
            <div className="rounded-2xl border border-dashed border-line bg-secondary-50 p-6 text-center text-sm text-secondary-500">
              …
            </div>
          )}
          {listQuery.isError && (
            <div
              className="rounded-2xl border border-danger-200 bg-danger-50 p-5 text-sm text-danger-700"
              data-testid="suspended-sales-error"
              role="alert"
            >
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-danger-700">
                    {t('sales:park.loadError')}
                  </p>
                  <p className="mt-1">
                    {translateServerError(
                      listQuery.error,
                      t,
                      t('errors:server.unknown')
                    )}
                  </p>
                  <button
                    type="button"
                    className="btn-outline mt-3"
                    onClick={() => {
                      void listQuery.refetch();
                    }}
                  >
                    <RotateCw className="h-4 w-4" />
                    {t('sales:park.retry')}
                  </button>
                </div>
              </div>
            </div>
          )}
          {!listQuery.isLoading && !listQuery.isError && drafts.length === 0 && (
            <div
              className="rounded-2xl border border-dashed border-line bg-secondary-50 p-6 text-center text-sm text-secondary-500"
              data-testid="suspended-sales-empty"
            >
              {t('sales:park.emptyState')}
            </div>
          )}
          {!listQuery.isError && drafts.map(draft => (
            <div
              key={draft.id}
              className="card-inset flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              data-testid="suspended-draft-card"
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-secondary-950">
                  {draft.label ?? draft.saleNumber}
                </p>
                <p className="mt-1 text-sm text-secondary-600">
                  {draft.saleNumber}
                  {draft.customerName && ` · ${draft.customerName}`}
                </p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-secondary-500">
                  {draft.suspendedAt && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDateTime(draft.suspendedAt)}
                    </span>
                  )}
                  {draft.suspendedBy && (
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {t('sales:park.suspendedBy', {
                        cashier: draft.suspendedBy,
                      })}
                    </span>
                  )}
                  <span>
                    {t('sales:park.items', { count: draft.itemCount })}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => {
                    void onResume(draft);
                  }}
                  data-testid="suspended-draft-resume"
                >
                  <PlayCircle className="h-4 w-4" />
                  {t('sales:park.resumeAction')}
                </button>
                <button
                  type="button"
                  className="btn-outline text-danger-600 hover:bg-danger-50"
                  onClick={() => setDiscardTarget(draft)}
                  data-testid="suspended-draft-discard"
                >
                  <Trash2 className="h-4 w-4" />
                  {t('sales:park.discard')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </aside>

      <ConfirmModal
        isOpen={discardTarget !== null}
        onClose={() => {
          if (discardMutation.isPending) return;
          setDiscardTarget(null);
        }}
        onConfirm={() => {
          if (!discardTarget) return;
          discardMutation.mutate({ saleId: discardTarget.id });
        }}
        title={t('sales:park.confirmDiscardTitle')}
        message={t('sales:park.confirmDiscardMessage')}
        confirmText={t('sales:park.discard')}
        cancelText={t('common:actions.cancel')}
        variant="danger"
        loading={discardMutation.isPending}
      />
    </>
  );
}
