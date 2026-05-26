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
import { adminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import { criticalCommandManagerOrAdminProcedure } from '../middleware/criticalCommand.js';
import {
  categories,
  initialInventory,
  inventoryMovements,
  operationEvents,
  products,
  sites,
  unitXProduct,
  units,
} from '../../db/schema.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import { updateOperationSummary } from '../../services/operation-journal/journal.js';
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
  applyInventoryBalanceDelta,
  ensureInventoryBalancesForSite,
  ensurePrimaryInventoryBalanceSnapshot,
  getPrimarySiteId,
  listInventoryBalancesBySite,
  reconcileProductStockFromBalances,
  summarizeInventoryBalances,
} from '../../services/inventory-balances.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { roundMoney } from '../../lib/money.js';

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

async function lookupInventoryJournalEventId(
  db: Context['db'],
  tenantId: string,
  operationId: string | undefined
): Promise<string | null> {
  if (!operationId) {
    return null;
  }
  const row = await db
    .select({ id: operationEvents.id })
    .from(operationEvents)
    .where(
      and(
        eq(operationEvents.tenantId, tenantId),
        eq(operationEvents.operationId, operationId)
      )
    )
    .get();
  return row?.id ?? null;
}

async function safeUpdateInventoryAdjustedSummary(
  ctx: Context,
  journalEventId: string,
  summary: {
    productId: string;
    siteId: string;
    quantityBefore: number;
    quantityAfter: number;
    delta: number;
    locationId: string | null;
    reasonCode: string | null;
  }
): Promise<void> {
  try {
    await updateOperationSummary(ctx.db, journalEventId, summary);
  } catch (err) {
    ctx.req?.server?.log?.warn(
      { err, journalEventId },
      'operation summary update failed (non-blocking)'
    );
  }
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
    const cost = roundMoney(input.cost);
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
          cost,
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
          initialCost: cost,
          syncStatus: 'pending',
          syncVersion: (product.syncVersion ?? 0) + 1,
          updatedAt: now,
        })
        .where(eq(products.id, input.productId))
        .run();

      // Phase 2 API-103 step 3: apply the same stockDelta to the operator
      // site's balance. `ctx.siteId` is the entry's site (the handler also
      // persists it on `initial_inventory.siteId`); falsy values no-op.
      // Seed value respects the migration rule: primary seeds from
      // products.stock, non-primary sites seed from 0. Skip the primary
      // lookup entirely when there is no site context — the helper no-ops.
      if (ctx.siteId) {
        const primarySiteIdForEntry = getPrimarySiteId(tx, ctx.tenantId);
        applyInventoryBalanceDelta(tx, {
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
          productId: input.productId,
          delta: stockDelta,
          initialOnHandIfMissing:
            ctx.siteId === primarySiteIdForEntry ? product.stock : 0,
          now,
        });
      }

    });

    await enqueueSync(ctx, {
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

    });

    await enqueueSync(ctx, {
      entityType: 'inventory_movements',
      entityId: movementId,
      operation: 'create',
      data: { id: movementId, productId: input.productId, newStock },
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
  adjustStock: criticalCommandManagerOrAdminProcedure.input(adjustStockInput).mutation(async ({ ctx, input }) => {
    const product = await getProductForInventory(ctx.db, ctx.tenantId, input.productId);

    const now = new Date().toISOString();
    const movementId = nanoid();
    const delta = input.newStock - product.stock;
    const quantity = Math.abs(delta);
    let resolvedAdjustmentSiteId: string | null = null;

    // Validate the explicit siteId (if provided) belongs to the tenant and is
    // active. We do this outside the transaction because the check is a pure
    // read and `throwServerError` would just roll back an untouched tx.
    if (input.siteId) {
      const targetSite = await ctx.db
        .select({ id: sites.id, isActive: sites.isActive })
        .from(sites)
        .where(and(eq(sites.id, input.siteId), eq(sites.tenantId, ctx.tenantId)))
        .get();

      if (!targetSite || targetSite.isActive === false) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Selected adjustment site was not found or is inactive',
        });
      }
    }

    // better-sqlite3 requires a synchronous transaction callback
    ctx.db.transaction(tx => {
      // Phase 2 API-103 step 3: resolve the site to apply the balance delta
      // to. Priority: explicit input > cashier/operator site > primary site.
      // If the tenant has zero active sites, `resolvedSiteId` is null and the
      // balance write silently no-ops (legacy path). `primarySiteId` is also
      // reused below for the migration-rule seed decision.
      const primarySiteId = getPrimarySiteId(tx, ctx.tenantId);
      const resolvedSiteId = input.siteId ?? ctx.siteId ?? primarySiteId;
      resolvedAdjustmentSiteId = resolvedSiteId;

      // When adjusting a non-primary site, first snapshot the primary site
      // with the PRE-adjustment aggregate so a later read still shows the
      // prior tenant stock at the primary.
      if (
        resolvedSiteId &&
        primarySiteId &&
        resolvedSiteId !== primarySiteId &&
        delta !== 0
      ) {
        ensurePrimaryInventoryBalanceSnapshot(tx, {
          tenantId: ctx.tenantId,
          productId: input.productId,
          onHandSnapshot: product.stock,
          now,
        });
      }

      // Update the legacy tenant-wide `products.stock` cache FIRST so
      // `applyInventoryBalanceDelta` (which trails every delta write with
      // `syncProductStockFromBalances`) runs last and ratifies the value
      // as Σ(site balances) — overwriting any historical drift the caller
      // unknowingly carried in.
      tx.update(products)
        .set({
          stock: input.newStock,
          syncStatus: 'pending',
          syncVersion: (product.syncVersion ?? 0) + 1,
          updatedAt: now,
        })
        .where(eq(products.id, input.productId))
        .run();

      // Seed value respects the migration rule: primary site seeds from
      // `products.stock`, non-primary sites seed from 0. Only pass an
      // explicit snapshot for the primary so non-primary first-time writes
      // reflect the true "site started with zero" semantics.
      applyInventoryBalanceDelta(tx, {
        tenantId: ctx.tenantId,
        siteId: resolvedSiteId,
        productId: input.productId,
        delta,
        initialOnHandIfMissing:
          resolvedSiteId && resolvedSiteId === primarySiteId ? product.stock : 0,
        now,
      });

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

      // Phase 8 / Tier-2 #8 — only audit when the adjustment actually
      // changed stock. A no-op call (newStock === current) shouldn't
      // pollute the audit timeline. Captures the delta + resolved site so
      // a reviewer can reconstruct the operator's intent without joining
      // back to inventory_movements.
      //
      // Scope note: the `tx.update(products) / tx.insert(inventoryMovements)`
      // writes ABOVE still land unconditionally when delta === 0 (writing a
      // zero-quantity movement row). The sync_outbox row is enqueued
      // post-tx unconditionally for the same reason. That pre-existing
      // shape is intentionally left unchanged; the audit row being
      // suppressed is a narrower, safer contract.
      if (delta !== 0) {
        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user!.id,
          action: 'inventory.adjust_stock',
          resourceType: 'product',
          resourceId: input.productId,
          before: { stock: product.stock },
          after: { stock: input.newStock },
          metadata: {
            delta,
            // resolvedSiteId is null when the tenant has zero active sites.
            ...(resolvedSiteId ? { siteId: resolvedSiteId } : {}),
            ...(input.notes ? { notes: input.notes } : {}),
            movementId,
          },
        });
      }
    });

    await enqueueSync(ctx, {
      entityType: 'inventory_movements',
      entityId: movementId,
      operation: 'create',
      data: { id: movementId, productId: input.productId, newStock: input.newStock },
    });

    const journalEventId = await lookupInventoryJournalEventId(
      ctx.db,
      ctx.tenantId,
      (ctx as unknown as { envelope?: { operationId: string } }).envelope?.operationId
    );
    if (journalEventId && resolvedAdjustmentSiteId) {
      await safeUpdateInventoryAdjustedSummary(ctx, journalEventId, {
        productId: input.productId,
        siteId: resolvedAdjustmentSiteId,
        locationId: null,
        quantityBefore: product.stock,
        quantityAfter: input.newStock,
        delta,
        reasonCode: input.notes ?? null,
      });
    }

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

  /**
   * Phase 2 API-103 step 4 — Admin reconciliation.
   *
   * Recomputes `products.stock` as Σ(`inventory_balances.on_hand`) for every
   * product in the tenant. Use after data migrations or historical imports
   * where `products.stock` has drifted from the per-site totals. Normal
   * mutation paths already keep the cache in lockstep, so this is a manual
   * heal-up tool, not a routine cron.
   */
  reconcileBalances: adminProcedure.mutation(async ({ ctx }) => {
    const result = reconcileProductStockFromBalances(ctx.db, ctx.tenantId);
    return { ...result, reconciledAt: new Date().toISOString() };
  }),
});
