/**
 * desktop sync-bridge IPC handlers (the `sync:*` + the
 * `db:addToSyncQueue` / `db:getPendingSyncItems` surface index.ts registers).
 * The where-clause / conflict / queue helpers + the entity-config constants
 * live in `./sync-helpers.js` (split out in slice 9 to clear the 500-LOC
 * ceiling). Electron-free (reaches the DB only via runtime.ts + db.ts), so
 * it stays unit-testable under node --test.
 * @module main/ipc/sync
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql, appSettings, syncConflicts, syncOutbox } from '@puntovivo/server';
import { getServerDatabase } from '../runtime.js';
import { mapRowToRendererRecord } from './db.js';
import {
  DESKTOP_PENDING_SYNC_STATUSES,
  DESKTOP_SYNC_CONFIG_KEY,
  SYNC_ENTITY_CONFIG,
  desktopPendingSyncWhere,
  desktopProcessableSyncWhere,
  ensurePendingConflict,
  findLocalSyncEntity,
  getLastSyncAt,
  incrementQueueFailure,
  markSyncEntityAsSynced,
  normalizeSyncEntityType,
  resolveDesktopConflictPolicy,
  saveLastSyncAt,
  type DesktopPendingSyncStatus,
} from './sync-helpers.js';

// Single source of truth for the operations the desktop sync
// bridge accepts. The IPC handler validates the renderer-supplied value
// against this list before any DB write, so a malformed/hostile payload
// cannot enqueue an outbox row with an unrecognised operation.
const DESKTOP_SYNC_OPERATIONS = ['create', 'update', 'delete'] as const;
type DesktopSyncOperation = (typeof DESKTOP_SYNC_OPERATIONS)[number];

export function assertDesktopSyncOperation(value: unknown): DesktopSyncOperation {
  if (typeof value === 'string' && (DESKTOP_SYNC_OPERATIONS as readonly string[]).includes(value)) {
    return value as DesktopSyncOperation;
  }
  throw new Error(`Sync operation "${String(value)}" is not allowed in the desktop bridge`);
}

export interface DesktopSyncQueueInput {
  entityType: string;
  entityId: string;
  operation: DesktopSyncOperation;
  payload?: Record<string, unknown>;
  tenantId: string;
}

export interface DesktopSyncStatusResult {
  isOnline: boolean;
  lastSync: string | null;
  pendingItems: number;
  conflicts: number;
}

export interface DesktopSyncTriggerResult extends DesktopSyncStatusResult {
  success: boolean;
  synced: number;
  errors: string[];
}

export async function getDesktopSyncStatus(tenantId?: string): Promise<DesktopSyncStatusResult> {
  const database = getServerDatabase();
  const [queueRow, conflictRow, lastSync] = await Promise.all([
    tenantId
      ? database
          .select({ count: sql<number>`count(*)` })
          .from(syncOutbox)
          .where(desktopPendingSyncWhere(tenantId))
          .get()
      : database
          .select({ count: sql<number>`count(*)` })
          .from(syncOutbox)
          .where(desktopPendingSyncWhere())
          .get(),
    tenantId
      ? database
          .select({ count: sql<number>`count(*)` })
          .from(syncConflicts)
          .where(and(eq(syncConflicts.tenantId, tenantId), eq(syncConflicts.status, 'pending')))
          .get()
      : database
          .select({ count: sql<number>`count(*)` })
          .from(syncConflicts)
          .where(eq(syncConflicts.status, 'pending'))
          .get(),
    getLastSyncAt(tenantId),
  ]);

  return {
    isOnline: true,
    lastSync,
    pendingItems: queueRow?.count ?? 0,
    conflicts: conflictRow?.count ?? 0,
  };
}

export async function handleDesktopAddToSyncQueue(input: DesktopSyncQueueInput): Promise<void> {
  const database = getServerDatabase();
  const entityType = normalizeSyncEntityType(input.entityType);
  const payload = input.payload ?? {};
  const now = new Date().toISOString();
  const existingItems = await database
    .select()
    .from(syncOutbox)
    .where(
      and(
        eq(syncOutbox.tenantId, input.tenantId),
        eq(syncOutbox.entityType, entityType),
        eq(syncOutbox.entityId, input.entityId),
        inArray(
          syncOutbox.status,
          DESKTOP_PENDING_SYNC_STATUSES as unknown as DesktopPendingSyncStatus[]
        )
      )
    )
    .all();

  const pendingCreate = existingItems.find(item => item.operation === 'create');
  if (pendingCreate && input.operation === 'update') {
    await database
      .update(syncOutbox)
      .set({
        payload: {
          ...((pendingCreate.payload ?? {}) as Record<string, unknown>),
          ...payload,
        },
        conflictPolicy: resolveDesktopConflictPolicy(entityType),
        attempts: 0,
        lastError: null,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
      })
      .where(eq(syncOutbox.id, pendingCreate.id))
      .run();
    return;
  }

  if (pendingCreate && input.operation === 'delete') {
    await database.delete(syncOutbox).where(eq(syncOutbox.id, pendingCreate.id)).run();
    return;
  }

  const pendingUpdate = existingItems.find(item => item.operation === 'update');
  if (pendingUpdate && input.operation === 'update') {
    await database
      .update(syncOutbox)
      .set({
        payload: {
          ...((pendingUpdate.payload ?? {}) as Record<string, unknown>),
          ...payload,
        },
        conflictPolicy: resolveDesktopConflictPolicy(entityType),
        attempts: 0,
        lastError: null,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
      })
      .where(eq(syncOutbox.id, pendingUpdate.id))
      .run();
    return;
  }

  // : write directly to `sync_outbox` from the Electron IPC
  // bridge. Mirror ADR-0004's high-risk manual policy here because
  // this path can enqueue sales, inventory, orders, and purchases
  // without passing through the server-side `enqueueSync` helper.
  await database.insert(syncOutbox).values({
    id: randomUUID(),
    tenantId: input.tenantId,
    status: 'queued',
    entityType,
    entityId: input.entityId,
    operation: input.operation,
    conflictPolicy: resolveDesktopConflictPolicy(entityType),
    payload,
    payloadVersion: 1,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
}

export async function handleDesktopGetPendingSyncItems(tenantId: string): Promise<unknown[]> {
  const items = await getServerDatabase()
    .select()
    .from(syncOutbox)
    .where(desktopPendingSyncWhere(tenantId))
    .orderBy(syncOutbox.createdAt)
    .all();

  return items
    .map(item => mapRowToRendererRecord('sync_outbox', item as unknown as Record<string, unknown>))
    .filter((item): item is Record<string, unknown> => item !== null);
}

export async function handleDesktopTriggerSync(
  tenantId: string
): Promise<DesktopSyncTriggerResult> {
  const database = getServerDatabase();
  const items = await database
    .select()
    .from(syncOutbox)
    .where(desktopProcessableSyncWhere(tenantId))
    .orderBy(syncOutbox.createdAt)
    .all();
  const processedIds: string[] = [];
  const errors: string[] = [];
  const now = new Date().toISOString();

  for (const item of items) {
    const existingConflict = await database
      .select({ id: syncConflicts.id })
      .from(syncConflicts)
      .where(
        and(
          eq(syncConflicts.tenantId, tenantId),
          eq(syncConflicts.entityType, item.entityType),
          eq(syncConflicts.entityId, item.entityId),
          eq(syncConflicts.status, 'pending')
        )
      )
      .get();

    if (existingConflict?.id) {
      const message = `Pending conflict blocks ${item.entityType}:${item.entityId}`;
      await incrementQueueFailure(tenantId, item.id, message);
      errors.push(message);
      continue;
    }

    if (!(item.entityType in SYNC_ENTITY_CONFIG)) {
      const message = `Unsupported sync entity type: ${item.entityType}`;
      await incrementQueueFailure(tenantId, item.id, message);
      errors.push(message);
      continue;
    }

    const entityType = item.entityType as keyof typeof SYNC_ENTITY_CONFIG;
    if (item.operation !== 'delete') {
      const exists = findLocalSyncEntity(entityType, tenantId, item.entityId);
      if (!exists) {
        const message = `Unable to sync ${item.entityType}:${item.entityId} because the local record is missing`;
        await ensurePendingConflict(
          tenantId,
          item.entityType,
          item.entityId,
          (item.payload ?? {}) as Record<string, unknown>,
          {}
        );
        await incrementQueueFailure(tenantId, item.id, message);
        errors.push(message);
        continue;
      }

      markSyncEntityAsSynced(entityType, tenantId, item.entityId, now);
    }

    await database.delete(syncOutbox).where(eq(syncOutbox.id, item.id)).run();
    processedIds.push(item.id);
  }

  if (processedIds.length > 0) {
    await saveLastSyncAt(tenantId, now);
  }

  const status = await getDesktopSyncStatus(tenantId);
  return {
    success: errors.length === 0,
    synced: processedIds.length,
    errors,
    ...status,
  };
}

export async function handleDesktopSetSyncConfig(config: Record<string, unknown>): Promise<void> {
  const database = getServerDatabase();
  const now = new Date().toISOString();
  const existing = await database
    .select({ key: appSettings.key })
    .from(appSettings)
    .where(eq(appSettings.key, DESKTOP_SYNC_CONFIG_KEY))
    .get();

  if (existing) {
    await database
      .update(appSettings)
      .set({
        value: config,
        updatedAt: now,
      })
      .where(eq(appSettings.key, DESKTOP_SYNC_CONFIG_KEY))
      .run();
    return;
  }

  await database.insert(appSettings).values({
    key: DESKTOP_SYNC_CONFIG_KEY,
    value: config,
    updatedAt: now,
  });
}
