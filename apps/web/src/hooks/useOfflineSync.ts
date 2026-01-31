import { useState, useEffect, useCallback } from 'react';
import { isOnline } from '@/lib/utils';

interface SyncStatus {
  isOnline: boolean;
  lastSync: Date | null;
  pendingItems: number;
  isSyncing: boolean;
  error: string | null;
}

export function useOfflineSync() {
  const [status, setStatus] = useState<SyncStatus>({
    isOnline: isOnline(),
    lastSync: null,
    pendingItems: 0,
    isSyncing: false,
    error: null,
  });

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
  const isElectron = typeof window !== 'undefined' && window.api;

  // Get sync status from Electron
  const refreshStatus = useCallback(async () => {
    if (isElectron) {
      try {
        const syncStatus = await window.api.sync.getStatus();
        setStatus(prev => ({
          ...prev,
          isOnline: syncStatus.isOnline,
          lastSync: syncStatus.lastSync ? new Date(syncStatus.lastSync) : null,
          pendingItems: syncStatus.pendingItems,
        }));
      } catch (error) {
        console.error('Failed to get sync status:', error);
      }
    }
  }, [isElectron]);

  // Trigger sync
  const triggerSync = useCallback(async () => {
    if (!isElectron) {
      // Web: use API client
      // TODO: Implement web sync
      return;
    }

    setStatus(prev => ({ ...prev, isSyncing: true, error: null }));

    try {
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
        error: error instanceof Error ? error.message : 'Sync failed',
      }));
    }
  }, [isElectron, refreshStatus]);

  // Initial status fetch
  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // Auto-sync when coming online
  useEffect(() => {
    if (status.isOnline && status.pendingItems > 0 && !status.isSyncing) {
      triggerSync();
    }
  }, [status.isOnline, status.pendingItems, status.isSyncing, triggerSync]);

  return {
    ...status,
    triggerSync,
    refreshStatus,
  };
}

// Hook to check if offline mode is available
export function useOfflineCapability() {
  const [hasCapability, setHasCapability] = useState(false);

  useEffect(() => {
    // Check for Electron API or IndexedDB support
    const isElectron = typeof window !== 'undefined' && window.api;
    const hasIndexedDB = typeof indexedDB !== 'undefined';
    setHasCapability(isElectron || hasIndexedDB);
  }, []);

  return hasCapability;
}
