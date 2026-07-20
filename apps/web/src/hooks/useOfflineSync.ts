import { useState, useEffect, useCallback, useRef } from 'react';
import { vanillaClient } from '@/lib/trpc';
import { getErrorMessage, isOnline } from '@/lib/utils';
import { getStoredAuthTenantId } from '@/features/auth/authStorage';

interface SyncStatus {
  isOnline: boolean;
  lastSync: Date | null;
  pendingItems: number;
  conflicts: number;
  isSyncing: boolean;
  error: string | null;
}

export function useOfflineSync() {
  const [status, setStatus] = useState<SyncStatus>({
    isOnline: isOnline(),
    lastSync: null,
    pendingItems: 0,
    conflicts: 0,
    isSyncing: false,
    error: null,
  });
  const hasDesktopSync = typeof window !== 'undefined' && Boolean(window.api?.sync);
  const tenantId = getStoredAuthTenantId();

  // Listen for online/offline events
  useEffect(() => {
    const handleOnline = () => {
      setStatus(prev => ({ ...prev, isOnline: true }));
    };

    const handleOffline = () => {
      setStatus(prev => ({ ...prev, isOnline: false }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Check if we're in Electron
  const refreshStatus = useCallback(async () => {
    const online = isOnline();

    if (hasDesktopSync && window.api) {
      try {
        // sync APIs derive tenantId from desktopSession.
        const syncStatus = await window.api.sync.getStatus();
        setStatus(prev => ({
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
        console.error('Failed to get sync status:', error);
      }
    }

    try {
      const syncStatus = await vanillaClient.sync.status.query();
      setStatus(prev => ({
        ...prev,
        isOnline: online,
        lastSync: syncStatus.lastSyncAt ? new Date(syncStatus.lastSyncAt) : null,
        pendingItems: syncStatus.pendingCount,
        conflicts: syncStatus.conflictsCount,
        error: null,
      }));
    } catch (error) {
      setStatus(prev => ({
        ...prev,
        isOnline: online,
        error: online ? getErrorMessage(error, 'Unable to load sync status') : prev.error,
      }));
    }
  }, [hasDesktopSync]);

  // Trigger sync
  const triggerSync = useCallback(async () => {
    if (!tenantId) {
      setStatus(prev => ({
        ...prev,
        isSyncing: false,
        error: 'A tenant must be selected before syncing',
      }));
      return;
    }

    if (!hasDesktopSync || !window.api) {
      setStatus(prev => ({ ...prev, isSyncing: true, error: null }));

      try {
        const result = await vanillaClient.sync.push.mutate({ limit: 50 });
        setStatus(prev => ({
          ...prev,
          isSyncing: false,
          lastSync: result.lastSyncAt ? new Date(result.lastSyncAt) : prev.lastSync,
          pendingItems: result.pendingCount,
          conflicts: result.conflictsCount,
          error: result.success ? null : result.errors[0] || 'Sync failed',
        }));
      } catch (error) {
        setStatus(prev => ({
          ...prev,
          isSyncing: false,
          error: getErrorMessage(error, 'Sync failed'),
        }));
      }

      return;
    }

    setStatus(prev => ({ ...prev, isSyncing: true, error: null }));

    try {
      // sync APIs derive tenantId from desktopSession.
      const result = await window.api.sync.triggerSync();
      setStatus(prev => ({
        ...prev,
        isSyncing: false,
        lastSync: new Date(),
        error: result.success ? null : result.errors?.[0] || 'Sync failed',
      }));
      await refreshStatus();
    } catch (error) {
      setStatus(prev => ({
        ...prev,
        isSyncing: false,
        error: getErrorMessage(error, 'Sync failed'),
      }));
    }
  }, [hasDesktopSync, refreshStatus, tenantId]);

  // Initial status fetch
  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (!hasDesktopSync || !tenantId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshStatus();
    }, 5_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasDesktopSync, refreshStatus, tenantId]);

  // Auto-sync when coming online. A known conflict requires operator review,
  // so it must never keep issuing background pushes. Successive automatic triggers are
  // spaced with exponential backoff: on the web path a push can report
  // success while pendingCount stays > 0 (conflict rows, stalled batch),
  // and re-triggering on every state change would hammer the endpoint in
  // a tight loop bounded only by network latency. A push that reduces
  // pendingItems resets the backoff; one that leaves it unchanged widens
  // the next window (5s → 10s → ... → 5min cap).
  const autoSyncGateRef = useRef({
    lastAttemptAt: 0,
    lastPending: -1,
    delayMs: 5_000,
  });
  useEffect(() => {
    if (!(
      tenantId &&
      status.isOnline &&
      status.pendingItems > 0 &&
      status.conflicts === 0 &&
      !status.isSyncing &&
      !status.error
    )) {
      return;
    }
    const gate = autoSyncGateRef.current;
    const now = Date.now();
    const madeProgress = gate.lastPending === -1 || status.pendingItems < gate.lastPending;
    if (madeProgress) {
      gate.delayMs = 5_000;
    }
    const waitMs = madeProgress ? 0 : Math.max(0, gate.lastAttemptAt + gate.delayMs - now);
    const timeoutId = window.setTimeout(() => {
      const g = autoSyncGateRef.current;
      g.lastAttemptAt = Date.now();
      g.lastPending = status.pendingItems;
      if (!madeProgress) {
        g.delayMs = Math.min(g.delayMs * 2, 300_000);
      }
      void triggerSync();
    }, waitMs);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    tenantId,
    status.isOnline,
    status.pendingItems,
    status.conflicts,
    status.isSyncing,
    status.error,
    triggerSync,
  ]);

  return {
    ...status,
    triggerSync,
    refreshStatus,
  };
}

// Hook to check if offline mode is available
export function useOfflineCapability() {
  // Check for Electron API or IndexedDB support on first render
  const [hasCapability] = useState(() => {
    const isElectron = typeof window !== 'undefined' && Boolean(window.api?.sync);
    const hasIndexedDB = typeof indexedDB !== 'undefined';
    return Boolean(isElectron) || hasIndexedDB;
  });

  return hasCapability;
}
