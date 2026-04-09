import { TRPCError } from '@trpc/server';
import { and, asc, eq, like, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { companies, logos, syncQueue } from '../../db/schema.js';
import { router } from '../init.js';
import { adminProcedure } from '../middleware/roles.js';
import { tenantProcedure } from '../middleware/tenant.js';
import {
  createLogoInput,
  deleteLogoInput,
  listLogosInput,
  updateLogoInput,
} from '../schemas/logos.js';

async function ensureTenantLogo(tenantId: string, id: string, db: DatabaseInstance) {
  const logo = await db
    .select()
    .from(logos)
    .where(and(eq(logos.id, id), eq(logos.tenantId, tenantId)))
    .get();

  if (!logo) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Logo not found' });
  }

  return logo;
}

export const logosRouter = router({
  list: tenantProcedure.input(listLogosInput).query(async ({ ctx, input }) => {
    const conditions = [eq(logos.tenantId, ctx.tenantId)];

    if (input.search) {
      conditions.push(or(like(logos.name, `%${input.search}%`), like(logos.imageUrl, `%${input.search}%`))!);
    }

    if (!input.includeInactive) {
      conditions.push(eq(logos.isActive, true));
    }

    const items = await ctx.db
      .select({
        id: logos.id,
        tenantId: logos.tenantId,
        name: logos.name,
        imageUrl: logos.imageUrl,
        isActive: logos.isActive,
        createdAt: logos.createdAt,
        updatedAt: logos.updatedAt,
        assignedCompanyCount: sql<number>`(
          select count(*)
          from companies
          where companies.logo_id = ${logos.id}
        )`,
      })
      .from(logos)
      .where(and(...conditions))
      .orderBy(asc(logos.name))
      .all();

    return { items };
  }),

  create: adminProcedure.input(createLogoInput).mutation(async ({ ctx, input }) => {
    const now = new Date().toISOString();
    const id = nanoid();

    await ctx.db.insert(logos).values({
      id,
      tenantId: ctx.tenantId,
      name: input.name,
      imageUrl: input.imageUrl,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'logos',
      entityId: id,
      operation: 'create',
      data: { id, ...input },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    return (await ctx.db.select().from(logos).where(eq(logos.id, id)).get())!;
  }),

  update: adminProcedure.input(updateLogoInput).mutation(async ({ ctx, input }) => {
    const { id, ...updates } = input;
    const existing = await ensureTenantLogo(ctx.tenantId, id, ctx.db);
    const now = new Date().toISOString();
    const nextImageUrl = updates.imageUrl ?? existing.imageUrl;
    const nextName = updates.name ?? existing.name;
    const nextIsActive = updates.isActive ?? existing.isActive;

    await ctx.db
      .update(logos)
      .set({
        name: nextName,
        imageUrl: nextImageUrl,
        isActive: nextIsActive,
        updatedAt: now,
      })
      .where(eq(logos.id, id));

    const assignedCompanies = await ctx.db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.tenantId, ctx.tenantId), eq(companies.logoId, id)))
      .all();

    ctx.db.transaction(tx => {
      for (const company of assignedCompanies) {
        tx.update(companies)
          .set({
            logoUrl: nextImageUrl,
            updatedAt: now,
          })
          .where(eq(companies.id, company.id))
          .run();
        tx.insert(syncQueue)
          .values({
            id: nanoid(),
            tenantId: ctx.tenantId,
            entityType: 'companies',
            entityId: company.id,
            operation: 'update',
            data: { id: company.id, logoId: id, logoUrl: nextImageUrl, updatedAt: now },
            localVersion: 1,
            attempts: 0,
            createdAt: now,
          })
          .run();
      }
    });

    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'logos',
      entityId: id,
      operation: 'update',
      data: { id, name: nextName, imageUrl: nextImageUrl, isActive: nextIsActive, updatedAt: now },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    return (await ctx.db.select().from(logos).where(eq(logos.id, id)).get())!;
  }),

  delete: adminProcedure.input(deleteLogoInput).mutation(async ({ ctx, input }) => {
    await ensureTenantLogo(ctx.tenantId, input.id, ctx.db);

    const assignedCompany = await ctx.db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.tenantId, ctx.tenantId), eq(companies.logoId, input.id)))
      .get();

    if (assignedCompany) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Unassign this logo from the company before deleting it.',
      });
    }

    await ctx.db.delete(logos).where(eq(logos.id, input.id));

    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'logos',
      entityId: input.id,
      operation: 'delete',
      data: { id: input.id },
      localVersion: 1,
      attempts: 0,
      createdAt: new Date().toISOString(),
    });

    return { success: true, id: input.id };
  }),
});
