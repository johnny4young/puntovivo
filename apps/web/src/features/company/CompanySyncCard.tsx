import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CloudUpload, RefreshCw } from 'lucide-react';
import { useToast } from '@/components/feedback/ToastProvider';
import { vanillaClient } from '@/lib/trpc';
import { formatDateTime, getErrorMessage } from '@/lib/utils';

const syncStatusQueryKey = ['sync', 'status'] as const;
const syncQueueQueryKey = ['sync', 'queue', 5] as const;
const syncConflictsQueryKey = ['sync', 'conflicts', 5] as const;

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
  const statusQuery = useQuery({
    queryKey: syncStatusQueryKey,
    queryFn: () => vanillaClient.sync.status.query(),
    refetchInterval: 30_000,
  });
  const queueQuery = useQuery({
    queryKey: syncQueueQueryKey,
    queryFn: () => vanillaClient.sync.listQueue.query({ limit: 5 }),
    refetchInterval: 30_000,
  });
  const conflictsQuery = useQuery({
    queryKey: syncConflictsQueryKey,
    queryFn: () => vanillaClient.sync.listConflicts.query({ limit: 5 }),
    refetchInterval: 30_000,
  });

  const refreshSyncQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['sync', 'status'] }),
      queryClient.invalidateQueries({ queryKey: ['sync', 'queue'] }),
      queryClient.invalidateQueries({ queryKey: ['sync', 'conflicts'] }),
    ]);
  };

  const pushMutation = useMutation({
    mutationFn: () => vanillaClient.sync.push.mutate({ limit: 50 }),
    onSuccess: async result => {
      await refreshSyncQueries();

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

  const resolveMutation = useMutation({
    mutationFn: ({ id, resolution }: { id: string; resolution: 'local_wins' | 'remote_wins' }) =>
      vanillaClient.sync.resolve.mutate({ id, resolution }),
    onSuccess: async (_result, variables) => {
      await refreshSyncQueries();
      toast.success({
        title: variables.resolution === 'local_wins' ? 'Conflict kept local changes' : 'Conflict accepted remote changes',
      });
    },
    onError: error => {
      toast.error({
        title: 'Unable to resolve conflict',
        description: getErrorMessage(error, 'Unable to resolve conflict'),
      });
    },
  });

  const status = statusQuery.data;
  const queueItems = queueQuery.data?.items ?? [];
  const conflicts = conflictsQuery.data?.items ?? [];
  const isRefreshing =
    statusQuery.isRefetching || queueQuery.isRefetching || conflictsQuery.isRefetching;

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

      {statusQuery.error && (
        <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          {statusQuery.error.message}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <SyncMetric label="Pending Changes" value={status?.pendingCount ?? '...'} />
        <SyncMetric label="Conflicts" value={status?.conflictsCount ?? '...'} />
        <SyncMetric
          label="Last Sync"
          value={status?.lastSyncAt ? formatDateTime(status.lastSyncAt) : 'Not yet'}
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="btn-outline flex items-center gap-2"
          disabled={isRefreshing}
          onClick={() => {
            void refreshSyncQueries();
          }}
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
        <button
          type="button"
          className="btn-primary flex items-center gap-2"
          disabled={(status?.pendingCount ?? 0) === 0 || pushMutation.isPending}
          onClick={() => {
            void pushMutation.mutateAsync();
          }}
        >
          <CloudUpload className="h-4 w-4" />
          {pushMutation.isPending ? 'Processing...' : 'Process Queue'}
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-secondary-900">Pending Queue</h3>
          <p className="mt-1 text-sm text-secondary-500">
            Most recent queued operations waiting to be acknowledged as synced.
          </p>
        </div>

        {queueQuery.isLoading ? (
          <p className="text-sm text-secondary-500">Loading queued operations...</p>
        ) : queueItems.length === 0 ? (
          <p className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-3 text-sm text-secondary-600">
            No queued operations are pending.
          </p>
        ) : (
          <div className="space-y-3">
            {queueItems.map(item => (
              <div
                key={item.id}
                className="rounded-xl border border-secondary-200 bg-white px-4 py-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-secondary-100 px-2.5 py-1 text-xs font-medium text-secondary-700">
                    {item.entityType}
                  </span>
                  <span className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-medium uppercase text-primary-700">
                    {item.operation}
                  </span>
                </div>
                <p className="mt-3 text-sm text-secondary-700">Entity ID: {item.entityId}</p>
                <p className="mt-1 text-xs text-secondary-500">
                  Queued {formatDateTime(item.createdAt)}
                </p>
                {item.lastError && <p className="mt-2 text-sm text-danger-600">{item.lastError}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-secondary-900">Conflicts</h3>
          <p className="mt-1 text-sm text-secondary-500">
            Conflicts stop automatic sync for the affected entity until someone resolves them.
          </p>
        </div>

        {conflictsQuery.isLoading ? (
          <p className="text-sm text-secondary-500">Loading conflicts...</p>
        ) : conflicts.length === 0 ? (
          <p className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-3 text-sm text-secondary-600">
            No sync conflicts need review.
          </p>
        ) : (
          <div className="space-y-3">
            {conflicts.map(conflict => (
              <div
                key={conflict.id}
                className="rounded-xl border border-warning-500/30 bg-warning-50 px-4 py-4"
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 text-warning-700" />
                  <div className="flex-1 space-y-2">
                    <div>
                      <p className="text-sm font-medium text-secondary-900">
                        {conflict.entityType} · {conflict.entityId}
                      </p>
                      <p className="text-xs text-secondary-500">
                        Created {formatDateTime(conflict.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        className="btn-outline"
                        disabled={resolveMutation.isPending}
                        onClick={() => {
                          void resolveMutation.mutateAsync({
                            id: conflict.id,
                            resolution: 'local_wins',
                          });
                        }}
                      >
                        Keep Local
                      </button>
                      <button
                        type="button"
                        className="btn-outline"
                        disabled={resolveMutation.isPending}
                        onClick={() => {
                          void resolveMutation.mutateAsync({
                            id: conflict.id,
                            resolution: 'remote_wins',
                          });
                        }}
                      >
                        Accept Remote
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
