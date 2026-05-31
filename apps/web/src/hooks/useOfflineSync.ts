import { useState, useEffect, useCallback } from 'react';
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
        // ENG-025 — sync APIs derive tenantId from desktopSession.
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
    if (hasDesktopSync && !tenantId) {
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
      // ENG-025 — sync APIs derive tenantId from desktopSession.
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

  // Auto-sync when coming online
  useEffect(() => {
    if (status.isOnline && status.pendingItems > 0 && !status.isSyncing && !status.error) {
      void triggerSync();
    }
  }, [status.isOnline, status.pendingItems, status.isSyncing, status.error, triggerSync]);

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
