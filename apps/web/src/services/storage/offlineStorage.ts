/**
 * High-level storage abstraction
 * Detects runtime environment and delegates to appropriate storage backend:
 * - Electron: Uses window.api for SQLite access
 * - Browser: Uses IndexedDB
 */

import type { SyncStatus } from '@/types';
import { generateId } from '@/lib/utils';
import * as indexedDB from './indexedDB';
import { STORE_NAMES, type StoreName, type StoreTypeMap } from './indexedDB';
import { addToQueue, type SyncEntityType } from './syncQueue';

// Re-export types for consumers
export type { StoreName, StoreTypeMap };

// Check if running in Electron environment
export function isElectron(): boolean {
  return typeof window !== 'undefined' && window.api !== undefined;
}

// Map store names to entity types for sync queue
const storeToEntityType: Record<string, SyncEntityType> = {
  [STORE_NAMES.PRODUCTS]: 'product',
  [STORE_NAMES.CUSTOMERS]: 'customer',
  [STORE_NAMES.SALES]: 'sale',
  [STORE_NAMES.SALE_ITEMS]: 'sale_item',
  [STORE_NAMES.CATEGORIES]: 'category',
  [STORE_NAMES.INVENTORY_MOVEMENTS]: 'inventory_movement',
};

// Map store names to Electron table names
const storeToTable: Record<StoreName, string> = {
  [STORE_NAMES.PRODUCTS]: 'products',
  [STORE_NAMES.CUSTOMERS]: 'customers',
  [STORE_NAMES.SALES]: 'sales',
  [STORE_NAMES.SALE_ITEMS]: 'sale_items',
  [STORE_NAMES.CATEGORIES]: 'categories',
  [STORE_NAMES.INVENTORY_MOVEMENTS]: 'inventory_movements',
  [STORE_NAMES.SYNC_QUEUE]: 'sync_queue',
};

// Base entity interface
interface BaseEntity {
  id: string;
  tenantId?: string;
  syncStatus?: SyncStatus;
  syncVersion?: number;
}

/**
 * Unified storage interface for offline data access
 */
export class OfflineStorage {
  private tenantId: string | null = null;
  private initialized = false;

  /**
   * Initialize storage backend
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (!isElectron()) {
      // Browser: Initialize IndexedDB
      await indexedDB.initDatabase();
    }
    // Electron: No initialization needed, API is ready

    this.initialized = true;
  }

  /**
   * Set the current tenant ID for data isolation
   */
  setTenantId(tenantId: string): void {
    this.tenantId = tenantId;
  }

  /**
   * Get the current tenant ID
   */
  getTenantId(): string | null {
    return this.tenantId;
  }

  /**
   * Ensure tenant ID is set
   */
  private ensureTenantId(): string {
    if (!this.tenantId) {
      throw new Error('Tenant ID not set. Call setTenantId() first.');
    }
    return this.tenantId;
  }

  /**
   * Get all records from a store
   */
  async getAll<K extends keyof StoreTypeMap>(storeName: K): Promise<StoreTypeMap[K][]> {
    const tenantId = this.ensureTenantId();

    if (isElectron()) {
      const result = await window.api!.db.getAll(storeToTable[storeName], tenantId);
      return result as StoreTypeMap[K][];
    }

    return indexedDB.getAll<StoreTypeMap[K]>(storeName, tenantId);
  }

  /**
   * Get a single record by ID
   */
  async getById<K extends keyof StoreTypeMap>(
    storeName: K,
    id: string
  ): Promise<StoreTypeMap[K] | undefined> {
    if (isElectron()) {
      const result = await window.api!.db.getById(storeToTable[storeName], id);
      return result as StoreTypeMap[K] | undefined;
    }

    return indexedDB.getById<StoreTypeMap[K]>(storeName, id);
  }

  /**
   * Save a record (insert or update)
   * Automatically adds to sync queue for offline sync
   */
  async save<K extends keyof StoreTypeMap>(
    storeName: K,
    data: Partial<StoreTypeMap[K]> & { id?: string },
    options: { skipSync?: boolean } = {}
  ): Promise<StoreTypeMap[K]> {
    const tenantId = this.ensureTenantId();
    const isNew = !data.id;
    const id = data.id || generateId();
    const timestamp = new Date().toISOString();

    // Build the complete record
    const record = {
      ...data,
      id,
      tenantId,
      syncStatus: 'pending' as SyncStatus,
      updatedAt: timestamp,
      ...(isNew ? { createdAt: timestamp } : {}),
    } as unknown as StoreTypeMap[K] & BaseEntity;

    if (isElectron()) {
      if (isNew) {
        await window.api!.db.insert(
          storeToTable[storeName],
          record as unknown as Record<string, unknown>
        );
      } else {
        await window.api!.db.update(
          storeToTable[storeName],
          id,
          record as unknown as Record<string, unknown>
        );
      }

      // Add to sync queue via Electron API
      if (!options.skipSync) {
        await window.api!.db.addToSyncQueue({
          entityType: storeToEntityType[storeName],
          entityId: id,
          operation: isNew ? 'create' : 'update',
          payload: record as unknown as Record<string, unknown>,
          tenantId,
        });
      }
    } else {
      // Browser: Use IndexedDB
      await indexedDB.put(storeName, record);

      // Add to sync queue
      if (!options.skipSync && storeToEntityType[storeName]) {
        await addToQueue({
          entityType: storeToEntityType[storeName],
          entityId: id,
          operation: isNew ? 'create' : 'update',
          payload: record as unknown as Record<string, unknown>,
          tenantId,
        });
      }
    }

    return record;
  }

  /**
   * Delete a record
   * Automatically adds to sync queue for offline sync
   */
  async delete(
    storeName: StoreName,
    id: string,
    options: { skipSync?: boolean } = {}
  ): Promise<void> {
    const tenantId = this.ensureTenantId();

    if (isElectron()) {
      await window.api!.db.delete(storeToTable[storeName], id);

      // Add to sync queue via Electron API
      if (!options.skipSync && storeToEntityType[storeName]) {
        await window.api!.db.addToSyncQueue({
          entityType: storeToEntityType[storeName],
          entityId: id,
          operation: 'delete',
          payload: { id },
          tenantId,
        });
      }
    } else {
      // Browser: Use IndexedDB
      await indexedDB.deleteRecord(storeName, id);

      // Add to sync queue
      if (!options.skipSync && storeToEntityType[storeName]) {
        await addToQueue({
          entityType: storeToEntityType[storeName],
          entityId: id,
          operation: 'delete',
          payload: { id },
          tenantId,
        });
      }
    }
  }

  /**
   * Query records by index (IndexedDB only, Electron uses SQL)
   */
  async query<K extends keyof StoreTypeMap>(
    storeName: K,
    indexName: string,
    value: IDBValidKey
  ): Promise<StoreTypeMap[K][]> {
    if (isElectron()) {
      const results = await window.api!.db.getByField(storeToTable[storeName], indexName, value);
      return results as StoreTypeMap[K][];
    }

    return indexedDB.getByIndex<StoreTypeMap[K]>(storeName, indexName, value);
  }

  /**
   * Bulk save records
   */
  async bulkSave<K extends keyof StoreTypeMap>(
    storeName: K,
    items: Array<Partial<StoreTypeMap[K]> & { id?: string }>,
    options: { skipSync?: boolean } = {}
  ): Promise<StoreTypeMap[K][]> {
    const tenantId = this.ensureTenantId();
    const timestamp = new Date().toISOString();

    const records = items.map(item => {
      const isNew = !item.id;
      return {
        ...item,
        id: item.id || generateId(),
        tenantId,
        syncStatus: 'pending' as SyncStatus,
        updatedAt: timestamp,
        ...(isNew ? { createdAt: timestamp } : {}),
      } as unknown as StoreTypeMap[K] & BaseEntity;
    });

    if (isElectron()) {
      // Electron: Insert/update each item
      for (const record of records) {
        const existing = await window.api!.db.getById(storeToTable[storeName], record.id);
        if (existing) {
          await window.api!.db.update(
            storeToTable[storeName],
            record.id,
            record as unknown as Record<string, unknown>
          );
        } else {
          await window.api!.db.insert(
            storeToTable[storeName],
            record as unknown as Record<string, unknown>
          );
        }
      }

      // Add to sync queue
      if (!options.skipSync && storeToEntityType[storeName]) {
        for (const record of records) {
          await window.api!.db.addToSyncQueue({
            entityType: storeToEntityType[storeName],
            entityId: record.id,
            operation: 'create',
            payload: record as unknown as Record<string, unknown>,
            tenantId,
          });
        }
      }
    } else {
      // Browser: Use IndexedDB bulk put
      await indexedDB.bulkPut(storeName, records);

      // Add to sync queue
      if (!options.skipSync && storeToEntityType[storeName]) {
        for (const record of records) {
          await addToQueue({
            entityType: storeToEntityType[storeName],
            entityId: record.id,
            operation: 'create',
            payload: record as unknown as Record<string, unknown>,
            tenantId,
          });
        }
      }
    }

    return records;
  }

  /**
   * Clear all data for the current tenant
   */
  async clearTenantData(): Promise<void> {
    const tenantId = this.ensureTenantId();

    if (isElectron()) {
      const tables = Object.values(storeToTable);
      for (const table of tables) {
        await window.api!.db.deleteByTenant(table, tenantId);
      }
    } else {
      // Browser: Clear each store (this clears ALL data, not just tenant)
      // For proper tenant isolation, we'd need to iterate and delete by tenant
      const stores = Object.values(STORE_NAMES);
      for (const store of stores) {
        const items = await indexedDB.getAll<BaseEntity>(store, tenantId);
        for (const item of items) {
          await indexedDB.deleteRecord(store, item.id);
        }
      }
    }
  }

  /**
   * Get count of records in a store
   */
  async count(storeName: StoreName): Promise<number> {
    const tenantId = this.ensureTenantId();

    if (isElectron()) {
      return window.api!.db.countByTenant(storeToTable[storeName], tenantId);
    }

    return indexedDB.count(storeName, tenantId);
  }

  /**
   * Update sync status after successful sync
   */
  async markAsSynced<K extends keyof StoreTypeMap>(
    storeName: K,
    id: string,
    syncVersion: number
  ): Promise<void> {
    const existing = await this.getById(storeName, id);
    if (existing) {
      await this.save(
        storeName,
        {
          ...existing,
          syncStatus: 'synced' as SyncStatus,
          syncVersion,
        },
        { skipSync: true }
      );
    }
  }

  /**
   * Check if storage is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Export singleton instance
export const offlineStorage = new OfflineStorage();

// Export convenience methods for direct access
export const initialize = () => offlineStorage.initialize();
export const setTenantId = (id: string) => offlineStorage.setTenantId(id);
export const getTenantId = () => offlineStorage.getTenantId();
export const getAll = <K extends keyof StoreTypeMap>(storeName: K) =>
  offlineStorage.getAll(storeName);
export const getById = <K extends keyof StoreTypeMap>(storeName: K, id: string) =>
  offlineStorage.getById(storeName, id);
export const save = <K extends keyof StoreTypeMap>(
  storeName: K,
  data: Partial<StoreTypeMap[K]> & { id?: string },
  options?: { skipSync?: boolean }
) => offlineStorage.save(storeName, data, options);
export const deleteItem = (storeName: StoreName, id: string, options?: { skipSync?: boolean }) =>
  offlineStorage.delete(storeName, id, options);
export const query = <K extends keyof StoreTypeMap>(
  storeName: K,
  indexName: string,
  value: IDBValidKey
) => offlineStorage.query(storeName, indexName, value);
export const bulkSave = <K extends keyof StoreTypeMap>(
  storeName: K,
  items: Array<Partial<StoreTypeMap[K]> & { id?: string }>,
  options?: { skipSync?: boolean }
) => offlineStorage.bulkSave(storeName, items, options);
export const clearTenantData = () => offlineStorage.clearTenantData();
export const count = (storeName: StoreName) => offlineStorage.count(storeName);
export const markAsSynced = <K extends keyof StoreTypeMap>(
  storeName: K,
  id: string,
  syncVersion: number
) => offlineStorage.markAsSynced(storeName, id, syncVersion);
export const isInitialized = () => offlineStorage.isInitialized();
