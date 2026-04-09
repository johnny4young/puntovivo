import { TRPCError } from '@trpc/server';
import { and, eq, like, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  clientTypes,
  identificationTypes,
  personTypes,
  regimeTypes,
  syncQueue,
} from '../../db/schema.js';
import { router } from '../init.js';
import { adminProcedure } from '../middleware/roles.js';
import { tenantProcedure } from '../middleware/tenant.js';
import {
  createCustomerCatalogItemInput,
  deleteCustomerCatalogItemInput,
  getCustomerCatalogItemInput,
  listCustomerCatalogItemsInput,
  searchCustomerCatalogItemsInput,
  updateCustomerCatalogItemInput,
} from '../schemas/customerCatalogs.js';

type CustomerCatalogTable =
  | typeof identificationTypes
  | typeof personTypes
  | typeof regimeTypes
  | typeof clientTypes;

interface CustomerCatalogDefinition {
  singularName: string;
  entityType: 'identification_types' | 'person_types' | 'regime_types' | 'client_types';
  table: CustomerCatalogTable;
}

async function ensureCatalogUniqueness(
  db: DatabaseInstance,
  tenantId: string,
  definition: CustomerCatalogDefinition,
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
      .select({ id: definition.table.id })
      .from(definition.table)
      .where(and(eq(definition.table.tenantId, tenantId), eq(definition.table.code, code)))
      .get();

    if (existingByCode && existingByCode.id !== id) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: `A ${definition.singularName.toLowerCase()} with this code already exists`,
      });
    }
  }

  if (name) {
    const existingByName = await db
      .select({ id: definition.table.id })
      .from(definition.table)
      .where(and(eq(definition.table.tenantId, tenantId), eq(definition.table.name, name)))
      .get();

    if (existingByName && existingByName.id !== id) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: `A ${definition.singularName.toLowerCase()} with this name already exists`,
      });
    }
  }
}

function buildCustomerCatalogRouter(definition: CustomerCatalogDefinition) {
  const table = definition.table;

  return router({
    list: tenantProcedure.input(listCustomerCatalogItemsInput).query(async ({ ctx, input }) => {
      const { page, perPage, search, isActive } = input;
      const offset = (page - 1) * perPage;
      const conditions = [eq(table.tenantId, ctx.tenantId)];

      if (search) {
        conditions.push(
          or(
            like(table.code, `%${search}%`),
            like(table.name, `%${search}%`),
            like(table.description, `%${search}%`)
          )!
        );
      }

      if (isActive !== undefined) {
        conditions.push(eq(table.isActive, isActive));
      }

      const where = and(...conditions);
      const [items, countRow] = await Promise.all([
        ctx.db.select().from(table).where(where).limit(perPage).offset(offset).all(),
        ctx.db.select({ count: sql<number>`count(*)` }).from(table).where(where).get(),
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

    getById: tenantProcedure.input(getCustomerCatalogItemInput).query(async ({ ctx, input }) => {
      const item = await ctx.db
        .select()
        .from(table)
        .where(and(eq(table.id, input.id), eq(table.tenantId, ctx.tenantId)))
        .get();

      if (!item) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `${definition.singularName} not found`,
        });
      }

      return item;
    }),

    create: adminProcedure.input(createCustomerCatalogItemInput).mutation(async ({ ctx, input }) => {
      await ensureCatalogUniqueness(ctx.db, ctx.tenantId, definition, {
        code: input.code,
        name: input.name,
      });

      const now = new Date().toISOString();
      const id = nanoid();

      await ctx.db.insert(table).values({
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
        entityType: definition.entityType,
        entityId: id,
        operation: 'create',
        data: { id, ...input },
        localVersion: 1,
        attempts: 0,
        createdAt: now,
      });

      return ctx.db.select().from(table).where(eq(table.id, id)).get();
    }),

    update: adminProcedure.input(updateCustomerCatalogItemInput).mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      const existing = await ctx.db
        .select()
        .from(table)
        .where(and(eq(table.id, id), eq(table.tenantId, ctx.tenantId)))
        .get();

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `${definition.singularName} not found`,
        });
      }

      await ensureCatalogUniqueness(ctx.db, ctx.tenantId, definition, {
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

      await ctx.db.update(table).set(updateData).where(eq(table.id, id));

      await ctx.db.insert(syncQueue).values({
        id: nanoid(),
        tenantId: ctx.tenantId,
        entityType: definition.entityType,
        entityId: id,
        operation: 'update',
        data: { id, ...updateData },
        localVersion: 1,
        attempts: 0,
        createdAt: now,
      });

      return ctx.db.select().from(table).where(eq(table.id, id)).get();
    }),

    delete: adminProcedure.input(deleteCustomerCatalogItemInput).mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select()
        .from(table)
        .where(and(eq(table.id, input.id), eq(table.tenantId, ctx.tenantId)))
        .get();

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `${definition.singularName} not found`,
        });
      }

      await ctx.db.delete(table).where(eq(table.id, input.id));

      const now = new Date().toISOString();
      await ctx.db.insert(syncQueue).values({
        id: nanoid(),
        tenantId: ctx.tenantId,
        entityType: definition.entityType,
        entityId: input.id,
        operation: 'delete',
        data: { id: input.id },
        localVersion: 1,
        attempts: 0,
        createdAt: now,
      });

      return { success: true, id: input.id };
    }),

    search: tenantProcedure.input(searchCustomerCatalogItemsInput).query(async ({ ctx, input }) => {
      const conditions = [eq(table.tenantId, ctx.tenantId)];

      if (input.isActive !== undefined) {
        conditions.push(eq(table.isActive, input.isActive));
      }

      const items = await ctx.db
        .select()
        .from(table)
        .where(
          and(
            ...conditions,
            or(
              like(table.code, `%${input.q}%`),
              like(table.name, `%${input.q}%`),
              like(table.description, `%${input.q}%`)
            )!
          )
        )
        .limit(input.limit)
        .all();

      return { items };
    }),
  });
}

export const identificationTypesRouter = buildCustomerCatalogRouter({
  singularName: 'Identification Type',
  entityType: 'identification_types',
  table: identificationTypes,
});

export const personTypesRouter = buildCustomerCatalogRouter({
  singularName: 'Person Type',
  entityType: 'person_types',
  table: personTypes,
});

export const regimeTypesRouter = buildCustomerCatalogRouter({
  singularName: 'Regime Type',
  entityType: 'regime_types',
  table: regimeTypes,
});

export const clientTypesRouter = buildCustomerCatalogRouter({
  singularName: 'Client Type',
  entityType: 'client_types',
  table: clientTypes,
});
