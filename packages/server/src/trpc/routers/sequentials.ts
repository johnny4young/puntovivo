import { TRPCError } from '@trpc/server';
import { and, asc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { adminProcedure } from '../middleware/roles.js';
import { sequentials, sites } from '../../db/schema.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import {
  deleteSequentialInput,
  listSequentialsInput,
  upsertSequentialInput,
} from '../schemas/sequentials.js';

export const sequentialsRouter = router({
  list: tenantProcedure.input(listSequentialsInput).query(async ({ ctx, input }) => {
    const conditions = [eq(sequentials.tenantId, ctx.tenantId)];

    if (input?.siteId) {
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
    const site = await ctx.db
      .select()
      .from(sites)
      .where(and(eq(sites.id, input.siteId), eq(sites.tenantId, ctx.tenantId)))
      .get();

    if (!site) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Site not found' });
    }

    const now = new Date().toISOString();
    const existing = await ctx.db
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

    if (existing) {
      const updateData = {
        prefix: input.prefix,
        currentValue: input.currentValue,
        updatedAt: now,
      };

      await ctx.db.update(sequentials).set(updateData).where(eq(sequentials.id, existing.id));

      await enqueueSync(ctx, {
        entityType: 'sequentials',
        entityId: existing.id,
        operation: 'update',
        data: { id: existing.id, ...updateData },
      });

      return (
        await ctx.db.select().from(sequentials).where(eq(sequentials.id, existing.id)).get()
      )!;
    }

    const id = nanoid();
    await ctx.db.insert(sequentials).values({
      id,
      tenantId: ctx.tenantId,
      siteId: input.siteId,
      documentType: input.documentType,
      prefix: input.prefix,
      currentValue: input.currentValue,
      createdAt: now,
      updatedAt: now,
    });

    await enqueueSync(ctx, {
      entityType: 'sequentials',
      entityId: id,
      operation: 'create',
      data: { id, ...input },
    });

    return (await ctx.db.select().from(sequentials).where(eq(sequentials.id, id)).get())!;
  }),

  delete: adminProcedure.input(deleteSequentialInput).mutation(async ({ ctx, input }) => {
    const existing = await ctx.db
      .select()
      .from(sequentials)
      .where(and(eq(sequentials.id, input.id), eq(sequentials.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Sequential configuration not found' });
    }

    await ctx.db.delete(sequentials).where(eq(sequentials.id, input.id));

    await enqueueSync(ctx, {
      entityType: 'sequentials',
      entityId: input.id,
      operation: 'delete',
      data: { id: input.id },
    });

    return { success: true, id: input.id };
  }),
});
