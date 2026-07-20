/** admin-only retention policy, preview, and on-demand sweep. */

import { eq } from 'drizzle-orm';

import { tenants } from '../../db/schema.js';
import {
  DATA_RETENTION_LIMITS,
  DEFAULT_DATA_RETENTION_POLICY,
  mergeDataRetentionPolicy,
  normalizeDataRetentionPolicy,
  previewDataRetention,
  resolveDataRetentionPolicy,
  runDataRetentionSweep,
} from '../../services/data-retention.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { router } from '../init.js';
import { adminProcedure } from '../middleware/roles.js';
import { updateDataRetentionPolicyInput } from '../schemas/dataRetention.js';

export const dataRetentionRouter = router({
  get: adminProcedure.query(async ({ ctx }) => ({
    policy: await resolveDataRetentionPolicy(ctx.db, ctx.tenantId),
    defaults: DEFAULT_DATA_RETENTION_POLICY,
    limits: DATA_RETENTION_LIMITS,
  })),

  preview: adminProcedure.query(({ ctx }) => previewDataRetention(ctx.db, ctx.tenantId)),

  update: adminProcedure.input(updateDataRetentionPolicyInput).mutation(({ ctx, input }) => {
    const now = new Date().toISOString();
    return ctx.db.transaction(tx => {
      const tenant = tx
        .select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .get();
      const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
      const before = normalizeDataRetentionPolicy(settings.dataRetention);
      const policy = normalizeDataRetentionPolicy(input);

      tx.update(tenants)
        .set({
          settings: mergeDataRetentionPolicy(settings, policy),
          updatedAt: now,
        })
        .where(eq(tenants.id, ctx.tenantId))
        .run();

      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user!.id,
        action: 'data_retention.policy.updated',
        resourceType: 'tenant',
        resourceId: ctx.tenantId,
        before: { ...before },
        after: { ...policy },
      });
      return { policy, updatedAt: now };
    });
  }),

  runNow: adminProcedure.mutation(async ({ ctx }) => {
    return runDataRetentionSweep(ctx.db, ctx.tenantId, new Date(), (tx, result) => {
      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user!.id,
        action: 'data_retention.sweep.run',
        resourceType: 'tenant',
        resourceId: ctx.tenantId,
        metadata: {
          evaluatedAt: result.evaluatedAt,
          deleted: result.deleted,
        },
      });
    });
  }),
});

export type DataRetentionRouter = typeof dataRetentionRouter;
