import { useState, useEffect, useCallback, useContext } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  extractDesktopIpcSessionErrorCode,
  translateServerError,
} from '@/lib/translateServerError';
import { vanillaClient } from '@/lib/trpc';
import { getErrorMessage, isOnline } from '@/lib/utils';
import { AuthContext } from '@/features/auth/AuthContext';
import { getStoredAuthTenantId } from '@/features/auth/authStorage';
import { canAccessRole, salesRoles } from '@/features/auth/roleAccess';

/** Local sync presentation; an error blocks automatic pushes without discarding queue counts. */
interface SyncStatus {
  isOnline: boolean;
  lastSync: Date | null;
  pendingItems: number;
  conflicts: number;
  isSyncing: boolean;
  error: string | null;
}

interface AutoSyncGate {
  lastAttemptAt: number;
  lastPending: number;
  delayMs: number;
}

interface OfflineSyncStoreEntry {
  key: string;
  tenantId: string | null;
  hasDesktopSync: boolean;
  status: SyncStatus;
  listeners: Set<(status: SyncStatus) => void>;
  canPushSubscribers: Set<symbol>;
  intervalId: number | null;
  autoSyncTimeoutId: number | null;
  initialFetchScheduled: boolean;
  inFlightSync: Promise<void> | null;
  inFlightRefresh: Promise<void> | null;
  autoSyncGate: AutoSyncGate;
  translate: TFunction;
  handleOnline: () => void;
  handleOffline: () => void;
}

// One ref-counted store per (tenantId, transport) coalesces GlobalStatusStrip,
// SyncConflictsPill, and OfflineSyncQueueList onto a single 5 s poll and single push flight.
const offlineSyncStores = new Map<string, OfflineSyncStoreEntry>();

function createInitialStatus(): SyncStatus {
  return {
    isOnline: isOnline(),
    lastSync: null,
    pendingItems: 0,
    conflicts: 0,
    isSyncing: false,
    error: null,
  };
}

function updateStoreStatus(
  entry: OfflineSyncStoreEntry,
  updater: (prev: SyncStatus) => SyncStatus
): void {
  const next = updater(entry.status);
  entry.status = next;
  for (const listener of entry.listeners) {
    listener(next);
  }
  scheduleAutoSync(entry);
}

function clearAutoSyncTimer(entry: OfflineSyncStoreEntry): void {
  if (entry.autoSyncTimeoutId !== null) {
    window.clearTimeout(entry.autoSyncTimeoutId);
    entry.autoSyncTimeoutId = null;
  }
}

async function refreshStoreStatus(entry: OfflineSyncStoreEntry): Promise<void> {
  if (entry.inFlightRefresh) return entry.inFlightRefresh;
  const run = (async () => {
    const online = isOnline();

    if (entry.hasDesktopSync && window.api) {
      try {
        // sync APIs derive tenantId from desktopSession.
        const syncStatus = await window.api.sync.getStatus();
        updateStoreStatus(entry, prev => ({
          ...prev,
          isOnline: online,
          lastSync: syncStatus.lastSync ? new Date(syncStatus.lastSync) : null,
          pendingItems: syncStatus.pendingItems,
          conflicts:
            'conflicts' in syncStatus && typeof syncStatus.conflicts === 'number'
              ? syncStatus.conflicts
              : prev.conflicts,
          error: null,
        }));
        return;
      } catch (error) {
        if (extractDesktopIpcSessionErrorCode(error)) {
          updateStoreStatus(entry, prev => ({
            ...prev,
            isOnline: online,
            error: translateServerError(error, entry.translate, entry.translate('server.unknown')),
          }));
          return;
        }
        console.error('Failed to get sync status:', error);
      }
    }

    try {
      const syncStatus = await vanillaClient.sync.status.query();
      updateStoreStatus(entry, prev => ({
        ...prev,
        isOnline: online,
        lastSync: syncStatus.lastSyncAt ? new Date(syncStatus.lastSyncAt) : null,
        pendingItems: syncStatus.pendingCount,
        conflicts: syncStatus.conflictsCount,
        error: null,
      }));
    } catch (error) {
      updateStoreStatus(entry, prev => ({
        ...prev,
        isOnline: online,
        error: online ? getErrorMessage(error, 'Unable to load sync status') : prev.error,
      }));
    }
  })().finally(() => {
    if (entry.inFlightRefresh === run) entry.inFlightRefresh = null;
  });
  entry.inFlightRefresh = run;
  return run;
}

async function triggerStoreSync(entry: OfflineSyncStoreEntry): Promise<void> {
  if (!entry.tenantId) {
    updateStoreStatus(entry, prev => ({
      ...prev,
      isSyncing: false,
      error: 'A tenant must be selected before syncing',
    }));
    return;
  }

  if (entry.inFlightSync) return entry.inFlightSync;

  const run = (async () => {
    if (!entry.hasDesktopSync || !window.api) {
      updateStoreStatus(entry, prev => ({ ...prev, isSyncing: true, error: null }));

      try {
        const result = await vanillaClient.sync.push.mutate({ limit: 50 });
        updateStoreStatus(entry, prev => ({
          ...prev,
          isSyncing: false,
          lastSync: result.lastSyncAt ? new Date(result.lastSyncAt) : prev.lastSync,
          pendingItems: result.pendingCount,
          conflicts: result.conflictsCount,
          error: result.success ? null : result.errors[0] || 'Sync failed',
        }));
      } catch (error) {
        updateStoreStatus(entry, prev => ({
          ...prev,
          isSyncing: false,
          error: getErrorMessage(error, 'Sync failed'),
        }));
      }
      return;
    }

    updateStoreStatus(entry, prev => ({ ...prev, isSyncing: true, error: null }));

    try {
      const result = await window.api.sync.triggerSync();
      updateStoreStatus(entry, prev => ({
        ...prev,
        isSyncing: false,
        lastSync: new Date(),
        error: result.success ? null : result.errors?.[0] || 'Sync failed',
      }));
      await refreshStoreStatus(entry);
    } catch (error) {
      updateStoreStatus(entry, prev => ({
        ...prev,
        isSyncing: false,
        error: extractDesktopIpcSessionErrorCode(error)
          ? translateServerError(error, entry.translate, entry.translate('server.unknown'))
          : getErrorMessage(error, 'Sync failed'),
      }));
    }
  })().finally(() => {
    if (entry.inFlightSync === run) entry.inFlightSync = null;
  });

  entry.inFlightSync = run;
  return run;
}

function scheduleAutoSync(entry: OfflineSyncStoreEntry): void {
  clearAutoSyncTimer(entry);
  const { status } = entry;
  const canPush = entry.canPushSubscribers.size > 0;
  if (!(
    entry.tenantId &&
    canPush &&
    status.isOnline &&
    status.pendingItems > 0 &&
    status.conflicts === 0 &&
    !status.isSyncing &&
    !status.error
  )) {
    return;
  }

  const gate = entry.autoSyncGate;
  const now = Date.now();
  const madeProgress = gate.lastPending === -1 || status.pendingItems < gate.lastPending;
  if (madeProgress) {
    gate.delayMs = 5_000;
  }
  const waitMs = madeProgress ? 0 : Math.max(0, gate.lastAttemptAt + gate.delayMs - now);
  entry.autoSyncTimeoutId = window.setTimeout(() => {
    entry.autoSyncTimeoutId = null;
    if (!offlineSyncStores.has(entry.key)) return;
    const g = entry.autoSyncGate;
    g.lastAttemptAt = Date.now();
    g.lastPending = entry.status.pendingItems;
    if (!madeProgress) {
      g.delayMs = Math.min(g.delayMs * 2, 300_000);
    }
    void triggerStoreSync(entry);
  }, waitMs);
}

function getOrCreateStore(
  tenantId: string | null,
  hasDesktopSync: boolean,
  translate: TFunction
): OfflineSyncStoreEntry {
  const key = `${tenantId ?? ''}|${hasDesktopSync ? 'desktop' : 'web'}`;
  const entry = offlineSyncStores.get(key);
  if (entry) {
    entry.translate = translate;
    return entry;
  }

  const created: OfflineSyncStoreEntry = {
    key,
    tenantId,
    hasDesktopSync,
    status: createInitialStatus(),
    listeners: new Set(),
    canPushSubscribers: new Set(),
    intervalId: null,
    autoSyncTimeoutId: null,
    initialFetchScheduled: false,
    inFlightSync: null,
    inFlightRefresh: null,
    autoSyncGate: {
      lastAttemptAt: 0,
      lastPending: -1,
      delayMs: 5_000,
    },
    translate,
    handleOnline: () => {
      updateStoreStatus(created, prev => ({ ...prev, isOnline: true }));
    },
    handleOffline: () => {
      updateStoreStatus(created, prev => ({ ...prev, isOnline: false }));
    },
  };

  window.addEventListener('online', created.handleOnline);
  window.addEventListener('offline', created.handleOffline);

  if (hasDesktopSync && tenantId) {
    created.intervalId = window.setInterval(() => {
      void refreshStoreStatus(created);
    }, 5_000);
  }

  offlineSyncStores.set(key, created);
  return created;
}

function releaseStoreIfUnused(entry: OfflineSyncStoreEntry): void {
  if (entry.listeners.size > 0) return;
  window.removeEventListener('online', entry.handleOnline);
  window.removeEventListener('offline', entry.handleOffline);
  if (entry.intervalId !== null) {
    window.clearInterval(entry.intervalId);
    entry.intervalId = null;
  }
  clearAutoSyncTimer(entry);
  offlineSyncStores.delete(entry.key);
}

export function useOfflineSync() {
  const { t } = useTranslation('errors');
  const hasDesktopSync = typeof window !== 'undefined' && Boolean(window.api?.sync);
  const tenantId = getStoredAuthTenantId();
  // sync.push is limited to sales roles; a viewer only reads the status.
  const role = useContext(AuthContext)?.user?.role;
  const canPush = role === undefined || canAccessRole(role, salesRoles);

  const storeKey = `${tenantId ?? ''}|${hasDesktopSync ? 'desktop' : 'web'}`;
  const [status, setStatus] = useState<SyncStatus>(
    () => offlineSyncStores.get(storeKey)?.status ?? createInitialStatus()
  );

  useEffect(() => {
    const token = Symbol('offline-sync-subscriber');
    const entry = getOrCreateStore(tenantId, hasDesktopSync, t);
    entry.listeners.add(setStatus);
    if (canPush) {
      entry.canPushSubscribers.add(token);
    }
    scheduleAutoSync(entry);

    let cancelled = false;
    if (!entry.initialFetchScheduled) {
      entry.initialFetchScheduled = true;
      queueMicrotask(() => {
        if (!cancelled && offlineSyncStores.get(entry.key) === entry) {
          void refreshStoreStatus(entry);
        }
      });
    }

    return () => {
      cancelled = true;
      entry.listeners.delete(setStatus);
      entry.canPushSubscribers.delete(token);
      if (entry.listeners.size > 0) {
        scheduleAutoSync(entry);
      } else {
        releaseStoreIfUnused(entry);
      }
    };
  }, [canPush, hasDesktopSync, t, tenantId]);

  const refreshStatus = useCallback(async () => {
    const entry = getOrCreateStore(tenantId, hasDesktopSync, t);
    try {
      await refreshStoreStatus(entry);
    } finally {
      releaseStoreIfUnused(entry);
    }
  }, [hasDesktopSync, t, tenantId]);

  const triggerSync = useCallback(async () => {
    const entry = getOrCreateStore(tenantId, hasDesktopSync, t);
    try {
      await triggerStoreSync(entry);
    } finally {
      releaseStoreIfUnused(entry);
    }
  }, [hasDesktopSync, t, tenantId]);

  return {
    ...status,
    canPush,
    triggerSync,
    refreshStatus,
  };
}
