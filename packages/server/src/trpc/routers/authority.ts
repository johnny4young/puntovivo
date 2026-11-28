/**
 * Authority Node pairing + health.
 *
 * Manager/admin callers can inspect the active topology; admin callers
 * create pairing codes and revoke hub-client terminals.
 */

import { and, eq, sql } from 'drizzle-orm';
import { getActiveRuntimeConfig } from '../../config/runtime.js';
import { devices, users } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  claimPairingCodeForDevice,
  createPairingCode,
  getAuthorityTopology,
  inferAuthorityRole,
} from '../../services/devices/authority.js';
import {
  expireUnboundFamiliesForUsers,
  revokeDeviceSessionsForDevice,
} from '../../services/devices/deviceSessions.js';
import { router } from '../init.js';
import {
  adminProcedureWithModule,
  managerOrAdminProcedureWithModule,
} from '../middleware/modules.js';
import {
  consumePairingCodeInput,
  createPairingCodeInput,
  revokeAuthorityDeviceInput,
} from '../schemas/authority.js';

export const authorityRouter = router({
  status: managerOrAdminProcedureWithModule('operations-center').query(async ({ ctx }) =>
    getAuthorityTopology(ctx.db, ctx.tenantId, getActiveRuntimeConfig())
  ),

  createPairingCode: adminProcedureWithModule('operations-center')
    .input(createPairingCodeInput)
    .mutation(async ({ ctx, input }) =>
      createPairingCode(ctx.db, {
        tenantId: ctx.tenantId,
        siteId: input.siteId,
        createdByUserId: ctx.user!.id,
        deviceName: input.deviceName,
        expiresInMinutes: input.expiresInMinutes,
      })
    ),

  consumePairingCode: managerOrAdminProcedureWithModule('operations-center')
    .input(consumePairingCodeInput)
    .mutation(async ({ ctx, input }) =>
      claimPairingCodeForDevice(ctx.db, {
        tenantId: ctx.tenantId,
        code: input.code,
        deviceId: input.deviceId,
        actorUserId: ctx.user!.id,
      })
    ),

  revokeDevice: adminProcedureWithModule('operations-center')
    .input(revokeAuthorityDeviceInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select({
          id: devices.id,
          name: devices.name,
          kind: devices.kind,
          authorityRole: devices.authorityRole,
          pairedSiteId: devices.pairedSiteId,
          isActive: devices.isActive,
          registeredByUserId: devices.registeredByUserId,
          activeUserId: devices.activeUserId,
        })
        .from(devices)
        .where(and(eq(devices.tenantId, ctx.tenantId), eq(devices.id, input.deviceId)))
        .get();

      if (!existing || !existing.isActive) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'DEVICE_NOT_REGISTERED',
          message: 'Device is not registered for this tenant',
          details: { deviceId: input.deviceId },
        });
      }

      const role = existing.authorityRole ?? inferAuthorityRole(existing.kind);
      if (role !== 'hub_client') {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'AUTHORITY_DEVICE_NOT_REVOKABLE',
          message: 'Only hub client devices can be revoked from Authority health',
          details: { deviceId: input.deviceId, role },
        });
      }

      const nowIso = new Date().toISOString();
      ctx.db.transaction(tx => {
        tx.update(devices)
          .set({ isActive: false, updatedAt: nowIso })
          .where(and(eq(devices.tenantId, ctx.tenantId), eq(devices.id, input.deviceId)))
          .run();

        // Revoke only the sessions bound to this hub client. Fall back to bumping
        // the registering user's sessionVersion only for legacy unpaired devices.
        const sessionRevocation = revokeDeviceSessionsForDevice(tx as unknown as typeof ctx.db, {
          tenantId: ctx.tenantId,
          deviceId: input.deviceId,
          revokedByUserId: ctx.user!.id,
          nowIso,
        });
        const expiredUnboundFamilies = expireUnboundFamiliesForUsers(
          tx as unknown as typeof ctx.db,
          {
            tenantId: ctx.tenantId,
            userIds: [
              ...new Set(
                [existing.registeredByUserId, existing.activeUserId].filter(
                  (userId): userId is string => Boolean(userId)
                )
              ),
            ],
            ...(ctx.user!.familyId ? { keepFamilyId: ctx.user!.familyId } : {}),
            nowIso,
          }
        );
        const sessionVersionBumped = sessionRevocation.totalBoundSessions === 0;
        if (sessionVersionBumped) {
          tx.update(users)
            .set({
              sessionVersion: sql`${users.sessionVersion} + 1`,
              updatedAt: nowIso,
            })
            .where(and(eq(users.tenantId, ctx.tenantId), eq(users.id, existing.registeredByUserId)))
            .run();
        }

        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user!.id,
          action: 'device.revoke',
          resourceType: 'device',
          resourceId: input.deviceId,
          before: {
            name: existing.name,
            kind: existing.kind,
            authorityRole: role,
            pairedSiteId: existing.pairedSiteId,
            isActive: existing.isActive,
          },
          after: { isActive: false },
          metadata: {
            reason: 'authority_hub_client_revoke',
            registeredByUserId: existing.registeredByUserId,
            sessionVersionBumped,
            revokedDeviceSessions: sessionRevocation.revokedCount,
            expiredUnboundFamilies,
          },
        });
      });

      return { success: true, deviceId: input.deviceId };
    }),
});

export type AuthorityRouter = typeof authorityRouter;
