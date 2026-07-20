/**
 * Cities tRPC router (geography).
 *
 * extracted verbatim from the former flat `trpc/routers/geography.ts`
 * during the megafile decomposition. The barrel re-exports `citiesRouter` under
 * the same name, so `appRouter` and the caller-based tests are unchanged.
 *
 * @module trpc/routers/geography/cities
 */
import { TRPCError } from '@trpc/server';
import { and, eq, like, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { cities, countries, departments, providers } from '../../../db/schema.js';
import { enqueueSync } from '../../../services/sync/enqueue.js';
import { router } from '../../init.js';
import { adminProcedure } from '../../middleware/roles.js';
import { tenantProcedure } from '../../middleware/tenant.js';
import {
  createCityInput,
  deleteCityInput,
  getCityInput,
  listCitiesInput,
  searchCitiesInput,
  updateCityInput,
} from '../../schemas/geography.js';
import { buildCitySelection, ensureCityUniqueness, ensureDepartmentExists } from './helpers.js';

export const citiesRouter = router({
  list: tenantProcedure.input(listCitiesInput).query(async ({ ctx, input }) => {
    const { page, perPage, search, isActive, departmentId } = input;
    const offset = (page - 1) * perPage;
    const conditions = [eq(cities.tenantId, ctx.tenantId)];

    if (departmentId) {
      conditions.push(eq(cities.departmentId, departmentId));
    }

    if (isActive !== undefined) {
      conditions.push(eq(cities.isActive, isActive));
    }

    if (search) {
      conditions.push(
        or(
          like(cities.code, `%${search}%`),
          like(cities.name, `%${search}%`),
          like(departments.name, `%${search}%`),
          like(countries.name, `%${search}%`)
        )!
      );
    }

    const where = and(...conditions);
    const [items, countRow] = await Promise.all([
      ctx.db
        .select(buildCitySelection())
        .from(cities)
        .innerJoin(departments, eq(cities.departmentId, departments.id))
        .leftJoin(countries, eq(departments.countryId, countries.id))
        .where(where)
        .limit(perPage)
        .offset(offset)
        .all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(cities)
        .innerJoin(departments, eq(cities.departmentId, departments.id))
        .leftJoin(countries, eq(departments.countryId, countries.id))
        .where(where)
        .get(),
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

  getById: tenantProcedure.input(getCityInput).query(async ({ ctx, input }) => {
    const city = await ctx.db
      .select(buildCitySelection())
      .from(cities)
      .innerJoin(departments, eq(cities.departmentId, departments.id))
      .leftJoin(countries, eq(departments.countryId, countries.id))
      .where(and(eq(cities.id, input.id), eq(cities.tenantId, ctx.tenantId)))
      .get();

    if (!city) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'City not found' });
    }

    return city;
  }),

  create: adminProcedure.input(createCityInput).mutation(async ({ ctx, input }) => {
    const departmentId = await ensureDepartmentExists(ctx.db, ctx.tenantId, input.departmentId);
    await ensureCityUniqueness(ctx.db, ctx.tenantId, {
      departmentId,
      code: input.code,
      name: input.name,
    });

    const now = new Date().toISOString();
    const id = nanoid();

    await ctx.db.insert(cities).values({
      id,
      tenantId: ctx.tenantId,
      departmentId,
      code: input.code,
      name: input.name,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    });

    await enqueueSync(ctx, {
      entityType: 'cities',
      entityId: id,
      operation: 'create',
      data: { id, ...input },
    });

    return ctx.db
      .select(buildCitySelection())
      .from(cities)
      .innerJoin(departments, eq(cities.departmentId, departments.id))
      .leftJoin(countries, eq(departments.countryId, countries.id))
      .where(eq(cities.id, id))
      .get();
  }),

  update: adminProcedure.input(updateCityInput).mutation(async ({ ctx, input }) => {
    const { id, ...updates } = input;
    const existing = await ctx.db
      .select()
      .from(cities)
      .where(and(eq(cities.id, id), eq(cities.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'City not found' });
    }

    const nextDepartmentId =
      updates.departmentId !== undefined
        ? await ensureDepartmentExists(ctx.db, ctx.tenantId, updates.departmentId)
        : existing.departmentId;

    await ensureCityUniqueness(ctx.db, ctx.tenantId, {
      id,
      departmentId: nextDepartmentId,
      code: updates.code,
      name: updates.name,
    });

    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = { updatedAt: now };

    if (updates.departmentId !== undefined) updateData.departmentId = nextDepartmentId;
    if (updates.code !== undefined) updateData.code = updates.code;
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

    await ctx.db
      .update(cities)
      .set(updateData)
      .where(and(eq(cities.id, id), eq(cities.tenantId, ctx.tenantId)));

    await enqueueSync(ctx, {
      entityType: 'cities',
      entityId: id,
      operation: 'update',
      data: { id, ...updateData },
    });

    return ctx.db
      .select(buildCitySelection())
      .from(cities)
      .innerJoin(departments, eq(cities.departmentId, departments.id))
      .leftJoin(countries, eq(departments.countryId, countries.id))
      .where(eq(cities.id, id))
      .get();
  }),

  delete: adminProcedure.input(deleteCityInput).mutation(async ({ ctx, input }) => {
    const existing = await ctx.db
      .select()
      .from(cities)
      .where(and(eq(cities.id, input.id), eq(cities.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'City not found' });
    }

    const assignedProvider = await ctx.db
      .select({ id: providers.id })
      .from(providers)
      .where(and(eq(providers.tenantId, ctx.tenantId), eq(providers.cityId, input.id)))
      .get();

    if (assignedProvider) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'This city is assigned to one or more providers',
      });
    }

    await ctx.db
      .delete(cities)
      .where(and(eq(cities.id, input.id), eq(cities.tenantId, ctx.tenantId)));

    await enqueueSync(ctx, {
      entityType: 'cities',
      entityId: input.id,
      operation: 'delete',
      data: { id: input.id },
    });

    return { success: true, id: input.id };
  }),

  search: tenantProcedure.input(searchCitiesInput).query(async ({ ctx, input }) => {
    const conditions = [eq(cities.tenantId, ctx.tenantId)];

    if (input.isActive !== undefined) {
      conditions.push(eq(cities.isActive, input.isActive));
    }

    if (input.departmentId) {
      conditions.push(eq(cities.departmentId, input.departmentId));
    }

    const items = await ctx.db
      .select(buildCitySelection())
      .from(cities)
      .innerJoin(departments, eq(cities.departmentId, departments.id))
      .leftJoin(countries, eq(departments.countryId, countries.id))
      .where(
        and(
          ...conditions,
          or(
            like(cities.code, `%${input.q}%`),
            like(cities.name, `%${input.q}%`),
            like(departments.name, `%${input.q}%`),
            like(countries.name, `%${input.q}%`)
          )!
        )
      )
      .limit(input.limit)
      .all();

    return { items };
  }),
});
