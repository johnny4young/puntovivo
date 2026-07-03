/**
 * Inventory router — read procedures (ENG-178 split).
 *
 * The six tenant-scoped reads: `listEntries` / `listMovements` / `listStock`
 * (paginated lists with valuation summary), `getMovement` / `productStock`
 * (single-row), and `listBalancesBySite` (per-site on-hand balances, seeded on
 * first access). All `managerOrAdminProcedure`. Spread into the router barrel.
 *
 * @module trpc/routers/inventory/queries
 */
import { TRPCError } from '@trpc/server';
import { and, desc, eq, gte, like, lte, or, sql } from 'drizzle-orm';

import { managerOrAdminProcedure } from '../../middleware/roles.js';
import { ensureTenantSite } from '../../middleware/tenantSite.js';
import {
  categories,
  initialInventory,
  inventoryMovements,
  products,
  sites,
  units,
} from '../../../db/schema.js';
import {
  ensureInventoryBalancesForSite,
  listInventoryBalancesBySite,
  summarizeInventoryBalances,
} from '../../../services/inventory-balances.js';
import { productStockTotalSql } from '../../../services/inventory-balances/derive.js';
import {
  getMovementInput,
  listBalancesBySiteInput,
  listEntriesInput,
  listMovementsInput,
  listStockInput,
  productStockInput,
} from '../../schemas/inventory.js';

export const inventoryQueryProcedures = {
  /**
   * List persisted initial/physical inventory entries.
   */
  listEntries: managerOrAdminProcedure.input(listEntriesInput).query(async ({ ctx, input }) => {
    const { page, perPage, productId, mode } = input;
    const offset = (page - 1) * perPage;

    const conditions = [eq(initialInventory.tenantId, ctx.tenantId)];
    if (productId) conditions.push(eq(initialInventory.productId, productId));
    if (mode) conditions.push(eq(initialInventory.mode, mode));

    const where = and(...conditions);

    const [items, countResult] = await Promise.all([
      ctx.db
        .select({
          id: initialInventory.id,
          tenantId: initialInventory.tenantId,
          productId: initialInventory.productId,
          unitId: initialInventory.unitId,
          siteId: initialInventory.siteId,
          mode: initialInventory.mode,
          quantity: initialInventory.quantity,
          unitEquivalence: initialInventory.unitEquivalence,
          normalizedQuantity: initialInventory.normalizedQuantity,
          cost: initialInventory.cost,
          previousStock: initialInventory.previousStock,
          newStock: initialInventory.newStock,
          notes: initialInventory.notes,
          createdBy: initialInventory.createdBy,
          syncStatus: initialInventory.syncStatus,
          syncVersion: initialInventory.syncVersion,
          createdAt: initialInventory.createdAt,
          productName: products.name,
          productSku: products.sku,
          unitName: units.name,
          unitAbbreviation: units.abbreviation,
          siteName: sites.name,
        })
        .from(initialInventory)
        .innerJoin(products, eq(initialInventory.productId, products.id))
        .innerJoin(units, eq(initialInventory.unitId, units.id))
        .leftJoin(sites, eq(initialInventory.siteId, sites.id))
        .where(where)
        .orderBy(desc(initialInventory.createdAt))
        .limit(perPage)
        .offset(offset)
        .all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(initialInventory)
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
   * List inventory movements for the current tenant
   */
  listMovements: managerOrAdminProcedure.input(listMovementsInput).query(async ({ ctx, input }) => {
    const { page, perPage, productId, type, fromDate, toDate } = input;
    const offset = (page - 1) * perPage;

    const conditions = [eq(inventoryMovements.tenantId, ctx.tenantId)];
    if (productId) conditions.push(eq(inventoryMovements.productId, productId));
    if (type) conditions.push(eq(inventoryMovements.type, type));
    if (fromDate) conditions.push(gte(inventoryMovements.createdAt, fromDate));
    if (toDate) conditions.push(lte(inventoryMovements.createdAt, toDate));

    const where = and(...conditions);

    const [items, countResult] = await Promise.all([
      ctx.db
        .select({
          id: inventoryMovements.id,
          tenantId: inventoryMovements.tenantId,
          productId: inventoryMovements.productId,
          type: inventoryMovements.type,
          quantity: inventoryMovements.quantity,
          previousStock: inventoryMovements.previousStock,
          newStock: inventoryMovements.newStock,
          reference: inventoryMovements.reference,
          notes: inventoryMovements.notes,
          createdBy: inventoryMovements.createdBy,
          createdAt: inventoryMovements.createdAt,
          syncStatus: inventoryMovements.syncStatus,
          syncVersion: inventoryMovements.syncVersion,
          productName: products.name,
          productSku: products.sku,
          categoryName: categories.name,
        })
        .from(inventoryMovements)
        .innerJoin(products, eq(inventoryMovements.productId, products.id))
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(where)
        .orderBy(desc(inventoryMovements.createdAt))
        .limit(perPage)
        .offset(offset)
        .all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(inventoryMovements)
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
   * List current stock balances with valuation and low-stock metadata.
   */
  listStock: managerOrAdminProcedure.input(listStockInput).query(async ({ ctx, input }) => {
    const { page, perPage, search, categoryId, lowStockOnly } = input;
    const offset = (page - 1) * perPage;

    const conditions = [eq(products.tenantId, ctx.tenantId), eq(products.isActive, true)];
    if (search) {
      conditions.push(
        or(like(products.name, `%${search}%`), like(products.sku, `%${search}%`), like(products.barcode, `%${search}%`))!
      );
    }
    if (categoryId) {
      conditions.push(eq(products.categoryId, categoryId));
    }
    if (lowStockOnly) {
      conditions.push(sql`${productStockTotalSql} <= ${products.minStock}`);
    }

    const where = and(...conditions);

    const [rawItems, countResult, summaryResult] = await Promise.all([
      ctx.db
        .select({
          id: products.id,
          tenantId: products.tenantId,
          name: products.name,
          sku: products.sku,
          categoryId: products.categoryId,
          categoryName: categories.name,
          stock: productStockTotalSql,
          minStock: products.minStock,
          initialCost: products.initialCost,
          price: products.price,
          isLowStock: sql<boolean>`${productStockTotalSql} <= ${products.minStock}`,
          inventoryValue: sql<number>`${productStockTotalSql} * ${products.initialCost}`,
          updatedAt: products.updatedAt,
        })
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(where)
        .orderBy(products.name)
        .limit(perPage)
        .offset(offset)
        .all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(products)
        .where(where)
        .get(),
      ctx.db
        .select({
          totalUnits: sql<number>`coalesce(sum(${productStockTotalSql}), 0)`,
          totalValue: sql<number>`coalesce(sum(${productStockTotalSql} * ${products.initialCost}), 0)`,
          lowStockCount: sql<number>`coalesce(sum(case when ${productStockTotalSql} <= ${products.minStock} then 1 else 0 end), 0)`,
        })
        .from(products)
        .where(where)
        .get(),
    ]);

    const totalItems = countResult?.count ?? 0;
    const items = rawItems.map(item => ({
      ...item,
      isLowStock: Boolean(item.isLowStock),
    }));

    return {
      items,
      page,
      perPage,
      totalItems,
      totalPages: Math.ceil(totalItems / perPage),
      summary: {
        totalUnits: summaryResult?.totalUnits ?? 0,
        totalValue: summaryResult?.totalValue ?? 0,
        lowStockCount: summaryResult?.lowStockCount ?? 0,
      },
    };
  }),

  /**
   * Get a single inventory movement by ID
   */
  getMovement: managerOrAdminProcedure.input(getMovementInput).query(async ({ ctx, input }) => {
    const movement = await ctx.db
      .select()
      .from(inventoryMovements)
      .where(
        and(eq(inventoryMovements.id, input.id), eq(inventoryMovements.tenantId, ctx.tenantId))
      )
      .get();

    if (!movement) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Inventory movement not found' });
    }

    return movement;
  }),

  /**
   * List on-hand balances attributed to a specific site (Phase 2 DB-101).
   *
   * Seeds the site on first access with 0-on_hand rows. `inventory_balances`
   * is the single source of truth; opening quantities come from the mutation
   * paths, and the tenant-wide total is derived as Σ(on_hand) on read.
   */
  listBalancesBySite: managerOrAdminProcedure
    .input(listBalancesBySiteInput)
    .query(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);

      // Seed exactly once — both read helpers below are pure selects.
      ensureInventoryBalancesForSite(ctx.db, ctx.tenantId, input.siteId);

      const [items, summary] = await Promise.all([
        listInventoryBalancesBySite(ctx.db, ctx.tenantId, input.siteId),
        summarizeInventoryBalances(ctx.db, ctx.tenantId, input.siteId),
      ]);

      return { items, summary, siteId: input.siteId };
    }),

  /**
   * Get current stock level for a product
   */
  productStock: managerOrAdminProcedure.input(productStockInput).query(async ({ ctx, input }) => {
    const product = await ctx.db
      .select({
        id: products.id,
        name: products.name,
        stock: productStockTotalSql,
        minStock: products.minStock,
      })
      .from(products)
      .where(and(eq(products.id, input.productId), eq(products.tenantId, ctx.tenantId)))
      .get();

    if (!product) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    }

    return {
      productId: product.id,
      name: product.name,
      stock: product.stock,
      minStock: product.minStock,
      isLowStock: product.stock <= product.minStock,
    };
  }),
};
