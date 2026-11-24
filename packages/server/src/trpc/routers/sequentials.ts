import { TRPCError } from '@trpc/server';
import { and, asc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import { adminProcedure } from '../middleware/roles.js';
import { sequentials, sites } from '../../db/schema.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { getHighestIssuedSequentialValue } from '../../services/sequential-issued.js';
import { throwServerError } from '../../lib/errorCodes.js';
import {
  deleteSequentialInput,
  listSequentialsInput,
  upsertSequentialInput,
} from '../schemas/sequentials.js';

function sequentialAuditSnapshot(row: typeof sequentials.$inferSelect) {
  return {
    siteId: row.siteId,
    documentType: row.documentType,
    prefix: row.prefix,
    currentValue: row.currentValue,
  };
}

export const sequentialsRouter = router({
  list: tenantProcedure.input(listSequentialsInput).query(async ({ ctx, input }) => {
    const conditions = [eq(sequentials.tenantId, ctx.tenantId)];

    if (input?.siteId) {
      // A foreign site id must fail like every other site-scoped procedure,
      // not pass as a tenant site that simply has no numbering.
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      conditions.push(eq(sequentials.siteId, input.siteId));
    }

    if (input?.documentType) {
      conditions.push(eq(sequentials.documentType, input.documentType));
    }

    const items = await ctx.db
      .select({
        id: sequentials.id,
        tenantId: sequentials.tenantId,
        siteId: sequentials.siteId,
        documentType: sequentials.documentType,
        prefix: sequentials.prefix,
        currentValue: sequentials.currentValue,
        createdAt: sequentials.createdAt,
        updatedAt: sequentials.updatedAt,
        siteName: sites.name,
      })
      .from(sequentials)
      .innerJoin(sites, eq(sites.id, sequentials.siteId))
      .where(and(...conditions))
      .orderBy(asc(sites.name), asc(sequentials.documentType))
      .all();

    return { items };
  }),

  upsert: adminProcedure.input(upsertSequentialInput).mutation(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);

    const now = new Date().toISOString();
    return ctx.db.transaction(
      tx => {
        const existing = tx
          .select()
          .from(sequentials)
          .where(
            and(
              eq(sequentials.tenantId, ctx.tenantId),
              eq(sequentials.siteId, input.siteId),
              eq(sequentials.documentType, input.documentType)
            )
          )
          .get();

        const prefix = input.prefix;
        const currentValue = input.currentValue ?? existing?.currentValue ?? 0;
        if (!existing || existing.prefix !== prefix || existing.currentValue !== currentValue) {
          // A counter below an issued number makes the next document collide.
          const highestIssued = getHighestIssuedSequentialValue(tx, {
            tenantId: ctx.tenantId,
            documentType: input.documentType,
            prefix,
          });
          if (currentValue < highestIssued) {
            throwServerError({
              trpcCode: 'BAD_REQUEST',
              errorCode: 'SEQUENTIAL_BELOW_ISSUED',
              message: `The last used number cannot be lower than ${highestIssued}, already issued`,
              details: { highestIssued },
            });
          }
        }

        const syncCtx = { ...ctx, db: tx };
        if (existing) {
          const updateData = {
            prefix,
            ...(input.currentValue === undefined ? {} : { currentValue: input.currentValue }),
            updatedAt: now,
          };

          tx.update(sequentials)
            .set(updateData)
            .where(and(eq(sequentials.id, existing.id), eq(sequentials.tenantId, ctx.tenantId)))
            .run();

          enqueueSyncInTransaction(syncCtx, {
            entityType: 'sequentials',
            entityId: existing.id,
            operation: 'update',
            data: { id: existing.id, ...updateData },
          });

          const updated = tx
            .select()
            .from(sequentials)
            .where(eq(sequentials.id, existing.id))
            .get()!;
          if (
            existing.prefix !== updated.prefix ||
            existing.currentValue !== updated.currentValue
          ) {
            writeAuditLog({
              tx,
              tenantId: ctx.tenantId,
              actorId: ctx.user!.id,
              action: 'sequential.adjust',
              resourceType: 'sequential',
              resourceId: existing.id,
              before: sequentialAuditSnapshot(existing),
              after: sequentialAuditSnapshot(updated),
            });
          }
          return updated;
        }

        const id = nanoid();
        tx.insert(sequentials)
          .values({
            id,
            tenantId: ctx.tenantId,
            siteId: input.siteId,
            documentType: input.documentType,
            prefix,
            currentValue,
            createdAt: now,
            updatedAt: now,
          })
          .run();

        enqueueSyncInTransaction(syncCtx, {
          entityType: 'sequentials',
          entityId: id,
          operation: 'create',
          data: { id, ...input, currentValue },
        });

        const created = tx.select().from(sequentials).where(eq(sequentials.id, id)).get()!;
        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user!.id,
          action: 'sequential.create',
          resourceType: 'sequential',
          resourceId: id,
          before: null,
          after: sequentialAuditSnapshot(created),
        });
        return created;
      },
      { behavior: 'immediate' }
    );
  }),

  delete: adminProcedure.input(deleteSequentialInput).mutation(({ ctx, input }) =>
    ctx.db.transaction(
      tx => {
        const existing = tx
          .select()
          .from(sequentials)
          .where(and(eq(sequentials.id, input.id), eq(sequentials.tenantId, ctx.tenantId)))
          .get();

        if (!existing) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Sequential configuration not found' });
        }

        tx.delete(sequentials)
          .where(and(eq(sequentials.id, input.id), eq(sequentials.tenantId, ctx.tenantId)))
          .run();

        enqueueSyncInTransaction(
          { ...ctx, db: tx },
          {
            entityType: 'sequentials',
            entityId: input.id,
            operation: 'delete',
            data: { id: input.id },
          }
        );

        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user!.id,
          action: 'sequential.delete',
          resourceType: 'sequential',
          resourceId: input.id,
          before: sequentialAuditSnapshot(existing),
          after: null,
        });

        return { success: true, id: input.id };
      },
      { behavior: 'immediate' }
    )
  ),
});
