/** Real migrated SQLite coverage of fulfillment, replay and tenant/site ownership. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hash } from 'argon2';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  cashSessions,
  companies,
  customers,
  deliveryOrderEvents,
  deliveryOrders,
  products,
  saleItems,
  saleReturns,
  sales,
  sites,
  syncOutbox,
  tenants,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { freshCriticalContext } from './utils/criticalCommandFixture.js';
import { advanceDelivery } from '../application/delivery/commands.js';
import { deliveryOrderStatusEnum } from '../db/schema.js';

let server: PuntovivoServer;

/** Isolated tenant/site identity with a real registered command device. */
interface Harness {
  deviceId: string;
  tenantId: string;
  companyId: string;
  siteId: string;
  adminId: string;
}

async function seedHarness(suffix: string): Promise<Harness> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `do-tenant-${suffix}`;
  const companyId = `do-company-${suffix}`;
  const siteId = `do-site-${suffix}`;
  const adminId = `do-admin-${suffix}`;

  await db.insert(tenants).values({
    id: tenantId,
    name: `Delivery Tenant ${suffix}`,
    slug: `do-${suffix}`,
    settings: { modules: { delivery: true } },
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(companies).values({
    id: companyId,
    tenantId,
    name: `Delivery Company ${suffix}`,
    taxId: `DO-${suffix}`,
    email: `company-${suffix}@example.com`,
    phone: null,
    address: null,
    logoId: null,
    logoUrl: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(sites).values({
    id: siteId,
    tenantId,
    companyId,
    name: `Main ${suffix}`,
    address: null,
    phone: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values({
    id: adminId,
    tenantId,
    email: `admin-${suffix}@example.com`,
    passwordHash: await hash('TestPassword123!'),
    name: `Admin ${suffix}`,
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  const { deviceId } = await registerDevice(db, {
    tenantId,
    userId: adminId,
    kind: 'web',
    name: 'Delivery test',
  });
  return { tenantId, companyId, siteId, adminId, deviceId };
}

function buildCtx(h: Harness) {
  return freshCriticalContext({
    db: getDatabase(),
    serverApp: server.app,
    tenantId: h.tenantId,
    userId: h.adminId,
    email: `admin-${h.tenantId}@example.com`,
    role: 'admin',
    siteId: h.siteId,
    deviceId: h.deviceId,
  });
}
function caller(h: Harness) {
  return appRouter.createCaller(buildCtx(h));
}
function createOrder(h: Harness) {
  return caller(h).deliveryOrders.create({
    siteId: h.siteId,
    customerName: 'Private Recipient',
    address: 'Private address',
  });
}
function seedSale(h: Harness, siteId = h.siteId) {
  const db = getDatabase();
  const sessionId = nanoid();
  db.insert(cashSessions)
    .values({
      id: sessionId,
      tenantId: h.tenantId,
      siteId,
      cashierId: h.adminId,
      registerName: nanoid(),
      openingCountDenominations: [],
      status: 'closed',
    })
    .run();
  const productId = nanoid();
  db.insert(products)
    .values({
      id: productId,
      tenantId: h.tenantId,
      sku: nanoid(),
      name: 'Renamed product',
      price: 500,
    })
    .run();
  const id = nanoid();
  db.insert(sales)
    .values({
      id,
      tenantId: h.tenantId,
      saleNumber: nanoid(),
      createdBy: h.adminId,
      status: 'completed',
      cashSessionId: sessionId,
      total: 24,
      subtotal: 24,
      currencyCode: 'COP',
    })
    .run();
  db.insert(saleItems)
    .values({
      id: nanoid(),
      saleId: id,
      productId,
      productNameSnapshot: 'Original product',
      quantity: 2,
      unitPrice: 12,
      total: 24,
    })
    .run();
  return { id, sessionId, productId };
}

describe('Delivery Orders tRPC Router', () => {
  let tenantA: Harness;
  let tenantB: Harness;

  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    tenantA = await seedHarness('a');
    tenantB = await seedHarness('b');
  });

  afterAll(async () => {
    await server.close();
  });

  it('creates a delivery order and advances its status through the queue', async () => {
    const localCaller = () => appRouter.createCaller(buildCtx(tenantA));

    const { id } = await localCaller().deliveryOrders.create({
      siteId: tenantA.siteId,
      customerName: 'Ada Lovelace',
      address: 'Calle 100 #20-30',
    });

    const advanced = await localCaller().deliveryOrders.advance({
      id,
      siteId: tenantA.siteId,
      expectedVersion: 1,
      toStatus: 'preparing',
      courierName: 'Carlos',
    });
    expect(advanced).toEqual({ id, status: 'preparing', version: 2 });

    const listed = await localCaller().deliveryOrders.list({ siteId: tenantA.siteId });
    const row = listed.find(order => order.id === id);
    expect(row?.status).toBe('preparing');
    expect(row?.courierName).toBe('Carlos');
    expect(row?.preparingAt).toBeTruthy();
  });

  it("rejects advancing another tenant's delivery order and leaves it unchanged", async () => {
    const callerA = () => appRouter.createCaller(buildCtx(tenantA));
    const callerB = () => appRouter.createCaller(buildCtx(tenantB));
    const db = getDatabase();

    const { id } = await callerA().deliveryOrders.create({
      siteId: tenantA.siteId,
      customerName: `Customer ${nanoid(6)}`,
      address: 'Av. Siempre Viva 742',
    });

    // Tenant B attempts to move tenant A's order — the pre-check rejects
    // with NOT_FOUND before the hardened UPDATE is reached.
    await expect(
      callerB().deliveryOrders.advance({
        id,
        siteId: tenantB.siteId,
        expectedVersion: 1,
        toStatus: 'cancelled',
        reason: 'Cancelled',
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const survivor = await db.select().from(deliveryOrders).where(eq(deliveryOrders.id, id)).get();
    expect(survivor).toBeTruthy();
    expect(survivor?.tenantId).toBe(tenantA.tenantId);
    // Status must still be the original 'accepted' — never moved to
    // 'cancelled', and cancelledAt must remain null.
    expect(survivor?.status).toBe('accepted');
    expect(survivor?.cancelledAt).toBeNull();
  });
  it('rejects skipping preparation and dispatch when confirming delivery', async () => {
    const localCaller = () => appRouter.createCaller(buildCtx(tenantA));
    const { id } = await localCaller().deliveryOrders.create({
      siteId: tenantA.siteId,
      customerName: 'Transition regression',
      address: 'Test delivery address',
    });
    await expect(
      localCaller().deliveryOrders.advance({
        id,
        siteId: tenantA.siteId,
        expectedVersion: 1,
        toStatus: 'delivered',
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(
      getDatabase().select().from(deliveryOrders).where(eq(deliveryOrders.id, id)).get()?.status
    ).toBe('accepted');
  });

  it.each(
    deliveryOrderStatusEnum.flatMap(from => deliveryOrderStatusEnum.map(to => [from, to] as const))
  )('allows only a legal transition %s → %s', async (from, to) => {
    const id = nanoid();
    getDatabase()
      .insert(deliveryOrders)
      .values({
        id,
        tenantId: tenantA.tenantId,
        siteId: tenantA.siteId,
        customerName: 'Matrix',
        address: 'Address',
        status: from,
        courierName: 'Courier',
        version: 1,
      })
      .run();
    const allowed = {
      accepted: ['preparing', 'cancelled'],
      preparing: ['dispatched', 'cancelled'],
      dispatched: ['delivered', 'cancelled'],
      delivered: [],
      cancelled: [],
    };
    const promise = caller(tenantA).deliveryOrders.advance({
      id,
      siteId: tenantA.siteId,
      expectedVersion: 1,
      toStatus: to,
      reason: 'Operator cancellation',
    });
    if (allowed[from].includes(to)) {
      await expect(promise).resolves.toEqual({ id, status: to, version: 2 });
    } else {
      await expect(promise).rejects.toMatchObject({
        code: 'CONFLICT',
        cause: { errorCode: 'DELIVERY_TRANSITION_INVALID' },
      });
      expect(
        getDatabase().select().from(deliveryOrders).where(eq(deliveryOrders.id, id)).get()?.version
      ).toBe(1);
    }
  });

  it('replays creation and transitions exactly once without leaking recipients into durable commands', async () => {
    const db = getDatabase();
    const creationContext = buildCtx(tenantA);
    const payload = {
      siteId: tenantA.siteId,
      customerName: 'Private Recipient',
      address: 'Private address',
    };
    const first = await appRouter.createCaller(creationContext).deliveryOrders.create(payload);
    expect(await appRouter.createCaller(creationContext).deliveryOrders.create(payload)).toEqual(
      first
    );
    const transitionContext = buildCtx(tenantA);
    const next = {
      id: first.id,
      siteId: tenantA.siteId,
      expectedVersion: 1,
      toStatus: 'preparing' as const,
    };
    const moved = await appRouter.createCaller(transitionContext).deliveryOrders.advance(next);
    expect(await appRouter.createCaller(transitionContext).deliveryOrders.advance(next)).toEqual(
      moved
    );
    const events = db
      .select()
      .from(deliveryOrderEvents)
      .where(eq(deliveryOrderEvents.deliveryOrderId, first.id))
      .all();
    expect(events.map(event => event.version)).toEqual([1, 2]);
    const outbox = db.select().from(syncOutbox).where(eq(syncOutbox.entityId, first.id)).all();
    expect(outbox).toHaveLength(2);
    expect(outbox.every(row => row.status === 'local_only')).toBe(true);
    const audit = db.select().from(auditLogs).where(eq(auditLogs.resourceId, first.id)).all();
    expect(audit).toHaveLength(2);
    expect(JSON.stringify({ events, outbox, audit })).not.toContain('Private Recipient');
    expect(JSON.stringify({ events, outbox, audit })).not.toContain('Private address');
  });

  it('permits only one of two simultaneous updates from the same observed version', async () => {
    const { id } = await createOrder(tenantA);
    const input = {
      id,
      siteId: tenantA.siteId,
      expectedVersion: 1,
      toStatus: 'preparing' as const,
    };
    const results = await Promise.allSettled([
      caller(tenantA).deliveryOrders.advance(input),
      caller(tenantA).deliveryOrders.advance(input),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({
      reason: { code: 'CONFLICT', cause: { errorCode: 'STALE_VERSION' } },
    });
    expect(
      getDatabase()
        .select()
        .from(deliveryOrderEvents)
        .where(eq(deliveryOrderEvents.deliveryOrderId, id))
        .all()
    ).toHaveLength(2);
  });

  it('requires an assigned courier before dispatch and a reason before cancellation', async () => {
    const { id } = await createOrder(tenantA);
    await caller(tenantA).deliveryOrders.advance({
      id,
      siteId: tenantA.siteId,
      expectedVersion: 1,
      toStatus: 'preparing',
    });
    await expect(
      caller(tenantA).deliveryOrders.advance({
        id,
        siteId: tenantA.siteId,
        expectedVersion: 2,
        toStatus: 'dispatched',
      })
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      cause: { errorCode: 'DELIVERY_COURIER_REQUIRED' },
    });
    await expect(
      caller(tenantA).deliveryOrders.advance({
        id,
        siteId: tenantA.siteId,
        expectedVersion: 2,
        toStatus: 'cancelled',
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await caller(tenantA).deliveryOrders.advance({
      id,
      siteId: tenantA.siteId,
      expectedVersion: 2,
      toStatus: 'dispatched',
      courierName: 'Courier',
    });
    await caller(tenantA).deliveryOrders.advance({
      id,
      siteId: tenantA.siteId,
      expectedVersion: 3,
      toStatus: 'delivered',
    });
    const row = await caller(tenantA).deliveryOrders.get({ id, siteId: tenantA.siteId });
    expect(row).toMatchObject({ status: 'delivered', version: 4, allowedTransitions: [] });
    expect(
      [row.acceptedAt, row.preparingAt, row.dispatchedAt, row.deliveredAt].every(Boolean)
    ).toBe(true);
  });

  it('rejects foreign customers, foreign sites and read access to foreign orders', async () => {
    const customerId = nanoid();
    getDatabase()
      .insert(customers)
      .values({ id: customerId, tenantId: tenantB.tenantId, name: 'Foreign' })
      .run();
    await expect(
      caller(tenantA).deliveryOrders.create({
        siteId: tenantA.siteId,
        customerId,
        customerName: 'Recipient',
        address: 'Address',
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller(tenantA).deliveryOrders.create({
        siteId: tenantB.siteId,
        customerName: 'Recipient',
        address: 'Address',
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const { id } = await createOrder(tenantA);
    await expect(
      caller(tenantB).deliveryOrders.get({ id, siteId: tenantB.siteId })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      caller(tenantB).deliveryOrders.list({ siteId: tenantA.siteId })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      caller(tenantB).deliveryOrders.counts({ siteId: tenantA.siteId })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('checks module and role before the idempotent response can be reused', async () => {
    const ctx = buildCtx(tenantA);
    const input = { siteId: tenantA.siteId, customerName: 'Recipient', address: 'Address' };
    await appRouter.createCaller(ctx).deliveryOrders.create(input);
    getDatabase()
      .update(tenants)
      .set({ settings: { modules: { delivery: false } } })
      .where(eq(tenants.id, tenantA.tenantId))
      .run();
    try {
      await expect(appRouter.createCaller(ctx).deliveryOrders.create(input)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    } finally {
      getDatabase()
        .update(tenants)
        .set({ settings: { modules: { delivery: true } } })
        .where(eq(tenants.id, tenantA.tenantId))
        .run();
    }
    const denied = { ...ctx, user: { ...ctx.user!, role: 'viewer' } };
    await expect(appRouter.createCaller(denied).deliveryOrders.create(input)).rejects.toMatchObject(
      { code: 'FORBIDDEN' }
    );
    await expect(
      appRouter.createCaller(denied).deliveryOrders.list({ siteId: tenantA.siteId })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rolls back projection, event, audit and outbox when the final identity fence fails', async () => {
    const { id } = await createOrder(tenantA);
    const db = getDatabase();
    const snapshot = () => ({
      delivery: db.select().from(deliveryOrders).where(eq(deliveryOrders.id, id)).get(),
      events: db
        .select()
        .from(deliveryOrderEvents)
        .where(eq(deliveryOrderEvents.deliveryOrderId, id))
        .all(),
      audit: db.select().from(auditLogs).where(eq(auditLogs.resourceId, id)).all(),
      outbox: db.select().from(syncOutbox).where(eq(syncOutbox.entityId, id)).all(),
    });
    const before = snapshot();
    expect(() =>
      advanceDelivery(
        {
          db,
          tenantId: tenantA.tenantId,
          user: { id: tenantA.adminId },
          deviceId: tenantA.deviceId,
          envelope: { operationId: nanoid(), idempotencyKey: nanoid() },
          completeInTransaction: () => {
            throw new Error('Injected identity fence failure');
          },
        },
        { id, siteId: tenantA.siteId, expectedVersion: 1, toStatus: 'preparing' }
      )
    ).toThrow('Injected identity fence failure');
    expect(snapshot()).toEqual(before);
  });

  it('returns exact counts and stable cursor pages even beyond the old 200-row cap', async () => {
    const db = getDatabase();
    const isolatedSite = nanoid();
    db.insert(sites)
      .values({
        id: isolatedSite,
        tenantId: tenantA.tenantId,
        companyId: tenantA.companyId,
        name: 'Pagination',
      })
      .run();
    const sameTime = '2026-01-01T12:00:00.000Z';
    for (let index = 0; index < 205; index++)
      db.insert(deliveryOrders)
        .values({
          id: `page-${index.toString().padStart(3, '0')}`,
          tenantId: tenantA.tenantId,
          siteId: isolatedSite,
          customerName: 'Page',
          address: 'Address',
          acceptedAt: sameTime,
        })
        .run();
    const counts = await caller(tenantA).deliveryOrders.counts({ siteId: isolatedSite });
    expect(counts).toEqual({
      accepted: 205,
      preparing: 0,
      dispatched: 0,
      delivered: 0,
      cancelled: 0,
    });
    const first = await caller(tenantA).deliveryOrders.list({
      siteId: isolatedSite,
      status: 'accepted',
      limit: 200,
    });
    expect(first).toHaveLength(200);
    const last = first.at(-1)!;
    const second = await caller(tenantA).deliveryOrders.list({
      siteId: isolatedSite,
      status: 'accepted',
      limit: 200,
      cursor: { id: last.id, acceptedAt: last.acceptedAt },
    });
    expect(second).toHaveLength(5);
    expect(new Set([...first, ...second].map(row => row.id)).size).toBe(205);
    expect(first.map(row => row.id)).toEqual([...first.map(row => row.id)].sort().reverse());
  });

  it('freezes sale evidence from SQLite and never charges or refunds during fulfillment', async () => {
    const db = getDatabase();
    const sale = seedSale(tenantA);
    const payload = {
      siteId: tenantA.siteId,
      saleId: sale.id,
      customerName: 'Recipient',
      address: 'Address',
    };
    const beforeSale = db.select().from(sales).where(eq(sales.id, sale.id)).get();
    const result = await caller(tenantA).deliveryOrders.createFromSale(payload);
    db.update(products)
      .set({ name: 'Edited later', price: 999 })
      .where(eq(products.id, sale.productId))
      .run();
    const delivery = await caller(tenantA).deliveryOrders.get({
      siteId: tenantA.siteId,
      id: result.id,
    });
    expect(delivery).toMatchObject({
      totalAmount: 24,
      currencyCode: 'COP',
      source: 'sale',
      saleId: sale.id,
    });
    expect(JSON.parse(delivery.itemsSnapshot!)).toEqual([
      expect.objectContaining({
        name: 'Original product',
        qty: 2,
        unitPrice: 12,
        total: 24,
      }),
    ]);
    await expect(caller(tenantA).deliveryOrders.createFromSale(payload)).rejects.toMatchObject({
      code: 'CONFLICT',
      cause: { errorCode: 'DELIVERY_SALE_ALREADY_LINKED' },
    });
    await caller(tenantA).deliveryOrders.advance({
      siteId: tenantA.siteId,
      id: result.id,
      expectedVersion: 1,
      toStatus: 'cancelled',
      reason: 'Customer arranged pickup',
    });
    expect(db.select().from(sales).where(eq(sales.id, sale.id)).get()).toEqual(beforeSale);
    expect(db.select().from(saleReturns).where(eq(saleReturns.saleId, sale.id)).all()).toEqual([]);
    expect(
      (await caller(tenantA).deliveryOrders.get({ siteId: tenantA.siteId, id: result.id }))
        .cancellationReason
    ).toBe('Customer arranged pickup');
  });

  it('rejects foreign, wrong-site, draft, voided and returned sale references', async () => {
    const db = getDatabase();
    const otherSite = nanoid();
    db.insert(sites)
      .values({
        id: otherSite,
        tenantId: tenantA.tenantId,
        companyId: tenantA.companyId,
        name: 'Other',
      })
      .run();
    const sameTenantOtherSite = seedSale(tenantA, otherSite);
    const foreign = seedSale(tenantB);
    const draft = seedSale(tenantA);
    const voided = seedSale(tenantA);
    const refunded = seedSale(tenantA);
    db.update(sales).set({ status: 'draft' }).where(eq(sales.id, draft.id)).run();
    db.update(sales).set({ status: 'voided' }).where(eq(sales.id, voided.id)).run();
    db.insert(saleReturns)
      .values({
        id: nanoid(),
        tenantId: tenantA.tenantId,
        saleId: refunded.id,
        createdBy: tenantA.adminId,
        refundAmount: 12,
      })
      .run();
    for (const sale of [sameTenantOtherSite, foreign, draft, voided, refunded]) {
      await expect(
        caller(tenantA).deliveryOrders.createFromSale({
          siteId: tenantA.siteId,
          saleId: sale.id,
          customerName: 'Recipient',
          address: 'Address',
        })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(
        db.select().from(deliveryOrders).where(eq(deliveryOrders.saleId, sale.id)).all()
      ).toEqual([]);
    }
  });

  it('stops dispatch after a concurrent return without preventing explicit logistics cancellation', async () => {
    const db = getDatabase();
    const sale = seedSale(tenantA);
    const result = await caller(tenantA).deliveryOrders.createFromSale({
      siteId: tenantA.siteId,
      saleId: sale.id,
      customerName: 'Recipient',
      address: 'Address',
    });
    await caller(tenantA).deliveryOrders.advance({
      siteId: tenantA.siteId,
      id: result.id,
      expectedVersion: 1,
      toStatus: 'preparing',
    });
    db.insert(saleReturns)
      .values({
        id: nanoid(),
        tenantId: tenantA.tenantId,
        saleId: sale.id,
        createdBy: tenantA.adminId,
        refundAmount: 12,
      })
      .run();
    await expect(
      caller(tenantA).deliveryOrders.advance({
        siteId: tenantA.siteId,
        id: result.id,
        expectedVersion: 2,
        toStatus: 'dispatched',
        courierName: 'Courier',
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(
      await caller(tenantA).deliveryOrders.advance({
        siteId: tenantA.siteId,
        id: result.id,
        expectedVersion: 2,
        toStatus: 'cancelled',
        reason: 'Returned before dispatch',
      })
    ).toMatchObject({ status: 'cancelled' });
  });

  it('rejects unbounded and legacy unstructured input rather than storing arbitrary JSON', async () => {
    const base = { siteId: tenantA.siteId, customerName: 'Recipient', address: 'Address' };
    for (const invalid of [
      { ...base, itemsSnapshot: '{invalid' },
      { ...base, saleId: 'unresolved' },
      { ...base, totalAmount: -1 },
      { ...base, totalAmount: 0.001 },
      { ...base, customerName: 'x'.repeat(161) },
      { ...base, address: '  ' },
      { ...base, items: [{ name: 'Unit', qty: 0.0001, unitPrice: 1 }] },
    ])
      await expect(caller(tenantA).deliveryOrders.create(invalid)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    const result = await caller(tenantA).deliveryOrders.create({
      ...base,
      items: [{ name: '<img src=x onerror=alert(1)>', qty: 0.125, unitPrice: 10 }],
      totalAmount: 1.25,
    });
    const row = await caller(tenantA).deliveryOrders.get({ siteId: tenantA.siteId, id: result.id });
    expect(JSON.parse(row.itemsSnapshot!)).toEqual([
      { name: '<img src=x onerror=alert(1)>', qty: 0.125, unitPrice: 10 },
    ]);
  });

  it('refuses writes and reads in a disabled site', async () => {
    const row = await createOrder(tenantB);
    getDatabase().update(sites).set({ isActive: false }).where(eq(sites.id, tenantB.siteId)).run();
    try {
      await expect(
        caller(tenantB).deliveryOrders.advance({
          siteId: tenantB.siteId,
          id: row.id,
          expectedVersion: 1,
          toStatus: 'preparing',
        })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        caller(tenantB).deliveryOrders.list({ siteId: tenantB.siteId })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      getDatabase().update(sites).set({ isActive: true }).where(eq(sites.id, tenantB.siteId)).run();
    }
  });
  it('offers only owned eligible sale choices and treats search metacharacters literally', async () => {
    const db = getDatabase();
    const wanted = seedSale(tenantA);
    db.update(sales).set({ saleNumber: 'SEARCH-50%_literal' }).where(eq(sales.id, wanted.id)).run();
    const decoy = seedSale(tenantA);
    db.update(sales).set({ saleNumber: 'SEARCH-50000literal' }).where(eq(sales.id, decoy.id)).run();
    const foreign = seedSale(tenantB);
    db.update(sales)
      .set({ saleNumber: 'SEARCH-50%_foreign' })
      .where(eq(sales.id, foreign.id))
      .run();
    const choices = await caller(tenantA).deliveryOrders.saleOptions({
      siteId: tenantA.siteId,
      search: '50%_',
    });
    expect(choices.map(row => row.id)).toEqual([wanted.id]);
    await caller(tenantA).deliveryOrders.createFromSale({
      siteId: tenantA.siteId,
      saleId: wanted.id,
      customerName: 'Recipient',
      address: 'Address',
    });
    expect(
      await caller(tenantA).deliveryOrders.saleOptions({
        siteId: tenantA.siteId,
        search: wanted.id,
      })
    ).toEqual([]);
    db.insert(saleReturns)
      .values({
        id: nanoid(),
        tenantId: tenantA.tenantId,
        saleId: decoy.id,
        createdBy: tenantA.adminId,
      })
      .run();
    expect(
      await caller(tenantA).deliveryOrders.saleOptions({ siteId: tenantA.siteId, search: decoy.id })
    ).toEqual([]);
    await expect(
      caller(tenantB).deliveryOrders.saleOptions({ siteId: tenantA.siteId })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
