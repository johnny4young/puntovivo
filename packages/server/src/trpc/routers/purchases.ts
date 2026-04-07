import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import {
  inventoryMovements,
  products,
  providers,
  purchaseItems,
  purchases,
  sequentials,
  sites,
  syncQueue,
  unitXProduct,
  units,
} from '../../db/schema.js';
import type { Context } from '../context.js';
import {
  createPurchaseInput,
  getPurchaseInput,
  listPurchasesInput,
} from '../schemas/purchases.js';
import type { CreatePurchaseInput } from '../schemas/purchases.js';

type ResolvedPurchaseItem = {
  id: string;
  productId: string;
  quantity: number;
  unitId: string;
  unitEquivalence: number;
  costPerUnit: number;
  baseUnitCost: number;
  total: number;
  normalizedQuantity: number;
};

type PurchaseSequentialContext = {
  id: string;
  prefix: string;
  currentValue: number;
  siteId: string;
  siteName: string;
};

function assertCanCreatePurchase(role: string | undefined) {
  if (role !== 'admin' && role !== 'manager') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only administrators and managers can register purchases',
    });
  }
}

function getNormalizedPurchaseQuantity(quantity: number, equivalence: number) {
  const normalizedQuantity = quantity * equivalence;

  if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'The selected quantity must resolve to a positive stock quantity',
    });
  }

  if (!Number.isInteger(normalizedQuantity)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'The selected quantity and unit equivalence must resolve to a whole stock quantity',
    });
  }

  return normalizedQuantity;
}

async function getPurchaseSequentialContext(
  db: Context['db'],
  tenantId: string,
  siteId: string | null
): Promise<PurchaseSequentialContext> {
  const baseConditions = [
    eq(sequentials.tenantId, tenantId),
    eq(sequentials.documentType, 'purchase'),
    eq(sites.isActive, true),
  ];

  if (siteId) {
    const siteScopedSequential = await db
      .select({
        id: sequentials.id,
        prefix: sequentials.prefix,
        currentValue: sequentials.currentValue,
        siteId: sequentials.siteId,
        siteName: sites.name,
      })
      .from(sequentials)
      .innerJoin(sites, eq(sequentials.siteId, sites.id))
      .where(and(...baseConditions, eq(sequentials.siteId, siteId)))
      .get();

    if (siteScopedSequential) {
      return siteScopedSequential;
    }
  }

  const fallbackSequential = await db
    .select({
      id: sequentials.id,
      prefix: sequentials.prefix,
      currentValue: sequentials.currentValue,
      siteId: sequentials.siteId,
      siteName: sites.name,
    })
    .from(sequentials)
    .innerJoin(sites, eq(sequentials.siteId, sites.id))
    .where(and(...baseConditions))
    .orderBy(asc(sites.name))
    .get();

  if (!fallbackSequential) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'No active purchase sequential is configured for the current tenant',
    });
  }

  return fallbackSequential;
}

async function validateProvider(db: Context['db'], tenantId: string, providerId: string) {
  const provider = await db
    .select({ id: providers.id, isActive: providers.isActive })
    .from(providers)
    .where(and(eq(providers.id, providerId), eq(providers.tenantId, tenantId)))
    .get();

  if (!provider || provider.isActive === false) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Selected provider was not found or is inactive',
    });
  }
}

async function resolvePurchaseItems(
  db: Context['db'],
  tenantId: string,
  inputItems: CreatePurchaseInput['items']
) {
  const productIds = [...new Set(inputItems.map(item => item.productId))];
  const productRows = await db
    .select()
    .from(products)
    .where(and(eq(products.tenantId, tenantId), inArray(products.id, productIds)))
    .all();
  const productMap = new Map(productRows.map(product => [product.id, product]));

  const unitAssignments = await db
    .select({
      productId: unitXProduct.productId,
      unitId: unitXProduct.unitId,
      equivalence: unitXProduct.equivalence,
      isActive: units.isActive,
    })
    .from(unitXProduct)
    .innerJoin(units, eq(unitXProduct.unitId, units.id))
    .where(inArray(unitXProduct.productId, productIds))
    .all();
  const assignmentMap = new Map(
    unitAssignments.map(assignment => [`${assignment.productId}:${assignment.unitId}`, assignment])
  );

  let subtotal = 0;
  const rows: ResolvedPurchaseItem[] = [];
  const productStocks = new Map(productRows.map(product => [product.id, product.stock]));

  for (const item of inputItems) {
    const product = productMap.get(item.productId);

    if (!product || product.isActive === false) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Product ${item.productId} was not found or is inactive`,
      });
    }

    const assignment = assignmentMap.get(`${item.productId}:${item.unitId}`);
    if (!assignment || assignment.isActive === false) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Unit selection is invalid for product "${product.name}"`,
      });
    }

    const normalizedQuantity = getNormalizedPurchaseQuantity(item.quantity, assignment.equivalence);
    const baseUnitCost = item.costPerUnit / assignment.equivalence;
    const total = item.costPerUnit * item.quantity;

    subtotal += total;
    rows.push({
      id: nanoid(),
      productId: item.productId,
      quantity: item.quantity,
      unitId: item.unitId,
      unitEquivalence: assignment.equivalence,
      costPerUnit: item.costPerUnit,
      baseUnitCost,
      total,
      normalizedQuantity,
    });
  }

  return {
    productStocks,
    rows,
    subtotal,
  };
}

async function getPurchaseRecord(db: Context['db'], tenantId: string, purchaseId: string) {
  const purchase = await db
    .select({
      id: purchases.id,
      tenantId: purchases.tenantId,
      purchaseNumber: purchases.purchaseNumber,
      providerId: purchases.providerId,
      providerName: providers.name,
      siteId: purchases.siteId,
      siteName: sites.name,
      subtotal: purchases.subtotal,
      total: purchases.total,
      notes: purchases.notes,
      createdBy: purchases.createdBy,
      syncStatus: purchases.syncStatus,
      syncVersion: purchases.syncVersion,
      createdAt: purchases.createdAt,
      updatedAt: purchases.updatedAt,
    })
    .from(purchases)
    .innerJoin(providers, eq(purchases.providerId, providers.id))
    .innerJoin(sites, eq(purchases.siteId, sites.id))
    .where(and(eq(purchases.id, purchaseId), eq(purchases.tenantId, tenantId)))
    .get();

  if (!purchase) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Purchase not found' });
  }

  const items = await db
    .select({
      id: purchaseItems.id,
      purchaseId: purchaseItems.purchaseId,
      productId: purchaseItems.productId,
      productName: products.name,
      productSku: products.sku,
      quantity: purchaseItems.quantity,
      unitId: purchaseItems.unitId,
      unitEquivalence: purchaseItems.unitEquivalence,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      costPerUnit: purchaseItems.costPerUnit,
      baseUnitCost: purchaseItems.baseUnitCost,
      total: purchaseItems.total,
    })
    .from(purchaseItems)
    .innerJoin(products, eq(purchaseItems.productId, products.id))
    .innerJoin(units, eq(purchaseItems.unitId, units.id))
    .where(eq(purchaseItems.purchaseId, purchaseId))
    .all();

  return { ...purchase, items };
}

export const purchasesRouter = router({
  list: tenantProcedure.input(listPurchasesInput).query(async ({ ctx, input }) => {
    const { page, perPage, providerId, fromDate, toDate } = input;
    const offset = (page - 1) * perPage;
    const conditions = [eq(purchases.tenantId, ctx.tenantId)];

    if (providerId) conditions.push(eq(purchases.providerId, providerId));
    if (fromDate) conditions.push(gte(purchases.createdAt, fromDate));
    if (toDate) conditions.push(lte(purchases.createdAt, toDate));

    const where = and(...conditions);

    const [items, countResult] = await Promise.all([
      ctx.db
        .select({
          id: purchases.id,
          tenantId: purchases.tenantId,
          purchaseNumber: purchases.purchaseNumber,
          providerId: purchases.providerId,
          providerName: providers.name,
          siteId: purchases.siteId,
          siteName: sites.name,
          subtotal: purchases.subtotal,
          total: purchases.total,
          notes: purchases.notes,
          createdBy: purchases.createdBy,
          syncStatus: purchases.syncStatus,
          syncVersion: purchases.syncVersion,
          createdAt: purchases.createdAt,
          updatedAt: purchases.updatedAt,
        })
        .from(purchases)
        .innerJoin(providers, eq(purchases.providerId, providers.id))
        .innerJoin(sites, eq(purchases.siteId, sites.id))
        .where(where)
        .orderBy(desc(purchases.createdAt))
        .limit(perPage)
        .offset(offset)
        .all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(purchases)
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

  getById: tenantProcedure.input(getPurchaseInput).query(async ({ ctx, input }) => {
    return getPurchaseRecord(ctx.db, ctx.tenantId, input.id);
  }),

  create: tenantProcedure.input(createPurchaseInput).mutation(async ({ ctx, input }) => {
    assertCanCreatePurchase(ctx.user?.role);

    await validateProvider(ctx.db, ctx.tenantId, input.providerId);

    const now = new Date().toISOString();
    const purchaseId = nanoid();
    const sequentialContext = await getPurchaseSequentialContext(ctx.db, ctx.tenantId, ctx.siteId);
    const resolvedItems = await resolvePurchaseItems(ctx.db, ctx.tenantId, input.items);
    const subtotal = resolvedItems.subtotal;
    const total = subtotal;
    const nextSequentialValue = sequentialContext.currentValue + 1;
    const purchaseNumber = `${sequentialContext.prefix}${String(nextSequentialValue).padStart(6, '0')}`;
    const productStockState = new Map(resolvedItems.productStocks);

    ctx.db.transaction(tx => {
      tx.update(sequentials)
        .set({
          currentValue: nextSequentialValue,
          updatedAt: now,
        })
        .where(eq(sequentials.id, sequentialContext.id))
        .run();

      tx.insert(purchases)
        .values({
          id: purchaseId,
          tenantId: ctx.tenantId,
          purchaseNumber,
          providerId: input.providerId,
          siteId: sequentialContext.siteId,
          subtotal,
          total,
          notes: input.notes,
          createdBy: ctx.user!.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      for (const row of resolvedItems.rows) {
        tx.insert(purchaseItems)
          .values({
            id: row.id,
            purchaseId,
            productId: row.productId,
            quantity: row.quantity,
            unitId: row.unitId,
            unitEquivalence: row.unitEquivalence,
            costPerUnit: row.costPerUnit,
            baseUnitCost: row.baseUnitCost,
            total: row.total,
          })
          .run();

        const previousStock = productStockState.get(row.productId) ?? 0;
        const newStock = previousStock + row.normalizedQuantity;
        productStockState.set(row.productId, newStock);

        tx.update(products)
          .set({
            stock: newStock,
            cost: row.baseUnitCost,
            initialCost: row.baseUnitCost,
            syncStatus: 'pending',
            syncVersion: sql`${products.syncVersion} + 1`,
            updatedAt: now,
          })
          .where(eq(products.id, row.productId))
          .run();

        tx.insert(inventoryMovements)
          .values({
            id: nanoid(),
            tenantId: ctx.tenantId,
            productId: row.productId,
            type: 'purchase',
            quantity: row.normalizedQuantity,
            previousStock,
            newStock,
            reference: purchaseId,
            notes: `Purchase ${purchaseNumber} · ${sequentialContext.siteName}`,
            createdBy: ctx.user!.id,
            syncStatus: 'pending',
            syncVersion: 1,
            createdAt: now,
          })
          .run();
      }

      tx.insert(syncQueue)
        .values({
          id: nanoid(),
          tenantId: ctx.tenantId,
          entityType: 'purchases',
          entityId: purchaseId,
          operation: 'create',
          data: {
            id: purchaseId,
            purchaseNumber,
            providerId: input.providerId,
            total,
            siteId: sequentialContext.siteId,
          },
          localVersion: 1,
          attempts: 0,
          createdAt: now,
        })
        .run();
    });

    return getPurchaseRecord(ctx.db, ctx.tenantId, purchaseId);
  }),
});
