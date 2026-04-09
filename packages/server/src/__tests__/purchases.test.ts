import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type OpenYojobServer } from '../index.js';
import { getDatabase } from '../db/index.js';
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
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: OpenYojobServer;
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
        equivalence: 4,
        price: 40,
        isBase: false,
        createdAt: now,
        updatedAt: now,
      },
    ]);

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
    expect(updatedProduct?.stock).toBe(13);
    expect(updatedProduct?.cost).toBeCloseTo(6);
    expect(updatedProduct?.initialCost).toBeCloseTo(6);

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
      stock: 1,
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
      stock: 10,
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

    const product = await db.select().from(products).where(eq(products.id, productId)).get();
    expect(product?.stock).toBe(10);

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
      .from(syncQueue)
      .where(and(eq(syncQueue.entityType, 'purchases'), eq(syncQueue.entityId, created.id)))
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

    await db.update(products).set({ stock: 1 }).where(eq(products.id, productId)).run();

    await expect(
      caller.purchases.void({
        id: created.id,
      })
    ).rejects.toThrow(/only has 1 units in stock/);
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
      stock: 3,
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
