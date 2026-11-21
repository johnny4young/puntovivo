/**
 * `registerZones.set` — admin override of one register zone.
 *
 * Overrides live in `tenants.settings.registerZones` and reach every register
 * through the `auth.me` settings projection. A value equal to the profile
 * default is removed, so the zone follows the profile again.
 *
 * @module trpc/routers/registerZones
 */

import { eq, sql } from 'drizzle-orm';
import {
  defaultRegisterZones,
  resolveRegisterZone,
  sanitizeRegisterZoneOverrides,
} from '@puntovivo/shared/register-zones';
import { tenants } from '../../db/schema.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { router } from '../init.js';
import { adminProcedure } from '../middleware/roles.js';
import { setRegisterZoneInput } from '../schemas/registerZones.js';

export const registerZonesRouter = router({
  set: adminProcedure.input(setRegisterZoneInput).mutation(({ ctx, input }) => {
    const { zoneId, enabled } = input;
    return ctx.db.transaction(
      tx => {
        const row = tx
          .select({ settings: tenants.settings })
          .from(tenants)
          .where(eq(tenants.id, ctx.tenantId))
          .get();
        const settings = (row?.settings ?? {}) as Record<string, unknown>;
        const stored = sanitizeRegisterZoneOverrides(settings.registerZones);
        const wasEnabled = resolveRegisterZone(settings.businessType, stored, zoneId);
        const followsProfile = defaultRegisterZones(settings.businessType)[zoneId] === enabled;
        if (stored[zoneId] === (followsProfile ? undefined : enabled)) {
          return { overrides: stored };
        }

        const overrides = { ...stored };
        if (followsProfile) delete overrides[zoneId];
        else overrides[zoneId] = enabled;

        // The whole object, so a malformed stored value cannot swallow the write.
        tx.update(tenants)
          .set({
            settings: sql`json_set(COALESCE(${tenants.settings}, '{}'), '$.registerZones', json(${JSON.stringify(overrides)}))`,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(tenants.id, ctx.tenantId))
          .run();

        // Clearing a redundant override changes nothing visible, so it is not audited.
        if (wasEnabled !== enabled) {
          writeAuditLog({
            tx,
            tenantId: ctx.tenantId,
            actorId: ctx.user!.id,
            action: 'register_zone.toggle',
            resourceType: 'tenant_register_zone',
            resourceId: zoneId,
            before: { enabled: wasEnabled },
            after: { enabled },
            metadata: { followsProfile },
          });
        }

        return { overrides };
      },
      { behavior: 'immediate' }
    );
  }),
});

export type RegisterZonesRouter = typeof registerZonesRouter;
