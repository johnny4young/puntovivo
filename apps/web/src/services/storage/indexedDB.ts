/**
 * IndexedDB wrapper for browser offline storage
 * Provides type-safe CRUD operations for local data persistence
 */

import type {
  Product,
  Customer,
  Sale,
  SaleItem,
  Category,
  InventoryMovement,
  SyncQueueItem,
} from '@/types';

// Database configuration
const DB_NAME = 'open_yojob_db';
const DB_VERSION = 1;

// Store names as const for type safety
export const STORE_NAMES = {
  PRODUCTS: 'products',
  CUSTOMERS: 'customers',
  SALES: 'sales',
  SALE_ITEMS: 'sale_items',
  CATEGORIES: 'categories',
  INVENTORY_MOVEMENTS: 'inventory_movements',
  SYNC_QUEUE: 'sync_queue',
} as const;

export type StoreName = (typeof STORE_NAMES)[keyof typeof STORE_NAMES];

// Type mapping for stores
export interface StoreTypeMap {
  products: Product;
  customers: Customer;
  sales: Sale;
  sale_items: SaleItem;
  categories: Category;
  inventory_movements: InventoryMovement;
  sync_queue: SyncQueueItem;
}

// Base interface for entities with id and tenantId
interface BaseEntity {
  id: string;
  tenantId?: string;
}

let dbInstance: IDBDatabase | null = null;

/**
 * Initialize IndexedDB with all required object stores
 */
export async function initDatabase(): Promise<IDBDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = event => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Products store
      if (!db.objectStoreNames.contains(STORE_NAMES.PRODUCTS)) {
        const productStore = db.createObjectStore(STORE_NAMES.PRODUCTS, { keyPath: 'id' });
        productStore.createIndex('tenantId', 'tenantId', { unique: false });
        productStore.createIndex('categoryId', 'categoryId', { unique: false });
        productStore.createIndex('sku', 'sku', { unique: false });
        productStore.createIndex('barcode', 'barcode', { unique: false });
        productStore.createIndex('syncStatus', 'syncStatus', { unique: false });
      }

      // Customers store
      if (!db.objectStoreNames.contains(STORE_NAMES.CUSTOMERS)) {
        const customerStore = db.createObjectStore(STORE_NAMES.CUSTOMERS, { keyPath: 'id' });
        customerStore.createIndex('tenantId', 'tenantId', { unique: false });
        customerStore.createIndex('email', 'email', { unique: false });
        customerStore.createIndex('phone', 'phone', { unique: false });
        customerStore.createIndex('syncStatus', 'syncStatus', { unique: false });
      }

      // Sales store
      if (!db.objectStoreNames.contains(STORE_NAMES.SALES)) {
        const salesStore = db.createObjectStore(STORE_NAMES.SALES, { keyPath: 'id' });
        salesStore.createIndex('tenantId', 'tenantId', { unique: false });
        salesStore.createIndex('customerId', 'customerId', { unique: false });
        salesStore.createIndex('saleNumber', 'saleNumber', { unique: false });
        salesStore.createIndex('createdAt', 'createdAt', { unique: false });
        salesStore.createIndex('syncStatus', 'syncStatus', { unique: false });
      }

      // Sale items store
      if (!db.objectStoreNames.contains(STORE_NAMES.SALE_ITEMS)) {
        const saleItemsStore = db.createObjectStore(STORE_NAMES.SALE_ITEMS, { keyPath: 'id' });
        saleItemsStore.createIndex('saleId', 'saleId', { unique: false });
        saleItemsStore.createIndex('productId', 'productId', { unique: false });
      }

      // Categories store
      if (!db.objectStoreNames.contains(STORE_NAMES.CATEGORIES)) {
        const categoriesStore = db.createObjectStore(STORE_NAMES.CATEGORIES, { keyPath: 'id' });
        categoriesStore.createIndex('tenantId', 'tenantId', { unique: false });
        categoriesStore.createIndex('parentId', 'parentId', { unique: false });
      }

      // Inventory movements store
      if (!db.objectStoreNames.contains(STORE_NAMES.INVENTORY_MOVEMENTS)) {
        const movementsStore = db.createObjectStore(STORE_NAMES.INVENTORY_MOVEMENTS, {
          keyPath: 'id',
        });
        movementsStore.createIndex('tenantId', 'tenantId', { unique: false });
        movementsStore.createIndex('productId', 'productId', { unique: false });
        movementsStore.createIndex('type', 'type', { unique: false });
        movementsStore.createIndex('createdAt', 'createdAt', { unique: false });
        movementsStore.createIndex('syncStatus', 'syncStatus', { unique: false });
      }

      // Sync queue store
      if (!db.objectStoreNames.contains(STORE_NAMES.SYNC_QUEUE)) {
        const syncStore = db.createObjectStore(STORE_NAMES.SYNC_QUEUE, { keyPath: 'id' });
        syncStore.createIndex('tenantId', 'tenantId', { unique: false });
        syncStore.createIndex('entityType', 'entityType', { unique: false });
        syncStore.createIndex('entityId', 'entityId', { unique: false });
        syncStore.createIndex('operation', 'operation', { unique: false });
        syncStore.createIndex('createdAt', 'createdAt', { unique: false });
        syncStore.createIndex('retryCount', 'retryCount', { unique: false });
      }
    };
  });
}

/**
 * Get database instance, initializing if necessary
 */
async function getDatabase(): Promise<IDBDatabase> {
  if (!dbInstance) {
    return initDatabase();
  }
  return dbInstance;
}

/**
 * Get all records from a store, optionally filtered by tenant
 */
export async function getAll<T extends BaseEntity>(
  storeName: StoreName,
  tenantId?: string
): Promise<T[]> {
  try {
    const db = await getDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);

      if (tenantId && store.indexNames.contains('tenantId')) {
        const index = store.index('tenantId');
        const request = index.getAll(tenantId);

        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () =>
          reject(new Error(`Failed to get all from ${storeName}: ${request.error?.message}`));
      } else {
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () =>
          reject(new Error(`Failed to get all from ${storeName}: ${request.error?.message}`));
      }
    });
  } catch (error) {
    console.error(`Error in getAll for ${storeName}:`, error);
    throw error;
  }
}

/**
 * Get a single record by ID
 */
export async function getById<T>(storeName: StoreName, id: string): Promise<T | undefined> {
  try {
    const db = await getDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () =>
        reject(new Error(`Failed to get ${id} from ${storeName}: ${request.error?.message}`));
    });
  } catch (error) {
    console.error(`Error in getById for ${storeName}:`, error);
    throw error;
  }
}

/**
 * Insert or update a record
 */
export async function put<T extends BaseEntity>(storeName: StoreName, data: T): Promise<T> {
  try {
    const db = await getDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(data);

      request.onsuccess = () => resolve(data);
      request.onerror = () =>
        reject(new Error(`Failed to put in ${storeName}: ${request.error?.message}`));
    });
  } catch (error) {
    console.error(`Error in put for ${storeName}:`, error);
    throw error;
  }
}

/**
 * Delete a record by ID
 */
export async function deleteRecord(storeName: StoreName, id: string): Promise<void> {
  try {
    const db = await getDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(new Error(`Failed to delete ${id} from ${storeName}: ${request.error?.message}`));
    });
  } catch (error) {
    console.error(`Error in delete for ${storeName}:`, error);
    throw error;
  }
}

/**
 * Clear all records in a store
 */
export async function clear(storeName: StoreName): Promise<void> {
  try {
    const db = await getDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(new Error(`Failed to clear ${storeName}: ${request.error?.message}`));
    });
  } catch (error) {
    console.error(`Error in clear for ${storeName}:`, error);
    throw error;
  }
}

/**
 * Bulk insert or update records
 */
export async function bulkPut<T extends BaseEntity>(
  storeName: StoreName,
  items: T[]
): Promise<T[]> {
  if (items.length === 0) {
    return [];
  }

  try {
    const db = await getDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);

      let completed = 0;
      const errors: string[] = [];

      items.forEach(item => {
        const request = store.put(item);

        request.onsuccess = () => {
          completed++;
          if (completed === items.length) {
            if (errors.length > 0) {
              reject(new Error(`Bulk put had errors: ${errors.join(', ')}`));
            } else {
              resolve(items);
            }
          }
        };

        request.onerror = () => {
          errors.push(request.error?.message || 'Unknown error');
          completed++;
          if (completed === items.length) {
            reject(new Error(`Bulk put had errors: ${errors.join(', ')}`));
          }
        };
      });

      transaction.onerror = () => {
        reject(new Error(`Transaction failed: ${transaction.error?.message}`));
      };
    });
  } catch (error) {
    console.error(`Error in bulkPut for ${storeName}:`, error);
    throw error;
  }
}

/**
 * Query records by index
 */
export async function getByIndex<T>(
  storeName: StoreName,
  indexName: string,
  value: IDBValidKey
): Promise<T[]> {
  try {
    const db = await getDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);

      if (!store.indexNames.contains(indexName)) {
        reject(new Error(`Index ${indexName} does not exist on store ${storeName}`));
        return;
      }

      const index = store.index(indexName);
      const request = index.getAll(value);

      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () =>
        reject(
          new Error(`Failed to query ${storeName} by ${indexName}: ${request.error?.message}`)
        );
    });
  } catch (error) {
    console.error(`Error in getByIndex for ${storeName}:`, error);
    throw error;
  }
}

/**
 * Count records in a store, optionally filtered by tenant
 */
export async function count(storeName: StoreName, tenantId?: string): Promise<number> {
  try {
    const db = await getDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);

      if (tenantId && store.indexNames.contains('tenantId')) {
        const index = store.index('tenantId');
        const request = index.count(tenantId);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(new Error(`Failed to count ${storeName}: ${request.error?.message}`));
      } else {
        const request = store.count();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(new Error(`Failed to count ${storeName}: ${request.error?.message}`));
      }
    });
  } catch (error) {
    console.error(`Error in count for ${storeName}:`, error);
    throw error;
  }
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Delete the entire database (use with caution)
 */
export async function deleteDatabase(): Promise<void> {
  closeDatabase();

  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);

    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(new Error(`Failed to delete database: ${request.error?.message}`));
    request.onblocked = () => {
      console.warn('Database deletion blocked - close all connections first');
    };
  });
}
