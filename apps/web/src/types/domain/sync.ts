// sync (offline buffer + conflict) domain shapes ( slice 28).

// Sync Types

export interface SyncQueueItem {
  id: string;
  entityType: string;
  entityId: string;
  operation: 'create' | 'update' | 'delete';
  payload: Record<string, unknown>;
  tenantId: string;
  createdAt: string;
  retryCount: number;
  /**
   * Either a plain message (legacy IndexedDB offline buffer) or a
   * `NormalizedOutboxError` JSON object (server `sync_outbox` rows
   * via `sync.pull` / `sync.listQueue`). The renderer formats both
   * shapes — see `normalizeSyncLastError` in
   * `apps/web/src/features/company/companySyncDisplay.ts`.
   */
  lastError?: string | Record<string, unknown> | null | undefined;
}

export interface SyncConflict {
  id: string;
  entityType: string;
  entityId: string;
  localData: Record<string, unknown>;
  remoteData: Record<string, unknown>;
  localRecordExists?: boolean | null;
  resolution?: 'local_wins' | 'remote_wins' | 'merged';
  resolvedAt?: string;
  tenantId: string;
}
