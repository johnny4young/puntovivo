/**
 * Inventory tRPC Router
 *
 * Inventory movement tracking and stock management with tenant isolation.
 *
 * Procedures:
 * - inventory.listMovements   (tenant) - List inventory movements
 * - inventory.getMovement     (tenant) - Get a single movement
 * - inventory.createMovement  (tenant) - Create movement + update product stock (transaction)
 * - inventory.adjustStock     (tenant, admin) - Set absolute stock level
 * - inventory.productStock    (tenant) - Get current stock for a product
 *
 * @module trpc/routers/inventory
 */

import { TRPCError } from '@trpc/server';
import { eq, and, sql, gte, lte, desc, like, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { router } from '../init.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import {
  categories,
  initialInventory,
  inventoryMovements,
  products,
  sites,
  syncQueue,
  unitXProduct,
  units,
} from '../../db/schema.js';
import type { Context } from '../context.js';
import {
  listEntriesInput,
  listMovementsInput,
  listStockInput,
  getMovementInput,
  createMovementInput,
  adjustStockInput,
  productStockInput,
  recordEntryInput,
  listBalancesBySiteInput,
} from '../schemas/inventory.js';
import {
  ensureInventoryBalancesForSite,
  listInventoryBalancesBySite,
  summarizeInventoryBalances,
} from '../../services/inventory-balances.js';

async function getProductForInventory(db: Context['db'], tenantId: string, productId: string) {
  const product = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)))
    .get();

  if (!product || product.isActive === false) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found or inactive' });
  }

  return product;
}

async function ensureTenantSite(db: Context['db'], tenantId: string, siteId: string) {
  const site = await db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId)))
    .get();

  if (!site) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Site not found' });
  }

  return site;
}

async function getProductUnitAssignment(
  db: Context['db'],
  productId: string,
  unitId: string
) {
  const assignment = await db
    .select({
      unitId: unitXProduct.unitId,
      equivalence: unitXProduct.equivalence,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      isActive: units.isActive,
    })
    .from(unitXProduct)
    .innerJoin(units, eq(unitXProduct.unitId, units.id))
    .where(and(eq(unitXProduct.productId, productId), eq(unitXProduct.unitId, unitId)))
    .get();

  if (!assignment || assignment.isActive === false) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Selected product unit was not found or is inactive',
    });
  }

  return assignment;
}

function getNormalizedInventoryQuantity(quantity: number, equivalence: number) {
  const normalizedQuantity = quantity * equivalence;
  if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'The normalized quantity must be greater than zero',
    });
  }

  return normalizedQuantity;
}

export const inventoryRouter = router({
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
      conditions.push(sql`${products.stock} <= ${products.minStock}`);
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
          stock: products.stock,
          minStock: products.minStock,
          initialCost: products.initialCost,
          price: products.price,
          isLowStock: sql<boolean>`${products.stock} <= ${products.minStock}`,
          inventoryValue: sql<number>`${products.stock} * ${products.initialCost}`,
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
          totalUnits: sql<number>`coalesce(sum(${products.stock}), 0)`,
          totalValue: sql<number>`coalesce(sum(${products.stock} * ${products.initialCost}), 0)`,
          lowStockCount: sql<number>`coalesce(sum(case when ${products.stock} <= ${products.minStock} then 1 else 0 end), 0)`,
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
   * Record an initial inventory or physical-count entry and update stock atomically.
   */
  recordEntry: managerOrAdminProcedure.input(recordEntryInput).mutation(async ({ ctx, input }) => {
    const product = await getProductForInventory(ctx.db, ctx.tenantId, input.productId);
    const unitAssignment = await getProductUnitAssignment(ctx.db, input.productId, input.unitId);
    const normalizedQuantity = getNormalizedInventoryQuantity(input.quantity, unitAssignment.equivalence);
    const now = new Date().toISOString();
    const entryId = nanoid();
    const movementId = nanoid();
    const newStock =
      input.mode === 'initial' ? product.stock + normalizedQuantity : normalizedQuantity;
    const stockDelta = newStock - product.stock;

    ctx.db.transaction(tx => {
      tx.insert(initialInventory)
        .values({
          id: entryId,
          tenantId: ctx.tenantId,
          productId: input.productId,
          unitId: input.unitId,
          siteId: ctx.siteId,
          mode: input.mode,
          quantity: input.quantity,
          unitEquivalence: unitAssignment.equivalence,
          normalizedQuantity,
          cost: input.cost,
          previousStock: product.stock,
          newStock,
          notes: input.notes,
          createdBy: ctx.user!.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
        })
        .run();

      tx.insert(inventoryMovements)
        .values({
          id: movementId,
          tenantId: ctx.tenantId,
          productId: input.productId,
          type: 'adjustment',
          quantity: Math.abs(stockDelta),
          previousStock: product.stock,
          newStock,
          reference: entryId,
          notes:
            input.notes ??
            (input.mode === 'initial' ? 'Initial inventory entry' : 'Physical inventory count'),
          createdBy: ctx.user!.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
        })
        .run();

      tx.update(products)
        .set({
          stock: newStock,
          initialCost: input.cost,
          syncStatus: 'pending',
          syncVersion: (product.syncVersion ?? 0) + 1,
          updatedAt: now,
        })
        .where(eq(products.id, input.productId))
        .run();

      tx.insert(syncQueue)
        .values({
          id: nanoid(),
          tenantId: ctx.tenantId,
          entityType: 'initial_inventory',
          entityId: entryId,
          operation: 'create',
          data: {
            id: entryId,
            productId: input.productId,
            unitId: input.unitId,
            mode: input.mode,
            normalizedQuantity,
            newStock,
          },
          localVersion: 1,
          attempts: 0,
          createdAt: now,
        })
        .run();
    });

    const created = await ctx.db
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
      .where(eq(initialInventory.id, entryId))
      .get();

    return created!;
  }),

  /**
   * Create an inventory movement and update product stock atomically.
   *
   * - For 'purchase'/'return': adds quantity to stock
   * - For 'sale'/'transfer': subtracts quantity from stock
   * - For 'adjustment': treated as an add (use adjustStock for absolute set)
   */
  createMovement: managerOrAdminProcedure.input(createMovementInput).mutation(async ({ ctx, input }) => {
    const now = new Date().toISOString();

    // Validate product belongs to tenant
    const product = await ctx.db
      .select()
      .from(products)
      .where(and(eq(products.id, input.productId), eq(products.tenantId, ctx.tenantId)))
      .get();

    if (!product) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    }

    // Determine stock change direction
    const isDeduction = input.type === 'sale' || input.type === 'transfer';
    const newStock = isDeduction ? product.stock - input.quantity : product.stock + input.quantity;

    if (newStock < 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Insufficient stock. Available: ${product.stock}, requested: ${input.quantity}`,
      });
    }

    const movementId = nanoid();

    // better-sqlite3 requires a synchronous transaction callback
    ctx.db.transaction(tx => {
      // Create movement record
      tx.insert(inventoryMovements)
        .values({
          id: movementId,
          tenantId: ctx.tenantId,
          productId: input.productId,
          type: input.type,
          quantity: input.quantity,
          previousStock: product.stock,
          newStock,
          reference: input.reference,
          notes: input.notes,
          createdBy: ctx.user!.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
        })
        .run();

      // Update product stock
      tx.update(products)
        .set({
          stock: newStock,
          syncStatus: 'pending',
          syncVersion: (product.syncVersion ?? 0) + 1,
          updatedAt: now,
        })
        .where(eq(products.id, input.productId))
        .run();

      // Add to sync queue
      tx.insert(syncQueue)
        .values({
          id: nanoid(),
          tenantId: ctx.tenantId,
          entityType: 'inventory_movements',
          entityId: movementId,
          operation: 'create',
          data: { id: movementId, productId: input.productId, newStock },
          localVersion: 1,
          attempts: 0,
          createdAt: now,
        })
        .run();
    });

    const created = await ctx.db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.id, movementId))
      .get();

    return created!;
  }),

  /**
   * Set a product's stock to an absolute value (admin only).
   * Creates an 'adjustment' movement record.
   */
  adjustStock: managerOrAdminProcedure.input(adjustStockInput).mutation(async ({ ctx, input }) => {
    const product = await getProductForInventory(ctx.db, ctx.tenantId, input.productId);

    const now = new Date().toISOString();
    const movementId = nanoid();
    const quantity = Math.abs(input.newStock - product.stock);

    // better-sqlite3 requires a synchronous transaction callback
    ctx.db.transaction(tx => {
      tx.insert(inventoryMovements)
        .values({
          id: movementId,
          tenantId: ctx.tenantId,
          productId: input.productId,
          type: 'adjustment',
          quantity,
          previousStock: product.stock,
          newStock: input.newStock,
          reference: 'manual-adjustment',
          notes: input.notes,
          createdBy: ctx.user!.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
        })
        .run();

      tx.update(products)
        .set({
          stock: input.newStock,
          syncStatus: 'pending',
          syncVersion: (product.syncVersion ?? 0) + 1,
          updatedAt: now,
        })
        .where(eq(products.id, input.productId))
        .run();

      tx.insert(syncQueue)
        .values({
          id: nanoid(),
          tenantId: ctx.tenantId,
          entityType: 'inventory_movements',
          entityId: movementId,
          operation: 'create',
          data: { id: movementId, productId: input.productId, newStock: input.newStock },
          localVersion: 1,
          attempts: 0,
          createdAt: now,
        })
        .run();
    });

    const updatedProduct = await ctx.db
      .select()
      .from(products)
      .where(eq(products.id, input.productId))
      .get();

    return { product: updatedProduct!, movementId };
  }),

  /**
   * List on-hand balances attributed to a specific site (Phase 2 DB-101).
   *
   * Seeds the site on first access — primary site mirrors current
   * `products.stock`, non-primary sites start at zero. Once transfers land the
   * balances stop being a projection and become the source of truth.
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
        stock: products.stock,
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
});
