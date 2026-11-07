/**
 * Authenticated desktop sync summaries, trigger and configuration.
 * Domain mutations and outbox payloads are not renderer IPC capabilities.
 * @module main/server-host/desktop-sync
 */
import { and, eq, sql, appSettings, syncConflicts, syncOutbox } from '@puntovivo/server';
import type { DesktopSyncStatusResult, DesktopSyncTriggerResult } from './contract.ts';
import {
  type SyncDatabase,
  DESKTOP_SYNC_CONFIG_KEY,
  SYNC_ENTITY_CONFIG,
  desktopPendingSyncWhere,
  desktopProcessableSyncWhere,
  ensurePendingConflict,
  findLocalSyncEntity,
  getLastSyncAt,
  incrementQueueFailure,
  markSyncEntityAsSynced,
  saveLastSyncAt,
} from './desktop-sync-helpers.ts';

export async function getDesktopSyncStatus(
  database: SyncDatabase,
  tenantId?: string
): Promise<DesktopSyncStatusResult> {
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
    getLastSyncAt(database, tenantId),
  ]);

  return {
    isOnline: true,
    lastSync,
    pendingItems: queueRow?.count ?? 0,
    conflicts: conflictRow?.count ?? 0,
  };
}

export async function handleDesktopTriggerSync(
  database: SyncDatabase,
  tenantId: string
): Promise<DesktopSyncTriggerResult> {
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
      await incrementQueueFailure(database, tenantId, item.id, message);
      errors.push(message);
      continue;
    }

    if (!(item.entityType in SYNC_ENTITY_CONFIG)) {
      const message = `Unsupported sync entity type: ${item.entityType}`;
      await incrementQueueFailure(database, tenantId, item.id, message);
      errors.push(message);
      continue;
    }

    const entityType = item.entityType as keyof typeof SYNC_ENTITY_CONFIG;
    if (item.operation !== 'delete') {
      const exists = findLocalSyncEntity(database, entityType, tenantId, item.entityId);
      if (!exists) {
        const message = `Unable to sync ${item.entityType}:${item.entityId} because the local record is missing`;
        await ensurePendingConflict(
          database,
          tenantId,
          item.entityType,
          item.entityId,
          (item.payload ?? {}) as Record<string, unknown>,
          {}
        );
        await incrementQueueFailure(database, tenantId, item.id, message);
        errors.push(message);
        continue;
      }

      markSyncEntityAsSynced(database, entityType, tenantId, item.entityId, now);
    }

    await database.delete(syncOutbox).where(eq(syncOutbox.id, item.id)).run();
    processedIds.push(item.id);
  }

  if (processedIds.length > 0) {
    await saveLastSyncAt(database, tenantId, now);
  }

  const status = await getDesktopSyncStatus(database, tenantId);
  return {
    success: errors.length === 0,
    synced: processedIds.length,
    errors,
    ...status,
  };
}

export async function handleDesktopSetSyncConfig(
  database: SyncDatabase,
  config: Record<string, unknown>
): Promise<void> {
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
