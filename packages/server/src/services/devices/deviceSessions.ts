/**
 * Device-scoped session bindings (`device_sessions`).
 *
 * Binds a refresh-token family to the terminal that registered or authenticated
 * with it so revoking one `hub_client` kills only that terminal's access and
 * refresh tokens without forcing the registering user to re-login elsewhere.
 */
import { and, eq, inArray } from 'drizzle-orm';
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

/**
 * Checks whether an access token's refresh family is still live and, if bound
 * to a device session, that neither the binding nor the device has been revoked.
 */
export function isAccessFamilyActive(
  db: DatabaseInstance,
  args: { familyId: string; tenantId: string; userId: string }
): boolean {
  const nowIso = new Date().toISOString();
  const family = db
    .select({
      tenantId: authRefreshFamilies.tenantId,
      userId: authRefreshFamilies.userId,
      expiresAt: authRefreshFamilies.expiresAt,
    })
    .from(authRefreshFamilies)
    .where(eq(authRefreshFamilies.id, args.familyId))
    .get();

  if (
    !family ||
    family.tenantId !== args.tenantId ||
    family.userId !== args.userId ||
    family.expiresAt <= nowIso
  ) {
    return false;
  }

  return !isRefreshFamilyRevokedByDevice(db, args.familyId);
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
