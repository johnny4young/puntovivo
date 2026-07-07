import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  inventoryBalances,
  inventoryMovements,
  orderItems,
  orders,
  products,
  providers,
  purchaseItems,
  purchaseReturnItems,
  purchaseReturns,
  purchases,
  sequentials,
  sites,
  syncOutbox,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { getProductStockTotal } from '../services/inventory-balances.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let userName: string;
let siteId: string;
let baseUnitId: string;
let boxUnitId: string;

function createTestContext(
  role: 'admin' | 'manager' | 'cashier' = 'admin'
): Context {
  const db = getDatabase();
  const mockReq = {
    server: server.app,
    headers: {
      'x-site-id': siteId,
    },
    user: {
      userId,
      email: `${role}@localhost`,
      role,
      tenantId,
    },
    jwtVerify: async () => {},
  } as unknown as Context['req'];

  const mockRes = {} as unknown as Context['res'];

  return {
    req: mockReq,
    res: mockRes,
    db,
    user: {
      id: userId,
      email: `${role}@localhost`,
      role,
      tenantId,
    },
    tenantId,
    siteId,
  };
}

function createTestContextForSite(
  overrideSiteId: string,
  role: 'admin' | 'manager' | 'cashier' = 'admin'
): Context {
  const db = getDatabase();
  const mockReq = {
    server: server.app,
    headers: {
      'x-site-id': overrideSiteId,
    },
    user: {
      userId,
      email: `${role}@localhost`,
      role,
      tenantId,
    },
    jwtVerify: async () => {},
  } as unknown as Context['req'];

  const mockRes = {} as unknown as Context['res'];

  return {
    req: mockReq,
    res: mockRes,
    db,
    user: {
      id: userId,
      email: `${role}@localhost`,
      role,
      tenantId,
    },
    tenantId,
    siteId: overrideSiteId,
  };
}

describe('Purchases tRPC Router', () => {
  beforeAll(async () => {
    server = await createServer({
      dbPath: ':memory:',
      verbose: false,
    });

    const db = getDatabase();
    const seededUser = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!seededUser) {
      throw new Error('Expected seeded admin user');
    }

    tenantId = seededUser.tenantId;
    userId = seededUser.id;
    userName = seededUser.name;

    const seededSite = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!seededSite) {
      throw new Error('Expected seeded site');
    }
    siteId = seededSite.id;

    const seededUnits = await db
      .select()
      .from(units)
      .where(eq(units.tenantId, tenantId))
      .all();
    const baseUnit = seededUnits.find(unit => unit.abbreviation === 'UND');
    const boxUnit = seededUnits.find(unit => unit.abbreviation === 'CJ');

    if (!baseUnit || !boxUnit) {
      throw new Error('Expected seeded units');
    }

    baseUnitId = baseUnit.id;
    boxUnitId = boxUnit.id;
  });

  afterAll(async () => {
    await server.close();
  });

  it('creates a purchase using the site sequential and increases stock with normalized quantity', async () => {
    const db = getDatabase();
    const providerId = nanoid();
    const productId = nanoid();
    const now = new Date().toISOString();

    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Inbound Supply Co',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Purchase Test Product',
      sku: 'PUR-001',
      price: 10,
      price2: 10,
      price3: 10,
      cost: 3,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 3,
      minStock: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(unitXProduct).values([
      {
        id: nanoid(),
        productId,
        unitId: baseUnitId,
        equivalence: 1,
        price: 10,
        isBase: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: nanoid(),
        productId,
        unitId: boxUnitId,
        equivalence: 4,
        price: 40,
        isBase: false,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(inventoryBalances).values({
      id: nanoid(),
      tenantId,
      siteId,
      productId,
      onHand: 5,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    });

    const caller = appRouter.createCaller(createTestContext());
    const result = await caller.purchases.create({
      providerId,
      items: [
        {
          productId,
          unitId: boxUnitId,
          quantity: 2,
          costPerUnit: 24,
        },
      ],
      notes: 'Weekly replenishment',
    });

    expect(result.purchaseNumber).toBe('COM-000001');
    expect(result.status).toBe('completed');
    expect(result.providerId).toBe(providerId);
    expect(result.siteId).toBe(siteId);
    expect(result.subtotal).toBeCloseTo(48);
    expect(result.total).toBeCloseTo(48);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      productId,
      unitId: boxUnitId,
      unitEquivalence: 4,
      costPerUnit: 24,
      baseUnitCost: 6,
      total: 48,
    });

    const updatedProduct = await db.select().from(products).where(eq(products.id, productId)).get();
    expect(getProductStockTotal(db, tenantId, productId)).toBe(13);
    expect(updatedProduct?.cost).toBeCloseTo(6);
    expect(updatedProduct?.initialCost).toBeCloseTo(6);

    const balances = await caller.inventory.listBalancesBySite({ siteId });
    expect(balances.items.find(item => item.productId === productId)?.onHand).toBe(13);

    const storedItems = await db
      .select()
      .from(purchaseItems)
      .where(eq(purchaseItems.purchaseId, result.id))
      .all();
    expect(storedItems).toHaveLength(1);
    expect(storedItems[0]?.baseUnitCost).toBeCloseTo(6);

    const movement = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.reference, result.id))
      .get();
    expect(movement).toMatchObject({
      productId,
      type: 'purchase',
      quantity: 8,
      previousStock: 5,
      newStock: 13,
    });

    const sequential = await db
      .select()
      .from(sequentials)
      .where(
        and(
          eq(sequentials.tenantId, tenantId),
          eq(sequentials.siteId, siteId),
          eq(sequentials.documentType, 'purchase')
        )
      )
      .get();
    expect(sequential?.currentValue).toBe(1);

    const listed = await caller.purchases.list({ page: 1, perPage: 10 });
    expect(listed.items.some(purchase => purchase.id === result.id)).toBe(true);

    const loaded = await caller.purchases.getById({ id: result.id });
    expect(loaded.items).toHaveLength(1);
    expect(loaded.providerName).toBe('Inbound Supply Co');
    expect(loaded.status).toBe('completed');
  });

  it('creates purchases with fractional quantities and preserves decimal stock movement', async () => {
    const db = getDatabase();
    const providerId = nanoid();
    const productId = nanoid();
    const now = new Date().toISOString();

    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Fractional Purchase Supply',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Rice by weight',
      sku: 'PUR-FRAC-001',
      price: 8,
      price2: 8,
      price3: 8,
      cost: 3,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 3,
      minStock: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId,
      unitId: baseUnitId,
      equivalence: 1,
      price: 8,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(inventoryBalances).values({
      id: nanoid(),
      tenantId,
      siteId,
      productId,
      onHand: 1.5,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    });

    const caller = appRouter.createCaller(createTestContext());
    const result = await caller.purchases.create({
      providerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 0.75,
          costPerUnit: 3,
        },
      ],
      notes: 'Fractional replenishment',
    });

    expect(result.total).toBeCloseTo(2.25);
    expect(result.items[0]?.quantity).toBe(0.75);

    expect(getProductStockTotal(db, tenantId, productId)).toBeCloseTo(2.25);

    const movement = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.reference, result.id))
      .get();
    expect(movement?.quantity).toBe(0.75);
    expect(movement?.newStock).toBeCloseTo(2.25);

    const balances = await caller.inventory.listBalancesBySite({ siteId });
    expect(balances.items.find(item => item.productId === productId)?.onHand).toBeCloseTo(2.25);
  });

  it('creates partial receipts from an order and marks the order as received when completed', async () => {
    const db = getDatabase();
    const providerId = nanoid();
    const productId = nanoid();
    const orderId = nanoid();
    const now = new Date().toISOString();

    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Ordered Supply Co',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Ordered Purchase Product',
      sku: 'PUR-ORD-001',
      price: 10,
      price2: 10,
      price3: 10,
      cost: 4,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 4,
      minStock: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(unitXProduct).values([
      {
        id: nanoid(),
        productId,
        unitId: baseUnitId,
        equivalence: 1,
        price: 10,
        isBase: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: nanoid(),
        productId,
        unitId: boxUnitId,
        equivalence: 5,
        price: 50,
        isBase: false,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(inventoryBalances).values({
      id: nanoid(),
      tenantId,
      siteId,
      productId,
      onHand: 3,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(orders).values({
      id: orderId,
      tenantId,
      orderNumber: 'PED-900001',
      providerId,
      siteId,
      status: 'submitted',
      subtotal: 70,
      total: 70,
      notes: 'Supplier confirmed availability',
      createdBy: userId,
      syncStatus: 'pending',
      syncVersion: 1,
      createdAt: now,
      updatedAt: now,
    });

    const orderItemId = nanoid();
    await db.insert(orderItems).values({
      id: orderItemId,
      orderId,
      productId,
      quantity: 2,
      unitId: boxUnitId,
      unitEquivalence: 5,
      costPerUnit: 35,
      baseUnitCost: 7,
      total: 70,
    });

    const caller = appRouter.createCaller(createTestContext('manager'));
    const firstReceipt = await caller.purchases.createFromOrder({
      orderId,
      items: [{ orderItemId, quantity: 1 }],
      notes: 'First truck',
    });

    expect(firstReceipt.status).toBe('completed');
    expect(firstReceipt.orderId).toBe(orderId);
    expect(firstReceipt.sourceOrderNumber).toBe('PED-900001');
    expect(firstReceipt.providerId).toBe(providerId);
    expect(firstReceipt.items).toHaveLength(1);
    expect(firstReceipt.items[0]).toMatchObject({
      productId,
      unitId: boxUnitId,
      sourceOrderItemId: orderItemId,
      unitEquivalence: 5,
      costPerUnit: 35,
      baseUnitCost: 7,
      total: 35,
    });

    expect(getProductStockTotal(db, tenantId, productId)).toBe(8);

    const balancesAfterFirstReceipt = await caller.inventory.listBalancesBySite({ siteId });
    expect(balancesAfterFirstReceipt.items.find(item => item.productId === productId)?.onHand).toBe(8);

    const updatedOrder = await db.select().from(orders).where(eq(orders.id, orderId)).get();
    expect(updatedOrder?.status).toBe('partial_received');

    const partiallyLoadedOrder = await caller.orders.getById({ id: orderId });
    expect(partiallyLoadedOrder.status).toBe('partial_received');
    expect(partiallyLoadedOrder.items?.[0]).toMatchObject({
      quantity: 2,
      receivedQuantity: 1,
      remainingQuantity: 1,
    });
    expect(partiallyLoadedOrder.linkedPurchases).toHaveLength(1);

    const secondReceipt = await caller.purchases.createFromOrder({
      orderId,
      items: [{ orderItemId, quantity: 1 }],
    });

    expect(secondReceipt.purchaseNumber).not.toBe(firstReceipt.purchaseNumber);

    expect(getProductStockTotal(db, tenantId, productId)).toBe(13);

    const balancesAfterSecondReceipt = await caller.inventory.listBalancesBySite({ siteId });
    expect(balancesAfterSecondReceipt.items.find(item => item.productId === productId)?.onHand).toBe(
      13
    );

    const finalOrder = await db.select().from(orders).where(eq(orders.id, orderId)).get();
    expect(finalOrder?.status).toBe('received');

    const linkedPurchases = await db
      .select()
      .from(purchases)
      .where(eq(purchases.orderId, orderId))
      .all();
    expect(linkedPurchases).toHaveLength(2);
  });

  it('credits the current site balance when a purchase falls back to another site sequential', async () => {
    const db = getDatabase();
    const providerId = nanoid();
    const productId = nanoid();
    const secondarySiteId = nanoid();
    const now = new Date().toISOString();
    const mainSite = await db
      .select()
      .from(sites)
      .where(eq(sites.id, siteId))
      .get();

    if (!mainSite) {
      throw new Error('Expected seeded main site');
    }

    await db.insert(sites).values({
      id: secondarySiteId,
      tenantId,
      companyId: mainSite.companyId,
      name: 'Secondary Purchasing Site',
      address: null,
      phone: null,
      isActive: true,
      createdAt: new Date(Date.now() + 60_000).toISOString(),
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
    });

    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Fallback Sequential Vendor',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Secondary Site Purchase Product',
      sku: 'PUR-SITE-001',
      price: 10,
      price2: 10,
      price3: 10,
      cost: 4,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 4,
      minStock: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId,
      unitId: baseUnitId,
      equivalence: 1,
      price: 10,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(inventoryBalances).values({
      id: nanoid(),
      tenantId,
      siteId,
      productId,
      onHand: 2,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    });

    const secondaryCaller = appRouter.createCaller(createTestContextForSite(secondarySiteId));
    const result = await secondaryCaller.purchases.create({
      providerId,
      items: [{ productId, unitId: baseUnitId, quantity: 3, costPerUnit: 6 }],
    });

    expect(result.siteId).toBe(secondarySiteId);

    const primaryBalances = await appRouter
      .createCaller(createTestContext())
      .inventory.listBalancesBySite({ siteId });
    expect(primaryBalances.items.find(item => item.productId === productId)?.onHand).toBe(2);

    const secondaryBalances = await appRouter
      .createCaller(createTestContext())
      .inventory.listBalancesBySite({ siteId: secondarySiteId });
    expect(secondaryBalances.items.find(item => item.productId === productId)?.onHand).toBe(3);
  });

  it('receives ordered stock into the order site even when the purchase sequential falls back elsewhere', async () => {
    const db = getDatabase();
    const providerId = nanoid();
    const productId = nanoid();
    const orderId = nanoid();
    const orderItemId = nanoid();
    const secondarySiteId = nanoid();
    const now = new Date().toISOString();
    const mainSite = await db
      .select()
      .from(sites)
      .where(eq(sites.id, siteId))
      .get();

    if (!mainSite) {
      throw new Error('Expected seeded main site');
    }

    await db.insert(sites).values({
      id: secondarySiteId,
      tenantId,
      companyId: mainSite.companyId,
      name: 'Order Receipt Site',
      address: null,
      phone: null,
      isActive: true,
      createdAt: new Date(Date.now() + 120_000).toISOString(),
      updatedAt: new Date(Date.now() + 120_000).toISOString(),
    });

    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Order Receipt Provider',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Receipt Site Product',
      sku: 'PUR-SITE-ORD-001',
      price: 10,
      price2: 10,
      price3: 10,
      cost: 4,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 4,
      minStock: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId,
      unitId: baseUnitId,
      equivalence: 1,
      price: 10,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(inventoryBalances).values({
      id: nanoid(),
      tenantId,
      siteId,
      productId,
      onHand: 1,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(orders).values({
      id: orderId,
      tenantId,
      orderNumber: 'PED-900777',
      providerId,
      siteId: secondarySiteId,
      status: 'submitted',
      subtotal: 12,
      total: 12,
      notes: 'Secondary site receipt',
      createdBy: userId,
      syncStatus: 'pending',
      syncVersion: 1,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(orderItems).values({
      id: orderItemId,
      orderId,
      productId,
      quantity: 2,
      unitId: baseUnitId,
      unitEquivalence: 1,
      costPerUnit: 6,
      baseUnitCost: 6,
      total: 12,
    });

    const secondaryCaller = appRouter.createCaller(createTestContextForSite(secondarySiteId, 'manager'));
    const receipt = await secondaryCaller.purchases.createFromOrder({
      orderId,
      items: [{ orderItemId, quantity: 2 }],
    });

    expect(receipt.siteId).toBe(secondarySiteId);

    const primaryBalances = await appRouter
      .createCaller(createTestContext())
      .inventory.listBalancesBySite({ siteId });
    expect(primaryBalances.items.find(item => item.productId === productId)?.onHand).toBe(1);

    const secondaryBalances = await appRouter
      .createCaller(createTestContext())
      .inventory.listBalancesBySite({ siteId: secondarySiteId });
    expect(secondaryBalances.items.find(item => item.productId === productId)?.onHand).toBe(2);
  });

  it('rejects purchases with an invalid product-unit assignment', async () => {
    const db = getDatabase();
    const providerId = nanoid();
    const productId = nanoid();
    const now = new Date().toISOString();

    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Broken Unit Vendor',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Invalid Assignment Product',
      sku: 'PUR-INVALID-01',
      price: 10,
      price2: 10,
      price3: 10,
      cost: 2,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 2,
      minStock: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId,
      unitId: baseUnitId,
      equivalence: 1,
      price: 10,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(inventoryBalances).values({
      id: nanoid(),
      tenantId,
      siteId,
      productId,
      onHand: 1,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    });

    const caller = appRouter.createCaller(createTestContext());

    await expect(
      caller.purchases.create({
        providerId,
        items: [
          {
            productId,
            unitId: boxUnitId,
            quantity: 1,
            costPerUnit: 20,
          },
        ],
      })
    ).rejects.toThrow(/Unit selection is invalid/);

    const count = await db.select().from(purchases).where(eq(purchases.providerId, providerId)).all();
    expect(count).toHaveLength(0);
  });

  it('returns selected purchase quantities, reduces stock, and marks the purchase as partially returned', async () => {
    const db = getDatabase();
    const providerId = nanoid();
    const productId = nanoid();
    const now = new Date().toISOString();

    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Returnable Provider',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Returnable Purchase Product',
      sku: 'PUR-RET-01',
      price: 10,
      price2: 10,
      price3: 10,
      cost: 4,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 4,
      minStock: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId,
      unitId: baseUnitId,
      equivalence: 1,
      price: 10,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(inventoryBalances).values({
      id: nanoid(),
      tenantId,
      siteId,
      productId,
      onHand: 8,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    });

    const caller = appRouter.createCaller(createTestContext('manager'));
    const created = await caller.purchases.create({
      providerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 5,
          costPerUnit: 9,
        },
      ],
    });

    const [lineItem] = await db
      .select()
      .from(purchaseItems)
      .where(eq(purchaseItems.purchaseId, created.id))
      .all();

    expect(lineItem).toBeDefined();

    const returned = await caller.purchases.returnPurchase({
      id: created.id,
      items: [
        {
          purchaseItemId: lineItem!.id,
          quantity: 2,
        },
      ],
      reason: 'Damaged boxes',
    });

    expect(returned.status).toBe('partial_returned');
    expect(returned.returnCount).toBe(1);
    expect(returned.returnedAmount).toBeCloseTo(18);
    expect(returned.notes).toContain('Returned: Damaged boxes');
    expect(returned.items[0]).toMatchObject({
      quantity: 5,
      returnedQuantity: 2,
      remainingQuantity: 3,
    });

    expect(getProductStockTotal(db, tenantId, productId)).toBe(11);

    const balances = await caller.inventory.listBalancesBySite({ siteId });
    expect(balances.items.find(item => item.productId === productId)?.onHand).toBe(11);

    const returnHeader = await db
      .select()
      .from(purchaseReturns)
      .where(eq(purchaseReturns.purchaseId, created.id))
      .get();
    expect(returnHeader?.returnAmount).toBeCloseTo(18);

    const returnLine = await db
      .select()
      .from(purchaseReturnItems)
      .where(eq(purchaseReturnItems.purchaseReturnId, returnHeader!.id))
      .get();
    expect(returnLine).toMatchObject({
      productId,
      quantity: 2,
      costPerUnit: 9,
      total: 18,
    });

    const reversalMovement = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.reference, returnHeader!.id))
      .get();
    expect(reversalMovement).toMatchObject({
      productId,
      type: 'return',
      quantity: -2,
      previousStock: 13,
      newStock: 11,
    });

    const listed = await caller.purchases.list({ page: 1, perPage: 10 });
    const listedPurchase = listed.items.find(purchase => purchase.id === created.id);
    expect(listedPurchase).toMatchObject({
      id: created.id,
      status: 'partial_returned',
      returnCount: 1,
      returnedAmount: 18,
      latestReturnReason: 'Damaged boxes',
      latestReturnCreatedByName: userName,
    });
    expect(listedPurchase?.returnedAt).toBeTruthy();
  });

  it('fully returns a purchase after multiple return operations and blocks over-returning quantities', async () => {
    const db = getDatabase();
    const providerId = nanoid();
    const productId = nanoid();
    const now = new Date().toISOString();

    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Full Return Provider',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Fully Returned Product',
      sku: 'PUR-RET-02',
      price: 10,
      price2: 10,
      price3: 10,
      cost: 3,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 3,
      minStock: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId,
      unitId: baseUnitId,
      equivalence: 1,
      price: 10,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(inventoryBalances).values({
      id: nanoid(),
      tenantId,
      siteId,
      productId,
      onHand: 4,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    });

    const caller = appRouter.createCaller(createTestContext('manager'));
    const created = await caller.purchases.create({
      providerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 3,
          costPerUnit: 5,
        },
      ],
    });

    const [lineItem] = await db
      .select()
      .from(purchaseItems)
      .where(eq(purchaseItems.purchaseId, created.id))
      .all();

    await expect(
      caller.purchases.returnPurchase({
        id: created.id,
        items: [
          {
            purchaseItemId: lineItem!.id,
            quantity: 4,
          },
        ],
      })
    ).rejects.toThrow(/only 3 remain available to return/);

    await caller.purchases.returnPurchase({
      id: created.id,
      items: [
        {
          purchaseItemId: lineItem!.id,
          quantity: 1,
        },
      ],
    });

    const fullyReturned = await caller.purchases.returnPurchase({
      id: created.id,
      items: [
        {
          purchaseItemId: lineItem!.id,
          quantity: 2,
        },
      ],
      reason: 'Supplier recalled inventory',
    });

    expect(fullyReturned.status).toBe('returned');
    expect(fullyReturned.returnCount).toBe(2);
    expect(fullyReturned.items[0]).toMatchObject({
      returnedQuantity: 3,
      remainingQuantity: 0,
    });

    await expect(
      caller.purchases.returnPurchase({
        id: created.id,
        items: [
          {
            purchaseItemId: lineItem!.id,
            quantity: 1,
          },
        ],
      })
    ).rejects.toThrow(/already been fully returned|fully returned/);
  });

  it('rejects returning a purchase when the purchase site no longer has enough stock', async () => {
    const db = getDatabase();
    const providerId = nanoid();
    const productId = nanoid();
    const now = new Date().toISOString();

    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Site Locked Return Provider',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Site Locked Return Product',
      sku: 'PUR-SITE-RET-01',
      price: 10,
      price2: 10,
      price3: 10,
      cost: 3,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 3,
      minStock: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId,
      unitId: baseUnitId,
      equivalence: 1,
      price: 10,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });

    const reserveSiteId = nanoid();
    const mainSite = await db.select().from(sites).where(eq(sites.id, siteId)).get();
    if (!mainSite) {
      throw new Error('Expected seeded main site');
    }
    await db.insert(sites).values({
      id: reserveSiteId,
      tenantId,
      companyId: mainSite.companyId,
      name: 'Return Reserve Site',
      address: null,
      phone: null,
      isActive: true,
      createdAt: new Date(Date.now() + 180_000).toISOString(),
      updatedAt: new Date(Date.now() + 180_000).toISOString(),
    });

    // Initial stock lives at another site so the purchase site can be drained
    // to 0 while the tenant-wide total stays positive.
    await db.insert(inventoryBalances).values([
      {
        id: nanoid(),
        tenantId,
        siteId,
        productId,
        onHand: 0,
        reserved: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: nanoid(),
        tenantId,
        siteId: reserveSiteId,
        productId,
        onHand: 1,
        reserved: 0,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const caller = appRouter.createCaller(createTestContext('manager'));
    const created = await caller.purchases.create({
      providerId,
      items: [{ productId, unitId: baseUnitId, quantity: 2, costPerUnit: 5 }],
    });

    const [lineItem] = await db
      .select()
      .from(purchaseItems)
      .where(eq(purchaseItems.purchaseId, created.id))
      .all();

    await db
      .update(inventoryBalances)
      .set({ onHand: 0 })
      .where(
        and(
          eq(inventoryBalances.tenantId, tenantId),
          eq(inventoryBalances.siteId, siteId),
          eq(inventoryBalances.productId, productId)
        )
      )
      .run();

    await expect(
      caller.purchases.returnPurchase({
        id: created.id,
        items: [{ purchaseItemId: lineItem!.id, quantity: 1 }],
      })
    ).rejects.toMatchObject<Partial<TRPCError>>({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/purchase site only has 0 units available/i),
    });
  });

  it('allows managers and rejects cashiers on purchase routes', async () => {
    const managerCaller = appRouter.createCaller(createTestContext('manager'));
    const cashierCaller = appRouter.createCaller(createTestContext('cashier'));

    const listed = await managerCaller.purchases.list({ page: 1, perPage: 10 });
    expect(Array.isArray(listed.items)).toBe(true);

    await expect(
      cashierCaller.purchases.list({ page: 1, perPage: 10 })
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('voids a completed purchase, reverses stock, and records a sync update', async () => {
    const db = getDatabase();
    const providerId = nanoid();
    const productId = nanoid();
    const now = new Date().toISOString();

    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Voidable Provider',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Voidable Purchase Product',
      sku: 'PUR-VOID-01',
      price: 10,
      price2: 10,
      price3: 10,
      cost: 4,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 4,
      minStock: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId,
      unitId: baseUnitId,
      equivalence: 1,
      price: 10,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(inventoryBalances).values({
      id: nanoid(),
      tenantId,
      siteId,
      productId,
      onHand: 10,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    });

    const caller = appRouter.createCaller(createTestContext());
    const created = await caller.purchases.create({
      providerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 3,
          costPerUnit: 12,
        },
      ],
    });

    const voided = await caller.purchases.void({
      id: created.id,
      reason: 'Duplicate receiving entry',
    });

    expect(voided.status).toBe('voided');
    expect(voided.notes).toContain('Voided: Duplicate receiving entry');

    expect(getProductStockTotal(db, tenantId, productId)).toBe(10);

    const balances = await caller.inventory.listBalancesBySite({ siteId });
    expect(balances.items.find(item => item.productId === productId)?.onHand).toBe(10);

    const reversalMovement = await db
      .select()
      .from(inventoryMovements)
      .where(and(eq(inventoryMovements.reference, created.id), eq(inventoryMovements.type, 'return')))
      .get();
    expect(reversalMovement).toMatchObject({
      productId,
      quantity: -3,
      previousStock: 13,
      newStock: 10,
    });

    const queuedUpdate = await db
      .select()
      .from(syncOutbox)
      .where(and(eq(syncOutbox.entityType, 'purchases'), eq(syncOutbox.entityId, created.id)))
      .all();
    expect(queuedUpdate.some(item => item.operation === 'update')).toBe(true);
  });

  it('rejects voiding a purchase when the received stock is no longer available', async () => {
    const db = getDatabase();
    const providerId = nanoid();
    const productId = nanoid();
    const now = new Date().toISOString();

    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Insufficient Stock Provider',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Low Stock Purchase Product',
      sku: 'PUR-VOID-02',
      price: 10,
      price2: 10,
      price3: 10,
      cost: 5,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 5,
      minStock: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId,
      unitId: baseUnitId,
      equivalence: 1,
      price: 10,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });

    const caller = appRouter.createCaller(createTestContext());
    const created = await caller.purchases.create({
      providerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 2,
          costPerUnit: 7,
        },
      ],
    });

    await db
      .update(inventoryBalances)
      .set({ onHand: 1 })
      .where(
        and(
          eq(inventoryBalances.tenantId, tenantId),
          eq(inventoryBalances.siteId, siteId),
          eq(inventoryBalances.productId, productId)
        )
      )
      .run();

    await expect(
      caller.purchases.void({
        id: created.id,
      })
    ).rejects.toThrow(/only has 1 units in stock/);
  });

  it('rejects voiding a purchase when the purchase site no longer has enough stock', async () => {
    const db = getDatabase();
    const providerId = nanoid();
    const productId = nanoid();
    const now = new Date().toISOString();

    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Site Locked Void Provider',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Site Locked Void Product',
      sku: 'PUR-SITE-VOID-01',
      price: 10,
      price2: 10,
      price3: 10,
      cost: 3,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 3,
      minStock: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId,
      unitId: baseUnitId,
      equivalence: 1,
      price: 10,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });

    const reserveSiteId = nanoid();
    const mainSite = await db.select().from(sites).where(eq(sites.id, siteId)).get();
    if (!mainSite) {
      throw new Error('Expected seeded main site');
    }
    await db.insert(sites).values({
      id: reserveSiteId,
      tenantId,
      companyId: mainSite.companyId,
      name: 'Void Reserve Site',
      address: null,
      phone: null,
      isActive: true,
      createdAt: new Date(Date.now() + 240_000).toISOString(),
      updatedAt: new Date(Date.now() + 240_000).toISOString(),
    });

    // Initial stock lives at another site so the purchase site can be drained
    // to 0 while the tenant-wide total stays large enough to clear the
    // tenant-level guard, leaving only the per-site guard to fire.
    await db.insert(inventoryBalances).values([
      {
        id: nanoid(),
        tenantId,
        siteId,
        productId,
        onHand: 0,
        reserved: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: nanoid(),
        tenantId,
        siteId: reserveSiteId,
        productId,
        onHand: 2,
        reserved: 0,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const caller = appRouter.createCaller(createTestContext());
    const created = await caller.purchases.create({
      providerId,
      items: [{ productId, unitId: baseUnitId, quantity: 2, costPerUnit: 5 }],
    });

    await db
      .update(inventoryBalances)
      .set({ onHand: 0 })
      .where(
        and(
          eq(inventoryBalances.tenantId, tenantId),
          eq(inventoryBalances.siteId, siteId),
          eq(inventoryBalances.productId, productId)
        )
      )
      .run();

    await expect(
      caller.purchases.void({
        id: created.id,
      })
    ).rejects.toMatchObject<Partial<TRPCError>>({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/purchase site only has 0 units in stock/i),
    });
  });

  it('allows only admins to void a purchase', async () => {
    const db = getDatabase();
    const providerId = nanoid();
    const productId = nanoid();
    const now = new Date().toISOString();

    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Role Provider',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Role Purchase Product',
      sku: 'PUR-VOID-03',
      price: 10,
      price2: 10,
      price3: 10,
      cost: 5,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 5,
      minStock: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId,
      unitId: baseUnitId,
      equivalence: 1,
      price: 10,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(inventoryBalances).values({
      id: nanoid(),
      tenantId,
      siteId,
      productId,
      onHand: 3,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    });

    const adminCaller = appRouter.createCaller(createTestContext('admin'));
    const managerCaller = appRouter.createCaller(createTestContext('manager'));
    const created = await adminCaller.purchases.create({
      providerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 1,
          costPerUnit: 6,
        },
      ],
    });

    await expect(
      managerCaller.purchases.void({
        id: created.id,
      })
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
