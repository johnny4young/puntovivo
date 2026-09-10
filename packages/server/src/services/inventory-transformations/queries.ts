/** Tenant-scoped read models for inventory recipes and executions. */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  inventoryTransformationInputs,
  inventoryTransformationOutputs,
  inventoryTransformationRecipeInputs,
  inventoryTransformationRecipeOutputs,
  inventoryTransformationRecipes,
  inventoryTransformations,
  inventoryTransformationWaste,
  products,
  sites,
  unitXProduct,
  units,
  users,
} from '../../db/schema.js';
import type { ListInventoryTransformationsInput } from '../../trpc/schemas/inventoryTransformations.js';

export function getTransformationRecipeRecord(db: DatabaseInstance, tenantId: string, id: string) {
  const recipe = db
    .select({
      id: inventoryTransformationRecipes.id,
      tenantId: inventoryTransformationRecipes.tenantId,
      siteId: inventoryTransformationRecipes.siteId,
      siteName: sites.name,
      name: inventoryTransformationRecipes.name,
      kind: inventoryTransformationRecipes.kind,
      notes: inventoryTransformationRecipes.notes,
      isActive: inventoryTransformationRecipes.isActive,
      version: inventoryTransformationRecipes.version,
      createdBy: inventoryTransformationRecipes.createdBy,
      createdAt: inventoryTransformationRecipes.createdAt,
      updatedAt: inventoryTransformationRecipes.updatedAt,
    })
    .from(inventoryTransformationRecipes)
    .leftJoin(
      sites,
      and(eq(inventoryTransformationRecipes.siteId, sites.id), eq(sites.tenantId, tenantId))
    )
    .where(
      and(
        eq(inventoryTransformationRecipes.tenantId, tenantId),
        eq(inventoryTransformationRecipes.id, id)
      )
    )
    .get();
  if (!recipe) return null;

  const inputs = db
    .select({
      id: inventoryTransformationRecipeInputs.id,
      productId: inventoryTransformationRecipeInputs.productId,
      productName: products.name,
      productSku: products.sku,
      tracksLots: products.tracksLots,
      tracksSerials: products.tracksSerials,
      tracksStock: products.tracksStock,
      catalogType: products.catalogType,
      baseQuantity: inventoryTransformationRecipeInputs.baseQuantity,
      position: inventoryTransformationRecipeInputs.position,
      unitId: unitXProduct.unitId,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
    })
    .from(inventoryTransformationRecipeInputs)
    .innerJoin(
      products,
      and(
        eq(inventoryTransformationRecipeInputs.productId, products.id),
        eq(products.tenantId, tenantId)
      )
    )
    .leftJoin(
      unitXProduct,
      and(
        eq(unitXProduct.productId, inventoryTransformationRecipeInputs.productId),
        eq(unitXProduct.isBase, true)
      )
    )
    .leftJoin(units, and(eq(unitXProduct.unitId, units.id), eq(units.tenantId, tenantId)))
    .where(
      and(
        eq(inventoryTransformationRecipeInputs.tenantId, tenantId),
        eq(inventoryTransformationRecipeInputs.recipeId, id)
      )
    )
    .orderBy(inventoryTransformationRecipeInputs.position)
    .all();

  const outputs = db
    .select({
      id: inventoryTransformationRecipeOutputs.id,
      productId: inventoryTransformationRecipeOutputs.productId,
      productName: products.name,
      productSku: products.sku,
      tracksLots: products.tracksLots,
      tracksSerials: products.tracksSerials,
      tracksStock: products.tracksStock,
      catalogType: products.catalogType,
      expectedBaseQuantity: inventoryTransformationRecipeOutputs.expectedBaseQuantity,
      allocationWeight: inventoryTransformationRecipeOutputs.allocationWeight,
      role: inventoryTransformationRecipeOutputs.role,
      position: inventoryTransformationRecipeOutputs.position,
      unitId: unitXProduct.unitId,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
    })
    .from(inventoryTransformationRecipeOutputs)
    .innerJoin(
      products,
      and(
        eq(inventoryTransformationRecipeOutputs.productId, products.id),
        eq(products.tenantId, tenantId)
      )
    )
    .leftJoin(
      unitXProduct,
      and(
        eq(unitXProduct.productId, inventoryTransformationRecipeOutputs.productId),
        eq(unitXProduct.isBase, true)
      )
    )
    .leftJoin(units, and(eq(unitXProduct.unitId, units.id), eq(units.tenantId, tenantId)))
    .where(
      and(
        eq(inventoryTransformationRecipeOutputs.tenantId, tenantId),
        eq(inventoryTransformationRecipeOutputs.recipeId, id)
      )
    )
    .orderBy(inventoryTransformationRecipeOutputs.position)
    .all();

  return { ...recipe, inputs, outputs };
}

/**
 * Replication snapshot for one normalized recipe aggregate.
 *
 * Unlike the UI read model above, this deliberately returns the committed
 * database rows (including generated child ids and sync metadata). A peer must
 * never try to recreate those children from the mutation request because an
 * update replaces every line with newly generated identities.
 */
export function getTransformationRecipeSyncAggregate(
  db: DatabaseInstance,
  tenantId: string,
  id: string
) {
  const recipe = db
    .select()
    .from(inventoryTransformationRecipes)
    .where(
      and(
        eq(inventoryTransformationRecipes.tenantId, tenantId),
        eq(inventoryTransformationRecipes.id, id)
      )
    )
    .get();
  if (!recipe) return null;

  const inputs = db
    .select()
    .from(inventoryTransformationRecipeInputs)
    .where(
      and(
        eq(inventoryTransformationRecipeInputs.tenantId, tenantId),
        eq(inventoryTransformationRecipeInputs.recipeId, id)
      )
    )
    .orderBy(inventoryTransformationRecipeInputs.position)
    .all();
  const outputs = db
    .select()
    .from(inventoryTransformationRecipeOutputs)
    .where(
      and(
        eq(inventoryTransformationRecipeOutputs.tenantId, tenantId),
        eq(inventoryTransformationRecipeOutputs.recipeId, id)
      )
    )
    .orderBy(inventoryTransformationRecipeOutputs.position)
    .all();

  return { aggregateVersion: 1, ...recipe, inputs, outputs };
}

export function listTransformationRecipeRecords(
  db: DatabaseInstance,
  tenantId: string,
  options: { siteId?: string; activeOnly?: boolean; limit?: number; q?: string } = {}
) {
  const limit = Math.max(1, Math.min(options.limit ?? 200, 200));
  const conditions = [eq(inventoryTransformationRecipes.tenantId, tenantId)];
  if (options.activeOnly !== false)
    conditions.push(eq(inventoryTransformationRecipes.isActive, true));
  if (options.siteId) {
    conditions.push(
      sql`(${inventoryTransformationRecipes.siteId} is null or ${inventoryTransformationRecipes.siteId} = ${options.siteId})`
    );
  }
  if (options.q?.trim()) {
    conditions.push(
      sql`instr(lower(${inventoryTransformationRecipes.name}), lower(${options.q.trim()})) > 0`
    );
  }
  const candidates = db
    .select({
      id: inventoryTransformationRecipes.id,
      tenantId: inventoryTransformationRecipes.tenantId,
      siteId: inventoryTransformationRecipes.siteId,
      siteName: sites.name,
      name: inventoryTransformationRecipes.name,
      kind: inventoryTransformationRecipes.kind,
      notes: inventoryTransformationRecipes.notes,
      isActive: inventoryTransformationRecipes.isActive,
      version: inventoryTransformationRecipes.version,
      createdBy: inventoryTransformationRecipes.createdBy,
      createdAt: inventoryTransformationRecipes.createdAt,
      updatedAt: inventoryTransformationRecipes.updatedAt,
    })
    .from(inventoryTransformationRecipes)
    .leftJoin(
      sites,
      and(eq(inventoryTransformationRecipes.siteId, sites.id), eq(sites.tenantId, tenantId))
    )
    .where(and(...conditions))
    .orderBy(inventoryTransformationRecipes.name)
    .limit(limit + 1)
    .all();
  const hasMore = candidates.length > limit;
  const recipes = candidates.slice(0, limit);
  if (recipes.length === 0) return { items: [], hasMore: false };

  const recipeIds = recipes.map(recipe => recipe.id);
  const inputs = db
    .select({
      recipeId: inventoryTransformationRecipeInputs.recipeId,
      id: inventoryTransformationRecipeInputs.id,
      productId: inventoryTransformationRecipeInputs.productId,
      productName: products.name,
      productSku: products.sku,
      tracksLots: products.tracksLots,
      tracksSerials: products.tracksSerials,
      tracksStock: products.tracksStock,
      catalogType: products.catalogType,
      baseQuantity: inventoryTransformationRecipeInputs.baseQuantity,
      position: inventoryTransformationRecipeInputs.position,
      unitId: unitXProduct.unitId,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
    })
    .from(inventoryTransformationRecipeInputs)
    .innerJoin(
      products,
      and(
        eq(inventoryTransformationRecipeInputs.productId, products.id),
        eq(products.tenantId, tenantId)
      )
    )
    .leftJoin(
      unitXProduct,
      and(
        eq(unitXProduct.productId, inventoryTransformationRecipeInputs.productId),
        eq(unitXProduct.isBase, true)
      )
    )
    .leftJoin(units, and(eq(unitXProduct.unitId, units.id), eq(units.tenantId, tenantId)))
    .where(
      and(
        eq(inventoryTransformationRecipeInputs.tenantId, tenantId),
        inArray(inventoryTransformationRecipeInputs.recipeId, recipeIds)
      )
    )
    .orderBy(
      inventoryTransformationRecipeInputs.recipeId,
      inventoryTransformationRecipeInputs.position
    )
    .all();
  const outputs = db
    .select({
      recipeId: inventoryTransformationRecipeOutputs.recipeId,
      id: inventoryTransformationRecipeOutputs.id,
      productId: inventoryTransformationRecipeOutputs.productId,
      productName: products.name,
      productSku: products.sku,
      tracksLots: products.tracksLots,
      tracksSerials: products.tracksSerials,
      tracksStock: products.tracksStock,
      catalogType: products.catalogType,
      expectedBaseQuantity: inventoryTransformationRecipeOutputs.expectedBaseQuantity,
      allocationWeight: inventoryTransformationRecipeOutputs.allocationWeight,
      role: inventoryTransformationRecipeOutputs.role,
      position: inventoryTransformationRecipeOutputs.position,
      unitId: unitXProduct.unitId,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
    })
    .from(inventoryTransformationRecipeOutputs)
    .innerJoin(
      products,
      and(
        eq(inventoryTransformationRecipeOutputs.productId, products.id),
        eq(products.tenantId, tenantId)
      )
    )
    .leftJoin(
      unitXProduct,
      and(
        eq(unitXProduct.productId, inventoryTransformationRecipeOutputs.productId),
        eq(unitXProduct.isBase, true)
      )
    )
    .leftJoin(units, and(eq(unitXProduct.unitId, units.id), eq(units.tenantId, tenantId)))
    .where(
      and(
        eq(inventoryTransformationRecipeOutputs.tenantId, tenantId),
        inArray(inventoryTransformationRecipeOutputs.recipeId, recipeIds)
      )
    )
    .orderBy(
      inventoryTransformationRecipeOutputs.recipeId,
      inventoryTransformationRecipeOutputs.position
    )
    .all();

  const inputsByRecipeId = new Map<string, Array<Omit<(typeof inputs)[number], 'recipeId'>>>();
  for (const { recipeId, ...line } of inputs) {
    const recipeInputs = inputsByRecipeId.get(recipeId) ?? [];
    recipeInputs.push(line);
    inputsByRecipeId.set(recipeId, recipeInputs);
  }
  const outputsByRecipeId = new Map<string, Array<Omit<(typeof outputs)[number], 'recipeId'>>>();
  for (const { recipeId, ...line } of outputs) {
    const recipeOutputs = outputsByRecipeId.get(recipeId) ?? [];
    recipeOutputs.push(line);
    outputsByRecipeId.set(recipeId, recipeOutputs);
  }

  return {
    items: recipes.map(recipe => ({
      ...recipe,
      inputs: inputsByRecipeId.get(recipe.id) ?? [],
      outputs: outputsByRecipeId.get(recipe.id) ?? [],
    })),
    hasMore,
  };
}

export function getInventoryTransformationRecord(
  db: DatabaseInstance,
  tenantId: string,
  id: string
) {
  const header = db
    .select({
      id: inventoryTransformations.id,
      tenantId: inventoryTransformations.tenantId,
      siteId: inventoryTransformations.siteId,
      siteName: sites.name,
      recipeId: inventoryTransformations.recipeId,
      recipeNameSnapshot: inventoryTransformations.recipeNameSnapshot,
      kindSnapshot: inventoryTransformations.kindSnapshot,
      status: inventoryTransformations.status,
      totalInputCost: inventoryTransformations.totalInputCost,
      totalOutputCost: inventoryTransformations.totalOutputCost,
      notes: inventoryTransformations.notes,
      executedBy: inventoryTransformations.executedBy,
      executedByName: users.name,
      voidedBy: inventoryTransformations.voidedBy,
      voidedAt: inventoryTransformations.voidedAt,
      voidReason: inventoryTransformations.voidReason,
      createdAt: inventoryTransformations.createdAt,
      updatedAt: inventoryTransformations.updatedAt,
    })
    .from(inventoryTransformations)
    .innerJoin(
      sites,
      and(eq(inventoryTransformations.siteId, sites.id), eq(sites.tenantId, tenantId))
    )
    .innerJoin(
      users,
      and(eq(inventoryTransformations.executedBy, users.id), eq(users.tenantId, tenantId))
    )
    .where(
      and(eq(inventoryTransformations.tenantId, tenantId), eq(inventoryTransformations.id, id))
    )
    .get();
  if (!header) return null;

  const inputs = db
    .select({
      id: inventoryTransformationInputs.id,
      recipeInputId: inventoryTransformationInputs.recipeInputId,
      productId: inventoryTransformationInputs.productId,
      productName: products.name,
      productSku: products.sku,
      lotId: inventoryTransformationInputs.lotId,
      lotNumber: inventoryTransformationInputs.lotNumberSnapshot,
      expiresAt: inventoryTransformationInputs.expiresAtSnapshot,
      sourceStatus: inventoryTransformationInputs.sourceStatusSnapshot,
      baseQuantity: inventoryTransformationInputs.baseQuantity,
      unitCost: inventoryTransformationInputs.unitCost,
      totalCost: inventoryTransformationInputs.totalCost,
    })
    .from(inventoryTransformationInputs)
    .innerJoin(
      products,
      and(eq(inventoryTransformationInputs.productId, products.id), eq(products.tenantId, tenantId))
    )
    .where(
      and(
        eq(inventoryTransformationInputs.tenantId, tenantId),
        eq(inventoryTransformationInputs.transformationId, id)
      )
    )
    .orderBy(inventoryTransformationInputs.createdAt)
    .all();

  const outputs = db
    .select({
      id: inventoryTransformationOutputs.id,
      recipeOutputId: inventoryTransformationOutputs.recipeOutputId,
      productId: inventoryTransformationOutputs.productId,
      productName: products.name,
      productSku: products.sku,
      lotId: inventoryTransformationOutputs.lotId,
      lotNumber: inventoryTransformationOutputs.lotNumberSnapshot,
      expiresAt: inventoryTransformationOutputs.expiresAtSnapshot,
      role: inventoryTransformationOutputs.role,
      baseQuantity: inventoryTransformationOutputs.baseQuantity,
      allocationWeight: inventoryTransformationOutputs.allocationWeight,
      allocatedCost: inventoryTransformationOutputs.allocatedCost,
      unitCost: inventoryTransformationOutputs.unitCost,
      previousProductCost: inventoryTransformationOutputs.previousProductCost,
      previousProductInitialCost: inventoryTransformationOutputs.previousProductInitialCost,
      resultingProductCost: inventoryTransformationOutputs.resultingProductCost,
      resultingProductInitialCost: inventoryTransformationOutputs.resultingProductInitialCost,
      resultingProductSyncVersion: inventoryTransformationOutputs.resultingProductSyncVersion,
      resultingBalanceVersion: inventoryTransformationOutputs.resultingBalanceVersion,
    })
    .from(inventoryTransformationOutputs)
    .innerJoin(
      products,
      and(
        eq(inventoryTransformationOutputs.productId, products.id),
        eq(products.tenantId, tenantId)
      )
    )
    .where(
      and(
        eq(inventoryTransformationOutputs.tenantId, tenantId),
        eq(inventoryTransformationOutputs.transformationId, id)
      )
    )
    .orderBy(inventoryTransformationOutputs.createdAt)
    .all();

  const waste = db
    .select({
      id: inventoryTransformationWaste.id,
      transformationInputId: inventoryTransformationWaste.transformationInputId,
      baseQuantity: inventoryTransformationWaste.baseQuantity,
      reason: inventoryTransformationWaste.reason,
    })
    .from(inventoryTransformationWaste)
    .where(
      and(
        eq(inventoryTransformationWaste.tenantId, tenantId),
        eq(inventoryTransformationWaste.transformationId, id)
      )
    )
    .orderBy(inventoryTransformationWaste.createdAt)
    .all();

  return { ...header, inputs, outputs, waste };
}

/**
 * Exact committed transformation aggregate for the sync outbox.
 *
 * The command input does not contain generated child ids, resolved source-lot
 * splits, allocated costs, or the resulting balance revision. Reading the
 * rows back inside the write transaction freezes all of that evidence in one
 * payload instead of asking a remote consumer to recompute business state.
 */
export function getInventoryTransformationSyncAggregate(
  db: DatabaseInstance,
  tenantId: string,
  id: string
) {
  const transformation = db
    .select()
    .from(inventoryTransformations)
    .where(
      and(eq(inventoryTransformations.tenantId, tenantId), eq(inventoryTransformations.id, id))
    )
    .get();
  if (!transformation) return null;

  const inputs = db
    .select()
    .from(inventoryTransformationInputs)
    .where(
      and(
        eq(inventoryTransformationInputs.tenantId, tenantId),
        eq(inventoryTransformationInputs.transformationId, id)
      )
    )
    .orderBy(inventoryTransformationInputs.createdAt, inventoryTransformationInputs.id)
    .all();
  const outputs = db
    .select()
    .from(inventoryTransformationOutputs)
    .where(
      and(
        eq(inventoryTransformationOutputs.tenantId, tenantId),
        eq(inventoryTransformationOutputs.transformationId, id)
      )
    )
    .orderBy(inventoryTransformationOutputs.createdAt, inventoryTransformationOutputs.id)
    .all();
  const waste = db
    .select()
    .from(inventoryTransformationWaste)
    .where(
      and(
        eq(inventoryTransformationWaste.tenantId, tenantId),
        eq(inventoryTransformationWaste.transformationId, id)
      )
    )
    .orderBy(inventoryTransformationWaste.createdAt, inventoryTransformationWaste.id)
    .all();

  return { aggregateVersion: 1, ...transformation, inputs, outputs, waste };
}

export function listInventoryTransformationRecords(
  db: DatabaseInstance,
  tenantId: string,
  input: ListInventoryTransformationsInput
) {
  const { page, perPage, siteId, recipeId, status } = input;
  const conditions = [eq(inventoryTransformations.tenantId, tenantId)];
  if (siteId) conditions.push(eq(inventoryTransformations.siteId, siteId));
  if (recipeId) conditions.push(eq(inventoryTransformations.recipeId, recipeId));
  if (status) conditions.push(eq(inventoryTransformations.status, status));
  const where = and(...conditions);
  const [items, count] = [
    db
      .select({
        id: inventoryTransformations.id,
        siteId: inventoryTransformations.siteId,
        siteName: sites.name,
        recipeId: inventoryTransformations.recipeId,
        recipeNameSnapshot: inventoryTransformations.recipeNameSnapshot,
        kindSnapshot: inventoryTransformations.kindSnapshot,
        status: inventoryTransformations.status,
        totalInputCost: inventoryTransformations.totalInputCost,
        totalOutputCost: inventoryTransformations.totalOutputCost,
        executedBy: inventoryTransformations.executedBy,
        executedByName: users.name,
        voidedAt: inventoryTransformations.voidedAt,
        createdAt: inventoryTransformations.createdAt,
        inputCount: sql<number>`(
          select count(*) from ${inventoryTransformationInputs}
          where ${inventoryTransformationInputs.tenantId} = ${tenantId}
            and ${inventoryTransformationInputs.transformationId} = ${inventoryTransformations.id}
        )`,
        outputCount: sql<number>`(
          select count(*) from ${inventoryTransformationOutputs}
          where ${inventoryTransformationOutputs.tenantId} = ${tenantId}
            and ${inventoryTransformationOutputs.transformationId} = ${inventoryTransformations.id}
        )`,
      })
      .from(inventoryTransformations)
      .innerJoin(
        sites,
        and(eq(inventoryTransformations.siteId, sites.id), eq(sites.tenantId, tenantId))
      )
      .innerJoin(
        users,
        and(eq(inventoryTransformations.executedBy, users.id), eq(users.tenantId, tenantId))
      )
      .where(where)
      .orderBy(desc(inventoryTransformations.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage)
      .all(),
    db
      .select({ count: sql<number>`count(*)` })
      .from(inventoryTransformations)
      .where(where)
      .get(),
  ];
  const totalItems = count?.count ?? 0;
  return { items, page, perPage, totalItems, totalPages: Math.ceil(totalItems / perPage) };
}

export function getTransformationRecipesByIds(
  db: DatabaseInstance,
  tenantId: string,
  ids: readonly string[]
) {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(inventoryTransformationRecipes)
    .where(
      and(
        eq(inventoryTransformationRecipes.tenantId, tenantId),
        inArray(inventoryTransformationRecipes.id, [...ids])
      )
    )
    .all();
}
