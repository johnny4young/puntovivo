import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ElementType } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Clock, CloudUpload, RefreshCw, RotateCw, XCircle } from 'lucide-react';
import { useToast } from '@/components/feedback/ToastProvider';
import { CompanySyncActions } from '@/features/company/CompanySyncActions';
import {
  CompanySyncConflictModal,
  type ConflictResolution,
  type PendingResolution,
} from '@/features/company/CompanySyncConflictModal';
import {
  CompanySyncConflictPreview,
  CompanySyncQueuePreview,
} from '@/features/company/CompanySyncPreviewSections';
import { CompanySyncMergeModal } from '@/features/company/CompanySyncMergeModal';
import { useSyncSnapshot } from '@/features/company/useSyncSnapshot';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc, vanillaClient } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { formatDateTime } from '@/lib/utils';

const syncPreviewLimit = 5;

interface SyncKpiProps {
  icon: ElementType;
  label: string;
  value: string;
  /** Turns the tile and its value danger-toned when an alarming count is > 0. */
  alarming?: boolean;
  /** Render the value in compact mono — used for the last-sync timestamp. */
  mono?: boolean;
}

/**
 * Single metric tile on the shared `.pv-kpi` recipe (propuesta §09). Counts use
 * the neutral ink glyph and flip to danger — glyph, border, background and
 * value — when `alarming` is set, so a non-zero failure / conflict count reads
 * as urgent instead of a flat grey number.
 */
function SyncKpi({ icon: Icon, label, value, alarming = false, mono = false }: SyncKpiProps) {
  return (
    <div className={alarming ? 'pv-kpi border-danger-500/35 bg-danger-50/50' : 'pv-kpi'}>
      <div className="hd">
        <span className={alarming ? 'pv-gt pv-gt-danger' : 'pv-gt pv-gt-ink'}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="lbl">{label}</span>
      </div>
      <div
        className={
          mono ? 'val mono mt-[18px] text-[15px]' : alarming ? 'val text-danger-700' : 'val'
        }
      >
        {value}
      </div>
    </div>
  );
}

function formatCount(value: number | undefined): string {
  return typeof value === 'number' ? value.toLocaleString() : '—';
}

export function CompanySyncCard() {
  const { t } = useTranslation('settings');
  const toast = useToast();
  const queryClient = useQueryClient();
  const trpcUtils = trpc.useUtils();
  const [pendingResolution, setPendingResolution] = useState<PendingResolution | null>(null);
  const {
    snapshotQuery,
    queryKey: syncSnapshotQueryKey,
    snapshot,
    queueItems,
    conflicts,
  } = useSyncSnapshot({
    queueLimit: syncPreviewLimit,
    conflictLimit: syncPreviewLimit,
  });

  const refreshSyncSnapshot = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['sync', 'snapshot'] }),
      trpcUtils.operations.needsAttention.invalidate(),
    ]);
  };

  const pushMutation = useMutation({
    mutationFn: () => vanillaClient.sync.push.mutate({ limit: 50 }),
    onSuccess: async result => {
      await refreshSyncSnapshot();

      if (result.errors.length > 0) {
        toast.error({
          title: t('company.sync.toast.syncWithIssues'),
          description: result.errors[0],
        });
        return;
      }

      toast.success({
        title:
          result.synced > 0
            ? t('company.sync.toast.syncedChanges', { count: result.synced })
            : t('company.sync.toast.alreadyUpToDate'),
      });
    },
    onError: onErrorToast(toast, t, { titleKey: 'settings:company.sync.toast.queueError' }),
  });
  const pullMutation = useMutation({
    mutationFn: () =>
      vanillaClient.sync.pull.query({
        queueLimit: syncPreviewLimit,
        conflictLimit: syncPreviewLimit,
      }),
    onSuccess: async snapshot => {
      queryClient.setQueryData(syncSnapshotQueryKey, snapshot);
      await trpcUtils.operations.needsAttention.invalidate();
      toast.success({ title: t('company.sync.toast.snapshotRefreshed') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'settings:company.sync.toast.snapshotError' }),
  });

  const resolveMutation = useMutation({
    mutationFn: ({
      id,
      resolution,
      mergedData,
    }: {
      // explicit `| undefined` on optional fields.
      id: string;
      resolution: ConflictResolution;
      mergedData?: Record<string, unknown> | undefined;
      localRecordExists?: boolean | null | undefined;
    }) => vanillaClient.sync.resolve.mutate({ id, resolution, mergedData }),
    onSuccess: async (_result, variables) => {
      await refreshSyncSnapshot();
      setPendingResolution(null);
      toast.success({
        title:
          variables.resolution === 'local_wins'
            ? t('company.sync.toast.conflictLocalWins')
            : variables.resolution === 'remote_wins'
              ? variables.localRecordExists === false
                ? t('company.sync.toast.staleLocalDiscarded')
                : t('company.sync.toast.conflictRemoteWins')
              : t('company.sync.toast.conflictMerged'),
      });
    },
    onError: onErrorToast(toast, t, { titleKey: 'settings:company.sync.toast.conflictError' }),
  });

  const isRefreshing = snapshotQuery.isRefetching || pullMutation.isPending;

  return (
    <section className="card p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100">
          <CloudUpload className="h-5 w-5 text-primary-700" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-secondary-900">{t('company.sync.title')}</h2>
          <p className="text-sm text-secondary-500">{t('company.sync.description')}</p>
        </div>
      </div>

      {snapshotQuery.error && (
        <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          {translateServerError(snapshotQuery.error, t, t('errors:server.unknown'))}
        </div>
      )}

      <div className="pv-kpis grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        <SyncKpi
          icon={Clock}
          label={t('company.sync.pendingChanges')}
          value={formatCount(snapshot?.pendingCount)}
        />
        <SyncKpi
          icon={RotateCw}
          label={t('company.sync.retrying')}
          value={formatCount(snapshot?.retryingCount)}
        />
        <SyncKpi
          icon={XCircle}
          label={t('company.sync.failures')}
          value={formatCount(snapshot?.failedCount)}
          alarming={(snapshot?.failedCount ?? 0) > 0}
        />
        <SyncKpi
          icon={AlertTriangle}
          label={t('company.sync.conflicts')}
          value={formatCount(snapshot?.conflictsCount)}
          alarming={(snapshot?.conflictsCount ?? 0) > 0}
        />
        <SyncKpi
          icon={RefreshCw}
          label={t('company.sync.lastSync')}
          value={
            snapshot?.lastSyncAt ? formatDateTime(snapshot.lastSyncAt) : t('company.sync.notYet')
          }
          mono
        />
      </div>

      {snapshot && snapshot.pendingCount > 0 && (
        <div className="surface-panel-muted text-sm text-secondary-700">
          <span className="font-medium text-secondary-900">{t('company.sync.oldestQueued')}</span>{' '}
          {snapshot.oldestPendingAt
            ? formatDateTime(snapshot.oldestPendingAt)
            : t('company.sync.unknown')}
          {snapshot.failedCount > 0 && (
            <>
              {' · '}
              <span className="font-medium text-warning-800">
                {t('company.sync.failedItems', { count: snapshot.failedCount })}
              </span>
            </>
          )}
        </div>
      )}

      <CompanySyncActions
        isRefreshing={isRefreshing}
        isPulling={pullMutation.isPending}
        isPushing={pushMutation.isPending}
        canProcessQueue={(snapshot?.pendingCount ?? 0) > 0}
        onPullSnapshot={() => {
          void pullMutation.mutateAsync();
        }}
        onRefreshView={() => {
          void refreshSyncSnapshot();
        }}
        onProcessQueue={() => {
          void pushMutation.mutateAsync();
        }}
      />

      <CompanySyncQueuePreview isLoading={snapshotQuery.isLoading} items={queueItems} />
      <CompanySyncConflictPreview
        isLoading={snapshotQuery.isLoading}
        conflicts={conflicts}
        isResolving={resolveMutation.isPending}
        onOpenResolution={setPendingResolution}
      />

      <CompanySyncConflictModal
        pendingResolution={pendingResolution?.resolution === 'merged' ? null : pendingResolution}
        isLoading={resolveMutation.isPending}
        onClose={() => setPendingResolution(null)}
        onConfirm={() => {
          if (!pendingResolution) return;
          void resolveMutation.mutateAsync({
            id: pendingResolution.id,
            resolution: pendingResolution.resolution,
            localRecordExists: pendingResolution.localRecordExists,
          });
        }}
      />
      <CompanySyncMergeModal
        pendingResolution={pendingResolution?.resolution === 'merged' ? pendingResolution : null}
        isLoading={resolveMutation.isPending}
        onClose={() => setPendingResolution(null)}
        onConfirm={mergedData => {
          if (!pendingResolution) return;
          void resolveMutation.mutateAsync({
            id: pendingResolution.id,
            resolution: 'merged',
            mergedData,
            localRecordExists: pendingResolution.localRecordExists,
          });
        }}
      />
    </section>
  );
}
