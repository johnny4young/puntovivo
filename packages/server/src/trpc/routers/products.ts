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
import { adminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import {
  adminProcedureWithModule,
  managerOrAdminProcedureWithModule,
} from '../middleware/modules.js';
import {
  categories,
  locations,
  products,
  productXProvider,
  providers,
  unitXProduct,
  units,
  vatRates,
} from '../../db/schema.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import type { Context } from '../context.js';
import {
  listProductsInput,
  getProductInput,
  createProductInput,
  updateProductInput,
  deleteProductInput,
  searchProductsInput,
  lookupByBarcodeInput,
} from '../schemas/products.js';
import { parseScan } from '../../services/peripherals/barcode/parser.js';
import { normalizeProductPricing } from '../../services/pricing.js';
import { resolveFractionPolicy } from '../../services/fraction-policy.js';
import {
  regenerateProductEmbeddings,
  semanticSearchProducts,
  suggestProductCategory,
} from '../../services/ai/embeddings.js';
import type { CreateProductInput, UpdateProductInput } from '../schemas/products.js';
import { z } from 'zod';

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
  sellByFraction: products.sellByFraction,
  fractionStep: products.fractionStep,
  fractionMinimum: products.fractionMinimum,
  isActive: products.isActive,
  barcode: products.barcode,
  imageUrl: products.imageUrl,
  syncStatus: products.syncStatus,
  syncVersion: products.syncVersion,
  createdAt: products.createdAt,
  updatedAt: products.updatedAt,
  categoryName: categories.name,
  locationCode: locations.code,
  locationName: locations.name,
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

type ProductProviderAssignmentInput = NonNullable<CreateProductInput['providerAssignments']>;

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

function getUniqueProviderIds(providerIds: string[]) {
  return [...new Set(providerIds)];
}

async function resolveProviderAssignments(
  db: Context['db'],
  tenantId: string,
  input: ProductProviderAssignmentInput
) {
  const providerIds = input.map(assignment => assignment.providerId);
  if (getUniqueProviderIds(providerIds).length !== providerIds.length) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'Each provider can only be assigned once per product',
    });
  }

  const availableProviders = await db
    .select({
      id: providers.id,
      isActive: providers.isActive,
    })
    .from(providers)
    .where(eq(providers.tenantId, tenantId))
    .all();

  const providerMap = new Map(availableProviders.map(provider => [provider.id, provider]));
  for (const assignment of input) {
    const provider = providerMap.get(assignment.providerId);
    if (!provider || provider.isActive === false) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'One of the selected providers was not found or is inactive',
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
    .leftJoin(locations, eq(products.locationId, locations.id))
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

  const providerAssignments = await db
    .select({
      id: productXProvider.id,
      productId: productXProvider.productId,
      providerId: productXProvider.providerId,
      providerName: providers.name,
      createdAt: productXProvider.createdAt,
      updatedAt: productXProvider.updatedAt,
    })
    .from(productXProvider)
    .innerJoin(providers, eq(productXProvider.providerId, providers.id))
    .where(eq(productXProvider.productId, productId))
    .all();

  return {
    ...product,
    unitAssignments,
    providerAssignments,
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

async function getExistingProviderAssignments(db: Context['db'], productId: string) {
  const existingAssignments = await db
    .select({
      providerId: productXProvider.providerId,
    })
    .from(productXProvider)
    .where(eq(productXProvider.productId, productId))
    .all();

  return existingAssignments.map(assignment => assignment.providerId);
}

async function replaceProviderAssignments(
  db: Context['db'],
  productId: string,
  providerAssignmentsInput: ProductProviderAssignmentInput,
  now: string
) {
  await db.delete(productXProvider).where(eq(productXProvider.productId, productId));

  for (const assignment of providerAssignmentsInput) {
    await db.insert(productXProvider).values({
      id: nanoid(),
      productId,
      providerId: assignment.providerId,
      createdAt: now,
      updatedAt: now,
    });
  }
}

function normalizeProviderState({
  providerId,
  providerAssignments,
  existingProviderIds = [],
}: {
  providerId: string | null | undefined;
  providerAssignments: ProductProviderAssignmentInput | undefined;
  existingProviderIds?: string[];
}) {
  if (providerAssignments === undefined && providerId === undefined) {
    return null;
  }

  if (providerAssignments !== undefined) {
    const submittedProviderIds = providerAssignments.map(assignment => assignment.providerId);
    const normalizedProviderIds = providerId
      ? [providerId, ...submittedProviderIds.filter(candidateId => candidateId !== providerId)]
      : submittedProviderIds;
    const uniqueProviderIds = getUniqueProviderIds(normalizedProviderIds);

    return {
      providerId: uniqueProviderIds[0] ?? null,
      providerAssignments: uniqueProviderIds.map(candidateId => ({ providerId: candidateId })),
    };
  }

  if (!providerId) {
    return {
      providerId: null,
      providerAssignments: [],
    };
  }

  const uniqueProviderIds = getUniqueProviderIds([
    providerId,
    ...existingProviderIds.filter(candidateId => candidateId !== providerId),
  ]);
  return {
    providerId: uniqueProviderIds[0] ?? null,
    providerAssignments: uniqueProviderIds.map(candidateId => ({ providerId: candidateId })),
  };
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

async function resolveLocationId(
  db: Context['db'],
  tenantId: string,
  locationId: string | null | undefined
) {
  if (!locationId) {
    return null;
  }

  const location = await db
    .select({
      id: locations.id,
      isActive: locations.isActive,
    })
    .from(locations)
    .where(and(eq(locations.id, locationId), eq(locations.tenantId, tenantId)))
    .get();

  if (!location || location.isActive === false) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Selected location was not found or is inactive',
    });
  }

  return location.id;
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
        .select(productSelection)
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .leftJoin(locations, eq(products.locationId, locations.id))
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
  create: managerOrAdminProcedure.input(createProductInput).mutation(async ({ ctx, input }) => {
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
    const normalizedProviderState = normalizeProviderState({
      providerId: input.providerId,
      providerAssignments: input.providerAssignments,
    });
    const resolvedProviderAssignments = normalizedProviderState
      ? await resolveProviderAssignments(ctx.db, ctx.tenantId, normalizedProviderState.providerAssignments)
      : [];
    const resolvedTax = await resolveTaxRate(ctx.db, ctx.tenantId, input.vatRateId, input.taxRate);
    const resolvedLocationId = await resolveLocationId(ctx.db, ctx.tenantId, input.locationId);
    const resolvedFractionPolicy = resolveFractionPolicy({
      sellByFraction: input.sellByFraction,
      fractionStep: input.fractionStep,
      fractionMinimum: input.fractionMinimum,
    });

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
      providerId: normalizedProviderState?.providerId ?? null,
      locationId: resolvedLocationId,
      initialCost: input.initialCost,
      stock: input.stock,
      minStock: input.minStock,
      sellByFraction: resolvedFractionPolicy.sellByFraction,
      fractionStep: resolvedFractionPolicy.fractionStep,
      fractionMinimum: resolvedFractionPolicy.fractionMinimum,
      isActive: input.isActive,
      barcode: input.barcode ?? null,
      imageUrl: input.imageUrl ?? null,
      syncStatus: 'pending',
      syncVersion: 1,
      createdAt: now,
      updatedAt: now,
    });

    await replaceUnitAssignments(ctx.db, id, resolvedUnitAssignments, now);

    if (normalizedProviderState) {
      await replaceProviderAssignments(ctx.db, id, resolvedProviderAssignments, now);
    }

    await enqueueSync(ctx, {
      entityType: 'products',
      entityId: id,
      operation: 'create',
      data: {
        id,
        ...input,
        ...normalizedPricing,
        taxRate: resolvedTax.taxRate,
        vatRateId: resolvedTax.vatRateId,
        providerId: normalizedProviderState?.providerId ?? null,
        locationId: resolvedLocationId,
        sellByFraction: resolvedFractionPolicy.sellByFraction,
        fractionStep: resolvedFractionPolicy.fractionStep,
        fractionMinimum: resolvedFractionPolicy.fractionMinimum,
        providerAssignments: resolvedProviderAssignments,
        unitAssignments: resolvedUnitAssignments,
      },
    });

    const created = await getProductWithRelations(ctx.db, id, ctx.tenantId);

    return created!;
  }),

  /**
   * Update an existing product
   */
  update: managerOrAdminProcedure.input(updateProductInput).mutation(async ({ ctx, input }) => {
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
    const existingProviderIds = await getExistingProviderAssignments(ctx.db, id);
    const resolvedUnitAssignments = await resolveUnitAssignments(
      ctx.db,
      ctx.tenantId,
      updates.unitAssignments ?? existingUnitAssignments
    );
    const normalizedProviderState = normalizeProviderState({
      providerId: updates.providerId,
      providerAssignments: updates.providerAssignments,
      existingProviderIds,
    });
    const resolvedProviderAssignments = normalizedProviderState
      ? await resolveProviderAssignments(ctx.db, ctx.tenantId, normalizedProviderState.providerAssignments)
      : undefined;
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
    const resolvedLocationId =
      updates.locationId !== undefined
        ? await resolveLocationId(ctx.db, ctx.tenantId, updates.locationId)
        : existing.locationId;
    const resolvedFractionPolicy = resolveFractionPolicy(
      {
        sellByFraction: updates.sellByFraction,
        fractionStep: updates.fractionStep,
        fractionMinimum: updates.fractionMinimum,
      },
      {
        sellByFraction: existing.sellByFraction ?? false,
        fractionStep: existing.fractionStep,
        fractionMinimum: existing.fractionMinimum,
      }
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
      sellByFraction: resolvedFractionPolicy.sellByFraction,
      fractionStep: resolvedFractionPolicy.fractionStep,
      fractionMinimum: resolvedFractionPolicy.fractionMinimum,
    };

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.sku !== undefined) updateData.sku = updates.sku;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.categoryId !== undefined) updateData.categoryId = updates.categoryId;
    if (normalizedProviderState) updateData.providerId = normalizedProviderState.providerId;
    if (updates.locationId !== undefined) updateData.locationId = resolvedLocationId;
    if (updates.initialCost !== undefined) updateData.initialCost = updates.initialCost;
    if (updates.stock !== undefined) updateData.stock = updates.stock;
    if (updates.minStock !== undefined) updateData.minStock = updates.minStock;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;
    if (updates.barcode !== undefined) updateData.barcode = updates.barcode;
    if (updates.imageUrl !== undefined) updateData.imageUrl = updates.imageUrl;

    await ctx.db.update(products).set(updateData).where(eq(products.id, id));
    await replaceUnitAssignments(ctx.db, id, resolvedUnitAssignments, now);

    if (resolvedProviderAssignments !== undefined) {
      await replaceProviderAssignments(ctx.db, id, resolvedProviderAssignments, now);
    }

    await enqueueSync(ctx, {
      entityType: 'products',
      entityId: id,
      operation: 'update',
      data: {
        id,
        ...updateData,
        providerAssignments: resolvedProviderAssignments,
        unitAssignments: resolvedUnitAssignments,
      },
    });

    const updated = await getProductWithRelations(ctx.db, id, ctx.tenantId);

    return updated!;
  }),

  /**
   * Delete a product (admin only)
   */
  delete: adminProcedure.input(deleteProductInput).mutation(async ({ ctx, input }) => {
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

    await enqueueSync(ctx, {
      entityType: 'products',
      entityId: input.id,
      operation: 'update',
      data: { id: input.id, isActive: false, updatedAt: now },
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
      .leftJoin(locations, eq(products.locationId, locations.id))
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

  // ==========================================================================
  // ENG-061 — exact-match scanner lookup
  // --------------------------------------------------------------------------
  // The renderer's `useBarcodeWedgeListener` accumulates raw HID
  // keystrokes; on emit it calls this procedure with the raw code.
  // We parse server-side (`parseScan`) to validate checksum and decode
  // GS1 prefix-2x weight/price labels, then look up the product by
  // exact barcode match. Available to any tenant-authenticated user
  // (cashiers must be able to scan); tenant-scoped via the explicit
  // `eq(products.tenantId, ctx.tenantId)` filter.
  //
  // Returns null when the scan does not resolve so the SalesPage can
  // surface a translated "not found" toast without an error envelope.
  // ==========================================================================

  /**
   * Exact-match barcode lookup with GS1 weight/price awareness.
   *
   * Strict mode rejects checksum failures for known digit-only
   * symbologies. Unknown symbologies fall through to exact lookup
   * so basic Code128 / internal SKU labels still resolve.
   */
  lookupByBarcode: tenantProcedure
    .input(lookupByBarcodeInput)
    .query(async ({ ctx, input }) => {
      const parsed = parseScan(input.barcode, { gs1Scheme: input.gs1Scheme });

      // Strict policy: checksum failure on a known digit-only
      // symbology is a hard reject. `kind: unknown` still falls
      // through to exact-match lookup so basic Code128 / short
      // internal barcodes work without forcing the scanner pipeline
      // into fully permissive mode.
      const failedKnownChecksum =
        !parsed.checksumValid &&
        /^\d+$/.test(parsed.code) &&
        (parsed.code.length === 8 ||
          parsed.code.length === 12 ||
          parsed.code.length === 13);
      if (
        input.parsePolicy === 'strict' &&
        failedKnownChecksum
      ) {
        return null;
      }

      // GS1 layouts carry the SKU in the first 5 digits after the role
      // prefix; non-GS1 codes look up the verbatim string.
      const lookupCode = parsed.lookupCode;

      const item = await ctx.db
        .select(productSelection)
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .leftJoin(locations, eq(products.locationId, locations.id))
        .leftJoin(providers, eq(products.providerId, providers.id))
        .leftJoin(vatRates, eq(products.vatRateId, vatRates.id))
        .where(
          and(
            eq(products.tenantId, ctx.tenantId),
            eq(products.isActive, true),
            eq(products.barcode, lookupCode)
          )
        )
        .get();

      if (!item) {
        return null;
      }

      const assignmentsMap = await getUnitAssignmentsByProductIds(ctx.db, [item.id]);
      const unitAssignments = assignmentsMap.get(item.id) ?? [];
      const baseUnit = unitAssignments.find(a => a.isBase) ?? unitAssignments[0];

      const product = {
        ...item,
        unitAssignments: unitAssignments.map(a => ({
          ...a,
          isBase: a.isBase ?? false,
        })),
        baseUnitId: baseUnit?.unitId ?? null,
        baseUnitName: baseUnit?.unitName ?? null,
        baseUnitAbbreviation: baseUnit?.unitAbbreviation ?? null,
        baseUnitPrice: baseUnit?.price ?? item.price,
      };

      return {
        product,
        parsed,
        // GS1 weight/price overrides for the cart line. Renderer uses
        // these verbatim when present; otherwise it falls back to
        // `quantity = 1` and the product's base unit price.
        suggestedQuantity: parsed.weightKg ?? null,
        suggestedPrice: parsed.priceMajor ?? null,
      };
    }),

  // ==========================================================================
  // ENG-033 — semantic search + auto-categorize procedures
  // --------------------------------------------------------------------------
  // Semantic search runs cosine similarity over embedded product names
  // and falls back to LIKE when AI is disabled or the tenant has no
  // embeddings yet. Regenerate is admin-only and re-embeds the entire
  // catalog (used after an embedding model upgrade or bulk import).
  // SuggestCategory is invoked at product create time to pre-fill the
  // category picker; the model is constrained to existing category ids
  // via Zod enum so it cannot hallucinate a new category.
  // ==========================================================================

  // ENG-068 — gated behind the `semantic-search` module. Tenants on
  // a basic plan keep the regular LIKE search; the toggle
  // (sparkles) on ProductsPage hides when the module is off.
  semanticSearch: managerOrAdminProcedureWithModule('semantic-search')
    .input(
      z.object({
        query: z.string().trim().min(1).max(200),
        limit: z.number().int().min(1).max(50).default(25),
      })
    )
    .query(async ({ ctx, input }) => {
      const ranked = await semanticSearchProducts(
        ctx.db,
        ctx.tenantId,
        input.query,
        input.limit
      );
      // ranked === null → AI disabled or provider can't embed.
      // The frontend should fall back to the regular list endpoint
      // with `search=...` (LIKE-based) in that case.
      if (ranked === null) {
        return { mode: 'unavailable' as const, results: [] };
      }
      // Hydrate full product rows for the ranked ids in one shot.
      if (ranked.length === 0) {
        return { mode: 'semantic' as const, results: [] };
      }
      const ids = ranked.map(r => r.productId);
      const rows = await ctx.db
        .select(productSelection)
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .leftJoin(locations, eq(products.locationId, locations.id))
        .leftJoin(providers, eq(products.providerId, providers.id))
        .leftJoin(vatRates, eq(products.vatRateId, vatRates.id))
        .where(and(eq(products.tenantId, ctx.tenantId), inArray(products.id, ids)))
        .all();
      const byId = new Map(rows.map(r => [r.id, r]));
      const ordered = ranked
        .map(r => {
          const row = byId.get(r.productId);
          if (!row) return null;
          return { ...row, similarity: r.similarity };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      return { mode: 'semantic' as const, results: ordered };
    }),

  // ENG-068 — gated behind `semantic-search`. Regenerating
  // embeddings only matters when the search surface is active.
  regenerateEmbeddings: adminProcedureWithModule('semantic-search').mutation(async ({ ctx }) => {
    const result = await regenerateProductEmbeddings(ctx.db, ctx.tenantId);
    if (result === null) {
      return { ok: false as const, reason: 'ai-disabled-or-empty' as const, embedded: 0 };
    }
    return { ok: true as const, embedded: result.embedded, model: result.model };
  }),

  // ENG-068 — gated behind `semantic-search`. The category-suggest
  // path uses the same embedding pipeline; tying the gates together
  // keeps the operator's mental model simple ("turn on smart search,
  // get all the smart-search features").
  suggestCategory: managerOrAdminProcedureWithModule('semantic-search')
    .input(
      z.object({
        name: z.string().trim().min(1).max(200),
        description: z.string().trim().max(2000).optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const candidates = await ctx.db
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .where(eq(categories.tenantId, ctx.tenantId))
        .all();
      const suggestion = await suggestProductCategory(
        ctx.db,
        ctx.tenantId,
        { name: input.name, description: input.description ?? null },
        candidates
      );
      if (!suggestion) return { ok: false as const, suggestion: null };
      return { ok: true as const, suggestion };
    }),
});
