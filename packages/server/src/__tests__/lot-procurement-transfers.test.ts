import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { resolvePurchaseItems } from '../application/purchases/resolveItems.js';
import {
  inventoryBalances,
  inventoryLots,
  inventoryMovements,
  products,
  providers,
  purchaseReturnItemLots,
  sites,
  syncOutbox,
  transferOrderItemLots,
  transferOrderItems,
  transferOrders,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { getProductStockTotal } from '../services/inventory-balances.js';
import { appRouter } from '../trpc/router.js';
import { receiveLotInput } from '../trpc/schemas/inventoryLots.js';
import { executeInventoryTransformationInput } from '../trpc/schemas/inventoryTransformations.js';
import { purchaseLotReceiptInput } from '../trpc/schemas/purchases.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let primarySiteId: string;
let secondarySiteId: string;
let baseUnitId: string;
let providerId: string;
let fresh: ReturnType<typeof makeFreshContextFactory>;

function expectErrorCode(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(TRPCError);
  expect((error as TRPCError).cause).toBeInstanceOf(ServerErrorWithCode);
  expect(((error as TRPCError).cause as ServerErrorWithCode).errorCode).toBe(code);
}

async function createLotProduct(name: string) {
  const db = getDatabase();
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id,
    tenantId,
    name,
    sku: `LOT-${nanoid(8)}`,
    price: 20,
    price2: 20,
    price3: 20,
    cost: 0,
    initialCost: 0,
    tracksLots: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(unitXProduct).values({
    id: nanoid(),
    productId: id,
    unitId: baseUnitId,
    equivalence: 1,
    price: 20,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function createOrdinaryStockProduct(name: string, stock: number) {
  const db = getDatabase();
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id,
    tenantId,
    name,
    sku: `STOCK-${nanoid(8)}`,
    price: 20,
    price2: 20,
    price3: 20,
    cost: 5,
    initialCost: 5,
    tracksStock: true,
    tracksLots: false,
    tracksSerials: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(unitXProduct).values({
    id: nanoid(),
    productId: id,
    unitId: baseUnitId,
    equivalence: 1,
    price: 20,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(inventoryBalances).values({
    id: nanoid(),
    tenantId,
    siteId: primarySiteId,
    productId: id,
    onHand: stock,
    reserved: 0,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

describe('lot-aware procurement and transfers', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const user = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!user) throw new Error('Expected seeded admin');
    tenantId = user.tenantId;
    userId = user.id;
    const primary = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!primary) throw new Error('Expected seeded site');
    primarySiteId = primary.id;
    secondarySiteId = nanoid();
    const now = new Date().toISOString();
    await db.insert(sites).values({
      id: secondarySiteId,
      tenantId,
      companyId: primary.companyId,
      name: 'Lot destination',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const unit = (await db.select().from(units).where(eq(units.tenantId, tenantId)).all()).find(
      row => row.abbreviation === 'UND'
    );
    if (!unit) throw new Error('Expected base unit');
    baseUnitId = unit.id;
    providerId = nanoid();
    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Exact Lot Supplier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const device = await registerDeviceService(db, {
      tenantId,
      userId,
      kind: 'web',
      name: 'lot-procurement-transfers.test',
    });
    fresh = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      userId,
      email: user.email,
      siteId: primarySiteId,
      deviceId: device.deviceId,
      defaultRole: 'admin',
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('lets a DRAFT defer lot identity while a receipt still demands it', async () => {
    // OCR confirmation maps product, unit, quantity and price only — it never
    // sees batch numbers. Requiring exact lots at resolve time made a
    // quantity-only draft impossible to create, even though a draft receives
    // no stock and therefore has no custody to declare.
    const productId = await createLotProduct(`Draft defers lots ${nanoid(5)}`);
    const items = [{ productId, unitId: baseUnitId, quantity: 4, costPerUnit: 3 }];

    // Receipt path: unchanged, still fails closed.
    expect(() => resolvePurchaseItems(getDatabase(), tenantId, items)).toThrow();
    try {
      resolvePurchaseItems(getDatabase(), tenantId, items);
    } catch (error) {
      expectErrorCode(error, 'LOT_ALLOCATION_REQUIRED');
    }

    // Draft path: catalog, unit and quantity are still resolved; only the
    // physical lot identity is deferred.
    const draft = resolvePurchaseItems(getDatabase(), tenantId, items, {
      allowMissingReceipts: true,
    });
    expect(draft.rows).toHaveLength(1);
    expect(draft.rows[0]).toMatchObject({ productId, normalizedQuantity: 4 });
    expect(draft.rows[0]!.lotReceipts).toEqual([]);
  });

  it('rejects impossible calendar expiries on every lot-receipt boundary', () => {
    const impossibleExpiry = '2027-02-30';
    expect(
      purchaseLotReceiptInput.safeParse({
        lotNumber: 'PUR-INVALID',
        expiresAt: impossibleExpiry,
        baseQuantity: 1,
      }).success
    ).toBe(false);
    expect(
      receiveLotInput.safeParse({
        siteId: primarySiteId,
        productId: 'product',
        lotNumber: 'LOT-INVALID',
        expiresAt: impossibleExpiry,
        quantity: 1,
        unitCost: 1,
      }).success
    ).toBe(false);
    expect(
      executeInventoryTransformationInput.safeParse({
        recipeId: 'recipe',
        siteId: primarySiteId,
        inputs: [{ recipeInputId: 'input', baseQuantity: 1 }],
        outputs: [
          {
            recipeOutputId: 'output',
            baseQuantity: 1,
            lot: { lotNumber: 'OUT-INVALID', expiresAt: impossibleExpiry },
          },
        ],
        waste: [],
      }).success
    ).toBe(false);

    expect(
      purchaseLotReceiptInput.safeParse({
        lotNumber: 'PUR-VALID',
        expiresAt: '2028-02-29',
        baseQuantity: 1,
      }).success
    ).toBe(true);
    expect(
      receiveLotInput.safeParse({
        siteId: primarySiteId,
        productId: 'product',
        lotNumber: 'LOT-VALID',
        expiresAt: '2028-02-29T23:59:59-05:00',
        quantity: 1,
        unitCost: 1,
      }).success
    ).toBe(true);
  });

  it('rejects lot procurement outside the exact supported cent range', async () => {
    const productId = await createLotProduct('Protected lot cost');
    try {
      await appRouter.createCaller(fresh()).purchases.create({
        providerId,
        items: [
          {
            productId,
            unitId: baseUnitId,
            quantity: 1,
            costPerUnit: 100_000_000_000_000,
            lotReceipts: [{ lotNumber: `UNSAFE-COST-${nanoid(5)}`, baseQuantity: 1 }],
          },
        ],
      });
      throw new Error('Expected unsafe-cent lot cost rejection');
    } catch (error) {
      expectErrorCode(error, 'LOT_COST_INVALID');
    }

    expect(getProductStockTotal(getDatabase(), tenantId, productId)).toBe(0);
    expect(
      await getDatabase()
        .select({ id: inventoryLots.id })
        .from(inventoryLots)
        .where(and(eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.productId, productId)))
        .all()
    ).toHaveLength(0);
    expect(
      await getDatabase()
        .select({ cost: products.cost, initialCost: products.initialCost })
        .from(products)
        .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
        .get()
    ).toEqual({ cost: 0, initialCost: 0 });
  });

  it('fails closed when legacy lot stock carries an unsafe stored cost', async () => {
    const productId = await createLotProduct('Legacy unsafe lot cost');
    const purchase = await appRouter.createCaller(fresh()).purchases.create({
      providerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          costPerUnit: 2,
          lotReceipts: [{ lotNumber: `LEGACY-COST-${nanoid(5)}`, baseQuantity: 1 }],
        },
      ],
    });
    const purchaseLot = purchase.items[0]!.lots[0]!;
    await getDatabase()
      .update(inventoryLots)
      .set({ unitCost: 100_000_000_000_000 })
      .where(eq(inventoryLots.id, purchaseLot.inventoryLotId));

    try {
      await appRouter.createCaller(fresh()).purchases.returnPurchase({
        id: purchase.id,
        items: [
          {
            purchaseItemId: purchase.items[0]!.id,
            quantity: 1,
            lotAllocations: [{ purchaseItemLotId: purchaseLot.id, baseQuantity: 1 }],
          },
        ],
        reason: 'Unsafe legacy cost must not propagate',
      });
      throw new Error('Expected unsafe stored lot cost rejection');
    } catch (error) {
      expectErrorCode(error, 'LOT_COST_INVALID');
    }

    expect(getProductStockTotal(getDatabase(), tenantId, productId)).toBe(1);
    expect(
      await getDatabase()
        .select({ onHand: inventoryLots.onHand, unitCost: inventoryLots.unitCost })
        .from(inventoryLots)
        .where(eq(inventoryLots.id, purchaseLot.inventoryLotId))
        .get()
    ).toEqual({ onHand: 1, unitCost: 100_000_000_000_000 });
  });

  it('receives exact batches and returns only frozen purchase provenance', async () => {
    const productId = await createLotProduct('Lot purchase round trip');
    const lotA = `PUR-A-${nanoid(5)}`;
    const lotB = `PUR-B-${nanoid(5)}`;
    const purchase = await appRouter.createCaller(fresh()).purchases.create({
      providerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 10,
          costPerUnit: 2,
          lotReceipts: [
            { lotNumber: lotA, baseQuantity: 6, expiresAt: '2030-01-01' },
            { lotNumber: lotB, baseQuantity: 4, expiresAt: null },
          ],
        },
      ],
    });
    expect(purchase.items[0]).toMatchObject({
      tracksLots: true,
      quantity: 10,
      remainingQuantity: 10,
      returnableQuantity: 10,
    });
    expect(purchase.items[0]!.lots.map(lot => lot.baseQuantity).sort((a, b) => a - b)).toEqual([
      4, 6,
    ]);
    expect(getProductStockTotal(getDatabase(), tenantId, productId)).toBe(10);

    const inheritedExpiryProductId = await createLotProduct('Inherited lot expiry');
    const inheritedLotNumber = `PUR-EXP-${nanoid(5)}`;
    await appRouter.createCaller(fresh()).purchases.create({
      providerId,
      items: [
        {
          productId: inheritedExpiryProductId,
          unitId: baseUnitId,
          quantity: 1,
          costPerUnit: 3,
          lotReceipts: [
            { lotNumber: inheritedLotNumber, baseQuantity: 1, expiresAt: '2032-06-30' },
          ],
        },
      ],
    });
    const repeatedReceipt = await appRouter.createCaller(fresh()).purchases.create({
      providerId,
      items: [
        {
          productId: inheritedExpiryProductId,
          unitId: baseUnitId,
          quantity: 1,
          costPerUnit: 3,
          lotReceipts: [{ lotNumber: inheritedLotNumber, baseQuantity: 1 }],
        },
      ],
    });
    expect(repeatedReceipt.items[0]!.lots[0]!.expiresAt).toBe('2032-06-30');

    const sourceLot = purchase.items[0]!.lots.find(lot => lot.lotNumber === lotA)!;
    await getDatabase()
      .update(products)
      .set({ tracksLots: false })
      .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
      .run();
    const mismatchedTrackingRead = await appRouter
      .createCaller(fresh())
      .purchases.getById({ id: purchase.id });
    expect(mismatchedTrackingRead.items[0]).toMatchObject({ returnableQuantity: 0 });
    expect(mismatchedTrackingRead.items[0]!.lots[0]).toMatchObject({
      availableBaseQuantity: 0,
    });
    try {
      await appRouter.createCaller(fresh()).purchases.returnPurchase({
        id: purchase.id,
        items: [
          {
            purchaseItemId: purchase.items[0]!.id,
            quantity: 1,
          },
        ],
        reason: 'Corrupt tracking-mode guard',
      });
      throw new Error('Expected frozen purchase-lot provenance rejection');
    } catch (error) {
      expectErrorCode(error, 'LOT_STOCK_INCONSISTENT');
    }
    await getDatabase()
      .update(products)
      .set({ tracksLots: true })
      .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
      .run();

    await getDatabase()
      .update(inventoryLots)
      .set({ expiresAt: '2030-02-01' })
      .where(eq(inventoryLots.id, sourceLot.inventoryLotId));
    const changedExpiryRead = await appRouter
      .createCaller(fresh())
      .purchases.getById({ id: purchase.id });
    expect(changedExpiryRead.items[0]).toMatchObject({ returnableQuantity: 4 });
    expect(changedExpiryRead.items[0]!.lots.find(lot => lot.id === sourceLot.id)).toMatchObject({
      availableBaseQuantity: 0,
    });
    try {
      await appRouter.createCaller(fresh()).purchases.returnPurchase({
        id: purchase.id,
        items: [
          {
            purchaseItemId: purchase.items[0]!.id,
            quantity: 3,
            lotAllocations: [{ purchaseItemLotId: sourceLot.id, baseQuantity: 3 }],
          },
        ],
        reason: 'Attempt after receipt identity changed',
      });
      throw new Error('Expected changed purchase lot identity to block supplier return');
    } catch (error) {
      expectErrorCode(error, 'LOT_STOCK_INCONSISTENT');
    }
    expect(getProductStockTotal(getDatabase(), tenantId, productId)).toBe(10);
    await getDatabase()
      .update(inventoryLots)
      .set({ expiresAt: '2030-01-01' })
      .where(eq(inventoryLots.id, sourceLot.inventoryLotId));

    const returned = await appRouter.createCaller(fresh()).purchases.returnPurchase({
      id: purchase.id,
      items: [
        {
          purchaseItemId: purchase.items[0]!.id,
          quantity: 3,
          lotAllocations: [{ purchaseItemLotId: sourceLot.id, baseQuantity: 3 }],
        },
      ],
      reason: 'Supplier quality return',
    });
    expect(returned.status).toBe('partial_returned');
    expect(returned.items[0]!.lots.find(lot => lot.id === sourceLot.id)).toMatchObject({
      returnedBaseQuantity: 3,
      remainingBaseQuantity: 3,
      currentOnHand: 3,
      availableBaseQuantity: 3,
    });
    expect(returned.items[0]).toMatchObject({
      remainingQuantity: 7,
      returnableQuantity: 7,
    });
    expect(returned.returns[0]!.items[0]!.lots[0]).toMatchObject({
      purchaseItemLotId: sourceLot.id,
      baseQuantity: 3,
      unitCost: 2,
    });
    expect(getProductStockTotal(getDatabase(), tenantId, productId)).toBe(7);
    expect(
      await getDatabase()
        .select()
        .from(purchaseReturnItemLots)
        .where(eq(purchaseReturnItemLots.purchaseItemLotId, sourceLot.id))
        .get()
    ).toBeTruthy();

    try {
      await appRouter.createCaller(fresh()).purchases.returnPurchase({
        id: purchase.id,
        items: [
          {
            purchaseItemId: purchase.items[0]!.id,
            quantity: 4,
            lotAllocations: [{ purchaseItemLotId: sourceLot.id, baseQuantity: 4 }],
          },
        ],
      });
      throw new Error('Expected provenance over-return rejection');
    } catch (error) {
      expectErrorCode(error, 'LOT_ALLOCATION_PROVENANCE_EXCEEDED');
    }
    expect(getProductStockTotal(getDatabase(), tenantId, productId)).toBe(7);
  });

  it('reconciles fractional lot returns without leaving a phantom remainder', async () => {
    const productId = await createLotProduct('Fractional lot return');
    const purchase = await appRouter.createCaller(fresh()).purchases.create({
      providerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 0.3,
          costPerUnit: 10,
          lotReceipts: [{ lotNumber: `FRAC-${nanoid(5)}`, baseQuantity: 0.3 }],
        },
      ],
    });
    const purchaseLot = purchase.items[0]!.lots[0]!;
    const firstReturn = await appRouter.createCaller(fresh()).purchases.returnPurchase({
      id: purchase.id,
      items: [
        {
          purchaseItemId: purchase.items[0]!.id,
          quantity: 0.1,
          lotAllocations: [{ purchaseItemLotId: purchaseLot.id, baseQuantity: 0.1 }],
        },
      ],
      reason: 'First fractional return',
    });
    expect(firstReturn.status).toBe('partial_returned');

    const finalReturn = await appRouter.createCaller(fresh()).purchases.returnPurchase({
      id: purchase.id,
      items: [
        {
          purchaseItemId: purchase.items[0]!.id,
          quantity: 0.2,
          lotAllocations: [{ purchaseItemLotId: purchaseLot.id, baseQuantity: 0.2 }],
        },
      ],
      reason: 'Final fractional return',
    });
    expect(finalReturn.status).toBe('returned');
    expect(finalReturn.items[0]).toMatchObject({ remainingQuantity: 0 });
    expect(finalReturn.items[0]!.returnedQuantity).toBeCloseTo(0.3, 9);
    expect(getProductStockTotal(getDatabase(), tenantId, productId)).toBeCloseTo(0, 9);

    const orderedProductId = await createLotProduct('Fractional lot order receipt');
    const order = await appRouter.createCaller(fresh()).orders.create({
      providerId,
      items: [{ productId: orderedProductId, unitId: baseUnitId, quantity: 0.3, costPerUnit: 4 }],
    });
    await appRouter.createCaller(fresh()).purchases.createFromOrder({
      orderId: order.id,
      items: [
        {
          orderItemId: order.items[0]!.id,
          quantity: 0.1,
          lotReceipts: [{ lotNumber: `FRAC-ORD-A-${nanoid(5)}`, baseQuantity: 0.1 }],
        },
      ],
    });
    expect((await appRouter.createCaller(fresh()).orders.getById({ id: order.id })).status).toBe(
      'partial_received'
    );
    const finalReceipt = await appRouter.createCaller(fresh()).purchases.createFromOrder({
      orderId: order.id,
      items: [
        {
          orderItemId: order.items[0]!.id,
          quantity: 0.2,
          lotReceipts: [{ lotNumber: `FRAC-ORD-B-${nanoid(5)}`, baseQuantity: 0.2 }],
        },
      ],
    });
    expect((await appRouter.createCaller(fresh()).orders.getById({ id: order.id })).status).toBe(
      'received'
    );
    expect(
      await getDatabase()
        .select({ newStock: inventoryMovements.newStock })
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.tenantId, tenantId),
            eq(inventoryMovements.reference, finalReceipt.id)
          )
        )
        .get()
    ).toEqual({ newStock: 0.3 });

    const sourceLots = await getDatabase()
      .select({ id: inventoryLots.id, onHand: inventoryLots.onHand })
      .from(inventoryLots)
      .where(
        and(
          eq(inventoryLots.tenantId, tenantId),
          eq(inventoryLots.siteId, primarySiteId),
          eq(inventoryLots.productId, orderedProductId)
        )
      )
      .all();
    const shipped = await appRouter.createCaller(fresh()).transfers.create({
      fromSiteId: primarySiteId,
      toSiteId: secondarySiteId,
      defer: true,
      items: [
        {
          productId: orderedProductId,
          quantity: 0.3,
          lotAllocations: sourceLots.map(lot => ({ lotId: lot.id, quantity: lot.onHand })),
        },
      ],
    });
    const received = await appRouter.createCaller(fresh()).transfers.receive({
      transferId: shipped.id,
      lines: [
        {
          itemId: shipped.items[0]!.id,
          receivedQuantity: 0.1 + 0.2,
          lotAllocations: shipped.items[0]!.lots.map(lot => ({
            transferItemLotId: lot.id,
            receivedQuantity: lot.quantity,
          })),
        },
      ],
    });
    expect(received.hasDiscrepancy).toBe(false);
    expect(received.receivedItems[0]!.quantity).toBe(0.3);
    expect(
      (await appRouter.createCaller(fresh()).transfers.list()).items.find(
        item => item.id === shipped.id
      )?.hasDiscrepancy
    ).toBe(false);
    expect(
      (await appRouter.createCaller(fresh()).transfers.getById({ id: shipped.id })).hasDiscrepancy
    ).toBe(false);

    const balancesAfterReceipt = await getDatabase()
      .select({ siteId: inventoryBalances.siteId, onHand: inventoryBalances.onHand })
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, tenantId),
          eq(inventoryBalances.productId, orderedProductId)
        )
      )
      .all();
    expect(balancesAfterReceipt.find(row => row.siteId === primarySiteId)?.onHand).toBe(0);
    expect(balancesAfterReceipt.find(row => row.siteId === secondarySiteId)?.onHand).toBe(0.3);

    await appRouter.createCaller(fresh()).transfers.void({
      transferId: shipped.id,
      reason: 'Fractional reconciliation round trip',
    });
    const balancesAfterVoid = await getDatabase()
      .select({ siteId: inventoryBalances.siteId, onHand: inventoryBalances.onHand })
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, tenantId),
          eq(inventoryBalances.productId, orderedProductId)
        )
      )
      .all();
    expect(balancesAfterVoid.find(row => row.siteId === primarySiteId)?.onHand).toBe(0.3);
    expect(balancesAfterVoid.find(row => row.siteId === secondarySiteId)?.onHand).toBe(0);

    const lotsAfterVoid = await getDatabase()
      .select({ siteId: inventoryLots.siteId, onHand: inventoryLots.onHand })
      .from(inventoryLots)
      .where(
        and(eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.productId, orderedProductId))
      )
      .all();
    expect(
      lotsAfterVoid
        .filter(row => row.siteId === primarySiteId)
        .reduce((sum, row) => sum + row.onHand, 0)
    ).toBeCloseTo(0.3, 12);
    expect(
      lotsAfterVoid
        .filter(row => row.siteId === secondarySiteId)
        .reduce((sum, row) => sum + row.onHand, 0)
    ).toBe(0);
  });

  it('normalizes a sub-precision lot receipt to a complete shortage', async () => {
    const productId = await createLotProduct('Sub-precision lot receipt');
    const purchase = await appRouter.createCaller(fresh()).purchases.create({
      providerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          costPerUnit: 7,
          lotReceipts: [{ lotNumber: `TINY-${nanoid(5)}`, baseQuantity: 1 }],
        },
      ],
    });
    const sourceLotId = purchase.items[0]!.lots[0]!.inventoryLotId;
    const shipped = await appRouter.createCaller(fresh()).transfers.create({
      fromSiteId: primarySiteId,
      toSiteId: secondarySiteId,
      defer: true,
      items: [
        {
          productId,
          quantity: 1,
          lotAllocations: [{ lotId: sourceLotId, quantity: 1 }],
        },
      ],
    });
    const shippedLot = shipped.items[0]!.lots[0]!;

    const received = await appRouter.createCaller(fresh()).transfers.receive({
      transferId: shipped.id,
      lines: [
        {
          itemId: shipped.items[0]!.id,
          receivedQuantity: 5e-7,
          lotAllocations: [{ transferItemLotId: shippedLot.id, receivedQuantity: 5e-7 }],
        },
      ],
      discrepancyNotes: 'Quantity below supported operational precision',
    });
    expect(received.receivedItems[0]!.quantity).toBe(0);
    expect(
      await getDatabase()
        .select()
        .from(transferOrderItemLots)
        .where(eq(transferOrderItemLots.id, shippedLot.id))
        .get()
    ).toMatchObject({
      receivedQuantity: 0,
      destinationLotId: null,
      destinationLotWasCreated: null,
      destinationResultingOnHand: null,
    });

    await appRouter.createCaller(fresh()).transfers.void({
      transferId: shipped.id,
      reason: 'Close sub-precision shortage',
    });
    expect(
      await getDatabase()
        .select({ onHand: inventoryLots.onHand })
        .from(inventoryLots)
        .where(eq(inventoryLots.id, sourceLotId))
        .get()
    ).toEqual({ onHand: 0 });
    expect(getProductStockTotal(getDatabase(), tenantId, productId)).toBe(0);
  });

  it('receives partial order batches and voids an untouched lot purchase exactly', async () => {
    const orderedProductId = await createLotProduct('Lot order receipt');
    const caller = appRouter.createCaller(fresh());
    const order = await caller.orders.create({
      providerId,
      items: [{ productId: orderedProductId, unitId: baseUnitId, quantity: 10, costPerUnit: 5 }],
    });
    const first = await appRouter.createCaller(fresh()).purchases.createFromOrder({
      orderId: order.id,
      items: [
        {
          orderItemId: order.items[0]!.id,
          quantity: 4,
          lotReceipts: [{ lotNumber: `ORD-A-${nanoid(5)}`, baseQuantity: 4 }],
        },
      ],
    });
    expect((await caller.orders.getById({ id: order.id })).status).toBe('partial_received');
    expect(first.items[0]!.lots).toHaveLength(1);
    const second = await appRouter.createCaller(fresh()).purchases.createFromOrder({
      orderId: order.id,
      items: [
        {
          orderItemId: order.items[0]!.id,
          quantity: 6,
          lotReceipts: [{ lotNumber: `ORD-B-${nanoid(5)}`, baseQuantity: 6 }],
        },
      ],
    });
    expect((await caller.orders.getById({ id: order.id })).status).toBe('received');
    expect(second.items[0]!.sourceOrderItemId).toBe(order.items[0]!.id);
    expect(getProductStockTotal(getDatabase(), tenantId, orderedProductId)).toBe(10);

    const voidProductId = await createLotProduct('Void lot purchase');
    const purchase = await appRouter.createCaller(fresh()).purchases.create({
      providerId,
      items: [
        {
          productId: voidProductId,
          unitId: baseUnitId,
          quantity: 5,
          costPerUnit: 7,
          lotReceipts: [{ lotNumber: `VOID-${nanoid(5)}`, baseQuantity: 5 }],
        },
      ],
    });
    await getDatabase()
      .update(products)
      .set({ tracksLots: false })
      .where(and(eq(products.tenantId, tenantId), eq(products.id, voidProductId)))
      .run();
    try {
      await appRouter.createCaller(fresh()).purchases.void({
        id: purchase.id,
        reason: 'Corrupt tracking-mode guard',
      });
      throw new Error('Expected frozen purchase-lot provenance rejection');
    } catch (error) {
      expectErrorCode(error, 'LOT_STOCK_INCONSISTENT');
    }
    await getDatabase()
      .update(products)
      .set({ tracksLots: true })
      .where(and(eq(products.tenantId, tenantId), eq(products.id, voidProductId)))
      .run();
    const voidLotId = purchase.items[0]!.lots[0]!.inventoryLotId;
    await getDatabase()
      .update(inventoryLots)
      .set({ expiresAt: '2035-01-01' })
      .where(eq(inventoryLots.id, voidLotId));
    try {
      await appRouter.createCaller(fresh()).purchases.void({
        id: purchase.id,
        reason: 'Do not erase changed lot identity',
      });
      throw new Error('Expected changed purchase lot identity to block void');
    } catch (error) {
      expectErrorCode(error, 'LOT_STOCK_INCONSISTENT');
    }
    await getDatabase()
      .update(inventoryLots)
      .set({ expiresAt: null })
      .where(eq(inventoryLots.id, voidLotId));
    await getDatabase()
      .update(inventoryLots)
      .set({ status: 'quarantined' })
      .where(eq(inventoryLots.id, voidLotId));
    try {
      await appRouter.createCaller(fresh()).purchases.void({
        id: purchase.id,
        reason: 'Do not erase quarantine evidence',
      });
      throw new Error('Expected non-vendable purchase lot rejection');
    } catch (error) {
      expectErrorCode(error, 'LOT_STOCK_INCONSISTENT');
    }
    expect(
      (await appRouter.createCaller(fresh()).purchases.getById({ id: purchase.id })).status
    ).toBe('completed');
    await getDatabase()
      .update(inventoryLots)
      .set({ status: 'active' })
      .where(eq(inventoryLots.id, voidLotId));
    const voided = await appRouter.createCaller(fresh()).purchases.void({
      id: purchase.id,
      reason: 'Duplicate supplier invoice',
    });
    expect(voided.status).toBe('voided');
    expect(voided.items[0]).toMatchObject({ returnableQuantity: 0 });
    expect(voided.items[0]!.lots[0]).toMatchObject({ availableBaseQuantity: 0 });
    expect(getProductStockTotal(getDatabase(), tenantId, voidProductId)).toBe(0);
    const lot = await getDatabase()
      .select()
      .from(inventoryLots)
      .where(eq(inventoryLots.id, voidLotId))
      .get();
    expect(lot).toMatchObject({ onHand: 0, status: 'depleted', unitCost: 7 });
  });

  it('rejects purchase void when a later receipt blended the physical lot cost', async () => {
    const productId = await createLotProduct('Blended purchase-lot void guard');
    const lotNumber = `BLEND-${nanoid(5)}`;
    const firstPurchase = await appRouter.createCaller(fresh()).purchases.create({
      providerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 10,
          costPerUnit: 10,
          lotReceipts: [{ lotNumber, baseQuantity: 10, expiresAt: '2034-12-31' }],
        },
      ],
    });
    const lotId = firstPurchase.items[0]!.lots[0]!.inventoryLotId;
    await appRouter.createCaller(fresh()).purchases.create({
      providerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 10,
          costPerUnit: 20,
          lotReceipts: [{ lotNumber, baseQuantity: 10, expiresAt: '2034-12-31' }],
        },
      ],
    });

    const before = await getDatabase()
      .select()
      .from(inventoryLots)
      .where(eq(inventoryLots.id, lotId))
      .get();
    expect(before).toMatchObject({ onHand: 20, unitCost: 15, status: 'active' });

    try {
      await appRouter.createCaller(fresh()).purchases.void({
        id: firstPurchase.id,
        reason: 'Duplicate invoice after a different-cost receipt',
      });
      throw new Error('Expected blended lot cost to block exact purchase void');
    } catch (error) {
      expectErrorCode(error, 'LOT_STOCK_INCONSISTENT');
    }

    expect(
      await getDatabase().select().from(inventoryLots).where(eq(inventoryLots.id, lotId)).get()
    ).toEqual(before);
    expect(getProductStockTotal(getDatabase(), tenantId, productId)).toBe(20);
    expect(
      (await appRouter.createCaller(fresh()).purchases.getById({ id: firstPurchase.id })).status
    ).toBe('completed');
  });

  it('rejects a supplier return when another receipt blended the physical lot cost', async () => {
    const productId = await createLotProduct('Blended purchase-lot return guard');
    const lotNumber = `RETURN-BLEND-${nanoid(5)}`;
    const firstPurchase = await appRouter.createCaller(fresh()).purchases.create({
      providerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 10,
          costPerUnit: 10,
          lotReceipts: [{ lotNumber, baseQuantity: 10, expiresAt: '2034-12-31' }],
        },
      ],
    });
    const purchaseLot = firstPurchase.items[0]!.lots[0]!;
    await appRouter.createCaller(fresh()).purchases.create({
      providerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 10,
          costPerUnit: 20,
          lotReceipts: [{ lotNumber, baseQuantity: 10, expiresAt: '2034-12-31' }],
        },
      ],
    });

    const before = await getDatabase()
      .select()
      .from(inventoryLots)
      .where(eq(inventoryLots.id, purchaseLot.inventoryLotId))
      .get();
    expect(before).toMatchObject({ onHand: 20, unitCost: 15, status: 'active' });
    const blendedRead = await appRouter
      .createCaller(fresh())
      .purchases.getById({ id: firstPurchase.id });
    expect(blendedRead.items[0]).toMatchObject({ returnableQuantity: 0 });
    expect(blendedRead.items[0]!.lots[0]).toMatchObject({ availableBaseQuantity: 0 });

    try {
      await appRouter.createCaller(fresh()).purchases.returnPurchase({
        id: firstPurchase.id,
        items: [
          {
            purchaseItemId: firstPurchase.items[0]!.id,
            quantity: 10,
            lotAllocations: [{ purchaseItemLotId: purchaseLot.id, baseQuantity: 10 }],
          },
        ],
        reason: 'Original-cost return after a different-cost receipt',
      });
      throw new Error('Expected blended lot cost to block the supplier return');
    } catch (error) {
      expectErrorCode(error, 'LOT_STOCK_INCONSISTENT');
    }

    expect(
      await getDatabase()
        .select()
        .from(inventoryLots)
        .where(eq(inventoryLots.id, purchaseLot.inventoryLotId))
        .get()
    ).toEqual(before);
    expect(
      (await appRouter.createCaller(fresh()).purchases.getById({ id: firstPurchase.id })).status
    ).toBe('completed');
  });

  it('collapses duplicate transfer lines that split the same physical lot', async () => {
    const productId = await createLotProduct('Collapsed exact-lot transfer');
    const purchase = await appRouter.createCaller(fresh()).purchases.create({
      providerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 5,
          costPerUnit: 8,
          lotReceipts: [{ lotNumber: `COLLAPSE-${nanoid(5)}`, baseQuantity: 5 }],
        },
      ],
    });
    const sourceLotId = purchase.items[0]!.lots[0]!.inventoryLotId;

    const transfer = await appRouter.createCaller(fresh()).transfers.create({
      fromSiteId: primarySiteId,
      toSiteId: secondarySiteId,
      items: [
        {
          productId,
          quantity: 2,
          lotAllocations: [{ lotId: sourceLotId, quantity: 2 }],
        },
        {
          productId,
          quantity: 3,
          lotAllocations: [{ lotId: sourceLotId, quantity: 3 }],
        },
      ],
    });

    expect(transfer.items).toHaveLength(1);
    expect(transfer.items[0]).toMatchObject({ productId, quantity: 5 });
    expect(transfer.items[0]!.lots).toHaveLength(1);
    expect(transfer.items[0]!.lots[0]).toMatchObject({ sourceLotId, quantity: 5 });
    expect(
      await getDatabase()
        .select({ onHand: inventoryLots.onHand })
        .from(inventoryLots)
        .where(eq(inventoryLots.id, sourceLotId))
        .get()
    ).toEqual({ onHand: 0 });
    expect(getProductStockTotal(getDatabase(), tenantId, productId)).toBe(5);
    const movedPurchase = await appRouter
      .createCaller(fresh())
      .purchases.getById({ id: purchase.id });
    expect(movedPurchase.items[0]).toMatchObject({
      remainingQuantity: 5,
      returnableQuantity: 0,
    });
    expect(movedPurchase.items[0]!.lots[0]).toMatchObject({ availableBaseQuantity: 0 });
  });

  it('moves exact batches immediately and restores their identity on void', async () => {
    const productId = await createLotProduct('Immediate lot transfer');
    const lotNumber = `TR-${nanoid(5)}`;
    const purchase = await appRouter.createCaller(fresh()).purchases.create({
      providerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 10,
          costPerUnit: 9,
          lotReceipts: [{ lotNumber, baseQuantity: 10 }],
        },
      ],
    });
    const sourceLotId = purchase.items[0]!.lots[0]!.inventoryLotId;
    const destinationLotId = nanoid();
    const seededAt = new Date().toISOString();
    await getDatabase().insert(inventoryBalances).values({
      id: nanoid(),
      tenantId,
      siteId: secondarySiteId,
      productId,
      onHand: 5,
      reserved: 0,
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    await getDatabase().insert(inventoryLots).values({
      id: destinationLotId,
      tenantId,
      siteId: secondarySiteId,
      productId,
      lotNumber,
      expiresAt: '2031-05-01',
      onHand: 5,
      unitCost: 20,
      status: 'active',
      receivedAt: seededAt,
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    const transferInput = {
      fromSiteId: primarySiteId,
      toSiteId: secondarySiteId,
      items: [
        {
          productId,
          quantity: 10,
          lotAllocations: [{ lotId: sourceLotId, quantity: 10 }],
        },
      ],
    };
    try {
      await appRouter.createCaller(fresh()).transfers.create(transferInput);
      throw new Error('Expected cross-site expiry mismatch rejection');
    } catch (error) {
      expectErrorCode(error, 'LOT_EXPIRY_CONFLICT');
    }
    expect(
      await getDatabase()
        .select()
        .from(inventoryLots)
        .where(eq(inventoryLots.id, sourceLotId))
        .get()
    ).toMatchObject({ onHand: 10, status: 'active' });
    await getDatabase()
      .update(inventoryLots)
      .set({ expiresAt: null })
      .where(eq(inventoryLots.id, destinationLotId));

    const transfer = await appRouter.createCaller(fresh()).transfers.create(transferInput);
    expect(transfer.items[0]!.lots[0]).toMatchObject({
      sourceLotId,
      lotNumber,
      quantity: 10,
      receivedQuantity: 10,
      status: 'active',
      unitCost: 9,
    });
    expect(transfer.items[0]!.lots[0]!.destinationLotId).toBe(destinationLotId);
    expect(
      await getDatabase()
        .select()
        .from(inventoryLots)
        .where(eq(inventoryLots.id, sourceLotId))
        .get()
    ).toMatchObject({ onHand: 0, status: 'depleted' });
    expect(
      await getDatabase()
        .select()
        .from(inventoryLots)
        .where(eq(inventoryLots.id, destinationLotId))
        .get()
    ).toMatchObject({ onHand: 15, lotNumber, unitCost: 12.67, status: 'active' });
    const movements = await getDatabase()
      .select()
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.tenantId, tenantId),
          eq(inventoryMovements.reference, transfer.id),
          eq(inventoryMovements.type, 'transfer')
        )
      )
      .all();
    expect(movements.map(row => row.quantity).sort((a, b) => a - b)).toEqual([-10, 10]);

    await getDatabase()
      .update(products)
      .set({ tracksLots: false })
      .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
      .run();
    try {
      await appRouter.createCaller(fresh()).transfers.void({
        transferId: transfer.id,
        reason: 'Corrupt tracking-mode guard',
      });
      throw new Error('Expected frozen transfer-lot provenance rejection');
    } catch (error) {
      expectErrorCode(error, 'LOT_STOCK_INCONSISTENT');
    }
    await getDatabase()
      .update(products)
      .set({ tracksLots: true })
      .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
      .run();

    await getDatabase()
      .update(inventoryLots)
      .set({ expiresAt: '2031-06-01' })
      .where(eq(inventoryLots.id, sourceLotId));
    try {
      await appRouter.createCaller(fresh()).transfers.void({
        transferId: transfer.id,
        reason: 'Corrupt source identity guard',
      });
      throw new Error('Expected changed source lot identity to block reversal');
    } catch (error) {
      expectErrorCode(error, 'LOT_STOCK_INCONSISTENT');
    }
    expect(
      await getDatabase()
        .select({ status: transferOrders.status })
        .from(transferOrders)
        .where(eq(transferOrders.id, transfer.id))
        .get()
    ).toEqual({ status: 'completed' });
    expect(
      await getDatabase()
        .select({ onHand: inventoryLots.onHand })
        .from(inventoryLots)
        .where(eq(inventoryLots.id, destinationLotId))
        .get()
    ).toEqual({ onHand: 15 });
    await getDatabase()
      .update(inventoryLots)
      .set({ expiresAt: null })
      .where(eq(inventoryLots.id, sourceLotId));

    await getDatabase()
      .update(inventoryLots)
      .set({ unitCost: 100_000_000_000_000 })
      .where(eq(inventoryLots.id, destinationLotId));
    try {
      await appRouter.createCaller(fresh()).transfers.void({
        transferId: transfer.id,
        reason: 'Corrupt destination cost guard',
      });
      throw new Error('Expected unsafe destination lot cost to block reversal');
    } catch (error) {
      expectErrorCode(error, 'LOT_COST_INVALID');
    }
    expect(
      await getDatabase()
        .select({ status: transferOrders.status })
        .from(transferOrders)
        .where(eq(transferOrders.id, transfer.id))
        .get()
    ).toEqual({ status: 'completed' });
    await getDatabase()
      .update(inventoryLots)
      .set({ unitCost: 12.67 })
      .where(eq(inventoryLots.id, destinationLotId));

    await getDatabase()
      .update(inventoryLots)
      .set({ status: 'quarantined' })
      .where(eq(inventoryLots.id, destinationLotId));

    await appRouter.createCaller(fresh()).transfers.void({
      transferId: transfer.id,
      reason: 'Wrong destination after quarantine',
    });
    expect(
      await getDatabase()
        .select()
        .from(inventoryLots)
        .where(eq(inventoryLots.id, sourceLotId))
        .get()
    ).toMatchObject({ onHand: 10, unitCost: 9, status: 'quarantined' });
    expect(
      await getDatabase()
        .select()
        .from(inventoryLots)
        .where(eq(inventoryLots.id, destinationLotId))
        .get()
    ).toMatchObject({ onHand: 5, unitCost: 20, status: 'quarantined' });
    expect(getProductStockTotal(getDatabase(), tenantId, productId)).toBe(15);
  });

  it('rejects an exact-lot transfer void after destination stock changes away and back', async () => {
    const productId = await createLotProduct('Transfer ABA guard');
    const purchase = await appRouter.createCaller(fresh()).purchases.create({
      providerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 2,
          costPerUnit: 4,
          lotReceipts: [{ lotNumber: `ABA-${nanoid(5)}`, baseQuantity: 2 }],
        },
      ],
    });
    const sourceLotId = purchase.items[0]!.lots[0]!.inventoryLotId;
    const transfer = await appRouter.createCaller(fresh()).transfers.create({
      fromSiteId: primarySiteId,
      toSiteId: secondarySiteId,
      items: [
        {
          productId,
          quantity: 2,
          lotAllocations: [{ lotId: sourceLotId, quantity: 2 }],
        },
      ],
    });
    const item = await getDatabase()
      .select({
        destinationResultingBalanceVersion: transferOrderItems.destinationResultingBalanceVersion,
      })
      .from(transferOrderItems)
      .where(eq(transferOrderItems.id, transfer.items[0]!.id))
      .get();
    expect(item?.destinationResultingBalanceVersion).toBeGreaterThan(0);
    const destinationLotId = transfer.items[0]!.lots[0]!.destinationLotId!;

    await getDatabase()
      .update(inventoryBalances)
      .set({
        onHand: sql`${inventoryBalances.onHand} + 1`,
        version: sql`${inventoryBalances.version} + 1`,
      })
      .where(
        and(
          eq(inventoryBalances.tenantId, tenantId),
          eq(inventoryBalances.siteId, secondarySiteId),
          eq(inventoryBalances.productId, productId)
        )
      );
    await getDatabase()
      .update(inventoryLots)
      .set({ onHand: sql`${inventoryLots.onHand} + 1` })
      .where(eq(inventoryLots.id, destinationLotId));
    await getDatabase()
      .update(inventoryBalances)
      .set({
        onHand: sql`${inventoryBalances.onHand} - 1`,
        version: sql`${inventoryBalances.version} + 1`,
      })
      .where(
        and(
          eq(inventoryBalances.tenantId, tenantId),
          eq(inventoryBalances.siteId, secondarySiteId),
          eq(inventoryBalances.productId, productId)
        )
      );
    await getDatabase()
      .update(inventoryLots)
      .set({ onHand: sql`${inventoryLots.onHand} - 1` })
      .where(eq(inventoryLots.id, destinationLotId));

    try {
      await appRouter.createCaller(fresh()).transfers.void({
        transferId: transfer.id,
        reason: 'Attempt after destination ABA activity',
      });
      throw new Error('Expected destination balance revision to block reversal');
    } catch (error) {
      expectErrorCode(error, 'TRANSFER_VOID_INSUFFICIENT_STOCK');
    }
    expect(
      await getDatabase()
        .select({ status: transferOrders.status })
        .from(transferOrders)
        .where(eq(transferOrders.id, transfer.id))
        .get()
    ).toEqual({ status: 'completed' });
  });

  it('freezes every stock identity while ordinary inventory is in transit', async () => {
    const productId = await createOrdinaryStockProduct('Deferred ordinary identity', 4);
    const shipped = await appRouter.createCaller(fresh()).transfers.create({
      fromSiteId: primarySiteId,
      toSiteId: secondarySiteId,
      defer: true,
      items: [{ productId, quantity: 4 }],
    });

    await expect(
      appRouter.createCaller(fresh()).products.update({
        id: productId,
        version: 0,
        tracksSerials: true,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_TRACKING_HAS_IN_TRANSIT_TRANSFER' },
    });
    await expect(
      appRouter.createCaller(fresh()).products.update({
        id: productId,
        version: 0,
        tracksStock: false,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_TRACKING_HAS_IN_TRANSIT_TRANSFER' },
    });

    // Defense in depth: even legacy or directly corrupted catalog state must
    // not let the receipt credit inventory to an item currently marked as a
    // service.
    await getDatabase()
      .update(products)
      .set({ tracksStock: false })
      .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
      .run();
    await expect(
      appRouter.createCaller(fresh()).transfers.receive({ transferId: shipped.id })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_SERVICE_STOCK_NOT_TRACKED' },
    });
    expect(
      await getDatabase()
        .select({ status: transferOrders.status })
        .from(transferOrders)
        .where(eq(transferOrders.id, shipped.id))
        .get()
    ).toEqual({ status: 'in_transit' });

    await getDatabase()
      .update(products)
      .set({ tracksStock: true })
      .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
      .run();
    await expect(
      appRouter.createCaller(fresh()).transfers.receive({ transferId: shipped.id })
    ).resolves.toMatchObject({ status: 'completed' });
    expect(getProductStockTotal(getDatabase(), tenantId, productId)).toBe(4);
  });

  it('fails closed when transfer create or void sees service metadata drift', async () => {
    const productId = await createOrdinaryStockProduct('Corrupt service transfer', 3);
    await getDatabase()
      .update(products)
      .set({ tracksStock: false })
      .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
      .run();
    await expect(
      appRouter.createCaller(fresh()).transfers.create({
        fromSiteId: primarySiteId,
        toSiteId: secondarySiteId,
        items: [{ productId, quantity: 3 }],
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_SERVICE_STOCK_NOT_TRACKED' },
    });
    expect(getProductStockTotal(getDatabase(), tenantId, productId)).toBe(3);

    await getDatabase()
      .update(products)
      .set({ tracksStock: true })
      .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
      .run();
    const shipped = await appRouter.createCaller(fresh()).transfers.create({
      fromSiteId: primarySiteId,
      toSiteId: secondarySiteId,
      defer: true,
      items: [{ productId, quantity: 3 }],
    });
    await getDatabase()
      .update(products)
      .set({ tracksStock: false })
      .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
      .run();
    await expect(
      appRouter.createCaller(fresh()).transfers.void({
        transferId: shipped.id,
        reason: 'Corrupt service metadata',
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_SERVICE_STOCK_NOT_TRACKED' },
    });
    expect(
      await getDatabase()
        .select({ status: transferOrders.status })
        .from(transferOrders)
        .where(eq(transferOrders.id, shipped.id))
        .get()
    ).toEqual({ status: 'in_transit' });

    await getDatabase()
      .update(products)
      .set({ tracksStock: true })
      .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
      .run();
    await expect(
      appRouter.createCaller(fresh()).transfers.void({
        transferId: shipped.id,
        reason: 'Restore ordinary inventory metadata',
      })
    ).resolves.toMatchObject({ status: 'void' });
    expect(getProductStockTotal(getDatabase(), tenantId, productId)).toBe(3);
  });

  it('preserves quarantine through a deferred receipt shortage and syncs the transfer atomically', async () => {
    const productId = await createLotProduct('Quarantined lot transfer');
    const now = new Date().toISOString();
    const sourceLotId = nanoid();
    await getDatabase().insert(inventoryBalances).values({
      id: nanoid(),
      tenantId,
      siteId: primarySiteId,
      productId,
      onHand: 5,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    });
    await getDatabase()
      .insert(inventoryLots)
      .values({
        id: sourceLotId,
        tenantId,
        siteId: primarySiteId,
        productId,
        lotNumber: `QUAR-${nanoid(5)}`,
        onHand: 5,
        unitCost: 11,
        status: 'quarantined',
        receivedAt: now,
        createdAt: now,
        updatedAt: now,
      });

    const shipped = await appRouter.createCaller(fresh()).transfers.create({
      fromSiteId: primarySiteId,
      toSiteId: secondarySiteId,
      defer: true,
      items: [
        {
          productId,
          quantity: 5,
          lotAllocations: [{ lotId: sourceLotId, quantity: 5 }],
        },
      ],
    });
    const transferLot = shipped.items[0]!.lots[0]!;
    await expect(
      appRouter.createCaller(fresh()).products.update({
        id: productId,
        version: 0,
        tracksLots: false,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PRODUCT_TRACKING_HAS_IN_TRANSIT_TRANSFER' },
    });

    await getDatabase()
      .update(products)
      .set({ tracksLots: false })
      .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
      .run();
    try {
      await appRouter.createCaller(fresh()).transfers.receive({
        transferId: shipped.id,
        lines: [
          {
            itemId: shipped.items[0]!.id,
            receivedQuantity: 3,
            lotAllocations: [{ transferItemLotId: transferLot.id, receivedQuantity: 3 }],
          },
        ],
        discrepancyNotes: 'Corrupt tracking-mode guard',
      });
      throw new Error('Expected frozen transfer-lot provenance rejection');
    } catch (error) {
      expectErrorCode(error, 'LOT_STOCK_INCONSISTENT');
    }
    await getDatabase()
      .update(products)
      .set({ tracksLots: true })
      .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
      .run();

    const received = await appRouter.createCaller(fresh()).transfers.receive({
      transferId: shipped.id,
      lines: [
        {
          itemId: shipped.items[0]!.id,
          receivedQuantity: 3,
          lotAllocations: [{ transferItemLotId: transferLot.id, receivedQuantity: 3 }],
        },
      ],
      discrepancyNotes: 'Two units damaged in transit',
    });
    expect(received).toMatchObject({ status: 'completed', hasDiscrepancy: true });
    const persistedLotLink = await getDatabase()
      .select()
      .from(transferOrderItemLots)
      .where(eq(transferOrderItemLots.id, transferLot.id))
      .get();
    expect(persistedLotLink).toMatchObject({ quantity: 5, receivedQuantity: 3 });
    const destinationLot = await getDatabase()
      .select()
      .from(inventoryLots)
      .where(eq(inventoryLots.id, persistedLotLink!.destinationLotId!))
      .get();
    expect(destinationLot).toMatchObject({ onHand: 3, status: 'quarantined', unitCost: 11 });
    expect(getProductStockTotal(getDatabase(), tenantId, productId)).toBe(3);

    const outbox = await getDatabase()
      .select()
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          eq(syncOutbox.entityType, 'transfer_orders'),
          eq(syncOutbox.entityId, shipped.id)
        )
      )
      .all();
    expect(outbox.map(row => row.operation)).toEqual(expect.arrayContaining(['create', 'update']));
    expect(outbox.find(row => row.operation === 'create')?.payload).toMatchObject({
      aggregateVersion: 1,
      id: shipped.id,
      status: 'in_transit',
      syncVersion: 0,
      items: [expect.objectContaining({ id: shipped.items[0]!.id, receivedQuantity: null })],
      lots: [
        expect.objectContaining({
          id: transferLot.id,
          destinationLotId: null,
          receivedQuantity: null,
        }),
      ],
      serialTransfers: [],
    });
    const receivedAggregate = outbox.find(row => row.operation === 'update')?.payload;
    expect(receivedAggregate).toMatchObject({
      aggregateVersion: 1,
      id: shipped.id,
      status: 'completed',
      syncVersion: 1,
      items: [
        expect.objectContaining({
          id: shipped.items[0]!.id,
          receivedQuantity: 3,
          destinationResultingBalanceVersion: expect.any(Number),
        }),
      ],
      lots: [
        expect.objectContaining({
          id: transferLot.id,
          destinationLotId: persistedLotLink!.destinationLotId,
          receivedQuantity: 3,
          destinationResultingOnHand: 3,
          destinationResultingStatus: 'quarantined',
        }),
      ],
      serialTransfers: [],
    });

    await appRouter.createCaller(fresh()).transfers.void({
      transferId: shipped.id,
      reason: 'Shipment rejected',
    });
    expect(
      await getDatabase()
        .select()
        .from(inventoryLots)
        .where(eq(inventoryLots.id, sourceLotId))
        .get()
    ).toMatchObject({ onHand: 3, status: 'quarantined', unitCost: 11 });
    expect(
      await getDatabase()
        .select()
        .from(inventoryLots)
        .where(eq(inventoryLots.id, persistedLotLink!.destinationLotId!))
        .get()
    ).toMatchObject({ onHand: 0, status: 'quarantined' });
    expect(getProductStockTotal(getDatabase(), tenantId, productId)).toBe(3);

    const outboxAfterVoid = await getDatabase()
      .select()
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          eq(syncOutbox.entityType, 'transfer_orders'),
          eq(syncOutbox.entityId, shipped.id)
        )
      )
      .all();
    expect(outboxAfterVoid.map(row => row.payload)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          aggregateVersion: 1,
          id: shipped.id,
          status: 'void',
          syncVersion: 2,
          items: [expect.objectContaining({ id: shipped.items[0]!.id, receivedQuantity: 3 })],
          lots: [
            expect.objectContaining({
              id: transferLot.id,
              destinationLotId: persistedLotLink!.destinationLotId,
              receivedQuantity: 3,
            }),
          ],
          serialTransfers: [],
        }),
      ])
    );
  });
});
