/**
 * React context provider for offline storage
 * Provides storage methods to the component tree
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import type { SyncQueueItem } from '@/types';
import { offlineStorage, isElectron, type StoreName, type StoreTypeMap } from './offlineStorage';
import { STORE_NAMES } from './indexedDB';
import {
  getQueuedOperations,
  getPendingCount,
  markAsSynced,
  retryFailed,
  clearFailedOperations,
} from './syncQueue';

// Storage context state
interface StorageState {
  isInitialized: boolean;
  isInitializing: boolean;
  error: string | null;
  tenantId: string | null;
  pendingSyncCount: number;
  isElectron: boolean;
}

// Storage context methods
interface StorageMethods {
  // Core CRUD operations
  getAll: <K extends keyof StoreTypeMap>(storeName: K) => Promise<StoreTypeMap[K][]>;
  getById: <K extends keyof StoreTypeMap>(
    storeName: K,
    id: string
  ) => Promise<StoreTypeMap[K] | undefined>;
  save: <K extends keyof StoreTypeMap>(
    storeName: K,
    data: Partial<StoreTypeMap[K]> & { id?: string },
    options?: { skipSync?: boolean }
  ) => Promise<StoreTypeMap[K]>;
  deleteRecord: (
    storeName: StoreName,
    id: string,
    options?: { skipSync?: boolean }
  ) => Promise<void>;
  query: <K extends keyof StoreTypeMap>(
    storeName: K,
    indexName: string,
    value: IDBValidKey
  ) => Promise<StoreTypeMap[K][]>;
  bulkSave: <K extends keyof StoreTypeMap>(
    storeName: K,
    items: Array<Partial<StoreTypeMap[K]> & { id?: string }>,
    options?: { skipSync?: boolean }
  ) => Promise<StoreTypeMap[K][]>;

  // Tenant management
  setTenantId: (tenantId: string) => void;

  // Sync queue management
  getPendingSyncItems: () => Promise<SyncQueueItem[]>;
  markItemsSynced: (operationIds: string[]) => Promise<void>;
  retryFailedItems: () => Promise<SyncQueueItem[]>;
  clearFailed: () => Promise<void>;
  refreshPendingCount: () => Promise<void>;

  // Utility methods
  clearTenantData: () => Promise<void>;
  count: (storeName: StoreName) => Promise<number>;
}

// Combined context value
interface StorageContextValue extends StorageState, StorageMethods {}

// Default context value
const defaultContextValue: StorageContextValue = {
  isInitialized: false,
  isInitializing: false,
  error: null,
  tenantId: null,
  pendingSyncCount: 0,
  isElectron: false,
  getAll: async () => [],
  getById: async () => undefined,
  save: async () => {
    throw new Error('Storage not initialized');
  },
  deleteRecord: async () => {},
  query: async () => [],
  bulkSave: async () => [],
  setTenantId: () => {},
  getPendingSyncItems: async () => [],
  markItemsSynced: async () => {},
  retryFailedItems: async () => [],
  clearFailed: async () => {},
  refreshPendingCount: async () => {},
  clearTenantData: async () => {},
  count: async () => 0,
};

// Create context
const StorageContext = createContext<StorageContextValue>(defaultContextValue);

// Provider props
interface StorageProviderProps {
  children: ReactNode;
  tenantId?: string;
  onInitialized?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Storage provider component
 * Initializes storage and provides methods via context
 */
export function StorageProvider({
  children,
  tenantId: initialTenantId,
  onInitialized,
  onError,
}: StorageProviderProps) {
  const [state, setState] = useState<StorageState>({
    isInitialized: false,
    isInitializing: true,
    error: null,
    tenantId: initialTenantId || null,
    pendingSyncCount: 0,
    isElectron: isElectron(),
  });

  const refreshPendingCountFor = useCallback(
    async (
      tenantIdOverride?: string | null,
      { force = false }: { force?: boolean } = {}
    ) => {
      const tenantId = tenantIdOverride ?? state.tenantId;

      if (!tenantId) return;
      if (!force && !state.isInitialized) return;

      try {
        const count = state.isElectron
          ? (await window.api!.sync.getStatus(tenantId)).pendingItems
          : await getPendingCount(tenantId);

        setState(prev => ({ ...prev, pendingSyncCount: count }));
      } catch (error) {
        console.error('Failed to refresh pending count:', error);
      }
    },
    [state.isElectron, state.isInitialized, state.tenantId]
  );

  const refreshPendingCount = useCallback(
    () => refreshPendingCountFor(),
    [refreshPendingCountFor]
  );

  // Initialize storage on mount
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        await offlineStorage.initialize();

        if (initialTenantId) {
          offlineStorage.setTenantId(initialTenantId);
        }

        if (mounted) {
          setState(prev => ({
            ...prev,
            isInitialized: true,
            isInitializing: false,
          }));
          void refreshPendingCountFor(initialTenantId ?? null, { force: true });
          onInitialized?.();
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to initialize storage';
        if (mounted) {
          setState(prev => ({
            ...prev,
            isInitializing: false,
            error: errorMessage,
          }));
          onError?.(error instanceof Error ? error : new Error(errorMessage));
        }
      }
    }

    init();

    return () => {
      mounted = false;
    };
  }, [initialTenantId, onInitialized, onError, refreshPendingCountFor]);

  // Set tenant ID
  const setTenantId = useCallback(
    (tenantId: string) => {
      offlineStorage.setTenantId(tenantId);
      setState(prev => ({ ...prev, tenantId }));
      void refreshPendingCountFor(tenantId, { force: true });
    },
    [refreshPendingCountFor]
  );

  // Core CRUD methods
  const getAll = useCallback(
    async <K extends keyof StoreTypeMap>(storeName: K) => {
      if (!state.isInitialized) {
        throw new Error('Storage not initialized');
      }
      return offlineStorage.getAll(storeName);
    },
    [state.isInitialized]
  );

  const getById = useCallback(
    async <K extends keyof StoreTypeMap>(storeName: K, id: string) => {
      if (!state.isInitialized) {
        throw new Error('Storage not initialized');
      }
      return offlineStorage.getById(storeName, id);
    },
    [state.isInitialized]
  );

  const save = useCallback(
    async <K extends keyof StoreTypeMap>(
      storeName: K,
      data: Partial<StoreTypeMap[K]> & { id?: string },
      options?: { skipSync?: boolean }
    ) => {
      if (!state.isInitialized) {
        throw new Error('Storage not initialized');
      }
      const result = await offlineStorage.save(storeName, data, options);
      // Update pending count after save
      if (!options?.skipSync) {
        await refreshPendingCount();
      }
      return result;
    },
    [state.isInitialized, refreshPendingCount]
  );

  const deleteRecordFn = useCallback(
    async (storeName: StoreName, id: string, options?: { skipSync?: boolean }) => {
      if (!state.isInitialized) {
        throw new Error('Storage not initialized');
      }
      await offlineStorage.delete(storeName, id, options);
      // Update pending count after delete
      if (!options?.skipSync) {
        await refreshPendingCount();
      }
    },
    [state.isInitialized, refreshPendingCount]
  );

  const query = useCallback(
    async <K extends keyof StoreTypeMap>(storeName: K, indexName: string, value: IDBValidKey) => {
      if (!state.isInitialized) {
        throw new Error('Storage not initialized');
      }
      return offlineStorage.query(storeName, indexName, value);
    },
    [state.isInitialized]
  );

  const bulkSave = useCallback(
    async <K extends keyof StoreTypeMap>(
      storeName: K,
      items: Array<Partial<StoreTypeMap[K]> & { id?: string }>,
      options?: { skipSync?: boolean }
    ) => {
      if (!state.isInitialized) {
        throw new Error('Storage not initialized');
      }
      const results = await offlineStorage.bulkSave(storeName, items, options);
      // Update pending count after bulk save
      if (!options?.skipSync) {
        await refreshPendingCount();
      }
      return results;
    },
    [state.isInitialized, refreshPendingCount]
  );

  // Sync queue methods
  const getPendingSyncItems = useCallback(async () => {
    if (!state.tenantId) return [];

    if (state.isElectron) {
      return (await window.api!.db.getPendingSyncItems(state.tenantId)) as SyncQueueItem[];
    }

    return getQueuedOperations(state.tenantId);
  }, [state.tenantId, state.isElectron]);

  const markItemsSynced = useCallback(
    async (operationIds: string[]) => {
      if (state.isElectron) {
        // Electron handles sync internally
        return;
      }
      await markAsSynced(operationIds);
      await refreshPendingCount();
    },
    [state.isElectron, refreshPendingCount]
  );

  const retryFailedItems = useCallback(async () => {
    if (!state.tenantId) return [];

    if (state.isElectron) {
      // Electron handles retry internally via triggerSync
      await window.api!.sync.triggerSync(state.tenantId);
      return [];
    }

    return retryFailed(state.tenantId);
  }, [state.tenantId, state.isElectron]);

  const clearFailed = useCallback(async () => {
    if (!state.tenantId) return;

    if (!state.isElectron) {
      await clearFailedOperations(state.tenantId);
      await refreshPendingCount();
    }
  }, [state.tenantId, state.isElectron, refreshPendingCount]);

  const clearTenantData = useCallback(async () => {
    if (!state.isInitialized) {
      throw new Error('Storage not initialized');
    }
    await offlineStorage.clearTenantData();
    await refreshPendingCount();
  }, [state.isInitialized, refreshPendingCount]);

  const count = useCallback(
    async (storeName: StoreName) => {
      if (!state.isInitialized) {
        throw new Error('Storage not initialized');
      }
      return offlineStorage.count(storeName);
    },
    [state.isInitialized]
  );

  // Memoize context value
  const contextValue = useMemo<StorageContextValue>(
    () => ({
      ...state,
      getAll,
      getById,
      save,
      deleteRecord: deleteRecordFn,
      query,
      bulkSave,
      setTenantId,
      getPendingSyncItems,
      markItemsSynced,
      retryFailedItems,
      clearFailed,
      refreshPendingCount,
      clearTenantData,
      count,
    }),
    [
      state,
      getAll,
      getById,
      save,
      deleteRecordFn,
      query,
      bulkSave,
      setTenantId,
      getPendingSyncItems,
      markItemsSynced,
      retryFailedItems,
      clearFailed,
      refreshPendingCount,
      clearTenantData,
      count,
    ]
  );

  return <StorageContext.Provider value={contextValue}>{children}</StorageContext.Provider>;
}

/**
 * Hook to access storage context
 */
export function useStorage(): StorageContextValue {
  const context = useContext(StorageContext);

  if (!context) {
    throw new Error('useStorage must be used within a StorageProvider');
  }

  return context;
}

/**
 * Hook to check if storage is ready
 */
export function useStorageReady(): boolean {
  const { isInitialized, isInitializing, error } = useStorage();
  return isInitialized && !isInitializing && !error;
}

/**
 * Hook to get pending sync count
 */
export function usePendingSyncCount(): number {
  const { pendingSyncCount } = useStorage();
  return pendingSyncCount;
}

// Export store names for convenience
export { STORE_NAMES };
