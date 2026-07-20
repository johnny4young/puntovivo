/**
 * Providers tRPC Router
 *
 * CRUD, search, and category-assignment operations for suppliers/providers with tenant isolation.
 *
 * @module trpc/routers/providers
 */

import { TRPCError } from '@trpc/server';
import { and, asc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createProvider } from '../../application/providers/index.js';
import type { DatabaseInstance } from '../../db/index.js';
import { assertVersionedWriteApplied } from '../../lib/optimisticVersion.js';
import {
  categories,
  categoryXProvider,
  cities,
  countries,
  departments,
  providers,
} from '../../db/schema.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import { ensureCityExists } from '../../services/geography/city-validation.js';
import { adminProcedure } from '../middleware/roles.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { router } from '../init.js';
import {
  createProviderInput,
  deleteProviderInput,
  getProviderInput,
  listProviderCategoryAssignmentsInput,
  listProvidersInput,
  replaceProviderCategoryAssignmentsInput,
  searchProvidersInput,
  updateProviderInput,
} from '../schemas/providers.js';

async function ensureTenantProvider(db: DatabaseInstance, tenantId: string, providerId: string) {
  const provider = await db
    .select()
    .from(providers)
    .where(and(eq(providers.id, providerId), eq(providers.tenantId, tenantId)))
    .get();

  if (!provider) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Provider not found' });
  }

  return provider;
}

function buildProviderSelection() {
  return {
    id: providers.id,
    tenantId: providers.tenantId,
    name: providers.name,
    taxId: providers.taxId,
    phone: providers.phone,
    email: providers.email,
    address: providers.address,
    cityId: providers.cityId,
    cityName: cities.name,
    departmentName: departments.name,
    countryName: countries.name,
    contactName: providers.contactName,
    isActive: providers.isActive,
    // optimistic-concurrency token surfaced for the edit form.
    version: providers.version,
    createdAt: providers.createdAt,
    updatedAt: providers.updatedAt,
  };
}

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
      ctx.db
        .select(buildProviderSelection())
        .from(providers)
        .leftJoin(cities, eq(providers.cityId, cities.id))
        .leftJoin(departments, eq(cities.departmentId, departments.id))
        .leftJoin(countries, eq(departments.countryId, countries.id))
        .where(where)
        .limit(perPage)
        .offset(offset)
        .all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(providers)
        .leftJoin(cities, eq(providers.cityId, cities.id))
        .leftJoin(departments, eq(cities.departmentId, departments.id))
        .leftJoin(countries, eq(departments.countryId, countries.id))
        .where(where)
        .get(),
    ]);

    const providerIds = items.map(provider => provider.id);
    const assignmentCounts =
      providerIds.length > 0
        ? await ctx.db
            .select({
              providerId: categoryXProvider.providerId,
              count: sql<number>`count(*)`,
            })
            .from(categoryXProvider)
            .where(
              and(
                eq(categoryXProvider.tenantId, ctx.tenantId),
                inArray(categoryXProvider.providerId, providerIds)
              )
            )
            .groupBy(categoryXProvider.providerId)
            .all()
        : [];
    const assignmentCountByProviderId = new Map(
      assignmentCounts.map(item => [item.providerId, item.count])
    );
    const totalItems = countResult?.count ?? 0;

    return {
      items: items.map(provider => ({
        ...provider,
        assignedCategoryCount: assignmentCountByProviderId.get(provider.id) ?? 0,
      })),
      page,
      perPage,
      totalItems,
      totalPages: Math.ceil(totalItems / perPage),
    };
  }),

  getById: tenantProcedure.input(getProviderInput).query(async ({ ctx, input }) => {
    const provider = await ctx.db
      .select(buildProviderSelection())
      .from(providers)
      .leftJoin(cities, eq(providers.cityId, cities.id))
      .leftJoin(departments, eq(cities.departmentId, departments.id))
      .leftJoin(countries, eq(departments.countryId, countries.id))
      .where(and(eq(providers.id, input.id), eq(providers.tenantId, ctx.tenantId)))
      .get();

    if (!provider) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Provider not found' });
    }

    return provider;
  }),

  create: adminProcedure.input(createProviderInput).mutation(async ({ ctx, input }) => {
    const createdProvider = await createProvider(ctx, input);
    const created = await ctx.db
      .select(buildProviderSelection())
      .from(providers)
      .leftJoin(cities, eq(providers.cityId, cities.id))
      .leftJoin(departments, eq(cities.departmentId, departments.id))
      .leftJoin(countries, eq(departments.countryId, countries.id))
      .where(and(eq(providers.id, createdProvider.id), eq(providers.tenantId, ctx.tenantId)))
      .get();

    return created!;
  }),

  update: adminProcedure.input(updateProviderInput).mutation(async ({ ctx, input }) => {
    const { id, ...updates } = input;
    await ensureTenantProvider(ctx.db, ctx.tenantId, id);

    const now = new Date().toISOString();
    // optimistic-concurrency bump (see the versioned WHERE below).
    const updateData: Record<string, unknown> = {
      updatedAt: now,
      version: input.version + 1,
    };
    const cityId =
      updates.cityId !== undefined
        ? await ensureCityExists(ctx.db, ctx.tenantId, updates.cityId)
        : undefined;

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.taxId !== undefined) updateData.taxId = updates.taxId;
    if (updates.phone !== undefined) updateData.phone = updates.phone;
    if (updates.email !== undefined) updateData.email = updates.email;
    if (updates.address !== undefined) updateData.address = updates.address;
    if (updates.cityId !== undefined) updateData.cityId = cityId;
    if (updates.contactName !== undefined) updateData.contactName = updates.contactName;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

    // optimistic-concurrency guard. `ensureTenantProvider` above
    // already established existence + tenant scope, so a zero-change result
    // here means another tab bumped the version first.
    const versionedUpdate = ctx.db
      .update(providers)
      .set(updateData)
      .where(
        and(
          eq(providers.id, id),
          eq(providers.tenantId, ctx.tenantId),
          eq(providers.version, input.version)
        )
      )
      .run() as { changes?: number };
    assertVersionedWriteApplied('provider', versionedUpdate.changes ?? 0, input.version);

    await enqueueSync(ctx, {
      entityType: 'providers',
      entityId: id,
      operation: 'update',
      data: { id, ...updateData },
    });

    const updated = await ctx.db
      .select(buildProviderSelection())
      .from(providers)
      .leftJoin(cities, eq(providers.cityId, cities.id))
      .leftJoin(departments, eq(cities.departmentId, departments.id))
      .leftJoin(countries, eq(departments.countryId, countries.id))
      .where(and(eq(providers.id, id), eq(providers.tenantId, ctx.tenantId)))
      .get();

    return updated!;
  }),

  listCategoryAssignments: adminProcedure
    .input(listProviderCategoryAssignmentsInput)
    .query(async ({ ctx, input }) => {
      await ensureTenantProvider(ctx.db, ctx.tenantId, input.providerId);

      const items = await ctx.db
        .select({
          id: categoryXProvider.id,
          categoryId: categoryXProvider.categoryId,
          name: categories.name,
          description: categories.description,
          parentId: categories.parentId,
          createdAt: categoryXProvider.createdAt,
          updatedAt: categoryXProvider.updatedAt,
        })
        .from(categoryXProvider)
        .innerJoin(categories, eq(categoryXProvider.categoryId, categories.id))
        .where(
          and(
            eq(categoryXProvider.tenantId, ctx.tenantId),
            eq(categoryXProvider.providerId, input.providerId)
          )
        )
        .orderBy(asc(categories.name))
        .all();

      return {
        items,
        providerId: input.providerId,
        categoryIds: items.map(item => item.categoryId),
      };
    }),

  replaceCategoryAssignments: adminProcedure
    .input(replaceProviderCategoryAssignmentsInput)
    .mutation(async ({ ctx, input }) => {
      await ensureTenantProvider(ctx.db, ctx.tenantId, input.providerId);

      const uniqueCategoryIds = [...new Set(input.categoryIds)];
      const availableCategories =
        uniqueCategoryIds.length > 0
          ? await ctx.db
              .select({ id: categories.id })
              .from(categories)
              .where(
                and(
                  eq(categories.tenantId, ctx.tenantId),
                  inArray(categories.id, uniqueCategoryIds)
                )
              )
              .all()
          : [];

      if (availableCategories.length !== uniqueCategoryIds.length) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'One or more selected categories were not found',
        });
      }

      const existingAssignments = await ctx.db
        .select({
          id: categoryXProvider.id,
          categoryId: categoryXProvider.categoryId,
        })
        .from(categoryXProvider)
        .where(
          and(
            eq(categoryXProvider.tenantId, ctx.tenantId),
            eq(categoryXProvider.providerId, input.providerId)
          )
        )
        .all();

      const existingByCategoryId = new Map(
        existingAssignments.map(assignment => [assignment.categoryId, assignment.id])
      );
      const nextCategoryIds = new Set(uniqueCategoryIds);
      const removedAssignments = existingAssignments.filter(
        assignment => !nextCategoryIds.has(assignment.categoryId)
      );
      const addedCategoryIds = uniqueCategoryIds.filter(
        categoryId => !existingByCategoryId.has(categoryId)
      );

      const now = new Date().toISOString();
      const addedAssignmentIds = addedCategoryIds.map(categoryId => ({
        assignmentId: nanoid(),
        categoryId,
      }));
      ctx.db.transaction(tx => {
        for (const assignment of removedAssignments) {
          tx.delete(categoryXProvider).where(eq(categoryXProvider.id, assignment.id)).run();
        }

        for (const { assignmentId, categoryId } of addedAssignmentIds) {
          tx.insert(categoryXProvider)
            .values({
              id: assignmentId,
              tenantId: ctx.tenantId,
              providerId: input.providerId,
              categoryId,
              createdAt: now,
              updatedAt: now,
            })
            .run();
        }
      });

      for (const assignment of removedAssignments) {
        await enqueueSync(ctx, {
          entityType: 'category_x_provider',
          entityId: assignment.id,
          operation: 'delete',
          data: {
            id: assignment.id,
            providerId: input.providerId,
            categoryId: assignment.categoryId,
          },
        });
      }

      for (const { assignmentId, categoryId } of addedAssignmentIds) {
        await enqueueSync(ctx, {
          entityType: 'category_x_provider',
          entityId: assignmentId,
          operation: 'create',
          data: { id: assignmentId, providerId: input.providerId, categoryId },
        });
      }

      return {
        success: true,
        providerId: input.providerId,
        categoryIds: uniqueCategoryIds,
      };
    }),

  delete: adminProcedure.input(deleteProviderInput).mutation(async ({ ctx, input }) => {
    await ensureTenantProvider(ctx.db, ctx.tenantId, input.id);

    const categoryAssignmentCount = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(categoryXProvider)
      .where(
        and(
          eq(categoryXProvider.tenantId, ctx.tenantId),
          eq(categoryXProvider.providerId, input.id)
        )
      )
      .get();

    if ((categoryAssignmentCount?.count ?? 0) > 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Provider has assigned categories. Remove them before deleting the provider.',
      });
    }

    await ctx.db
      .delete(providers)
      .where(and(eq(providers.id, input.id), eq(providers.tenantId, ctx.tenantId)));

    await enqueueSync(ctx, {
      entityType: 'providers',
      entityId: input.id,
      operation: 'delete',
      data: { id: input.id },
    });

    return { success: true, id: input.id };
  }),

  search: tenantProcedure.input(searchProvidersInput).query(async ({ ctx, input }) => {
    const items = await ctx.db
      .select(buildProviderSelection())
      .from(providers)
      .leftJoin(cities, eq(providers.cityId, cities.id))
      .leftJoin(departments, eq(cities.departmentId, departments.id))
      .leftJoin(countries, eq(departments.countryId, countries.id))
      .where(
        and(
          eq(providers.tenantId, ctx.tenantId),
          or(
            like(providers.name, `%${input.q}%`),
            like(providers.email, `%${input.q}%`),
            like(providers.phone, `%${input.q}%`),
            like(providers.taxId, `%${input.q}%`),
            like(providers.contactName, `%${input.q}%`),
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
