import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CloudUpload } from 'lucide-react';
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
import { vanillaClient } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { formatDateTime } from '@/lib/utils';

const syncSnapshotQueryKey = ['sync', 'snapshot', 5, 5] as const;
const syncPreviewLimit = 5;

interface SyncMetricProps {
  label: string;
  value: string | number;
}

function SyncMetric({ label, value }: SyncMetricProps) {
  return (
    <div className="surface-panel-muted">
      <p className="text-xs uppercase tracking-wide text-secondary-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-secondary-900">{value}</p>
    </div>
  );
}

export function CompanySyncCard() {
  const { t } = useTranslation('settings');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [pendingResolution, setPendingResolution] = useState<PendingResolution | null>(null);
  const snapshotQuery = useQuery({
    queryKey: syncSnapshotQueryKey,
    queryFn: () =>
      vanillaClient.sync.pull.query({
        queueLimit: syncPreviewLimit,
        conflictLimit: syncPreviewLimit,
      }),
    refetchInterval: 30_000,
  });

  const refreshSyncSnapshot = async () => {
    await queryClient.invalidateQueries({ queryKey: ['sync', 'snapshot'] });
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
    onError: error => {
      toast.error({
        title: t('company.sync.toast.queueError'),
        description: translateServerError(error, t, t('errors:server.unknown')),
      });
    },
  });
  const pullMutation = useMutation({
    mutationFn: () =>
      vanillaClient.sync.pull.query({
        queueLimit: syncPreviewLimit,
        conflictLimit: syncPreviewLimit,
      }),
    onSuccess: snapshot => {
      queryClient.setQueryData(syncSnapshotQueryKey, snapshot);
      toast.success({ title: t('company.sync.toast.snapshotRefreshed') });
    },
    onError: error => {
      toast.error({
        title: t('company.sync.toast.snapshotError'),
        description: translateServerError(error, t, t('errors:server.unknown')),
      });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: ({
      id,
      resolution,
      mergedData,
    }: {
      id: string;
      resolution: ConflictResolution;
      mergedData?: Record<string, unknown>;
      localRecordExists?: boolean | null;
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
    onError: error => {
      toast.error({
        title: t('company.sync.toast.conflictError'),
        description: translateServerError(error, t, t('errors:server.unknown')),
      });
    },
  });

  const snapshot = snapshotQuery.data;
  const queueItems = snapshot?.queue ?? [];
  const conflicts = snapshot?.conflicts ?? [];
  const isRefreshing = snapshotQuery.isRefetching || pullMutation.isPending;

  return (
    <section className="card p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100">
          <CloudUpload className="h-5 w-5 text-primary-700" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-secondary-900">{t('company.sync.title')}</h2>
          <p className="text-sm text-secondary-500">
            {t('company.sync.description')}
          </p>
        </div>
      </div>

      {snapshotQuery.error && (
        <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          {translateServerError(snapshotQuery.error, t, t('errors:server.unknown'))}
        </div>
      )}

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
        <SyncMetric label={t('company.sync.pendingChanges')} value={snapshot?.pendingCount ?? '...'} />
        <SyncMetric label={t('company.sync.retrying')} value={snapshot?.retryingCount ?? '...'} />
        <SyncMetric label={t('company.sync.failures')} value={snapshot?.failedCount ?? '...'} />
        <SyncMetric label={t('company.sync.conflicts')} value={snapshot?.conflictsCount ?? '...'} />
        <SyncMetric label={t('company.sync.lastSync')} value={snapshot?.lastSyncAt ? formatDateTime(snapshot.lastSyncAt) : t('company.sync.notYet')} />
      </div>

      {snapshot && snapshot.pendingCount > 0 && (
        <div className="surface-panel-muted text-sm text-secondary-700">
          <span className="font-medium text-secondary-900">{t('company.sync.oldestQueued')}</span>{' '}
          {snapshot.oldestPendingAt ? formatDateTime(snapshot.oldestPendingAt) : t('company.sync.unknown')}
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
