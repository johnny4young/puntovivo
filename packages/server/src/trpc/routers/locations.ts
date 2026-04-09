import { TRPCError } from '@trpc/server';
import { and, eq, like, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { locations, products, syncQueue } from '../../db/schema.js';
import type { DatabaseInstance } from '../../db/index.js';
import { router } from '../init.js';
import { adminProcedure } from '../middleware/roles.js';
import { tenantProcedure } from '../middleware/tenant.js';
import {
  createLocationInput,
  deleteLocationInput,
  getLocationInput,
  listLocationsInput,
  searchLocationsInput,
  updateLocationInput,
} from '../schemas/locations.js';

async function ensureLocationUniqueness(
  db: DatabaseInstance,
  tenantId: string,
  {
    id,
    code,
    name,
  }: {
    id?: string;
    code?: string;
    name?: string;
  }
) {
  if (code) {
    const existingByCode = await db
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), eq(locations.code, code)))
      .get();

    if (existingByCode && existingByCode.id !== id) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A location with this code already exists',
      });
    }
  }

  if (name) {
    const existingByName = await db
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), eq(locations.name, name)))
      .get();

    if (existingByName && existingByName.id !== id) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A location with this name already exists',
      });
    }
  }
}

export const locationsRouter = router({
  list: tenantProcedure.input(listLocationsInput).query(async ({ ctx, input }) => {
    const { page, perPage, search, isActive } = input;
    const offset = (page - 1) * perPage;
    const conditions = [eq(locations.tenantId, ctx.tenantId)];

    if (search) {
      conditions.push(
        or(
          like(locations.code, `%${search}%`),
          like(locations.name, `%${search}%`),
          like(locations.description, `%${search}%`)
        )!
      );
    }

    if (isActive !== undefined) {
      conditions.push(eq(locations.isActive, isActive));
    }

    const where = and(...conditions);
    const [items, countRow] = await Promise.all([
      ctx.db.select().from(locations).where(where).limit(perPage).offset(offset).all(),
      ctx.db.select({ count: sql<number>`count(*)` }).from(locations).where(where).get(),
    ]);

    const totalItems = countRow?.count ?? 0;

    return {
      items,
      page,
      perPage,
      totalItems,
      totalPages: Math.ceil(totalItems / perPage),
    };
  }),

  getById: tenantProcedure.input(getLocationInput).query(async ({ ctx, input }) => {
    const location = await ctx.db
      .select()
      .from(locations)
      .where(and(eq(locations.id, input.id), eq(locations.tenantId, ctx.tenantId)))
      .get();

    if (!location) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Location not found' });
    }

    return location;
  }),

  create: adminProcedure.input(createLocationInput).mutation(async ({ ctx, input }) => {
    await ensureLocationUniqueness(ctx.db, ctx.tenantId, {
      code: input.code,
      name: input.name,
    });

    const now = new Date().toISOString();
    const id = nanoid();

    await ctx.db.insert(locations).values({
      id,
      tenantId: ctx.tenantId,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'locations',
      entityId: id,
      operation: 'create',
      data: { id, ...input },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    return ctx.db.select().from(locations).where(eq(locations.id, id)).get();
  }),

  update: adminProcedure.input(updateLocationInput).mutation(async ({ ctx, input }) => {
    const { id, ...updates } = input;

    const existing = await ctx.db
      .select()
      .from(locations)
      .where(and(eq(locations.id, id), eq(locations.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Location not found' });
    }

    await ensureLocationUniqueness(ctx.db, ctx.tenantId, {
      id,
      code: updates.code,
      name: updates.name,
    });

    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = { updatedAt: now };

    if (updates.code !== undefined) updateData.code = updates.code;
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

    await ctx.db.update(locations).set(updateData).where(eq(locations.id, id));

    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'locations',
      entityId: id,
      operation: 'update',
      data: { id, ...updateData },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    return ctx.db.select().from(locations).where(eq(locations.id, id)).get();
  }),

  delete: adminProcedure.input(deleteLocationInput).mutation(async ({ ctx, input }) => {
    const existing = await ctx.db
      .select()
      .from(locations)
      .where(and(eq(locations.id, input.id), eq(locations.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Location not found' });
    }

    const assignedProduct = await ctx.db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.tenantId, ctx.tenantId), eq(products.locationId, input.id)))
      .get();

    if (assignedProduct) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'This location is assigned to one or more products',
      });
    }

    await ctx.db.delete(locations).where(eq(locations.id, input.id));

    const now = new Date().toISOString();
    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'locations',
      entityId: input.id,
      operation: 'delete',
      data: { id: input.id },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    return { success: true, id: input.id };
  }),

  search: tenantProcedure.input(searchLocationsInput).query(async ({ ctx, input }) => {
    const conditions = [eq(locations.tenantId, ctx.tenantId)];

    if (input.isActive !== undefined) {
      conditions.push(eq(locations.isActive, input.isActive));
    }

    const items = await ctx.db
      .select()
      .from(locations)
      .where(
        and(
          ...conditions,
          or(
            like(locations.code, `%${input.q}%`),
            like(locations.name, `%${input.q}%`),
            like(locations.description, `%${input.q}%`)
          )
        )
      )
      .limit(input.limit)
      .all();

    return { items };
  }),
});
