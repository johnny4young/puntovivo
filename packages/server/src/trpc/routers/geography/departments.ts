/**
 * Departments tRPC router (geography).
 *
 * extracted verbatim from the former flat `trpc/routers/geography.ts`
 * during the megafile decomposition. The barrel re-exports `departmentsRouter`
 * under the same name, so `appRouter` and the caller-based tests are unchanged.
 *
 * @module trpc/routers/geography/departments
 */
import { TRPCError } from '@trpc/server';
import { and, eq, like, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { cities, countries, departments } from '../../../db/schema.js';
import { enqueueSync } from '../../../services/sync/enqueue.js';
import { router } from '../../init.js';
import { adminProcedure } from '../../middleware/roles.js';
import { tenantProcedure } from '../../middleware/tenant.js';
import {
  createDepartmentInput,
  deleteDepartmentInput,
  getDepartmentInput,
  listDepartmentsInput,
  searchDepartmentsInput,
  updateDepartmentInput,
} from '../../schemas/geography.js';
import {
  buildDepartmentSelection,
  ensureCountryExists,
  ensureDepartmentUniqueness,
} from './helpers.js';

export const departmentsRouter = router({
  list: tenantProcedure.input(listDepartmentsInput).query(async ({ ctx, input }) => {
    const { page, perPage, search, isActive, countryId } = input;
    const offset = (page - 1) * perPage;
    const conditions = [eq(departments.tenantId, ctx.tenantId)];

    if (countryId) {
      conditions.push(eq(departments.countryId, countryId));
    }

    if (search) {
      conditions.push(
        or(
          like(departments.code, `%${search}%`),
          like(departments.name, `%${search}%`),
          like(countries.name, `%${search}%`)
        )!
      );
    }

    if (isActive !== undefined) {
      conditions.push(eq(departments.isActive, isActive));
    }

    const where = and(...conditions);
    const [items, countRow] = await Promise.all([
      ctx.db
        .select(buildDepartmentSelection())
        .from(departments)
        .leftJoin(countries, eq(departments.countryId, countries.id))
        .where(where)
        .limit(perPage)
        .offset(offset)
        .all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(departments)
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

  getById: tenantProcedure.input(getDepartmentInput).query(async ({ ctx, input }) => {
    const department = await ctx.db
      .select(buildDepartmentSelection())
      .from(departments)
      .leftJoin(countries, eq(departments.countryId, countries.id))
      .where(and(eq(departments.id, input.id), eq(departments.tenantId, ctx.tenantId)))
      .get();

    if (!department) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Department not found' });
    }

    return department;
  }),

  create: adminProcedure.input(createDepartmentInput).mutation(async ({ ctx, input }) => {
    const countryId = await ensureCountryExists(ctx.db, ctx.tenantId, input.countryId);
    await ensureDepartmentUniqueness(ctx.db, ctx.tenantId, input);

    const now = new Date().toISOString();
    const id = nanoid();

    await ctx.db.insert(departments).values({
      id,
      tenantId: ctx.tenantId,
      countryId,
      code: input.code,
      name: input.name,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    });

    await enqueueSync(ctx, {
      entityType: 'departments',
      entityId: id,
      operation: 'create',
      data: { id, ...input, countryId },
    });

    return ctx.db
      .select(buildDepartmentSelection())
      .from(departments)
      .leftJoin(countries, eq(departments.countryId, countries.id))
      .where(eq(departments.id, id))
      .get();
  }),

  update: adminProcedure.input(updateDepartmentInput).mutation(async ({ ctx, input }) => {
    const { id, ...updates } = input;
    const existing = await ctx.db
      .select()
      .from(departments)
      .where(and(eq(departments.id, id), eq(departments.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Department not found' });
    }

    await ensureDepartmentUniqueness(ctx.db, ctx.tenantId, {
      id,
      code: updates.code,
      name: updates.name,
    });

    const countryId =
      updates.countryId !== undefined
        ? await ensureCountryExists(ctx.db, ctx.tenantId, updates.countryId)
        : undefined;

    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = { updatedAt: now };

    if (updates.countryId !== undefined) updateData.countryId = countryId;
    if (updates.code !== undefined) updateData.code = updates.code;
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

    await ctx.db
      .update(departments)
      .set(updateData)
      .where(and(eq(departments.id, id), eq(departments.tenantId, ctx.tenantId)));

    await enqueueSync(ctx, {
      entityType: 'departments',
      entityId: id,
      operation: 'update',
      data: { id, ...updateData },
    });

    return ctx.db
      .select(buildDepartmentSelection())
      .from(departments)
      .leftJoin(countries, eq(departments.countryId, countries.id))
      .where(eq(departments.id, id))
      .get();
  }),

  delete: adminProcedure.input(deleteDepartmentInput).mutation(async ({ ctx, input }) => {
    const existing = await ctx.db
      .select()
      .from(departments)
      .where(and(eq(departments.id, input.id), eq(departments.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Department not found' });
    }

    const assignedCity = await ctx.db
      .select({ id: cities.id })
      .from(cities)
      .where(and(eq(cities.tenantId, ctx.tenantId), eq(cities.departmentId, input.id)))
      .get();

    if (assignedCity) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'This department is assigned to one or more cities',
      });
    }

    await ctx.db
      .delete(departments)
      .where(and(eq(departments.id, input.id), eq(departments.tenantId, ctx.tenantId)));

    await enqueueSync(ctx, {
      entityType: 'departments',
      entityId: input.id,
      operation: 'delete',
      data: { id: input.id },
    });

    return { success: true, id: input.id };
  }),

  search: tenantProcedure.input(searchDepartmentsInput).query(async ({ ctx, input }) => {
    const conditions = [eq(departments.tenantId, ctx.tenantId)];

    if (input.isActive !== undefined) {
      conditions.push(eq(departments.isActive, input.isActive));
    }

    const items = await ctx.db
      .select(buildDepartmentSelection())
      .from(departments)
      .leftJoin(countries, eq(departments.countryId, countries.id))
      .where(
        and(
          ...conditions,
          or(
            like(departments.code, `%${input.q}%`),
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
