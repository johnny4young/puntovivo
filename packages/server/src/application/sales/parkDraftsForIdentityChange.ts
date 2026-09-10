/**
 * Gracefully park server-backed carts before a terminal changes identity.
 *
 * Resuming a draft clears its suspension marker while the renderer owns the
 * chargeable workspace. Logout and staff handoff erase those workspaces, so
 * the identity mutation must first make every draft owned by that actor
 * discoverable again in the same SQLite transaction.
 */
import { and, eq, isNull } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import { restaurantChecks, restaurantTables, sales } from '../../db/schema.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';

/**
 * Identity boundary that determines which active draft claims are parked.
 * Logout globally revokes every session for the actor, so every actor claim
 * must be released. A staff switch affects one registered terminal only and
 * therefore requires that terminal id to avoid disrupting another register.
 */
export type ParkDraftsForIdentityChangeArgs = {
  tenantId: string;
  actorId: string;
  now: string;
} & (
  | { reason: 'logout'; deviceId?: never }
  | { reason: 'password_change'; deviceId?: never }
  | { reason: 'staff_switch' | 'device_rebind'; deviceId: string }
);

/**
 * Park every unsuspended draft explicitly claimed by the authenticated actor
 * inside the identity boundary. Staff handoff is device-local; logout is
 * actor-global because it invalidates every access and refresh token.
 * The caller owns the surrounding IMMEDIATE transaction, so identity rotation
 * cannot commit while one of its draft releases is only partially recorded.
 */
export function parkDraftsForIdentityChange(
  db: DatabaseInstance,
  args: ParkDraftsForIdentityChangeArgs
): { parkedIds: string[] } {
  const ownershipConditions = [
    eq(sales.tenantId, args.tenantId),
    eq(sales.status, 'draft'),
    isNull(sales.suspendedAt),
    eq(sales.resumedBy, args.actorId),
  ];
  if (args.reason === 'staff_switch' || args.reason === 'device_rebind') {
    ownershipConditions.push(eq(sales.resumedDeviceId, args.deviceId));
  }

  const activeDrafts = db
    .select({
      id: sales.id,
      status: sales.status,
      suspendedBy: sales.suspendedBy,
      suspendedLabel: sales.suspendedLabel,
      resumedBy: sales.resumedBy,
      resumedDeviceId: sales.resumedDeviceId,
      tableId: sales.tableId,
      syncVersion: sales.syncVersion,
    })
    .from(sales)
    .where(and(...ownershipConditions))
    .all();
  const parkedIds: string[] = [];

  for (const existing of activeDrafts) {
    const checkLabel = db
      .select({ label: restaurantChecks.label })
      .from(restaurantChecks)
      .where(
        and(eq(restaurantChecks.tenantId, args.tenantId), eq(restaurantChecks.saleId, existing.id))
      )
      .get()?.label;
    const tableName = existing.tableId
      ? db
          .select({ name: restaurantTables.name })
          .from(restaurantTables)
          .where(
            and(
              eq(restaurantTables.id, existing.tableId),
              eq(restaurantTables.tenantId, args.tenantId)
            )
          )
          .get()?.name
      : null;
    const label = checkLabel ?? tableName ?? existing.suspendedLabel ?? null;
    const nextSyncVersion = (existing.syncVersion ?? 0) + 1;
    const changed = db
      .update(sales)
      .set({
        suspendedAt: args.now,
        suspendedBy: args.actorId,
        resumedBy: null,
        resumedDeviceId: null,
        suspendedLabel: label,
        syncStatus: 'pending',
        syncVersion: nextSyncVersion,
        updatedAt: args.now,
      })
      .where(
        and(
          eq(sales.id, existing.id),
          eq(sales.tenantId, args.tenantId),
          eq(sales.status, 'draft'),
          isNull(sales.suspendedAt),
          eq(sales.resumedBy, args.actorId),
          ...(args.reason === 'staff_switch' || args.reason === 'device_rebind'
            ? [eq(sales.resumedDeviceId, args.deviceId)]
            : [])
        )
      )
      .run();
    if (changed.changes !== 1) continue;

    writeAuditLog({
      tx: db,
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: 'sale.park',
      resourceType: 'sale',
      resourceId: existing.id,
      before: {
        status: existing.status,
        suspendedAt: null,
        suspendedBy: existing.suspendedBy,
        resumedBy: existing.resumedBy,
        resumedDeviceId: existing.resumedDeviceId,
        suspendedLabel: existing.suspendedLabel,
      },
      after: {
        status: 'draft',
        suspendedAt: args.now,
        suspendedBy: args.actorId,
        resumedBy: null,
        resumedDeviceId: null,
        suspendedLabel: label,
      },
      metadata: { identityChange: args.reason },
    });
    enqueueSyncInTransaction(
      { db, tenantId: args.tenantId, envelope: null, deviceId: null },
      {
        entityType: 'sales',
        entityId: existing.id,
        operation: 'update',
        data: {
          id: existing.id,
          status: 'draft',
          suspendedAt: args.now,
          suspendedBy: args.actorId,
          resumedBy: null,
          resumedDeviceId: null,
          suspendedLabel: label,
          tableId: existing.tableId,
          syncVersion: nextSyncVersion,
        },
      }
    );
    parkedIds.push(existing.id);
  }

  return { parkedIds };
}
