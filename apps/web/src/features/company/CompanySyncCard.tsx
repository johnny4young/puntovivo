import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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
import { formatDateTime, getErrorMessage } from '@/lib/utils';

const syncSnapshotQueryKey = ['sync', 'snapshot', 5, 5] as const;
const syncPreviewLimit = 5;

interface SyncMetricProps {
  label: string;
  value: string | number;
}

function SyncMetric({ label, value }: SyncMetricProps) {
  return (
    <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
      <p className="text-xs uppercase tracking-wide text-secondary-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-secondary-900">{value}</p>
    </div>
  );
}

export function CompanySyncCard() {
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
          title: 'Sync completed with issues',
          description: result.errors[0],
        });
        return;
      }

      toast.success({
        title:
          result.synced > 0
            ? `Processed ${result.synced} queued change${result.synced === 1 ? '' : 's'}`
            : 'Sync is already up to date',
      });
    },
    onError: error => {
      toast.error({
        title: 'Unable to process sync queue',
        description: getErrorMessage(error, 'Unable to process sync queue'),
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
      toast.success({ title: 'Sync snapshot refreshed' });
    },
    onError: error => {
      toast.error({
        title: 'Unable to pull sync snapshot',
        description: getErrorMessage(error, 'Unable to pull sync snapshot'),
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
    }) => vanillaClient.sync.resolve.mutate({ id, resolution, mergedData }),
    onSuccess: async (_result, variables) => {
      await refreshSyncSnapshot();
      setPendingResolution(null);
      toast.success({
        title:
          variables.resolution === 'local_wins'
            ? 'Conflict kept local changes'
            : variables.resolution === 'remote_wins'
              ? 'Conflict accepted remote changes'
              : 'Conflict merged successfully',
      });
    },
    onError: error => {
      toast.error({
        title: 'Unable to resolve conflict',
        description: getErrorMessage(error, 'Unable to resolve conflict'),
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
          <h2 className="text-lg font-semibold text-secondary-900">Sync Center</h2>
          <p className="text-sm text-secondary-500">
            Review queued changes, process the local sync queue, and resolve conflicts when a sync
            item needs manual attention.
          </p>
        </div>
      </div>

      {snapshotQuery.error && <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">{snapshotQuery.error.message}</div>}

      <div className="grid gap-4 md:grid-cols-3">
        <SyncMetric label="Pending Changes" value={snapshot?.pendingCount ?? '...'} />
        <SyncMetric label="Conflicts" value={snapshot?.conflictsCount ?? '...'} />
        <SyncMetric label="Last Sync" value={snapshot?.lastSyncAt ? formatDateTime(snapshot.lastSyncAt) : 'Not yet'} />
      </div>

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
          });
        }}
      />
    </section>
  );
}
