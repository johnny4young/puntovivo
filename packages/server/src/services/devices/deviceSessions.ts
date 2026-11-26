/**
 * Device-scoped session bindings (`device_sessions`).
 *
 * Binds a refresh-token family to the terminal that registered or authenticated
 * with it so revoking one `hub_client` kills only that terminal's access and
 * refresh tokens without forcing the registering user to re-login elsewhere.
 */
import { and, eq, gt, inArray, ne, notExists, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { authRefreshFamilies, devices, deviceSessions } from '../../db/schema.js';

const EXPIRED_EPOCH_ISO = '1970-01-01T00:00:00.000Z';

export function bindDeviceSession(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    deviceId: string;
    userId: string;
    refreshFamilyId: string;
  }
): boolean {
  const family = db
    .select({ id: authRefreshFamilies.id })
    .from(authRefreshFamilies)
    .where(
      and(
        eq(authRefreshFamilies.id, args.refreshFamilyId),
        eq(authRefreshFamilies.tenantId, args.tenantId),
        eq(authRefreshFamilies.userId, args.userId)
      )
    )
    .get();
  if (!family) return false;

  const nowIso = new Date().toISOString();
  db.insert(deviceSessions)
    .values({
      id: nanoid(),
      tenantId: args.tenantId,
      deviceId: args.deviceId,
      userId: args.userId,
      refreshFamilyId: args.refreshFamilyId,
      status: 'active',
      revokedAt: null,
      revokedByUserId: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .onConflictDoUpdate({
      target: deviceSessions.refreshFamilyId,
      set: {
        deviceId: args.deviceId,
        userId: args.userId,
        status: 'active',
        revokedAt: null,
        revokedByUserId: null,
        updatedAt: nowIso,
      },
    })
    .run();
  return true;
}

function prepareFamilyLiveness(db: DatabaseInstance) {
  return db
    .select({
      tenantId: authRefreshFamilies.tenantId,
      userId: authRefreshFamilies.userId,
      expiresAt: authRefreshFamilies.expiresAt,
      bindingStatus: deviceSessions.status,
      deviceIsActive: devices.isActive,
    })
    .from(authRefreshFamilies)
    .leftJoin(deviceSessions, eq(deviceSessions.refreshFamilyId, authRefreshFamilies.id))
    .leftJoin(devices, eq(devices.id, deviceSessions.deviceId))
    .where(eq(authRefreshFamilies.id, sql.placeholder('familyId')))
    .prepare();
}

const familyLivenessStatements = new WeakMap<
  DatabaseInstance,
  ReturnType<typeof prepareFamilyLiveness>
>();

/**
 * Checks whether an access token's refresh family is still live and, if bound
 * to a device session, that neither the binding nor the device has been revoked.
 */
export function isAccessFamilyActive(
  db: DatabaseInstance,
  args: { familyId: string; tenantId: string; userId: string }
): boolean {
  let statement = familyLivenessStatements.get(db);
  if (!statement) {
    statement = prepareFamilyLiveness(db);
    familyLivenessStatements.set(db, statement);
  }
  // One statement on the auth hot path: family liveness plus its device binding.
  const row = statement.get({ familyId: args.familyId });
  if (
    !row ||
    row.tenantId !== args.tenantId ||
    row.userId !== args.userId ||
    row.expiresAt <= new Date().toISOString()
  ) {
    return false;
  }
  if (row.bindingStatus === null) return true;
  return row.bindingStatus === 'active' && row.deviceIsActive === true;
}

/** Returns true when a refresh family is bound to a revoked session or inactive device. */
export function isRefreshFamilyRevokedByDevice(db: DatabaseInstance, familyId: string): boolean {
  const binding = db
    .select({
      status: deviceSessions.status,
      deviceIsActive: devices.isActive,
    })
    .from(deviceSessions)
    .innerJoin(devices, eq(deviceSessions.deviceId, devices.id))
    .where(eq(deviceSessions.refreshFamilyId, familyId))
    .get();

  if (!binding) return false;
  return binding.status !== 'active' || !binding.deviceIsActive;
}

/**
 * Marks every session bound to `deviceId` as revoked and expires only their
 * refresh families, leaving all other terminals of the same user untouched.
 */
export function revokeDeviceSessionsForDevice(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    deviceId: string;
    revokedByUserId: string;
    nowIso: string;
  }
): { totalBoundSessions: number; revokedCount: number } {
  const boundRows = db
    .select({
      id: deviceSessions.id,
      status: deviceSessions.status,
      refreshFamilyId: deviceSessions.refreshFamilyId,
    })
    .from(deviceSessions)
    .where(
      and(eq(deviceSessions.tenantId, args.tenantId), eq(deviceSessions.deviceId, args.deviceId))
    )
    .all();

  if (boundRows.length === 0) {
    return { totalBoundSessions: 0, revokedCount: 0 };
  }

  const activeRows = boundRows.filter(row => row.status === 'active');
  if (activeRows.length > 0) {
    db.update(deviceSessions)
      .set({
        status: 'revoked',
        revokedAt: args.nowIso,
        revokedByUserId: args.revokedByUserId,
        updatedAt: args.nowIso,
      })
      .where(
        and(
          eq(deviceSessions.tenantId, args.tenantId),
          eq(deviceSessions.deviceId, args.deviceId),
          eq(deviceSessions.status, 'active')
        )
      )
      .run();
  }

  // Expire rather than delete the family rows so `device_sessions` keeps its
  // revocation record even with ON DELETE CASCADE on `refresh_family_id`.
  const familyIds = boundRows.map(row => row.refreshFamilyId);
  db.update(authRefreshFamilies)
    .set({ expiresAt: EXPIRED_EPOCH_ISO })
    .where(
      and(
        eq(authRefreshFamilies.tenantId, args.tenantId),
        inArray(authRefreshFamilies.id, familyIds)
      )
    )
    .run();

  return {
    totalBoundSessions: boundRows.length,
    revokedCount: activeRows.length,
  };
}

/**
 * Expires the live refresh families of `userIds` that no terminal claims, sparing
 * `keepFamilyId` (the revoker's own session). An unbound family cannot be traced
 * to a device, so a device revoke must not let it outlive the device.
 */
export function expireUnboundFamiliesForUsers(
  db: DatabaseInstance,
  args: { tenantId: string; userIds: readonly string[]; keepFamilyId?: string; nowIso: string }
): number {
  if (args.userIds.length === 0) return 0;
  const result = db
    .update(authRefreshFamilies)
    .set({ expiresAt: EXPIRED_EPOCH_ISO })
    .where(
      and(
        eq(authRefreshFamilies.tenantId, args.tenantId),
        inArray(authRefreshFamilies.userId, [...args.userIds]),
        gt(authRefreshFamilies.expiresAt, args.nowIso),
        ...(args.keepFamilyId ? [ne(authRefreshFamilies.id, args.keepFamilyId)] : []),
        notExists(
          db
            .select({ id: deviceSessions.id })
            .from(deviceSessions)
            .where(eq(deviceSessions.refreshFamilyId, authRefreshFamilies.id))
        )
      )
    )
    .run() as { changes?: number };
  return result.changes ?? 0;
}
