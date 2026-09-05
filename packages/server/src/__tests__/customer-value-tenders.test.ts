/** Loyalty and store-credit tender round trips through sale, return, draft and void. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  customers,
  inventoryBalances,
  loyaltyAccounts,
  loyaltyMovements,
  products,
  saleItems,
  salePayments,
  sales,
  sites,
  storeCreditAccounts,
  storeCreditMovements,
  syncOutbox,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { writeLoyaltySettings } from '../services/loyalty.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { appRouter } from '../trpc/router.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let unitId: string;
let productId: string;
let fresh: ReturnType<typeof makeFreshContextFactory>;

async function createCustomer(name = 'Customer value shopper') {
  const id = nanoid();
  const now = new Date().toISOString();
  await getDatabase().insert(customers).values({
    id,
    tenantId,
    name,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function sale(args: {
  customerId?: string;
  quantity?: number;
  payments?: Array<{
    method: 'cash' | 'loyalty' | 'store_credit';
    amount: number;
    loyaltyPoints?: number;
  }>;
  status?: 'completed' | 'draft';
}) {
  const quantity = args.quantity ?? 1;
  const total = quantity * 50;
  return appRouter.createCaller(fresh()).sales.create({
    ...(args.customerId ? { customerId: args.customerId } : {}),
    items: [{ productId, unitId, quantity, unitPrice: 50, discount: 0 }],
    paymentMethod: 'cash',
    paymentStatus: args.status === 'draft' ? 'pending' : 'paid',
    status: args.status ?? 'completed',
    amountReceived:
      args.status === 'draft'
        ? 0
        : (args.payments?.find(payment => payment.method === 'cash')?.amount ?? total),
    discountAmount: 0,
    ...(args.payments ? { payments: args.payments } : {}),
  });
}

async function issueStoreCredit(customerId: string, amount: number) {
  await writeLoyaltySettings(getDatabase(), tenantId, {
    enabled: false,
    redemptionEnabled: false,
  });
  const source = await appRouter.createCaller(fresh()).sales.create({
    customerId,
    items: [{ productId, unitId, quantity: 1, unitPrice: amount, discount: 0 }],
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    amountReceived: amount,
    discountAmount: 0,
  });
  await appRouter.createCaller(fresh()).sales.returnSale({
    id: source.id,
    destination: 'store_credit',
    reason: 'Seed customer-owned store credit',
  });
  const account = await getDatabase()
    .select()
    .from(storeCreditAccounts)
    .where(
      and(
        eq(storeCreditAccounts.tenantId, tenantId),
        eq(storeCreditAccounts.customerId, customerId)
      )
    )
    .get();
  if (!account) throw new Error('Expected store-credit account');
  return account;
}

async function grantPoints(customerId: string, points: number) {
  await appRouter.createCaller(fresh()).loyalty.adjust({
    customerId,
    points,
    note: 'Test opening loyalty balance',
  });
}

async function loyaltyBalance(customerId: string) {
  return appRouter.createCaller(fresh()).loyalty.forCustomer({ customerId, limit: 50 });
}

async function storeBalance(customerId: string) {
  return (await loyaltyBalance(customerId)).storeCredit.balance;
}

async function expectLoyaltyParity(customerId: string) {
  const db = getDatabase();
  const account = await db
    .select({ id: loyaltyAccounts.id, points: loyaltyAccounts.points })
    .from(loyaltyAccounts)
    .where(and(eq(loyaltyAccounts.tenantId, tenantId), eq(loyaltyAccounts.customerId, customerId)))
    .get();
  if (!account) return;
  const ledger = await db
    .select({ total: sql<number>`coalesce(sum(${loyaltyMovements.points}), 0)` })
    .from(loyaltyMovements)
    .where(and(eq(loyaltyMovements.tenantId, tenantId), eq(loyaltyMovements.accountId, account.id)))
    .get();
  expect(account.points).toBe(ledger?.total ?? 0);
}

async function expectStoreCreditParity(customerId: string) {
  const db = getDatabase();
  const account = await db
    .select({ id: storeCreditAccounts.id, balance: storeCreditAccounts.balance })
    .from(storeCreditAccounts)
    .where(
      and(
        eq(storeCreditAccounts.tenantId, tenantId),
        eq(storeCreditAccounts.customerId, customerId)
      )
    )
    .get();
  if (!account) return;
  const ledger = await db
    .select({ total: sql<number>`coalesce(sum(${storeCreditMovements.amount}), 0)` })
    .from(storeCreditMovements)
    .where(
      and(
        eq(storeCreditMovements.tenantId, tenantId),
        eq(storeCreditMovements.accountId, account.id)
      )
    )
    .get();
  expect(account.balance).toBe(ledger?.total ?? 0);
}

describe('customer-value tenders', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!admin) throw new Error('Expected seeded admin user');
    tenantId = admin.tenantId;
    userId = admin.id;
    const site = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!site) throw new Error('Expected seeded site');
    siteId = site.id;
    const unit = (await db.select().from(units).where(eq(units.tenantId, tenantId)).all()).find(
      candidate => candidate.abbreviation === 'UND'
    );
    if (!unit) throw new Error('Expected seeded unit');
    unitId = unit.id;
    const now = new Date().toISOString();
    productId = nanoid();
    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Customer value product',
      sku: `CV-${nanoid(7)}`,
      price: 50,
      cost: 20,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId,
      unitId,
      equivalence: 1,
      price: 50,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(inventoryBalances).values({
      id: nanoid(),
      tenantId,
      siteId,
      productId,
      onHand: 10_000,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    });
    const registration = await registerDeviceService(db, {
      tenantId,
      userId,
      kind: 'web',
      name: 'customer-value-tenders.test',
    });
    fresh = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      userId,
      email: admin.email,
      siteId,
      deviceId: registration.deviceId,
      defaultRole: 'admin',
    });
    await appRouter.createCaller(fresh()).cashSessions.open({
      registerName: 'customer value register',
      openingFloat: 1_000,
      denominations: [{ value: 100, count: 10 }],
    });
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    await writeLoyaltySettings(getDatabase(), tenantId, {
      enabled: false,
      pointsPerUnit: 0.001,
      redemptionEnabled: false,
      valuePerPoint: 1_000,
    });
  });

  it('merges independent settings changes and keeps redemption admin-owned', async () => {
    const admin = appRouter.createCaller(fresh());
    await Promise.all([
      admin.loyalty.updateSettings({ enabled: true, pointsPerUnit: 0.5 }),
      appRouter
        .createCaller(fresh())
        .loyalty.updateSettings({ redemptionEnabled: true, valuePerPoint: 10 }),
    ]);
    await expect(admin.loyalty.settings()).resolves.toMatchObject({
      enabled: true,
      pointsPerUnit: 0.5,
      redemptionEnabled: true,
      valuePerPoint: 10,
    });
    await expect(
      appRouter
        .createCaller(fresh({ role: 'manager' }))
        .loyalty.updateSettings({ redemptionEnabled: false })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('fails closed on disabled, anonymous, mismatched and insufficient tenders without writes', async () => {
    const db = getDatabase();
    const customerId = await createCustomer('Guarded value customer');
    const beforeSales =
      db
        .select({ count: sql<number>`count(*)` })
        .from(sales)
        .get()?.count ?? 0;
    const stockBefore = db
      .select({ onHand: inventoryBalances.onHand })
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, tenantId),
          eq(inventoryBalances.siteId, siteId),
          eq(inventoryBalances.productId, productId)
        )
      )
      .get()!.onHand;

    await expect(
      sale({
        customerId,
        payments: [
          { method: 'loyalty', amount: 10, loyaltyPoints: 1 },
          { method: 'cash', amount: 40 },
        ],
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await writeLoyaltySettings(db, tenantId, {
      enabled: true,
      redemptionEnabled: true,
      valuePerPoint: 10,
    });
    await expect(
      sale({
        payments: [
          { method: 'store_credit', amount: 10 },
          { method: 'cash', amount: 40 },
        ],
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await grantPoints(customerId, 1);
    await expect(
      sale({
        customerId,
        payments: [
          { method: 'loyalty', amount: 9, loyaltyPoints: 1 },
          { method: 'cash', amount: 41 },
        ],
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      sale({
        customerId,
        payments: [
          { method: 'loyalty', amount: 20, loyaltyPoints: 2 },
          { method: 'cash', amount: 30 },
        ],
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      sale({
        customerId,
        payments: [
          { method: 'store_credit', amount: 1 },
          { method: 'cash', amount: 49 },
        ],
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(
      db
        .select({ count: sql<number>`count(*)` })
        .from(sales)
        .get()?.count
    ).toBe(beforeSales);
    expect(
      db
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, tenantId),
            eq(inventoryBalances.siteId, siteId),
            eq(inventoryBalances.productId, productId)
          )
        )
        .get()!.onHand
    ).toBe(stockBefore);
    expect((await loyaltyBalance(customerId)).points).toBe(1);
  });

  it('redeems split internal value and restores every cent and point across two partial returns', async () => {
    const customerId = await createCustomer('Partial customer value');
    await issueStoreCredit(customerId, 100);
    await grantPoints(customerId, 100);
    await writeLoyaltySettings(getDatabase(), tenantId, {
      enabled: true,
      pointsPerUnit: 1,
      redemptionEnabled: true,
      valuePerPoint: 10,
    });

    const completed = await sale({
      customerId,
      quantity: 2,
      payments: [
        { method: 'loyalty', amount: 30, loyaltyPoints: 3 },
        { method: 'store_credit', amount: 20 },
        { method: 'cash', amount: 50 },
      ],
    });
    expect(completed).toMatchObject({ total: 100, loyaltyPointsEarned: 70 });
    expect((await loyaltyBalance(customerId)).points).toBe(167);
    expect(await storeBalance(customerId)).toBe(80);
    const persistedPayments = getDatabase()
      .select()
      .from(salePayments)
      .where(and(eq(salePayments.tenantId, tenantId), eq(salePayments.saleId, completed.id)))
      .all();
    expect(persistedPayments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'loyalty', amount: 30, loyaltyPoints: 3 }),
        expect.objectContaining({ method: 'store_credit', amount: 20 }),
        expect.objectContaining({ method: 'cash', amount: 50 }),
      ])
    );
    const line = getDatabase()
      .select({ id: saleItems.id })
      .from(saleItems)
      .where(eq(saleItems.saleId, completed.id))
      .get();
    if (!line) throw new Error('Expected sold line');

    await appRouter.createCaller(fresh()).sales.returnSale({
      id: completed.id,
      items: [{ saleItemId: line.id, quantity: 1 }],
      reason: 'First half returned',
    });
    const afterFirst = await loyaltyBalance(customerId);
    expect(afterFirst.points).toBeLessThan(167);
    expect(afterFirst.storeCredit.balance).toBeGreaterThan(80);

    await appRouter.createCaller(fresh()).sales.returnSale({
      id: completed.id,
      reason: 'Final half returned',
    });
    expect((await loyaltyBalance(customerId)).points).toBe(100);
    expect(await storeBalance(customerId)).toBe(100);
    await expectLoyaltyParity(customerId);
    await expectStoreCreditParity(customerId);

    const loyaltyKinds = getDatabase()
      .select({ kind: loyaltyMovements.kind, points: loyaltyMovements.points })
      .from(loyaltyMovements)
      .where(
        and(eq(loyaltyMovements.tenantId, tenantId), eq(loyaltyMovements.saleId, completed.id))
      )
      .all();
    expect(loyaltyKinds).toEqual(
      expect.arrayContaining([
        { kind: 'redeem', points: -3 },
        { kind: 'earn', points: 70 },
      ])
    );
    expect(
      loyaltyKinds.filter(row => row.kind === 'restore').reduce((sum, row) => sum + row.points, 0)
    ).toBe(3);
    expect(
      loyaltyKinds.filter(row => row.kind === 'revert').reduce((sum, row) => sum + row.points, 0)
    ).toBe(-70);
    const storeKinds = getDatabase()
      .select({ kind: storeCreditMovements.kind, amount: storeCreditMovements.amount })
      .from(storeCreditMovements)
      .where(
        and(
          eq(storeCreditMovements.tenantId, tenantId),
          eq(storeCreditMovements.saleId, completed.id)
        )
      )
      .all();
    expect(storeKinds.filter(row => row.kind === 'redeem')).toEqual([
      { kind: 'redeem', amount: -20 },
    ]);
    expect(
      storeKinds.filter(row => row.kind === 'revert').reduce((sum, row) => sum + row.amount, 0)
    ).toBe(20);
    const personalData = await appRouter
      .createCaller(fresh())
      .customers.exportPersonalData({ id: customerId });
    expect(
      personalData.records.salePayments.find(
        payment => payment.saleId === completed.id && payment.method === 'loyalty'
      )
    ).toMatchObject({ loyaltyPoints: 3, amount: 30 });
    const exportedLoyalty = personalData.records.loyaltyMovements.filter(
      movement => movement.saleId === completed.id
    );
    const exportedStoreCredit = personalData.records.storeCreditMovements.filter(
      movement => movement.saleId === completed.id
    );
    expect(exportedLoyalty.map(movement => movement.kind)).toEqual(
      expect.arrayContaining(['redeem', 'earn', 'restore', 'revert'])
    );
    expect(exportedStoreCredit.map(movement => movement.kind)).toEqual(
      expect.arrayContaining(['redeem', 'revert'])
    );
    const replicatedCustomerValueIds = new Set(
      getDatabase()
        .select({ entityId: syncOutbox.entityId })
        .from(syncOutbox)
        .where(eq(syncOutbox.tenantId, tenantId))
        .all()
        .map(row => row.entityId)
    );
    expect(
      [...exportedLoyalty, ...exportedStoreCredit]
        .filter(movement => !replicatedCustomerValueIds.has(movement.id))
        .map(movement => ({ id: movement.id, kind: movement.kind }))
    ).toEqual([]);
    await expect(
      appRouter.createCaller(fresh()).sales.returnSale({
        id: completed.id,
        reason: 'Must not restore twice',
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect((await loyaltyBalance(customerId)).points).toBe(100);
    expect(await storeBalance(customerId)).toBe(100);
  });

  it('supports internal tenders when a reserved draft is completed', async () => {
    const customerId = await createCustomer('Draft customer value');
    await issueStoreCredit(customerId, 50);
    await grantPoints(customerId, 5);
    await writeLoyaltySettings(getDatabase(), tenantId, {
      enabled: true,
      pointsPerUnit: 0.1,
      redemptionEnabled: true,
      valuePerPoint: 10,
    });
    const draft = await sale({ customerId, status: 'draft' });
    const completed = await appRouter.createCaller(fresh()).sales.completeDraft({
      saleId: draft.id,
      customerId,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 20,
      payments: [
        { method: 'loyalty', amount: 10, loyaltyPoints: 1 },
        { method: 'store_credit', amount: 20 },
        { method: 'cash', amount: 20 },
      ],
    });
    expect(completed).toMatchObject({ status: 'completed', total: 50, loyaltyPointsEarned: 4 });
    expect((await loyaltyBalance(customerId)).points).toBe(8);
    expect(await storeBalance(customerId)).toBe(30);
    await expectLoyaltyParity(customerId);
    await expectStoreCreditParity(customerId);
  });

  it('lets only one concurrent checkout consume the last store-credit balance', async () => {
    const customerId = await createCustomer('Concurrent store credit');
    await issueStoreCredit(customerId, 50);
    const stockBefore = getDatabase()
      .select({ onHand: inventoryBalances.onHand })
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, tenantId),
          eq(inventoryBalances.siteId, siteId),
          eq(inventoryBalances.productId, productId)
        )
      )
      .get()!.onHand;

    const attempts = await Promise.allSettled([
      sale({ customerId, payments: [{ method: 'store_credit', amount: 50 }] }),
      sale({ customerId, payments: [{ method: 'store_credit', amount: 50 }] }),
    ]);
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(await storeBalance(customerId)).toBe(0);
    expect(
      getDatabase()
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, tenantId),
            eq(inventoryBalances.siteId, siteId),
            eq(inventoryBalances.productId, productId)
          )
        )
        .get()!.onHand
    ).toBe(stockBefore - 1);
    await expectStoreCreditParity(customerId);
  });

  it('restores internal tenders and claws back new earnings exactly once on void', async () => {
    const customerId = await createCustomer('Void customer value');
    await issueStoreCredit(customerId, 30);
    await grantPoints(customerId, 10);
    await writeLoyaltySettings(getDatabase(), tenantId, {
      enabled: true,
      pointsPerUnit: 0.1,
      redemptionEnabled: true,
      valuePerPoint: 10,
    });
    const completed = await sale({
      customerId,
      payments: [
        { method: 'loyalty', amount: 20, loyaltyPoints: 2 },
        { method: 'store_credit', amount: 10 },
        { method: 'cash', amount: 20 },
      ],
    });
    expect(completed.loyaltyPointsEarned).toBe(3);
    expect((await loyaltyBalance(customerId)).points).toBe(11);
    expect(await storeBalance(customerId)).toBe(20);

    await appRouter.createCaller(fresh()).sales.void({
      id: completed.id,
      reason: 'Operator caught duplicate ticket',
    });
    expect((await loyaltyBalance(customerId)).points).toBe(10);
    expect(await storeBalance(customerId)).toBe(30);
    await expectLoyaltyParity(customerId);
    await expectStoreCreditParity(customerId);
    await expect(
      appRouter.createCaller(fresh()).sales.void({ id: completed.id, reason: 'Duplicate void' })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect((await loyaltyBalance(customerId)).points).toBe(10);
    expect(await storeBalance(customerId)).toBe(30);
  });
});
