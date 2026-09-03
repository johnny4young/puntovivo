/**
 * SuspendedSalesPanel.
 *
 * Renders the server-side list of suspended drafts owned by the
 * signed-in cashier (or every draft under the tenant for manager /
 * admin, per the `sales.listDrafts` role scope). Exposes two actions
 * per row:
 *
 * - Resume: calls `sales.resume` and lets the parent (SalesPage)
 * hydrate the returned items into a fresh workspace via
 * `useCartWorkspaceStore.hydrateFromResumed`.
 * - Discard: opens a ConfirmModal, then calls `sales.discardDraft`.
 * makes that server-side procedure reverse stock so
 * cancelling a parked sale no longer leaks inventory.
 *
 * The panel is a plain `<aside>` — the parent decides when to render
 * it. A typical host toggles it via Ctrl+R.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowRightLeft,
  Clock,
  MapPin,
  PlayCircle,
  RotateCw,
  Split,
  Trash2,
  Users,
} from 'lucide-react';
import { ConfirmModal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { useIsModuleActive } from '@/features/modules';
import { useTenant } from '@/features/tenant/TenantProvider';
import {
  invalidateCommittedGroups,
  INVENTORY_RESERVATION_INVALIDATIONS,
} from '@/lib/invalidateGroups';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { formatDateTime } from '@/lib/utils';
import { getCachedDeviceIdSync } from '@/lib/deviceId';
import { SplitBillModal } from './SplitBillModal';
import { TransferTableModal } from './TransferTableModal';

/** Bounded draft-card projection used for resume, discard, transfer and split. */
export interface SuspendedDraftSummary {
  id: string;
  saleNumber: string;
  createdBy: string;
  label: string | null;
  suspendedAt: string | null;
  suspendedBy: string | null;
  /** Actor who owns an unsuspended server claim after resume/recovery. */
  resumedBy: string | null;
  /** Registered terminal currently bound to the active claim. */
  resumedDeviceId: string | null;
  customerName: string | null;
  total: number;
  itemCount: number;
  /**
   * when the draft was opened on a restaurant table the
   * server surfaces the FK + the resolved table name through the
   * `sales.listDrafts` leftJoin. Free-text drafts (legacy )
   * leave both fields `null` and the panel falls back to `label`.
   */
  tableId: string | null;
  tableName: string | null;
  /** Distinguishes normalized checks from table-linked legacy drafts. */
  hasRestaurantCheck: boolean;
}

/** Visibility and resume boundary for the operational draft panel. */
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

export function SuspendedSalesPanel(props: SuspendedSalesPanelProps) {
  const { currentSite } = useTenant();
  if (!props.isOpen) return null;

  // Page state belongs to one visible site-scoped panel. A keyed child is
  // React's native reset boundary: closing/reopening or changing site remounts
  // the controller at page one without a state-synchronizing effect.
  return <OpenSuspendedSalesPanel key={currentSite?.id ?? 'site-unselected'} {...props} />;
}

function OpenSuspendedSalesPanel({ isOpen, onClose, onResume }: SuspendedSalesPanelProps) {
  const { t } = useTranslation(['sales', 'restaurants', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const { currentSite } = useTenant();
  const isDineInActive = useIsModuleActive('dine-in');
  const canTransferTables = user?.role === 'manager' || user?.role === 'admin';
  const canOverrideDraftOwnership = user?.role === 'manager' || user?.role === 'admin';
  const currentDeviceId = getCachedDeviceIdSync();

  const [draftPage, setDraftPage] = useState(1);
  const [discardTarget, setDiscardTarget] = useState<SuspendedDraftSummary | null>(null);
  // In-flight resume tracking so a double-click cannot fire `sales.resume`
  // twice for the same draft (the flows hook also guards on the mutation's
  // isPending; this keeps the row button visibly disabled meanwhile).
  const [resumingId, setResumingId] = useState<string | null>(null);
  // the operator picks a draft to transfer to a different
  // restaurant table. Holding the full summary (not just the id) lets
  // `<TransferTableModal>` render the current label without re-fetching.
  const [transferTarget, setTransferTarget] = useState<SuspendedDraftSummary | null>(null);
  // same shape as transferTarget but drives the
  // `<SplitBillModal>`. Separated so the operator can hold two modals
  // open against different drafts in principle (in practice only one
  // mounts at a time because `<Modal>` portals to the same DOM root).
  const [splitTarget, setSplitTarget] = useState<SuspendedDraftSummary | null>(null);

  const listQuery = trpc.sales.listDrafts.useQuery(
    {
      page: draftPage,
      perPage: 50,
      ...(currentSite ? { siteId: currentSite.id } : {}),
    },
    { enabled: isOpen, staleTime: 5_000 }
  );
  // "Cambiar mesa" is manager/admin + dine-in only. Mirror both server
  // guards before querying so a counter tenant does not turn an expected
  // MODULE_DISABLED response into a noisy 403 in the sales journey.
  const tableCatalogQuery = trpc.restaurantTables.list.useQuery(
    currentSite && canTransferTables && isDineInActive
      ? { siteId: currentSite.id, includeArchived: false }
      : (undefined as never),
    {
      enabled: isOpen && canTransferTables && isDineInActive && Boolean(currentSite),
      staleTime: 5_000,
    }
  );
  const restaurantTablesAvailable =
    canTransferTables &&
    isDineInActive &&
    !tableCatalogQuery.isLoading &&
    !tableCatalogQuery.isError &&
    (tableCatalogQuery.data?.items.length ?? 0) > 0;

  const discardMutation = useCriticalMutation('sales.discardDraft', {
    onSuccess: async () => {
      // The server already cancelled the draft and restored stock. Close the
      // confirmation before refreshing projections so a cache failure cannot
      // present the destructive command as retryable.
      setDiscardTarget(null);
      setDraftPage(1);
      const refreshed = await invalidateCommittedGroups(utils, [
        u => u.sales.listDrafts,
        u => u.restaurantTables.listWithDraftStatus,
        u => u.restaurantServices.getTableState,
        ...INVENTORY_RESERVATION_INVALIDATIONS,
      ]);
      if (refreshed) {
        toast.success({ title: t('sales:park.toastDiscardTitle') });
      } else {
        toast.warning({
          title: t('sales:park.toastDiscardTitle'),
          description: t('common:toast.committedRefreshWarning'),
        });
      }
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'sales:park.toastErrorTitle',
    }),
  });

  // A concurrent settlement can make the requested page cease to exist.
  // React discards this render and immediately retries with the bounded page;
  // the guard makes the render-phase reconciliation finite and avoids the
  // cascading render caused by synchronizing derived query state in an effect.
  if (listQuery.data) {
    const lastPage = Math.max(1, listQuery.data.totalPages ?? 0);
    if (draftPage > lastPage) setDraftPage(lastPage);
  }

  if (!isOpen) {
    return null;
  }

  const drafts = (listQuery.data?.items ?? []).map(item => ({
    id: item.id,
    saleNumber: item.saleNumber,
    createdBy: item.createdBy,
    label: item.restaurantCheckLabel ?? item.suspendedLabel ?? null,
    suspendedAt: item.suspendedAt ?? null,
    suspendedBy: item.suspendedBy ?? null,
    resumedBy: item.resumedBy ?? null,
    resumedDeviceId: item.resumedDeviceId ?? null,
    customerName: item.customerName ?? null,
    total: item.total,
    itemCount: Number(item.itemCount ?? 0),
    tableId: item.tableId ?? null,
    tableName: item.tableName ?? null,
    hasRestaurantCheck: Boolean(item.restaurantCheckId),
  })) satisfies SuspendedDraftSummary[];
  const totalDrafts = listQuery.data?.totalItems ?? drafts.length;
  const totalDraftPages = listQuery.data?.totalPages ?? (totalDrafts > 0 ? 1 : 0);

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
              <span className="text-secondary-500">({totalDrafts})</span>
            </h2>
            <p className="mt-1 text-sm text-secondary-600">{t('sales:park.panelDescription')}</p>
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
                  <p className="font-semibold text-danger-700">{t('sales:park.loadError')}</p>
                  <p className="mt-1">
                    {translateServerError(listQuery.error, t, t('errors:server.unknown'))}
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
          {!listQuery.isError &&
            drafts.map(draft => (
              <div
                key={draft.id}
                className="card-inset flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                data-testid="suspended-draft-card"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-secondary-950">
                      {draft.label ?? draft.saleNumber}
                    </p>
                    {draft.tableId && draft.tableName && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-primary-700"
                        data-testid="suspended-draft-table-badge"
                        title={t('restaurants:tables.draftStatus.badgeTooltip', {
                          tableName: draft.tableName,
                        })}
                      >
                        <MapPin className="h-3 w-3" />
                        {t('restaurants:tables.draftStatus.badgeLabel', {
                          tableName: draft.tableName,
                        })}
                      </span>
                    )}
                  </div>
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
                    <span>{t('sales:park.items', { count: draft.itemCount })}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-outline"
                    disabled={resumingId !== null}
                    onClick={() => {
                      if (resumingId !== null) {
                        return;
                      }
                      setResumingId(draft.id);
                      void Promise.resolve(onResume(draft)).finally(() => {
                        setResumingId(null);
                      });
                    }}
                    data-testid="suspended-draft-resume"
                  >
                    <PlayCircle className="h-4 w-4" />
                    {t('sales:park.resumeAction')}
                  </button>
                  {restaurantTablesAvailable && draft.suspendedAt !== null && (
                    <button
                      type="button"
                      className="btn-outline"
                      disabled={resumingId !== null}
                      onClick={() => setTransferTarget(draft)}
                      data-testid="suspended-draft-transfer"
                      aria-label={t('restaurants:transfer.ctaAriaLabel', {
                        saleNumber: draft.saleNumber,
                      })}
                    >
                      <ArrowRightLeft className="h-4 w-4" />
                      {t('restaurants:transfer.ctaLabel')}
                    </button>
                  )}
                  {restaurantTablesAvailable &&
                    draft.suspendedAt !== null &&
                    draft.itemCount > 0 && (
                      <button
                        type="button"
                        className="btn-outline"
                        disabled={resumingId !== null}
                        onClick={() => setSplitTarget(draft)}
                        data-testid="suspended-draft-split"
                        aria-label={t('restaurants:split.ctaAriaLabel', {
                          saleNumber: draft.saleNumber,
                        })}
                      >
                        <Split className="h-4 w-4" />
                        {t('restaurants:split.ctaLabel')}
                      </button>
                    )}
                  {(canOverrideDraftOwnership ||
                    (draft.suspendedAt !== null &&
                      (draft.createdBy === user?.id || draft.suspendedBy === user?.id)) ||
                    (draft.suspendedAt === null &&
                      draft.resumedBy === user?.id &&
                      currentDeviceId !== null &&
                      draft.resumedDeviceId === currentDeviceId)) && (
                    <button
                      type="button"
                      className="btn-outline text-danger-600 hover:bg-danger-50"
                      disabled={resumingId !== null}
                      onClick={() => setDiscardTarget(draft)}
                      data-testid="suspended-draft-discard"
                    >
                      <Trash2 className="h-4 w-4" />
                      {t('sales:park.discard')}
                    </button>
                  )}
                </div>
              </div>
            ))}
        </div>

        {(draftPage > 1 || totalDraftPages > 1) && (
          <nav
            className="mt-5 flex items-center justify-end gap-3 text-sm text-secondary-600"
            aria-label={t('common:pagination.navigation')}
            data-testid="suspended-sales-pagination"
          >
            <span>
              {t('common:pagination.page')} {draftPage} {t('common:pagination.of')}{' '}
              {Math.max(1, totalDraftPages)}
            </span>
            <button
              type="button"
              className="btn-outline"
              disabled={draftPage <= 1 || listQuery.isLoading}
              onClick={() => setDraftPage(current => Math.max(1, current - 1))}
              data-testid="suspended-sales-previous-page"
            >
              {t('common:pagination.previous')}
            </button>
            <button
              type="button"
              className="btn-outline"
              disabled={draftPage >= totalDraftPages || listQuery.isLoading}
              onClick={() => setDraftPage(current => current + 1)}
              data-testid="suspended-sales-next-page"
            >
              {t('common:pagination.next')}
            </button>
          </nav>
        )}
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

      {/* Transfer-to-table modal. The `key` forces a
          fresh remount whenever the operator picks a different draft
          so the modal's `useState` initializer seeds the dropdown
          with the right starting value (the draft's current tableId)
          without a setState-in-effect mirror. */}
      <TransferTableModal
        key={transferTarget?.id ?? 'transfer-closed'}
        draft={canTransferTables ? transferTarget : null}
        onClose={() => setTransferTarget(null)}
      />

      {/* Split-bill modal. Same key-based remount strategy
          so the per-draft selection state seeds fresh every time. The
          `canTransferTables` gate is reused intentionally — splitting
          a draft is also a manager/admin operations override. */}
      <SplitBillModal
        key={splitTarget?.id ?? 'split-closed'}
        draft={canTransferTables ? splitTarget : null}
        onClose={() => setSplitTarget(null)}
      />
    </>
  );
}
