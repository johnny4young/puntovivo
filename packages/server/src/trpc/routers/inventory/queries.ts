/**
 * Inventory router — read procedures ( split).
 *
 * The six tenant-scoped reads: `listEntries` / `listMovements` / `listStock`
 * (paginated lists with valuation summary), `getMovement` / `productStock`
 * (single-row), and `listBalancesBySite` (per-site on-hand balances, seeded on
 * first access). All `managerOrAdminProcedure`. Spread into the router barrel.
 *
 * @module trpc/routers/inventory/queries
 */
import { TRPCError } from '@trpc/server';
import { and, desc, eq, gt, gte, like, lte, or, sql } from 'drizzle-orm';

import { managerOrAdminProcedure } from '../../middleware/roles.js';
import { ensureTenantSite } from '../../middleware/tenantSite.js';
import {
  categories,
  initialInventory,
  inventoryBalances,
  inventoryCountLines,
  inventoryCountSessions,
  inventoryMovements,
  orderItems,
  orders,
  products,
  purchaseItems,
  purchases,
  sites,
  unitXProduct,
  units,
} from '../../../db/schema.js';
import { getInventoryCountRecord } from '../../../application/inventory/index.js';
import { roundQuantity } from '@puntovivo/shared/unit-math';
import {
  ensureInventoryBalancesForSite,
  listInventoryBalancesBySite,
  summarizeInventoryBalances,
  listCountableProductsBySite,
} from '../../../services/inventory-balances.js';
import { productStockTotalSql } from '../../../services/inventory-balances/derive.js';
import {
  getMovementInput,
  getInventoryCountInput,
  listBalancesBySiteInput,
  listCountableProductsInput,
  listInventoryCountsInput,
  listEntriesInput,
  listMovementsInput,
  listReplenishmentSuggestionsInput,
  listStockInput,
  productStockInput,
} from '../../schemas/inventory.js';

export const inventoryQueryProcedures = {
  listCountSessions: managerOrAdminProcedure
    .input(listInventoryCountsInput)
    .query(async ({ ctx, input }) => {
      const { page, perPage, siteId, status } = input;
      const offset = (page - 1) * perPage;
      if (siteId) await ensureTenantSite(ctx.db, ctx.tenantId, siteId);

      const conditions = [eq(inventoryCountSessions.tenantId, ctx.tenantId)];
      if (siteId) conditions.push(eq(inventoryCountSessions.siteId, siteId));
      if (status) conditions.push(eq(inventoryCountSessions.status, status));
      const where = and(...conditions);

      const [items, countResult] = await Promise.all([
        ctx.db
          .select({
            id: inventoryCountSessions.id,
            tenantId: inventoryCountSessions.tenantId,
            siteId: inventoryCountSessions.siteId,
            siteName: sites.name,
            status: inventoryCountSessions.status,
            isBlind: inventoryCountSessions.isBlind,
            notes: inventoryCountSessions.notes,
            rejectionReason: inventoryCountSessions.rejectionReason,
            createdBy: inventoryCountSessions.createdBy,
            submittedBy: inventoryCountSessions.submittedBy,
            approvedBy: inventoryCountSessions.approvedBy,
            rejectedBy: inventoryCountSessions.rejectedBy,
            submittedAt: inventoryCountSessions.submittedAt,
            approvedAt: inventoryCountSessions.approvedAt,
            rejectedAt: inventoryCountSessions.rejectedAt,
            version: inventoryCountSessions.version,
            createdAt: inventoryCountSessions.createdAt,
            updatedAt: inventoryCountSessions.updatedAt,
            lineCount: sql<number>`(
              select count(*) from ${inventoryCountLines}
              where ${inventoryCountLines.tenantId} = ${ctx.tenantId}
                and ${inventoryCountLines.sessionId} = ${inventoryCountSessions.id}
            )`,
            countedLineCount: sql<number>`(
              select count(*) from ${inventoryCountLines}
              where ${inventoryCountLines.tenantId} = ${ctx.tenantId}
                and ${inventoryCountLines.sessionId} = ${inventoryCountSessions.id}
                and ${inventoryCountLines.countedQuantity} is not null
            )`,
            discrepancyLineCount: sql<number | null>`case
              when ${inventoryCountSessions.status} = 'counting' then null
              else (
                select count(*) from ${inventoryCountLines}
                where ${inventoryCountLines.tenantId} = ${ctx.tenantId}
                  and ${inventoryCountLines.sessionId} = ${inventoryCountSessions.id}
                  and coalesce(${inventoryCountLines.discrepancy}, 0) != 0
              ) end`,
          })
          .from(inventoryCountSessions)
          .innerJoin(
            sites,
            and(eq(inventoryCountSessions.siteId, sites.id), eq(sites.tenantId, ctx.tenantId))
          )
          .where(where)
          .orderBy(desc(inventoryCountSessions.createdAt))
          .limit(perPage)
          .offset(offset)
          .all(),
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(inventoryCountSessions)
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

  getCountSession: managerOrAdminProcedure
    .input(getInventoryCountInput)
    .query(({ ctx, input }) => getInventoryCountRecord(ctx.db, ctx.tenantId, input.id)),

  listReplenishmentSuggestions: managerOrAdminProcedure
    .input(listReplenishmentSuggestionsInput)
    .query(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      const { page, perPage, search } = input;
      const offset = (page - 1) * perPage;
      const onHandSql = sql<number>`coalesce(${inventoryBalances.onHand}, 0)`;
      const reservedSql = sql<number>`coalesce(${inventoryBalances.reserved}, 0)`;
      const availableSql = sql<number>`max(${onHandSql} - ${reservedSql}, 0)`;
      const onOrderSql = sql<number>`coalesce((
        select sum(
          max(
            ${orderItems.quantity} - coalesce((
              select sum(${purchaseItems.quantity})
              from ${purchaseItems}
              inner join ${purchases} on ${purchases.id} = ${purchaseItems.purchaseId}
              where ${purchaseItems.sourceOrderItemId} = ${orderItems.id}
                and ${purchases.tenantId} = ${ctx.tenantId}
                and ${purchases.status} in ('completed', 'partial_returned', 'returned')
            ), 0),
            0
          ) * ${orderItems.unitEquivalence}
        )
        from ${orderItems}
        inner join ${orders} on ${orders.id} = ${orderItems.orderId}
        where ${orders.tenantId} = ${ctx.tenantId}
          and ${orders.siteId} = ${input.siteId}
          and ${orderItems.productId} = ${products.id}
          and ${orders.status} in ('draft', 'submitted', 'partial_received')
      ), 0)`;
      const projectedSql = sql<number>`${availableSql} + ${onOrderSql}`;
      const conditions = [
        eq(products.tenantId, ctx.tenantId),
        eq(products.isActive, true),
        eq(products.tracksStock, true),
        gt(products.minStock, 0),
        sql`${projectedSql} < ${products.minStock}`,
      ];
      if (search) {
        conditions.push(
          or(
            like(products.name, `%${search}%`),
            like(products.sku, `%${search}%`),
            like(products.barcode, `%${search}%`)
          )!
        );
      }
      const where = and(...conditions);

      const baseQuery = () =>
        ctx.db
          .select({
            productId: products.id,
            productName: products.name,
            productSku: products.sku,
            tracksLots: products.tracksLots,
            tracksSerials: products.tracksSerials,
            catalogType: products.catalogType,
            minStock: products.minStock,
            unitId: unitXProduct.unitId,
            unitName: units.name,
            unitAbbreviation: units.abbreviation,
            initialCost: products.initialCost,
            onHand: onHandSql,
            reserved: reservedSql,
            available: availableSql,
            onOrder: onOrderSql,
            projectedAvailable: projectedSql,
          })
          .from(products)
          .innerJoin(
            unitXProduct,
            and(eq(unitXProduct.productId, products.id), eq(unitXProduct.isBase, true))
          )
          .innerJoin(
            units,
            and(
              eq(unitXProduct.unitId, units.id),
              eq(units.tenantId, ctx.tenantId),
              eq(units.isActive, true)
            )
          )
          .leftJoin(
            inventoryBalances,
            and(
              eq(inventoryBalances.tenantId, ctx.tenantId),
              eq(inventoryBalances.siteId, input.siteId),
              eq(inventoryBalances.productId, products.id)
            )
          )
          .where(where);

      const [rawItems, countResult] = await Promise.all([
        baseQuery().orderBy(products.name).limit(perPage).offset(offset).all(),
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(products)
          .innerJoin(
            unitXProduct,
            and(eq(unitXProduct.productId, products.id), eq(unitXProduct.isBase, true))
          )
          .innerJoin(
            units,
            and(
              eq(unitXProduct.unitId, units.id),
              eq(units.tenantId, ctx.tenantId),
              eq(units.isActive, true)
            )
          )
          .leftJoin(
            inventoryBalances,
            and(
              eq(inventoryBalances.tenantId, ctx.tenantId),
              eq(inventoryBalances.siteId, input.siteId),
              eq(inventoryBalances.productId, products.id)
            )
          )
          .where(where)
          .get(),
      ]);
      const totalItems = countResult?.count ?? 0;
      return {
        items: rawItems.map(item => {
          // Replenishment only plans quantities. Concrete lot and serial
          // identity is captured later by the receiving flow, which now fails
          // closed unless the complete physical allocation is supplied.
          const blockedReason =
            item.catalogType === 'variant_parent' ? ('catalog_parent' as const) : null;
          return {
            ...item,
            suggestedQuantity: roundQuantity(Math.max(item.minStock - item.projectedAvailable, 0)),
            canDraft: blockedReason === null,
            blockedReason,
          };
        }),
        page,
        perPage,
        totalItems,
        totalPages: Math.ceil(totalItems / perPage),
        siteId: input.siteId,
      };
    }),

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
    const { page, perPage, productId, siteId, type, fromDate, toDate } = input;
    const offset = (page - 1) * perPage;

    if (siteId) {
      await ensureTenantSite(ctx.db, ctx.tenantId, siteId);
    }

    const conditions = [eq(inventoryMovements.tenantId, ctx.tenantId)];
    if (productId) conditions.push(eq(inventoryMovements.productId, productId));
    if (siteId) conditions.push(eq(inventoryMovements.siteId, siteId));
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
          siteId: sites.id,
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
          siteName: sites.name,
        })
        .from(inventoryMovements)
        .innerJoin(products, eq(inventoryMovements.productId, products.id))
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .leftJoin(
          sites,
          and(eq(inventoryMovements.siteId, sites.id), eq(sites.tenantId, ctx.tenantId))
        )
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

    // the stock screen lists inventory-bearing products only;
    // a service owns no balance and would read as permanently low.
    const conditions = [
      eq(products.tenantId, ctx.tenantId),
      eq(products.isActive, true),
      eq(products.tracksStock, true),
    ];
    if (search) {
      conditions.push(
        or(
          like(products.name, `%${search}%`),
          like(products.sku, `%${search}%`),
          like(products.barcode, `%${search}%`)
        )!
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
          tracksLots: products.tracksLots,
          tracksSerials: products.tracksSerials,
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

    if (!movement.siteId) return movement;

    const ownedSite = await ctx.db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.id, movement.siteId), eq(sites.tenantId, ctx.tenantId)))
      .get();
    return { ...movement, siteId: ownedSite?.id ?? null };
  }),

  /**
   * List on-hand balances attributed to a specific site ().
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
   * Product picker for a blind count. Identity only — no onHand, no reserved.
   * The count UI must never receive the figure it is asking the counter to
   * produce; the server snapshots it when the session is created.
   */
  listCountableProducts: managerOrAdminProcedure
    .input(listCountableProductsInput)
    .query(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      ensureInventoryBalancesForSite(ctx.db, ctx.tenantId, input.siteId);
      const items = await listCountableProductsBySite(ctx.db, ctx.tenantId, input.siteId);
      return { items, siteId: input.siteId };
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
