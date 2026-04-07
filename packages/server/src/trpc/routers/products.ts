/**
 * Products tRPC Router
 *
 * CRUD and search operations for products with tenant isolation.
 *
 * Procedures:
 * - products.list      (tenant) - List products with pagination
 * - products.getById   (tenant) - Get a single product
 * - products.create    (tenant) - Create a new product
 * - products.update    (tenant) - Update a product
 * - products.delete    (tenant, admin) - Delete a product
 * - products.search    (tenant) - Full-text search
 *
 * @module trpc/routers/products
 */

import { TRPCError } from '@trpc/server';
import { eq, and, sql, like, or, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import {
  categories,
  products,
  providers,
  syncQueue,
  unitXProduct,
  units,
  vatRates,
} from '../../db/schema.js';
import type { Context } from '../context.js';
import {
  listProductsInput,
  getProductInput,
  createProductInput,
  updateProductInput,
  deleteProductInput,
  searchProductsInput,
} from '../schemas/products.js';
import { normalizeProductPricing } from '../../services/pricing.js';
import type { CreateProductInput, UpdateProductInput } from '../schemas/products.js';

const productSelection = {
  id: products.id,
  tenantId: products.tenantId,
  name: products.name,
  sku: products.sku,
  description: products.description,
  categoryId: products.categoryId,
  price: products.price,
  price2: products.price2,
  price3: products.price3,
  cost: products.cost,
  marginPercent1: products.marginPercent1,
  marginPercent2: products.marginPercent2,
  marginPercent3: products.marginPercent3,
  marginAmount1: products.marginAmount1,
  marginAmount2: products.marginAmount2,
  marginAmount3: products.marginAmount3,
  taxRate: products.taxRate,
  vatRateId: products.vatRateId,
  providerId: products.providerId,
  locationId: products.locationId,
  initialCost: products.initialCost,
  stock: products.stock,
  minStock: products.minStock,
  isActive: products.isActive,
  barcode: products.barcode,
  imageUrl: products.imageUrl,
  syncStatus: products.syncStatus,
  syncVersion: products.syncVersion,
  createdAt: products.createdAt,
  updatedAt: products.updatedAt,
  categoryName: categories.name,
  providerName: providers.name,
  vatRateName: vatRates.name,
};

type ProductUnitAssignmentRecord = {
  id: string;
  productId: string;
  unitId: string;
  unitName: string | null;
  unitAbbreviation: string | null;
  equivalence: number;
  price: number;
  isBase: boolean | null;
  createdAt: string;
  updatedAt: string;
};

function validateUnitAssignments(
  input:
    | NonNullable<CreateProductInput['unitAssignments']>
    | NonNullable<UpdateProductInput['unitAssignments']>
) {
  const baseAssignments = input.filter(assignment => assignment.isBase);

  if (baseAssignments.length !== 1) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Exactly one product unit must be marked as base',
    });
  }

  if (baseAssignments[0].equivalence !== 1) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'The base unit must use an equivalence of 1',
    });
  }

  const unitIds = new Set<string>();
  for (const assignment of input) {
    if (unitIds.has(assignment.unitId)) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Each unit can only be assigned once per product',
      });
    }

    unitIds.add(assignment.unitId);
  }
}

async function resolveUnitAssignments(
  db: Context['db'],
  tenantId: string,
  input:
    | NonNullable<CreateProductInput['unitAssignments']>
    | NonNullable<UpdateProductInput['unitAssignments']>
) {
  validateUnitAssignments(input);

  const availableUnits = await db
    .select({
      id: units.id,
      tenantId: units.tenantId,
      isActive: units.isActive,
    })
    .from(units)
    .where(eq(units.tenantId, tenantId))
    .all();

  const unitMap = new Map(availableUnits.map(unit => [unit.id, unit]));
  for (const assignment of input) {
    const unit = unitMap.get(assignment.unitId);
    if (!unit || unit.isActive === false) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'One of the selected units was not found or is inactive',
      });
    }
  }

  return input;
}

async function getDefaultUnitAssignments(
  db: Context['db'],
  tenantId: string,
  price: number
): Promise<NonNullable<CreateProductInput['unitAssignments']>> {
  const now = new Date().toISOString();
  const availableUnits = await db
    .select({
      id: units.id,
      abbreviation: units.abbreviation,
      isActive: units.isActive,
    })
    .from(units)
    .where(eq(units.tenantId, tenantId))
    .all();

  const defaultUnit =
    availableUnits.find(unit => unit.abbreviation === 'UND' && unit.isActive !== false) ??
    availableUnits.find(unit => unit.isActive !== false);

  if (!defaultUnit || defaultUnit.isActive === false) {
    const createdUnitId = nanoid();
    await db.insert(units).values({
      id: createdUnitId,
      tenantId,
      name: 'Unidad',
      abbreviation: 'UND',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    return [
      {
        unitId: createdUnitId,
        equivalence: 1,
        price,
        isBase: true,
      },
    ];
  }

  return [
    {
      unitId: defaultUnit.id,
      equivalence: 1,
      price,
      isBase: true,
    },
  ];
}

async function replaceUnitAssignments(
  db: Context['db'],
  productId: string,
  unitAssignmentsInput:
    | NonNullable<CreateProductInput['unitAssignments']>
    | NonNullable<UpdateProductInput['unitAssignments']>,
  now: string
) {
  await db.delete(unitXProduct).where(eq(unitXProduct.productId, productId));

  for (const assignment of unitAssignmentsInput) {
    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId,
      unitId: assignment.unitId,
      equivalence: assignment.equivalence,
      price: assignment.price,
      isBase: assignment.isBase,
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function getProductWithRelations(db: Context['db'], productId: string, tenantId: string) {
  const product = await db
    .select(productSelection)
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .leftJoin(providers, eq(products.providerId, providers.id))
    .leftJoin(vatRates, eq(products.vatRateId, vatRates.id))
    .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)))
    .get();

  if (!product) {
    return null;
  }

  const unitAssignments = await db
    .select({
      id: unitXProduct.id,
      productId: unitXProduct.productId,
      unitId: unitXProduct.unitId,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      equivalence: unitXProduct.equivalence,
      price: unitXProduct.price,
      isBase: unitXProduct.isBase,
      createdAt: unitXProduct.createdAt,
      updatedAt: unitXProduct.updatedAt,
    })
    .from(unitXProduct)
    .innerJoin(units, eq(unitXProduct.unitId, units.id))
    .where(eq(unitXProduct.productId, productId))
    .all();

  return {
    ...product,
    unitAssignments,
  };
}

async function getUnitAssignmentsByProductIds(
  db: Context['db'],
  productIds: string[]
): Promise<Map<string, ProductUnitAssignmentRecord[]>> {
  if (productIds.length === 0) {
    return new Map();
  }

  const assignments = await db
    .select({
      id: unitXProduct.id,
      productId: unitXProduct.productId,
      unitId: unitXProduct.unitId,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      equivalence: unitXProduct.equivalence,
      price: unitXProduct.price,
      isBase: unitXProduct.isBase,
      createdAt: unitXProduct.createdAt,
      updatedAt: unitXProduct.updatedAt,
    })
    .from(unitXProduct)
    .innerJoin(units, eq(unitXProduct.unitId, units.id))
    .where(inArray(unitXProduct.productId, productIds))
    .all();

  const assignmentsMap = new Map<string, typeof assignments>();
  for (const assignment of assignments) {
    const productAssignments = assignmentsMap.get(assignment.productId) ?? [];
    productAssignments.push(assignment);
    assignmentsMap.set(assignment.productId, productAssignments);
  }

  return assignmentsMap;
}

async function getExistingUnitAssignments(db: Context['db'], productId: string) {
  const existingAssignments = await db
    .select({
      unitId: unitXProduct.unitId,
      equivalence: unitXProduct.equivalence,
      price: unitXProduct.price,
      isBase: unitXProduct.isBase,
    })
    .from(unitXProduct)
    .where(eq(unitXProduct.productId, productId))
    .all();

  return existingAssignments.map(assignment => ({
    ...assignment,
    isBase: assignment.isBase ?? false,
  }));
}

async function resolveTaxRate(
  db: Context['db'],
  tenantId: string,
  vatRateId: string | null | undefined,
  fallbackTaxRate: number | undefined
) {
  if (!vatRateId) {
    return {
      vatRateId: vatRateId ?? null,
      taxRate: fallbackTaxRate ?? 0,
    };
  }

  const vatRate = await db
    .select({ id: vatRates.id, rate: vatRates.rate })
    .from(vatRates)
    .where(and(eq(vatRates.id, vatRateId), eq(vatRates.tenantId, tenantId)))
    .get();

  if (!vatRate) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Selected VAT rate was not found',
    });
  }

  return {
    vatRateId: vatRate.id,
    taxRate: vatRate.rate,
  };
}

export const productsRouter = router({
  /**
   * List products for the current tenant with pagination and filtering
   */
  list: tenantProcedure.input(listProductsInput).query(async ({ ctx, input }) => {
    const { page, perPage, search, categoryId, isActive } = input;
    const offset = (page - 1) * perPage;

    const conditions = [eq(products.tenantId, ctx.tenantId)];
    if (search) {
      conditions.push(or(like(products.name, `%${search}%`), like(products.sku, `%${search}%`))!);
    }
    if (categoryId !== undefined) {
      conditions.push(eq(products.categoryId, categoryId));
    }
    if (isActive !== undefined) {
      conditions.push(eq(products.isActive, isActive));
    }

    const where = and(...conditions);

    const [items, countResult] = await Promise.all([
      ctx.db
        .select({
          id: products.id,
          tenantId: products.tenantId,
          name: products.name,
          sku: products.sku,
          description: products.description,
          categoryId: products.categoryId,
          price: products.price,
          price2: products.price2,
          price3: products.price3,
          cost: products.cost,
          marginPercent1: products.marginPercent1,
          marginPercent2: products.marginPercent2,
          marginPercent3: products.marginPercent3,
          marginAmount1: products.marginAmount1,
          marginAmount2: products.marginAmount2,
          marginAmount3: products.marginAmount3,
          taxRate: products.taxRate,
          vatRateId: products.vatRateId,
          providerId: products.providerId,
          locationId: products.locationId,
          initialCost: products.initialCost,
          stock: products.stock,
          minStock: products.minStock,
          isActive: products.isActive,
          barcode: products.barcode,
          imageUrl: products.imageUrl,
          syncStatus: products.syncStatus,
          syncVersion: products.syncVersion,
          createdAt: products.createdAt,
          updatedAt: products.updatedAt,
          categoryName: categories.name,
          providerName: providers.name,
          vatRateName: vatRates.name,
        })
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .leftJoin(providers, eq(products.providerId, providers.id))
        .leftJoin(vatRates, eq(products.vatRateId, vatRates.id))
        .where(where)
        .limit(perPage)
        .offset(offset)
        .all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(products)
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

  /**
   * Get a single product by ID
   */
  getById: tenantProcedure.input(getProductInput).query(async ({ ctx, input }) => {
    const product = await getProductWithRelations(ctx.db, input.id, ctx.tenantId);

    if (!product) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    }

    return product;
  }),

  /**
   * Create a new product
   */
  create: tenantProcedure.input(createProductInput).mutation(async ({ ctx, input }) => {
    const existingSku = await ctx.db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.tenantId, ctx.tenantId), eq(products.sku, input.sku)))
      .get();

    if (existingSku) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A product with this SKU already exists',
      });
    }

    const now = new Date().toISOString();
    const normalizedPricing = normalizeProductPricing({
      cost: input.cost,
      price: input.price,
      price2: input.price2,
      price3: input.price3,
      marginPercent1: input.marginPercent1,
      marginPercent2: input.marginPercent2,
      marginPercent3: input.marginPercent3,
      marginAmount1: input.marginAmount1,
      marginAmount2: input.marginAmount2,
      marginAmount3: input.marginAmount3,
    });
    const id = nanoid();
    const resolvedUnitAssignments = await resolveUnitAssignments(
      ctx.db,
      ctx.tenantId,
      input.unitAssignments ?? (await getDefaultUnitAssignments(ctx.db, ctx.tenantId, normalizedPricing.price))
    );
    const resolvedTax = await resolveTaxRate(ctx.db, ctx.tenantId, input.vatRateId, input.taxRate);

    await ctx.db.insert(products).values({
      id,
      tenantId: ctx.tenantId,
      name: input.name,
      sku: input.sku,
      description: input.description ?? null,
      categoryId: input.categoryId ?? null,
      price: normalizedPricing.price,
      price2: normalizedPricing.price2,
      price3: normalizedPricing.price3,
      cost: normalizedPricing.cost,
      marginPercent1: normalizedPricing.marginPercent1,
      marginPercent2: normalizedPricing.marginPercent2,
      marginPercent3: normalizedPricing.marginPercent3,
      marginAmount1: normalizedPricing.marginAmount1,
      marginAmount2: normalizedPricing.marginAmount2,
      marginAmount3: normalizedPricing.marginAmount3,
      taxRate: resolvedTax.taxRate,
      vatRateId: resolvedTax.vatRateId,
      providerId: input.providerId ?? null,
      locationId: input.locationId ?? null,
      initialCost: input.initialCost,
      stock: input.stock,
      minStock: input.minStock,
      isActive: input.isActive,
      barcode: input.barcode ?? null,
      imageUrl: input.imageUrl ?? null,
      syncStatus: 'pending',
      syncVersion: 1,
      createdAt: now,
      updatedAt: now,
    });

    await replaceUnitAssignments(ctx.db, id, resolvedUnitAssignments, now);

    // Add to sync queue
    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'products',
      entityId: id,
      operation: 'create',
      data: {
        id,
        ...input,
        ...normalizedPricing,
        taxRate: resolvedTax.taxRate,
        vatRateId: resolvedTax.vatRateId,
        unitAssignments: resolvedUnitAssignments,
      },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    const created = await getProductWithRelations(ctx.db, id, ctx.tenantId);

    return created!;
  }),

  /**
   * Update an existing product
   */
  update: tenantProcedure.input(updateProductInput).mutation(async ({ ctx, input }) => {
    const { id, ...updates } = input;

    const existing = await ctx.db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    }

    if (updates.sku && updates.sku !== existing.sku) {
      const duplicateSku = await ctx.db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.tenantId, ctx.tenantId), eq(products.sku, updates.sku)))
        .get();

      if (duplicateSku) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'A product with this SKU already exists',
        });
      }
    }

    const now = new Date().toISOString();
    const existingUnitAssignments = await getExistingUnitAssignments(ctx.db, id);
    const resolvedUnitAssignments = await resolveUnitAssignments(
      ctx.db,
      ctx.tenantId,
      updates.unitAssignments ?? existingUnitAssignments
    );
    const normalizedPricing = normalizeProductPricing({
      cost: updates.cost ?? existing.cost,
      price: updates.price ?? existing.price,
      price2: updates.price2 ?? existing.price2,
      price3: updates.price3 ?? existing.price3,
      marginPercent1: updates.marginPercent1 ?? existing.marginPercent1,
      marginPercent2: updates.marginPercent2 ?? existing.marginPercent2,
      marginPercent3: updates.marginPercent3 ?? existing.marginPercent3,
      marginAmount1: updates.marginAmount1 ?? existing.marginAmount1,
      marginAmount2: updates.marginAmount2 ?? existing.marginAmount2,
      marginAmount3: updates.marginAmount3 ?? existing.marginAmount3,
    });
    const resolvedTax = await resolveTaxRate(
      ctx.db,
      ctx.tenantId,
      updates.vatRateId !== undefined ? updates.vatRateId : existing.vatRateId,
      updates.taxRate ?? existing.taxRate
    );
    const updateData: Record<string, unknown> = {
      updatedAt: now,
      syncStatus: 'pending',
      syncVersion: (existing.syncVersion ?? 0) + 1,
      price: normalizedPricing.price,
      price2: normalizedPricing.price2,
      price3: normalizedPricing.price3,
      cost: normalizedPricing.cost,
      marginPercent1: normalizedPricing.marginPercent1,
      marginPercent2: normalizedPricing.marginPercent2,
      marginPercent3: normalizedPricing.marginPercent3,
      marginAmount1: normalizedPricing.marginAmount1,
      marginAmount2: normalizedPricing.marginAmount2,
      marginAmount3: normalizedPricing.marginAmount3,
      taxRate: resolvedTax.taxRate,
      vatRateId: resolvedTax.vatRateId,
    };

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.sku !== undefined) updateData.sku = updates.sku;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.categoryId !== undefined) updateData.categoryId = updates.categoryId;
    if (updates.providerId !== undefined) updateData.providerId = updates.providerId;
    if (updates.locationId !== undefined) updateData.locationId = updates.locationId;
    if (updates.initialCost !== undefined) updateData.initialCost = updates.initialCost;
    if (updates.stock !== undefined) updateData.stock = updates.stock;
    if (updates.minStock !== undefined) updateData.minStock = updates.minStock;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;
    if (updates.barcode !== undefined) updateData.barcode = updates.barcode;
    if (updates.imageUrl !== undefined) updateData.imageUrl = updates.imageUrl;

    await ctx.db.update(products).set(updateData).where(eq(products.id, id));
    await replaceUnitAssignments(ctx.db, id, resolvedUnitAssignments, now);

    // Add to sync queue
    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'products',
      entityId: id,
      operation: 'update',
      data: { id, ...updateData, unitAssignments: resolvedUnitAssignments },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    const updated = await getProductWithRelations(ctx.db, id, ctx.tenantId);

    return updated!;
  }),

  /**
   * Delete a product (admin only)
   */
  delete: tenantProcedure.input(deleteProductInput).mutation(async ({ ctx, input }) => {
    if (ctx.user!.role !== 'admin') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only administrators can delete products',
      });
    }

    const existing = await ctx.db
      .select()
      .from(products)
      .where(and(eq(products.id, input.id), eq(products.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    }

    const now = new Date().toISOString();
    await ctx.db
      .update(products)
      .set({
        isActive: false,
        updatedAt: now,
        syncStatus: 'pending',
        syncVersion: (existing.syncVersion ?? 0) + 1,
      })
      .where(eq(products.id, input.id));

    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'products',
      entityId: input.id,
      operation: 'update',
      data: { id: input.id, isActive: false, updatedAt: now },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    return { success: true, id: input.id };
  }),

  /**
   * Search products by name, SKU or barcode
   */
  search: tenantProcedure.input(searchProductsInput).query(async ({ ctx, input }) => {
    const conditions = [eq(products.tenantId, ctx.tenantId)];
    if (input.categoryId) {
      conditions.push(eq(products.categoryId, input.categoryId));
    }
    if (input.providerId) {
      conditions.push(eq(products.providerId, input.providerId));
    }
    if (input.isActive !== undefined) {
      conditions.push(eq(products.isActive, input.isActive));
    }

    const items = await ctx.db
      .select(productSelection)
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(providers, eq(products.providerId, providers.id))
      .leftJoin(vatRates, eq(products.vatRateId, vatRates.id))
      .where(
        and(
          ...conditions,
          or(
            like(products.name, `%${input.q}%`),
            like(products.sku, `%${input.q}%`),
            like(products.barcode, `%${input.q}%`)
          )
        )
      )
      .limit(input.limit)
      .all();

    const assignmentsMap = await getUnitAssignmentsByProductIds(
      ctx.db,
      items.map(item => item.id)
    );

    return {
      items: items.map(item => {
        const unitAssignments = assignmentsMap.get(item.id) ?? [];
        const baseUnit = unitAssignments.find(assignment => assignment.isBase) ?? unitAssignments[0];

        return {
          ...item,
          unitAssignments: unitAssignments.map(assignment => ({
            ...assignment,
            isBase: assignment.isBase ?? false,
          })),
          baseUnitId: baseUnit?.unitId ?? null,
          baseUnitName: baseUnit?.unitName ?? null,
          baseUnitAbbreviation: baseUnit?.unitAbbreviation ?? null,
          baseUnitPrice: baseUnit?.price ?? item.price,
        };
      }),
    };
  }),
});
