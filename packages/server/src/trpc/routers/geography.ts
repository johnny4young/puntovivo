import { TRPCError } from '@trpc/server';
import { and, eq, like, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { cities, countries, departments, providers } from '../../db/schema.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import { router } from '../init.js';
import { adminProcedure } from '../middleware/roles.js';
import { tenantProcedure } from '../middleware/tenant.js';
import {
  createCityInput,
  createCountryInput,
  createDepartmentInput,
  deleteCityInput,
  deleteCountryInput,
  deleteDepartmentInput,
  getCityInput,
  getCountryInput,
  getDepartmentInput,
  listCitiesInput,
  listCountriesInput,
  listDepartmentsInput,
  searchCitiesInput,
  searchCountriesInput,
  searchDepartmentsInput,
  updateCityInput,
  updateCountryInput,
  updateDepartmentInput,
} from '../schemas/geography.js';

async function ensureCountryUniqueness(
  db: DatabaseInstance,
  tenantId: string,
  values: {
    // ENG-179b — explicit `| undefined` on Zod-optional fields.
    id?: string | undefined;
    code?: string | undefined;
    name?: string | undefined;
  }
) {
  if (values.code) {
    const existing = await db
      .select({ id: countries.id })
      .from(countries)
      .where(and(eq(countries.tenantId, tenantId), eq(countries.code, values.code)))
      .get();

    if (existing && existing.id !== values.id) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A country with this code already exists',
      });
    }
  }

  if (values.name) {
    const existing = await db
      .select({ id: countries.id })
      .from(countries)
      .where(and(eq(countries.tenantId, tenantId), eq(countries.name, values.name)))
      .get();

    if (existing && existing.id !== values.id) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A country with this name already exists',
      });
    }
  }
}

async function ensureCountryExists(db: DatabaseInstance, tenantId: string, countryId: string) {
  const country = await db
    .select({ id: countries.id, isActive: countries.isActive })
    .from(countries)
    .where(and(eq(countries.tenantId, tenantId), eq(countries.id, countryId)))
    .get();

  if (!country || country.isActive === false) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Selected country was not found or is inactive',
    });
  }

  return country.id;
}

async function ensureDepartmentUniqueness(
  db: DatabaseInstance,
  tenantId: string,
  values: {
    // ENG-179b — explicit `| undefined` on Zod-optional fields.
    id?: string | undefined;
    code?: string | undefined;
    name?: string | undefined;
  }
) {
  if (values.code) {
    const existing = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.tenantId, tenantId), eq(departments.code, values.code)))
      .get();

    if (existing && existing.id !== values.id) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A department with this code already exists',
      });
    }
  }

  if (values.name) {
    const existing = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.tenantId, tenantId), eq(departments.name, values.name)))
      .get();

    if (existing && existing.id !== values.id) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A department with this name already exists',
      });
    }
  }
}

async function ensureDepartmentExists(
  db: DatabaseInstance,
  tenantId: string,
  departmentId: string
) {
  const department = await db
    .select({ id: departments.id, isActive: departments.isActive })
    .from(departments)
    .where(and(eq(departments.tenantId, tenantId), eq(departments.id, departmentId)))
    .get();

  if (!department || department.isActive === false) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Selected department was not found or is inactive',
    });
  }

  return department.id;
}

async function ensureCityUniqueness(
  db: DatabaseInstance,
  tenantId: string,
  values: {
    // ENG-179b — explicit `| undefined` on Zod-optional fields.
    id?: string | undefined;
    departmentId: string;
    code?: string | undefined;
    name?: string | undefined;
  }
) {
  if (values.code) {
    const existing = await db
      .select({ id: cities.id })
      .from(cities)
      .where(and(eq(cities.tenantId, tenantId), eq(cities.code, values.code)))
      .get();

    if (existing && existing.id !== values.id) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A city with this code already exists',
      });
    }
  }

  if (values.name) {
    const existing = await db
      .select({ id: cities.id })
      .from(cities)
      .where(
        and(
          eq(cities.tenantId, tenantId),
          eq(cities.departmentId, values.departmentId),
          eq(cities.name, values.name)
        )
      )
      .get();

    if (existing && existing.id !== values.id) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A city with this name already exists in the selected department',
      });
    }
  }
}

async function ensureCityExists(
  db: DatabaseInstance,
  tenantId: string,
  cityId: string | null | undefined
) {
  if (!cityId) {
    return null;
  }

  const city = await db
    .select({ id: cities.id, isActive: cities.isActive })
    .from(cities)
    .where(and(eq(cities.tenantId, tenantId), eq(cities.id, cityId)))
    .get();

  if (!city || city.isActive === false) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Selected city was not found or is inactive',
    });
  }

  return city.id;
}

function buildDepartmentSelection() {
  return {
    id: departments.id,
    tenantId: departments.tenantId,
    countryId: departments.countryId,
    countryCode: countries.code,
    countryName: countries.name,
    code: departments.code,
    name: departments.name,
    isActive: departments.isActive,
    createdAt: departments.createdAt,
    updatedAt: departments.updatedAt,
  };
}

function buildCitySelection() {
  return {
    id: cities.id,
    tenantId: cities.tenantId,
    departmentId: cities.departmentId,
    countryId: departments.countryId,
    countryName: countries.name,
    departmentCode: departments.code,
    departmentName: departments.name,
    code: cities.code,
    name: cities.name,
    isActive: cities.isActive,
    createdAt: cities.createdAt,
    updatedAt: cities.updatedAt,
  };
}

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

export { ensureCityExists };
