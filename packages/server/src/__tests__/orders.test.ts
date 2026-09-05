import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  idempotencyKeys,
  inventoryBalances,
  orderItems,
  orders,
  products,
  providers,
  sequentials,
  sites,
  syncOutbox,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { getProductStockTotal } from '../services/inventory-balances.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { freshCriticalContext, makeEnvelopeHeadersProxy } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let baseUnitId: string;
let boxUnitId: string;
let testDeviceId: string;

function createTestContext(role: 'admin' | 'manager' | 'cashier' = 'admin'): Context {
  const db = getDatabase();
  const mockReq = {
    server: server.app,
    headers: makeEnvelopeHeadersProxy({
      getDeviceId: () => testDeviceId,
      getSiteId: () => siteId,
    }),
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
    const seededUser = await db
      .select()
      .from(users)
      .where(eq(users.email, 'admin@localhost'))
      .get();
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

    const registration = await registerDeviceService(db, {
      tenantId,
      userId,
      kind: 'web',
      name: 'orders.test',
    });
    testDeviceId = registration.deviceId;

    const seededUnits = await db.select().from(units).where(eq(units.tenantId, tenantId)).all();
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

    // Stock now lives in inventory_balances (products.stock removed). Seed the
    // opening on_hand at the active site so the derived total reads back 5.
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

    const envelope = {
      operationId: randomUUID(),
      idempotencyKey: randomUUID(),
      clientCreatedAt: new Date().toISOString(),
    };
    const createInput = {
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
    };
    const replayContext = () =>
      freshCriticalContext({
        db,
        serverApp: server.app,
        tenantId,
        userId,
        email: 'manager@localhost',
        role: 'manager',
        siteId,
        deviceId: testDeviceId,
        envelope,
      });
    const caller = appRouter.createCaller(replayContext());
    const result = await caller.orders.create(createInput);
    const replayed = await appRouter.createCaller(replayContext()).orders.create(createInput);

    expect(replayed).toEqual(result);

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

    const untouchedStock = getProductStockTotal(db, tenantId, productId);
    expect(untouchedStock).toBe(5);

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
        entityType: syncOutbox.entityType,
      })
      .from(syncOutbox)
      .where(and(eq(syncOutbox.tenantId, tenantId), eq(syncOutbox.entityId, result.id)))
      .all();
    expect(queuedEntities.some(item => item.entityType === 'orders')).toBe(true);
    expect(queuedEntities.filter(item => item.entityType === 'orders')).toHaveLength(1);
    const queuedOrderEffects = await db
      .select({ entityType: syncOutbox.entityType })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          inArray(syncOutbox.entityId, [result.id, ...storedItems.map(item => item.id)])
        )
      )
      .all();
    expect(queuedOrderEffects).toHaveLength(2);
    expect(queuedOrderEffects).toEqual(
      expect.arrayContaining([{ entityType: 'orders' }, { entityType: 'order_items' }])
    );

    expect(
      await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.action, 'order.create'),
            eq(auditLogs.resourceId, result.id)
          )
        )
        .all()
    ).toHaveLength(1);
    expect(
      await db
        .select({ status: idempotencyKeys.status, resultRef: idempotencyKeys.resultRef })
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.idempotencyKey, envelope.idempotencyKey))
        .get()
    ).toEqual({ status: 'succeeded', resultRef: result });
  });

  it('creates purchase orders at the 0.001 operational precision without rounding lines', async () => {
    const db = getDatabase();
    const providerId = nanoid();
    const productId = nanoid();
    const now = new Date().toISOString();

    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Fractional Order Supply',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Copper Cable',
      sku: 'ORD-FRAC-001',
      price: 12,
      price2: 12,
      price3: 12,
      cost: 4000,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 4000,
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

    const caller = appRouter.createCaller(createTestContext('manager'));
    const result = await caller.orders.create({
      providerId,
      items: [
        {
          productId,
          unitId: baseUnitId,
          quantity: 0.001,
          costPerUnit: 4000,
        },
      ],
    });

    expect(result.total).toBe(4);
    expect(result.items[0]?.quantity).toBe(0.001);

    const storedItem = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, result.id))
      .get();
    expect(storedItem?.quantity).toBe(0.001);
    expect(storedItem?.total).toBe(4);
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

    await db.insert(inventoryBalances).values({
      id: nanoid(),
      tenantId,
      siteId,
      productId,
      onHand: 9,
      reserved: 0,
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

    const stockBeforeVoid = getProductStockTotal(db, tenantId, productId);

    const voided = await caller.orders.void({
      id: created.id,
      reason: 'Provider cancelled delivery',
    });

    expect(voided.status).toBe('voided');
    expect(voided.notes).toContain('Provider cancelled delivery');

    const stockAfterVoid = getProductStockTotal(db, tenantId, productId);
    expect(stockAfterVoid).toBe(stockBeforeVoid);

    const storedOrder = await db.select().from(orders).where(eq(orders.id, created.id)).get();
    expect(storedOrder?.status).toBe('voided');

    const syncUpdate = await db
      .select()
      .from(syncOutbox)
      .where(and(eq(syncOutbox.entityType, 'orders'), eq(syncOutbox.entityId, created.id)))
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

  it('keeps replenishment drafts non-operational until an explicit idempotent submit', async () => {
    const db = getDatabase();
    const providerId = nanoid();
    const productId = nanoid();
    const now = new Date().toISOString();

    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Draft Replenishment Provider',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Draft Replenishment Product',
      sku: 'ORD-DRAFT',
      price: 12,
      price2: 12,
      price3: 12,
      cost: 4,
      initialCost: 4,
      minStock: 10,
      taxRate: 0,
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

    const managerCaller = appRouter.createCaller(createTestContext('manager'));
    const disposableDraft = await managerCaller.orders.create({
      providerId,
      status: 'draft',
      items: [{ productId, unitId: baseUnitId, quantity: 1, costPerUnit: 4 }],
      notes: 'Discard if the plan changes',
    });
    const discarded = await appRouter
      .createCaller(createTestContext('manager'))
      .orders.void({ id: disposableDraft.id, reason: 'Recount changed the plan' });
    expect(discarded.status).toBe('voided');
    expect(getProductStockTotal(db, tenantId, productId)).toBe(2);
    expect(
      await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.action, 'order.void'),
            eq(auditLogs.resourceId, disposableDraft.id)
          )
        )
        .all()
    ).toHaveLength(1);

    const managerSubmitted = await appRouter
      .createCaller(createTestContext('manager'))
      .orders.create({
        providerId,
        items: [{ productId, unitId: baseUnitId, quantity: 1, costPerUnit: 4 }],
      });
    await expect(
      appRouter.createCaller(createTestContext('manager')).orders.void({ id: managerSubmitted.id })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const draft = await appRouter.createCaller(createTestContext('manager')).orders.create({
      providerId,
      status: 'draft',
      items: [{ productId, unitId: baseUnitId, quantity: 8, costPerUnit: 4 }],
      notes: 'Generated from minimum stock',
    });
    expect(draft).toMatchObject({ status: 'draft', siteId, total: 32 });
    expect(getProductStockTotal(db, tenantId, productId)).toBe(2);
    expect(
      (
        await appRouter
          .createCaller(createTestContext('manager'))
          .orders.list({ page: 1, perPage: 20, status: 'draft' })
      ).items.some(item => item.id === draft.id)
    ).toBe(true);

    await expect(
      appRouter.createCaller(createTestContext('manager')).purchases.createFromOrder({
        orderId: draft.id,
        items: [{ orderItemId: draft.items[0]!.id, quantity: 1 }],
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'ORDER_DRAFT_INVALID_STATUS' } });
    expect(getProductStockTotal(db, tenantId, productId)).toBe(2);

    const submitEnvelope = {
      operationId: randomUUID(),
      idempotencyKey: randomUUID(),
      clientCreatedAt: new Date().toISOString(),
    };
    const submitContext = () =>
      freshCriticalContext({
        db,
        serverApp: server.app,
        tenantId,
        userId,
        email: 'manager@localhost',
        role: 'manager',
        siteId,
        deviceId: testDeviceId,
        envelope: submitEnvelope,
      });
    const submitted = await appRouter
      .createCaller(submitContext())
      .orders.submitDraft({ id: draft.id });
    const replayed = await appRouter
      .createCaller(submitContext())
      .orders.submitDraft({ id: draft.id });
    expect(replayed).toEqual(submitted);
    expect(submitted.status).toBe('submitted');
    expect(getProductStockTotal(db, tenantId, productId)).toBe(2);

    await expect(
      appRouter.createCaller(createTestContext('manager')).orders.submitDraft({ id: draft.id })
    ).rejects.toMatchObject({ cause: { errorCode: 'ORDER_DRAFT_INVALID_STATUS' } });
    expect(
      await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.action, 'order.submit'),
            eq(auditLogs.resourceId, draft.id)
          )
        )
        .all()
    ).toHaveLength(1);
    expect(
      await db
        .select({ status: idempotencyKeys.status })
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.idempotencyKey, submitEnvelope.idempotencyKey))
        .get()
    ).toEqual({ status: 'succeeded' });

    const receipt = await appRouter
      .createCaller(createTestContext('manager'))
      .purchases.createFromOrder({
        orderId: draft.id,
        items: [{ orderItemId: draft.items[0]!.id, quantity: 1 }],
      });
    expect(receipt.status).toBe('completed');
    expect(getProductStockTotal(db, tenantId, productId)).toBe(3);
  });
});
