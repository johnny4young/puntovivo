/**
 * Units tRPC Router
 *
 * CRUD and search operations for measurement units with tenant isolation.
 *
 * Procedures:
 * - units.list
 * - units.getById
 * - units.create
 * - units.update
 * - units.delete
 * - units.search
 *
 * @module trpc/routers/units
 */

import { TRPCError } from '@trpc/server';
import { and, eq, like, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { adminProcedure } from '../middleware/roles.js';
import { syncQueue, units } from '../../db/schema.js';
import {
  createUnitInput,
  deleteUnitInput,
  getUnitInput,
  listUnitsInput,
  searchUnitsInput,
  updateUnitInput,
} from '../schemas/units.js';

export const unitsRouter = router({
  list: tenantProcedure.input(listUnitsInput).query(async ({ ctx, input }) => {
    const { page, perPage, search, isActive } = input;
    const offset = (page - 1) * perPage;

    const conditions = [eq(units.tenantId, ctx.tenantId)];
    if (search) {
      conditions.push(
        or(like(units.name, `%${search}%`), like(units.abbreviation, `%${search}%`))!
      );
    }
    if (isActive !== undefined) {
      conditions.push(eq(units.isActive, isActive));
    }

    const where = and(...conditions);

    const [items, countResult] = await Promise.all([
      ctx.db.select().from(units).where(where).limit(perPage).offset(offset).all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(units)
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

  getById: tenantProcedure.input(getUnitInput).query(async ({ ctx, input }) => {
    const unit = await ctx.db
      .select()
      .from(units)
      .where(and(eq(units.id, input.id), eq(units.tenantId, ctx.tenantId)))
      .get();

    if (!unit) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Unit not found' });
    }

    return unit;
  }),

  create: adminProcedure.input(createUnitInput).mutation(async ({ ctx, input }) => {
    const now = new Date().toISOString();
    const id = nanoid();

    await ctx.db.insert(units).values({
      id,
      tenantId: ctx.tenantId,
      name: input.name,
      abbreviation: input.abbreviation,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'units',
      entityId: id,
      operation: 'create',
      data: { id, ...input },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    const created = await ctx.db.select().from(units).where(eq(units.id, id)).get();

    return created!;
  }),

  update: adminProcedure.input(updateUnitInput).mutation(async ({ ctx, input }) => {
    const { id, ...updates } = input;

    const existing = await ctx.db
      .select()
      .from(units)
      .where(and(eq(units.id, id), eq(units.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Unit not found' });
    }

    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = { updatedAt: now };

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.abbreviation !== undefined) updateData.abbreviation = updates.abbreviation;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

    await ctx.db.update(units).set(updateData).where(eq(units.id, id));

    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'units',
      entityId: id,
      operation: 'update',
      data: { id, ...updateData },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    const updated = await ctx.db.select().from(units).where(eq(units.id, id)).get();

    return updated!;
  }),

  delete: adminProcedure.input(deleteUnitInput).mutation(async ({ ctx, input }) => {
    const existing = await ctx.db
      .select()
      .from(units)
      .where(and(eq(units.id, input.id), eq(units.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Unit not found' });
    }

    await ctx.db.delete(units).where(eq(units.id, input.id));

    const now = new Date().toISOString();
    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'units',
      entityId: input.id,
      operation: 'delete',
      data: { id: input.id },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    return { success: true, id: input.id };
  }),

  search: tenantProcedure.input(searchUnitsInput).query(async ({ ctx, input }) => {
    const items = await ctx.db
      .select()
      .from(units)
      .where(
        and(
          eq(units.tenantId, ctx.tenantId),
          or(like(units.name, `%${input.q}%`), like(units.abbreviation, `%${input.q}%`))
        )
      )
      .limit(input.limit)
      .all();

    return { items };
  }),
});
