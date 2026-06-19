/**
 * Countries tRPC router (geography).
 *
 * ENG-178 — extracted verbatim from the former flat `trpc/routers/geography.ts`
 * during the megafile decomposition. The barrel re-exports `countriesRouter`
 * under the same name, so `appRouter` and the caller-based tests are unchanged.
 *
 * @module trpc/routers/geography/countries
 */
import { TRPCError } from '@trpc/server';
import { and, eq, like, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { countries, departments } from '../../../db/schema.js';
import { enqueueSync } from '../../../services/sync/enqueue.js';
import { router } from '../../init.js';
import { adminProcedure } from '../../middleware/roles.js';
import { tenantProcedure } from '../../middleware/tenant.js';
import {
  createCountryInput,
  deleteCountryInput,
  getCountryInput,
  listCountriesInput,
  searchCountriesInput,
  updateCountryInput,
} from '../../schemas/geography.js';
import { ensureCountryUniqueness } from './helpers.js';

export const countriesRouter = router({
  list: tenantProcedure.input(listCountriesInput).query(async ({ ctx, input }) => {
    const { page, perPage, search, isActive } = input;
    const offset = (page - 1) * perPage;
    const conditions = [eq(countries.tenantId, ctx.tenantId)];

    if (search) {
      conditions.push(or(like(countries.code, `%${search}%`), like(countries.name, `%${search}%`))!);
    }

    if (isActive !== undefined) {
      conditions.push(eq(countries.isActive, isActive));
    }

    const where = and(...conditions);
    const [items, countRow] = await Promise.all([
      ctx.db.select().from(countries).where(where).limit(perPage).offset(offset).all(),
      ctx.db.select({ count: sql<number>`count(*)` }).from(countries).where(where).get(),
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

  getById: tenantProcedure.input(getCountryInput).query(async ({ ctx, input }) => {
    const country = await ctx.db
      .select()
      .from(countries)
      .where(and(eq(countries.id, input.id), eq(countries.tenantId, ctx.tenantId)))
      .get();

    if (!country) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Country not found' });
    }

    return country;
  }),

  create: adminProcedure.input(createCountryInput).mutation(async ({ ctx, input }) => {
    await ensureCountryUniqueness(ctx.db, ctx.tenantId, input);

    const now = new Date().toISOString();
    const id = nanoid();

    await ctx.db.insert(countries).values({
      id,
      tenantId: ctx.tenantId,
      code: input.code,
      name: input.name,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    });

    await enqueueSync(ctx, {
      entityType: 'countries',
      entityId: id,
      operation: 'create',
      data: { id, ...input },
    });

    return ctx.db.select().from(countries).where(eq(countries.id, id)).get();
  }),

  update: adminProcedure.input(updateCountryInput).mutation(async ({ ctx, input }) => {
    const { id, ...updates } = input;
    const existing = await ctx.db
      .select()
      .from(countries)
      .where(and(eq(countries.id, id), eq(countries.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Country not found' });
    }

    await ensureCountryUniqueness(ctx.db, ctx.tenantId, {
      id,
      code: updates.code,
      name: updates.name,
    });

    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = { updatedAt: now };

    if (updates.code !== undefined) updateData.code = updates.code;
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

    await ctx.db
      .update(countries)
      .set(updateData)
      .where(and(eq(countries.id, id), eq(countries.tenantId, ctx.tenantId)));

    await enqueueSync(ctx, {
      entityType: 'countries',
      entityId: id,
      operation: 'update',
      data: { id, ...updateData },
    });

    return ctx.db.select().from(countries).where(eq(countries.id, id)).get();
  }),

  delete: adminProcedure.input(deleteCountryInput).mutation(async ({ ctx, input }) => {
    const existing = await ctx.db
      .select()
      .from(countries)
      .where(and(eq(countries.id, input.id), eq(countries.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Country not found' });
    }

    const assignedDepartment = await ctx.db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.tenantId, ctx.tenantId), eq(departments.countryId, input.id)))
      .get();

    if (assignedDepartment) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'This country is assigned to one or more departments',
      });
    }

    await ctx.db
      .delete(countries)
      .where(and(eq(countries.id, input.id), eq(countries.tenantId, ctx.tenantId)));

    await enqueueSync(ctx, {
      entityType: 'countries',
      entityId: input.id,
      operation: 'delete',
      data: { id: input.id },
    });

    return { success: true, id: input.id };
  }),

  search: tenantProcedure.input(searchCountriesInput).query(async ({ ctx, input }) => {
    const conditions = [eq(countries.tenantId, ctx.tenantId)];

    if (input.isActive !== undefined) {
      conditions.push(eq(countries.isActive, input.isActive));
    }

    const items = await ctx.db
      .select()
      .from(countries)
      .where(
        and(
          ...conditions,
          or(like(countries.code, `%${input.q}%`), like(countries.name, `%${input.q}%`))!
        )
      )
      .limit(input.limit)
      .all();

    return { items };
  }),
});
