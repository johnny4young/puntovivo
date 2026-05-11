/**
 * ENG-075 — Authority Node pairing + health.
 *
 * Manager/admin callers can inspect the active topology; admin callers
 * create pairing codes and revoke hub-client terminals.
 */

import { and, eq } from 'drizzle-orm';
import { getActiveRuntimeConfig } from '../../config/runtime.js';
import { devices } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  claimPairingCodeForDevice,
  createPairingCode,
  getAuthorityTopology,
  inferAuthorityRole,
} from '../../services/devices/authority.js';
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
          metadata: { reason: 'authority_hub_client_revoke' },
        });
      });

      return { success: true, deviceId: input.deviceId };
    }),
});

export type AuthorityRouter = typeof authorityRouter;
