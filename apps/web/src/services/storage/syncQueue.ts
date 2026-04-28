/**
 * Sync queue management for offline operations
 * Tracks pending changes that need to be synchronized with the server
 */

import type { SyncQueueItem } from '@/types';
import { generateId } from '@/lib/utils';
import { getAll, getById, put, deleteRecord, getByIndex, bulkPut, STORE_NAMES } from './indexedDB';

// Operation types for sync queue
export type SyncOperation = 'create' | 'update' | 'delete';

// Entity types that can be synced
export type SyncEntityType =
  | 'product'
  | 'customer'
  | 'sale'
  | 'sale_item'
  | 'category'
  | 'inventory_movement';

// Input for adding to sync queue
export interface AddToQueueInput {
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  payload: Record<string, unknown>;
  tenantId: string;
}

// Maximum retry attempts before marking as failed
const MAX_RETRY_COUNT = 5;

/**
 * Add an operation to the sync queue
 */
export async function addToQueue(input: AddToQueueInput): Promise<SyncQueueItem> {
  const { entityType, entityId, operation, payload, tenantId } = input;

  // Check if there's already a pending operation for this entity
  const existingOps = await getByIndex<SyncQueueItem>(STORE_NAMES.SYNC_QUEUE, 'entityId', entityId);

  // If there's an existing pending create and we're now updating, merge the payloads
  const pendingCreate = existingOps.find(
    op => op.operation === 'create' && op.entityType === entityType
  );

  if (pendingCreate && operation === 'update') {
    // Merge update into the create operation
    const mergedItem: SyncQueueItem = {
      ...pendingCreate,
      payload: { ...pendingCreate.payload, ...payload },
      createdAt: new Date().toISOString(),
    };
    await put(STORE_NAMES.SYNC_QUEUE, mergedItem);
    return mergedItem;
  }

  // If there's a pending create and we're deleting, remove the create
  if (pendingCreate && operation === 'delete') {
    await deleteRecord(STORE_NAMES.SYNC_QUEUE, pendingCreate.id);
    // Don't add a delete operation since the item was never synced
    return pendingCreate;
  }

  // If there's a pending update and we're updating again, merge
  const pendingUpdate = existingOps.find(
    op => op.operation === 'update' && op.entityType === entityType
  );

  if (pendingUpdate && operation === 'update') {
    const mergedItem: SyncQueueItem = {
      ...pendingUpdate,
      payload: { ...pendingUpdate.payload, ...payload },
      createdAt: new Date().toISOString(),
    };
    await put(STORE_NAMES.SYNC_QUEUE, mergedItem);
    return mergedItem;
  }

  // Create new queue item
  const queueItem: SyncQueueItem = {
    id: generateId(),
    entityType,
    entityId,
    operation,
    payload,
    tenantId,
    createdAt: new Date().toISOString(),
    retryCount: 0,
  };

  await put(STORE_NAMES.SYNC_QUEUE, queueItem);
  return queueItem;
}

/**
 * Get all pending operations for a tenant
 */
export async function getQueuedOperations(tenantId: string): Promise<SyncQueueItem[]> {
  try {
    const items = await getAll<SyncQueueItem>(STORE_NAMES.SYNC_QUEUE, tenantId);
    // Sort by creation time to maintain order
    return items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  } catch (error) {
    console.error('Error getting queued operations:', error);
    return [];
  }
}

/**
 * Get the count of pending operations
 */
export async function getPendingCount(tenantId: string): Promise<number> {
  const items = await getQueuedOperations(tenantId);
  return items.filter(item => item.retryCount < MAX_RETRY_COUNT).length;
}

/**
 * Mark operations as synced (remove from queue)
 */
export async function markAsSynced(operationIds: string[]): Promise<void> {
  try {
    await Promise.all(operationIds.map(id => deleteRecord(STORE_NAMES.SYNC_QUEUE, id)));
  } catch (error) {
    console.error('Error marking operations as synced:', error);
    throw error;
  }
}

/**
 * Mark a single operation as synced
 */
export async function markOneSynced(operationId: string): Promise<void> {
  try {
    await deleteRecord(STORE_NAMES.SYNC_QUEUE, operationId);
  } catch (error) {
    console.error('Error marking operation as synced:', error);
    throw error;
  }
}

/**
 * Increment retry count for a failed operation
 */
export async function incrementRetry(
  operationId: string,
  errorMessage?: string
): Promise<SyncQueueItem | null> {
  try {
    const item = await getById<SyncQueueItem>(STORE_NAMES.SYNC_QUEUE, operationId);

    if (!item) {
      console.warn(`Operation ${operationId} not found in queue`);
      return null;
    }

    const updatedItem: SyncQueueItem = {
      ...item,
      retryCount: item.retryCount + 1,
      lastError: errorMessage,
    };

    await put(STORE_NAMES.SYNC_QUEUE, updatedItem);
    return updatedItem;
  } catch (error) {
    console.error('Error incrementing retry count:', error);
    throw error;
  }
}

/**
 * Get failed operations that can be retried
 */
export async function retryFailed(tenantId: string): Promise<SyncQueueItem[]> {
  try {
    const items = await getQueuedOperations(tenantId);
    // Return items that have failed but haven't exceeded max retries
    return items.filter(item => item.retryCount > 0 && item.retryCount < MAX_RETRY_COUNT);
  } catch (error) {
    console.error('Error getting failed operations:', error);
    return [];
  }
}

/**
 * Get permanently failed operations (exceeded max retries)
 */
export async function getPermFailedOperations(tenantId: string): Promise<SyncQueueItem[]> {
  try {
    const items = await getQueuedOperations(tenantId);
    return items.filter(item => item.retryCount >= MAX_RETRY_COUNT);
  } catch (error) {
    console.error('Error getting permanently failed operations:', error);
    return [];
  }
}

/**
 * Clear all failed operations (after user acknowledges)
 */
export async function clearFailedOperations(tenantId: string): Promise<void> {
  try {
    const failed = await getPermFailedOperations(tenantId);
    await Promise.all(failed.map(item => deleteRecord(STORE_NAMES.SYNC_QUEUE, item.id)));
  } catch (error) {
    console.error('Error clearing failed operations:', error);
    throw error;
  }
}

/**
 * Reset retry count for operations (for manual retry)
 */
export async function resetRetryCount(operationIds: string[]): Promise<void> {
  try {
    const items = await Promise.all(
      operationIds.map(id => getById<SyncQueueItem>(STORE_NAMES.SYNC_QUEUE, id))
    );

    const validItems = items.filter((item): item is SyncQueueItem => item !== undefined);
    const resetItems = validItems.map(item => ({
      ...item,
      retryCount: 0,
      lastError: undefined,
    }));

    await bulkPut(STORE_NAMES.SYNC_QUEUE, resetItems);
  } catch (error) {
    console.error('Error resetting retry count:', error);
    throw error;
  }
}

/**
 * Get operations by entity type
 */
export async function getOperationsByEntityType(
  tenantId: string,
  entityType: SyncEntityType
): Promise<SyncQueueItem[]> {
  try {
    const items = await getByIndex<SyncQueueItem>(STORE_NAMES.SYNC_QUEUE, 'entityType', entityType);
    return items.filter(item => item.tenantId === tenantId);
  } catch (error) {
    console.error('Error getting operations by entity type:', error);
    return [];
  }
}

/**
 * Check if an entity has pending changes
 */
export async function hasPendingChanges(entityId: string): Promise<boolean> {
  try {
    const items = await getByIndex<SyncQueueItem>(STORE_NAMES.SYNC_QUEUE, 'entityId', entityId);
    return items.length > 0;
  } catch (error) {
    console.error('Error checking pending changes:', error);
    return false;
  }
}

/**
 * Get pending changes for a specific entity
 */
export async function getEntityPendingChanges(entityId: string): Promise<SyncQueueItem[]> {
  try {
    return await getByIndex<SyncQueueItem>(STORE_NAMES.SYNC_QUEUE, 'entityId', entityId);
  } catch (error) {
    console.error('Error getting entity pending changes:', error);
    return [];
  }
}
