/**
 * Storage module exports
 * Provides offline storage capabilities for both browser (IndexedDB) and Electron (SQLite)
 */

// IndexedDB wrapper
export {
  initDatabase,
  getAll,
  getById,
  put,
  deleteRecord,
  clear,
  bulkPut,
  getByIndex,
  count,
  closeDatabase,
  deleteDatabase,
  STORE_NAMES,
  type StoreName,
  type StoreTypeMap,
} from './indexedDB';

// Sync queue management
export {
  addToQueue,
  getQueuedOperations,
  getPendingCount,
  markAsSynced,
  markOneSynced,
  incrementRetry,
  retryFailed,
  getPermFailedOperations,
  clearFailedOperations,
  resetRetryCount,
  getOperationsByEntityType,
  hasPendingChanges,
  getEntityPendingChanges,
  type SyncOperation,
  type SyncEntityType,
  type AddToQueueInput,
} from './offlineQueue';

// High-level storage abstraction
export {
  OfflineStorage,
  offlineStorage,
  isElectron,
  initialize,
  setTenantId,
  getTenantId,
  getAll as getAllRecords,
  getById as getRecordById,
  save,
  deleteItem,
  query,
  bulkSave,
  clearTenantData,
  count as countRecords,
  markAsSynced as markRecordSynced,
  isInitialized,
} from './offlineStorage';

// React context provider and hooks
export {
  StorageProvider,
  useStorage,
  useStorageReady,
  usePendingSyncCount,
} from './StorageProvider';
