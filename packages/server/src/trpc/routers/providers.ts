/**
 * Providers tRPC Router
 *
 * CRUD and search operations for suppliers/providers with tenant isolation.
 *
 * Procedures:
 * - providers.list
 * - providers.getById
 * - providers.create
 * - providers.update
 * - providers.delete
 * - providers.search
 *
 * @module trpc/routers/providers
 */

import { TRPCError } from '@trpc/server';
import { and, eq, like, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { adminProcedure } from '../middleware/roles.js';
import { providers, syncQueue } from '../../db/schema.js';
import {
  createProviderInput,
  deleteProviderInput,
  getProviderInput,
  listProvidersInput,
  searchProvidersInput,
  updateProviderInput,
} from '../schemas/providers.js';

export const providersRouter = router({
  list: tenantProcedure.input(listProvidersInput).query(async ({ ctx, input }) => {
    const { page, perPage, search, isActive } = input;
    const offset = (page - 1) * perPage;

    const conditions = [eq(providers.tenantId, ctx.tenantId)];
    if (search) {
      conditions.push(
        or(
          like(providers.name, `%${search}%`),
          like(providers.email, `%${search}%`),
          like(providers.phone, `%${search}%`),
          like(providers.contactName, `%${search}%`)
        )!
      );
    }
    if (isActive !== undefined) {
      conditions.push(eq(providers.isActive, isActive));
    }

    const where = and(...conditions);

    const [items, countResult] = await Promise.all([
      ctx.db.select().from(providers).where(where).limit(perPage).offset(offset).all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(providers)
        .where(where)
        .get(),
    ]);

    const totalItems = countResult?.count ?? 0;

    return {
      items,
      page,
      perPage,
      totalItems,
      totalPages: Math.ceil(totalItems / perPage),
    };
  }),

  getById: tenantProcedure.input(getProviderInput).query(async ({ ctx, input }) => {
    const provider = await ctx.db
      .select()
      .from(providers)
      .where(and(eq(providers.id, input.id), eq(providers.tenantId, ctx.tenantId)))
      .get();

    if (!provider) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Provider not found' });
    }

    return provider;
  }),

  create: adminProcedure.input(createProviderInput).mutation(async ({ ctx, input }) => {
    const now = new Date().toISOString();
    const id = nanoid();

    await ctx.db.insert(providers).values({
      id,
      tenantId: ctx.tenantId,
      name: input.name,
      taxId: input.taxId,
      phone: input.phone,
      email: input.email,
      address: input.address,
      cityId: input.cityId,
      contactName: input.contactName,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'providers',
      entityId: id,
      operation: 'create',
      data: { id, ...input },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    const created = await ctx.db.select().from(providers).where(eq(providers.id, id)).get();

    return created!;
  }),

  update: adminProcedure.input(updateProviderInput).mutation(async ({ ctx, input }) => {
    const { id, ...updates } = input;

    const existing = await ctx.db
      .select()
      .from(providers)
      .where(and(eq(providers.id, id), eq(providers.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Provider not found' });
    }

    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = { updatedAt: now };

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.taxId !== undefined) updateData.taxId = updates.taxId;
    if (updates.phone !== undefined) updateData.phone = updates.phone;
    if (updates.email !== undefined) updateData.email = updates.email;
    if (updates.address !== undefined) updateData.address = updates.address;
    if (updates.cityId !== undefined) updateData.cityId = updates.cityId;
    if (updates.contactName !== undefined) updateData.contactName = updates.contactName;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

    await ctx.db.update(providers).set(updateData).where(eq(providers.id, id));

    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'providers',
      entityId: id,
      operation: 'update',
      data: { id, ...updateData },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    const updated = await ctx.db.select().from(providers).where(eq(providers.id, id)).get();

    return updated!;
  }),

  delete: adminProcedure.input(deleteProviderInput).mutation(async ({ ctx, input }) => {
    const existing = await ctx.db
      .select()
      .from(providers)
      .where(and(eq(providers.id, input.id), eq(providers.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Provider not found' });
    }

    await ctx.db.delete(providers).where(eq(providers.id, input.id));

    const now = new Date().toISOString();
    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'providers',
      entityId: input.id,
      operation: 'delete',
      data: { id: input.id },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    return { success: true, id: input.id };
  }),

  search: tenantProcedure.input(searchProvidersInput).query(async ({ ctx, input }) => {
    const items = await ctx.db
      .select()
      .from(providers)
      .where(
        and(
          eq(providers.tenantId, ctx.tenantId),
          or(
            like(providers.name, `%${input.q}%`),
            like(providers.email, `%${input.q}%`),
            like(providers.phone, `%${input.q}%`),
            like(providers.contactName, `%${input.q}%`)
          )
        )
      )
      .limit(input.limit)
      .all();

    return { items };
  }),
});
