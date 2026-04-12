import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  orderItems,
  orders,
  products,
  providers,
  sequentials,
  sites,
  syncQueue,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
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

describe('Orders tRPC Router', () => {
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

  it('creates a purchase order using the order sequential without affecting stock', async () => {
    const db = getDatabase();
    const providerId = nanoid();
    const productId = nanoid();
    const now = new Date().toISOString();

    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Order Supply Co',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Order Test Product',
      sku: 'ORD-001',
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
      stock: 5,
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
        equivalence: 6,
        price: 60,
        isBase: false,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const caller = appRouter.createCaller(createTestContext('manager'));
    const result = await caller.orders.create({
      providerId,
      items: [
        {
          productId,
          unitId: boxUnitId,
          quantity: 2,
          costPerUnit: 30,
        },
      ],
      notes: 'Restock next week',
    });

    expect(result.orderNumber).toBe('PED-000001');
    expect(result.status).toBe('submitted');
    expect(result.providerId).toBe(providerId);
    expect(result.siteId).toBe(siteId);
    expect(result.total).toBeCloseTo(60);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      productId,
      unitId: boxUnitId,
      unitEquivalence: 6,
      costPerUnit: 30,
      baseUnitCost: 5,
      total: 60,
    });

    const untouchedProduct = await db.select().from(products).where(eq(products.id, productId)).get();
    expect(untouchedProduct?.stock).toBe(5);

    const storedItems = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, result.id))
      .all();
    expect(storedItems).toHaveLength(1);

    const orderSequential = await db
      .select()
      .from(sequentials)
      .where(
        and(
          eq(sequentials.tenantId, tenantId),
          eq(sequentials.siteId, siteId),
          eq(sequentials.documentType, 'order')
        )
      )
      .get();
    expect(orderSequential?.currentValue).toBe(1);

    const queuedEntities = await db
      .select({
        entityType: syncQueue.entityType,
      })
      .from(syncQueue)
      .where(and(eq(syncQueue.tenantId, tenantId), eq(syncQueue.entityId, result.id)))
      .all();
    expect(queuedEntities.some(item => item.entityType === 'orders')).toBe(true);
  });

  it('voids a submitted order without affecting product stock', async () => {
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
      name: 'Voidable Order Product',
      sku: 'ORD-VOID',
      price: 12,
      price2: 12,
      price3: 12,
      cost: 4,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 4,
      stock: 9,
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
      price: 12,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });

    const caller = appRouter.createCaller(createTestContext());
    const created = await caller.orders.create({
      providerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 3,
          costPerUnit: 4,
        },
      ],
      notes: 'Initial order note',
    });

    const stockBeforeVoid = await db.select().from(products).where(eq(products.id, productId)).get();

    const voided = await caller.orders.void({
      id: created.id,
      reason: 'Provider cancelled delivery',
    });

    expect(voided.status).toBe('voided');
    expect(voided.notes).toContain('Provider cancelled delivery');

    const stockAfterVoid = await db.select().from(products).where(eq(products.id, productId)).get();
    expect(stockAfterVoid?.stock).toBe(stockBeforeVoid?.stock);

    const storedOrder = await db.select().from(orders).where(eq(orders.id, created.id)).get();
    expect(storedOrder?.status).toBe('voided');

    const syncUpdate = await db
      .select()
      .from(syncQueue)
      .where(and(eq(syncQueue.entityType, 'orders'), eq(syncQueue.entityId, created.id)))
      .all();
    expect(syncUpdate.some(item => item.operation === 'update')).toBe(true);
  });

  it('surfaces receipt progress metadata in order listings after a partial receipt', async () => {
    const db = getDatabase();
    const providerId = nanoid();
    const productId = nanoid();
    const now = new Date().toISOString();

    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Partial Receipt Provider',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Partial Receipt Product',
      sku: 'ORD-PARTIAL',
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
      stock: 0,
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

    const caller = appRouter.createCaller(createTestContext('manager'));
    const order = await caller.orders.create({
      providerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 5,
          costPerUnit: 4,
        },
      ],
      notes: 'Expect staged delivery',
    });

    const receipt = await caller.purchases.createFromOrder({
      orderId: order.id,
      items: [
        {
          orderItemId: order.items[0]!.id,
          quantity: 2,
        },
      ],
      notes: 'First truck arrived',
    });

    const listed = await caller.orders.list({ page: 1, perPage: 20 });
    const listedOrder = listed.items.find(item => item.id === order.id);

    expect(listedOrder).toMatchObject({
      id: order.id,
      status: 'partial_received',
      linkedPurchaseCount: 1,
      receivedPurchaseNumber: receipt.purchaseNumber,
    });
  });

  it('rejects voiding orders after partial receipt has started', async () => {
    const db = getDatabase();
    const providerId = nanoid();
    const orderId = nanoid();
    const now = new Date().toISOString();

    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Partially Received Provider',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(orders).values({
      id: orderId,
      tenantId,
      orderNumber: 'PED-VOID-BLOCK',
      providerId,
      siteId,
      status: 'partial_received',
      subtotal: 10,
      total: 10,
      createdBy: userId,
      syncStatus: 'pending',
      syncVersion: 1,
      createdAt: now,
      updatedAt: now,
    });

    const caller = appRouter.createCaller(createTestContext());

    await expect(
      caller.orders.void({
        id: orderId,
      })
    ).rejects.toThrow(/received stock/);
  });
});
