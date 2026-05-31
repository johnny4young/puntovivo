import { useQuery } from '@tanstack/react-query';
import { vanillaClient } from '@/lib/trpc';

/**
 * Shared sync-snapshot reader for the two §09 sync surfaces:
 *   - write-side `CompanySyncCard` (Configuración → Empresa → Data),
 *   - read-only `operations/SyncHealthPanel` (Operations Center → Sync).
 *
 * Both poll `sync.pull` (the "read-only mirror of sync.status plus the actual
 * row payloads") on the same 30s cadence and key the cache by the requested
 * preview limits so the two surfaces share a cache entry when their limits
 * match. This hook centralizes the query + cache-key derivation only; the
 * write actions (push / pull / resolve mutations and their modals) stay in
 * `CompanySyncCard`, and the per-conflict field diff is computed at render via
 * `computeConflictDiff` from `companySyncDisplay`.
 */

/** Snapshot payload returned by `sync.pull` (inferred end-to-end from tRPC). */
export type SyncSnapshot = Awaited<ReturnType<typeof vanillaClient.sync.pull.query>>;

export type SyncSnapshotConflict = SyncSnapshot['conflicts'][number];
export type SyncSnapshotQueueItem = SyncSnapshot['queue'][number];

export type SyncSnapshotQueryKey = readonly ['sync', 'snapshot', number, number];

/** The cache key shared by every snapshot reader for a given limit pair. */
export function syncSnapshotQueryKey(
  queueLimit: number,
  conflictLimit: number
): SyncSnapshotQueryKey {
  return ['sync', 'snapshot', queueLimit, conflictLimit] as const;
}

interface UseSyncSnapshotOptions {
  queueLimit: number;
  conflictLimit: number;
  /** Background poll cadence in ms. Both surfaces use 30s today. */
  refetchInterval?: number;
  /** Optional cache freshness window (the read-only panel sets this). */
  staleTime?: number;
}

/**
 * Read the sync snapshot and expose the derived queue + conflict lists.
 *
 * Returns the raw TanStack query (for `isLoading` / `error` / `isRefetching`
 * and on-demand refetch / cache writes by the caller) plus the resolved
 * `snapshot`, `queueItems` and `conflicts` with the same `?? []` fallbacks
 * both surfaces applied inline before the dedup.
 */
export function useSyncSnapshot({
  queueLimit,
  conflictLimit,
  refetchInterval = 30_000,
  staleTime,
}: UseSyncSnapshotOptions) {
  const queryKey = syncSnapshotQueryKey(queueLimit, conflictLimit);

  const snapshotQuery = useQuery({
    queryKey,
    queryFn: () =>
      vanillaClient.sync.pull.query({
        queueLimit,
        conflictLimit,
      }),
    refetchInterval,
    ...(staleTime !== undefined ? { staleTime } : {}),
  });

  const snapshot = snapshotQuery.data;
  const queueItems = snapshot?.queue ?? [];
  const conflicts = snapshot?.conflicts ?? [];

  return { snapshotQuery, queryKey, snapshot, queueItems, conflicts };
}
