import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { nanoid } from 'nanoid';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { companies, syncQueue } from '../../db/schema.js';
import { upsertCompanyInput } from '../schemas/companies.js';

export const companiesRouter = router({
  getCurrent: tenantProcedure.query(async ({ ctx }) => {
    const company = await ctx.db
      .select()
      .from(companies)
      .where(eq(companies.tenantId, ctx.tenantId))
      .get();

    return company ?? null;
  }),

  upsert: tenantProcedure.input(upsertCompanyInput).mutation(async ({ ctx, input }) => {
    if (ctx.user!.role !== 'admin') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only administrators can update company settings',
      });
    }

    const now = new Date().toISOString();
    const existing = await ctx.db
      .select()
      .from(companies)
      .where(eq(companies.tenantId, ctx.tenantId))
      .get();

    if (existing) {
      const updateData = {
        name: input.name,
        taxId: input.taxId ?? null,
        address: input.address ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        logoUrl: input.logoUrl ?? null,
        updatedAt: now,
      };

      await ctx.db.update(companies).set(updateData).where(eq(companies.id, existing.id));

      await ctx.db.insert(syncQueue).values({
        id: nanoid(),
        tenantId: ctx.tenantId,
        entityType: 'companies',
        entityId: existing.id,
        operation: 'update',
        data: { id: existing.id, ...updateData },
        localVersion: 1,
        attempts: 0,
        createdAt: now,
      });

      return (await ctx.db.select().from(companies).where(eq(companies.id, existing.id)).get())!;
    }

    const id = nanoid();
    await ctx.db.insert(companies).values({
      id,
      tenantId: ctx.tenantId,
      name: input.name,
      taxId: input.taxId ?? null,
      address: input.address ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      logoUrl: input.logoUrl ?? null,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'companies',
      entityId: id,
      operation: 'create',
      data: { id, ...input },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    return (await ctx.db.select().from(companies).where(eq(companies.id, id)).get())!;
  }),
});
