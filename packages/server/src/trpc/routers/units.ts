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
import { and, eq, like, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { adminProcedure } from '../middleware/roles.js';
import { units } from '../../db/schema.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import { lookupUnitStandard } from '../../services/units/unit-standards.js';
import { paginatedList } from '../lib/paginatedList.js';
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

    const conditions = [eq(units.tenantId, ctx.tenantId)];
    if (search) {
      conditions.push(
        or(like(units.name, `%${search}%`), like(units.abbreviation, `%${search}%`))!
      );
    }
    if (isActive !== undefined) {
      conditions.push(eq(units.isActive, isActive));
    }

    // A-22 — one predicate feeds both the page and the count.
    return paginatedList({ db: ctx.db, table: units, where: and(...conditions), page, perPage });
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

    // Backfill dimension / standard code / reference factor from the
    // standards catalog when the operator did not supply them, so a plain
    // "KG" create still lands fiscal-ready. Explicit input always wins.
    const standard = lookupUnitStandard(input.abbreviation);
    const dimension = input.dimension ?? standard?.dimension ?? null;
    const standardCode = input.standardCode ?? standard?.standardCode ?? null;
    const referenceFactor = input.referenceFactor ?? standard?.referenceFactor ?? null;

    await ctx.db.insert(units).values({
      id,
      tenantId: ctx.tenantId,
      name: input.name,
      abbreviation: input.abbreviation,
      dimension,
      standardCode,
      referenceFactor,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    });

    await enqueueSync(ctx, {
      entityType: 'units',
      entityId: id,
      operation: 'create',
      data: { id, ...input, dimension, standardCode, referenceFactor },
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
    if (updates.dimension !== undefined) updateData.dimension = updates.dimension;
    if (updates.standardCode !== undefined) updateData.standardCode = updates.standardCode;
    if (updates.referenceFactor !== undefined) updateData.referenceFactor = updates.referenceFactor;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

    await ctx.db
      .update(units)
      .set(updateData)
      .where(and(eq(units.id, id), eq(units.tenantId, ctx.tenantId)));

    await enqueueSync(ctx, {
      entityType: 'units',
      entityId: id,
      operation: 'update',
      data: { id, ...updateData },
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

    await ctx.db.delete(units).where(and(eq(units.id, input.id), eq(units.tenantId, ctx.tenantId)));

    await enqueueSync(ctx, {
      entityType: 'units',
      entityId: input.id,
      operation: 'delete',
      data: { id: input.id },
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
