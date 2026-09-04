/** Real migrated SQLite tests: authentication, durable replay, fail-closed ownership and rollback. */
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  companies,
  products,
  units,
  unitXProduct,
  cashSessions,
  cashMovements,
  sequentials,
  inventoryBalances,
  kdsOrders,
  tenants,
  sites,
  users,
  externalOrderConnectors,
  externalOrders,
  externalOrderReceipts,
  externalOrderNonces,
  externalOrderEvents,
  sales,
  syncOutbox,
  auditLogs,
  idempotencyKeys,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { freshCriticalContext } from './utils/criticalCommandFixture.js';
import { registerDevice } from '../services/devices/devicesService.js';
import {
  signExternalOrderEnvelope,
  type ExternalOrderSignedEnvelope,
} from '../services/external-orders/signature.js';
import { configureExternalOrderSecretKey } from '../services/external-orders/secret-box.js';
import { receiveExternalOrder } from '../application/external-orders/receive.js';
import { acceptExternalOrder } from '../application/external-orders/commands.js';
import { createExternalConnector } from '../application/external-orders/connectors.js';
import type { CriticalCommandContext } from '../trpc/middleware/commandEnvelope.js';
let server: PuntovivoServer;
/** Per-test tenant identity; no sales, payments or inventory is fabricated for ingress. */
interface Harness {
  tenantId: string;
  siteId: string;
  userId: string;
  deviceId: string;
}
async function harness(): Promise<Harness> {
  const db = getDatabase(),
    tenantId = nanoid(),
    siteId = nanoid(),
    userId = nanoid(),
    companyId = nanoid();
  db.insert(tenants)
    .values({
      id: tenantId,
      name: 'External inbox',
      slug: tenantId,
      isActive: true,
      settings: { modules: { delivery: true } },
    })
    .run();
  db.insert(companies)
    .values({ id: companyId, tenantId, name: 'External company', taxId: tenantId })
    .run();
  db.insert(sites)
    .values({ id: siteId, tenantId, companyId, name: 'External site', isActive: true })
    .run();
  db.insert(users)
    .values({
      id: userId,
      tenantId,
      email: `${userId}@example.com`,
      name: 'External admin',
      passwordHash: 'unused-test-hash',
      role: 'admin',
      isActive: true,
    })
    .run();
  const { deviceId } = await registerDevice(db, {
    tenantId,
    userId,
    kind: 'web',
    name: 'Inbox test',
  });
  return { tenantId, siteId, userId, deviceId };
}
function context(h: Harness, role: 'admin' | 'manager' | 'cashier' | 'viewer' = 'admin') {
  return freshCriticalContext({
    ...h,
    db: getDatabase(),
    serverApp: server.app,
    email: `${h.userId}@example.com`,
    role,
  });
}
function caller(h: Harness) {
  return appRouter.createCaller(context(h));
}
function anonymous(h: Harness) {
  return appRouter.createCaller({ ...context(h), tenantId: null, siteId: null, user: null });
}
async function connector(h: Harness) {
  const secret = randomBytes(32).toString('base64url');
  const row = await caller(h).externalOrders.createConnector({
    siteId: h.siteId,
    name: 'Sandbox',
    adapter: 'sandbox_v1',
    secret,
  });
  return { ...row, secret };
}
function created(orderId = nanoid(), eventId = nanoid()) {
  return {
    schemaVersion: 1 as const,
    eventId,
    orderId,
    kind: 'order.created' as const,
    order: {
      customerName: 'Private guest',
      phone: 'Private phone',
      address: '<img src=x onerror=alert(1)>',
      notes: 'Private notes',
      currencyCode: 'COP',
      quotedTotal: 4000,
      items: [{ productCode: 'sku-1', quantity: 1.001 }],
    },
  };
}
function signed(
  c: { id: string; secret: string },
  event: unknown,
  overrides: Partial<Omit<ExternalOrderSignedEnvelope, 'signature'>> = {}
) {
  const input = {
    connectorId: c.id,
    timestamp: Date.now(),
    nonce: nanoid(32),
    body: JSON.stringify(event),
    ...overrides,
  };
  return { ...input, signature: signExternalOrderEnvelope(c.secret, input) };
}
function orders(h: Harness) {
  return getDatabase()
    .select()
    .from(externalOrders)
    .where(eq(externalOrders.tenantId, h.tenantId))
    .all();
}
function receipts(h: Harness) {
  return getDatabase()
    .select()
    .from(externalOrderReceipts)
    .where(eq(externalOrderReceipts.tenantId, h.tenantId))
    .all();
}
function nonces(h: Harness) {
  return getDatabase()
    .select()
    .from(externalOrderNonces)
    .where(eq(externalOrderNonces.tenantId, h.tenantId))
    .all();
}
function events(h: Harness) {
  return getDatabase()
    .select()
    .from(externalOrderEvents)
    .where(eq(externalOrderEvents.tenantId, h.tenantId))
    .all();
}

function seedCheckout(h: Harness) {
  const db = getDatabase(),
    productId = nanoid(),
    unitId = nanoid();
  db.insert(units)
    .values({ id: unitId, tenantId: h.tenantId, name: 'Unit', abbreviation: 'u' })
    .run();
  db.insert(products)
    .values({
      id: productId,
      tenantId: h.tenantId,
      sku: 'sku-1',
      name: 'Inbox meal',
      price: 10,
      cost: 2,
      tracksStock: true,
      sellByFraction: true,
      fractionStep: 0.001,
      fractionMinimum: 0.001,
      taxRate: 0,
    })
    .run();
  db.insert(unitXProduct)
    .values({ id: nanoid(), productId, unitId, equivalence: 1, price: 10, isBase: true })
    .run();
  db.insert(inventoryBalances)
    .values({ id: nanoid(), tenantId: h.tenantId, siteId: h.siteId, productId, onHand: 8 })
    .run();
  db.insert(cashSessions)
    .values({
      id: nanoid(),
      tenantId: h.tenantId,
      siteId: h.siteId,
      cashierId: h.userId,
      registerName: 'Inbox',
      status: 'open',
      openingCountDenominations: [],
    })
    .run();
  db.insert(sequentials)
    .values({
      id: nanoid(),
      tenantId: h.tenantId,
      siteId: h.siteId,
      name: 'Inbox sales',
      documentType: 'sale',
      prefix: 'EX-' + h.siteId,
      currentNumber: 1,
      isActive: true,
    })
    .run();
  return { productId, unitId };
}
async function intent(h: Harness) {
  const c = await connector(h),
    event = created();
  await anonymous(h).externalOrders.receive(signed(c, event));
  const row = orders(h)[0]!;
  return { c, event, row };
}
async function acceptance(h: Harness, id: string) {
  const quote = await caller(h).externalOrders.quote({ siteId: h.siteId, id });
  return {
    siteId: h.siteId,
    id,
    expectedVersion: quote.expectedVersion,
    fingerprint: quote.fingerprint,
    confirmedLocalPricing: true as const,
  };
}
function stock(productId: string) {
  return getDatabase()
    .select()
    .from(inventoryBalances)
    .where(eq(inventoryBalances.productId, productId))
    .get()!.onHand;
}
describe('signed external order inbox', () => {
  beforeAll(async () => {
    server = await createServer({
      dbPath: ':memory:',
      verbose: false,
      webhookSecretKey: 'external-test-key',
      seedData: false,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    configureExternalOrderSecretKey('external-test-key');
  });
  afterAll(async () => {
    await server.close();
  });
  it('seals secrets and excludes them from responses, idempotency results, audit and lists', async () => {
    const h = await harness(),
      secret = randomBytes(32).toString('base64url'),
      c = caller(h);
    const input = { siteId: h.siteId, name: 'Sandbox', adapter: 'sandbox_v1' as const, secret };
    const first = await c.externalOrders.createConnector(input);
    expect(await c.externalOrders.createConnector(input)).toEqual(first);
    const stored = getDatabase()
      .select()
      .from(externalOrderConnectors)
      .where(eq(externalOrderConnectors.id, first.id))
      .get()!;
    expect(stored.sealedSecret).not.toContain(secret);
    const list = await caller(h).externalOrders.connectors({ siteId: h.siteId });
    expect(list.rows).toHaveLength(1);
    expect(
      JSON.stringify([
        first,
        list,
        getDatabase().select().from(idempotencyKeys).all(),
        getDatabase().select().from(auditLogs).all(),
      ])
    ).not.toContain(secret);
    expect(JSON.stringify(list)).not.toContain(stored.sealedSecret);
  });
  it('receives anonymous signed intent once without creating a sale or exposing contact in outbox/events', async () => {
    const h = await harness(),
      c = await connector(h),
      event = created(),
      envelope = signed(c, event),
      a = anonymous(h);
    const result = await a.externalOrders.receive(envelope);
    expect(result).toEqual({
      eventId: event.eventId,
      orderId: event.orderId,
      status: 'received',
      version: 1,
    });
    expect(await a.externalOrders.receive(envelope)).toEqual(result);
    expect(await a.externalOrders.receive(signed(c, event))).toEqual(result);
    expect(orders(h)).toHaveLength(1);
    expect(receipts(h)).toHaveLength(1);
    expect(nonces(h)).toHaveLength(2);
    expect(events(h)).toHaveLength(1);
    expect(
      getDatabase().select().from(sales).where(eq(sales.tenantId, h.tenantId)).all()
    ).toHaveLength(0);
    const outbox = getDatabase()
      .select()
      .from(syncOutbox)
      .where(eq(syncOutbox.tenantId, h.tenantId))
      .all();
    expect(outbox.filter(row => row.entityType === 'external_orders')).toHaveLength(1);
    for (const value of ['Private guest', 'Private phone', 'Private notes', 'onerror'])
      expect(JSON.stringify([outbox, events(h), result])).not.toContain(value);
    const list = await caller(h).externalOrders.list({ siteId: h.siteId });
    expect(list.rows[0]!.snapshot?.items[0]!.quantity).toBe(1.001);
  });
  it('rejects tampering, wrong connector, bad MAC, unknown connector and stale envelopes with no durable writes', async () => {
    const h = await harness(),
      c = await connector(h),
      other = await connector(h),
      envelope = signed(c, created());
    for (const value of [
      { ...envelope, body: envelope.body + ' ' },
      { ...envelope, connectorId: other.id },
      { ...envelope, connectorId: 'missing' },
      { ...envelope, signature: 'v1=' + '0'.repeat(64) },
      signed(c, created(), { timestamp: Date.now() - 300_100 }),
    ]) {
      await expect(anonymous(h).externalOrders.receive(value)).rejects.toThrow(
        'authentication failed'
      );
    }
    expect(orders(h)).toHaveLength(0);
    expect(receipts(h)).toHaveLength(0);
    expect(nonces(h)).toHaveLength(0);
  });
  it('rejects event-id and nonce substitution without mutating the original receipt', async () => {
    const h = await harness(),
      c = await connector(h),
      event = created(),
      envelope = signed(c, event);
    const first = await anonymous(h).externalOrders.receive(envelope);
    await expect(
      anonymous(h).externalOrders.receive(signed(c, { ...event, orderId: 'different' }))
    ).rejects.toThrow('conflicts');
    await expect(
      anonymous(h).externalOrders.receive(signed(c, created(), { nonce: envelope.nonce }))
    ).rejects.toThrow('conflicts');
    expect(await anonymous(h).externalOrders.receive(envelope)).toEqual(first);
    expect(orders(h)).toHaveLength(1);
    expect(receipts(h)).toHaveLength(1);
    expect(nonces(h)).toHaveLength(1);
  });
  it('deduplicates create with a new event id but rejects conflicting order contents', async () => {
    const h = await harness(),
      c = await connector(h),
      event = created();
    await anonymous(h).externalOrders.receive(signed(c, event));
    await anonymous(h).externalOrders.receive(signed(c, { ...event, eventId: nanoid() }));
    await expect(
      anonymous(h).externalOrders.receive(
        signed(c, { ...event, eventId: nanoid(), order: { ...event.order, quotedTotal: 5000 } })
      )
    ).rejects.toThrow('conflicts');
    expect(orders(h)).toHaveLength(1);
    expect(events(h)).toHaveLength(1);
    expect(receipts(h)).toHaveLength(2);
  });
  it('keeps receipt acknowledgements stable after cancellation and never resurrects on retry', async () => {
    const h = await harness(),
      c = await connector(h),
      event = created();
    const first = await anonymous(h).externalOrders.receive(signed(c, event));
    const cancel = {
      schemaVersion: 1,
      eventId: nanoid(),
      orderId: event.orderId,
      kind: 'order.cancelled',
      reason: 'Private reason',
    };
    expect((await anonymous(h).externalOrders.receive(signed(c, cancel))).status).toBe('cancelled');
    expect(await anonymous(h).externalOrders.receive(signed(c, event))).toEqual(first);
    expect(orders(h)[0]).toMatchObject({
      status: 'cancelled',
      version: 2,
      reason: 'Private reason',
    });
    expect(events(h)).toHaveLength(2);
    expect(JSON.stringify(events(h))).not.toContain('Private reason');
  });
  it('retains cancel-before-create tombstones including reordered creates and duplicate cancels', async () => {
    const h = await harness(),
      c = await connector(h),
      event = created();
    const cancel = {
      schemaVersion: 1,
      eventId: nanoid(),
      orderId: event.orderId,
      kind: 'order.cancelled',
      reason: 'Never deliver',
    };
    await anonymous(h).externalOrders.receive(signed(c, cancel));
    await anonymous(h).externalOrders.receive(signed(c, event));
    await anonymous(h).externalOrders.receive(signed(c, { ...cancel, eventId: nanoid() }));
    expect(orders(h)[0]).toMatchObject({ status: 'cancelled', snapshot: null, version: 1 });
    expect(events(h)).toHaveLength(1);
    expect(receipts(h)).toHaveLength(3);
  });
  it('handles concurrent duplicate delivery with one order and one receipt', async () => {
    const h = await harness(),
      c = await connector(h),
      event = created(),
      a = anonymous(h);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => a.externalOrders.receive(signed(c, event)))
    );
    expect(results.every(row => JSON.stringify(row) === JSON.stringify(results[0]))).toBe(true);
    expect(orders(h)).toHaveLength(1);
    expect(receipts(h)).toHaveLength(1);
    expect(events(h)).toHaveLength(1);
  });
  it('rejects unsupported fields, paid claims, malformed JSON, precision and oversized UTF-8 without writes', async () => {
    const h = await harness(),
      c = await connector(h),
      event = created();
    for (const body of [
      '{broken',
      JSON.stringify({ ...event, tenantId: h.tenantId }),
      JSON.stringify({ ...event, paid: true }),
      JSON.stringify({ ...event, schemaVersion: 2 }),
      JSON.stringify({
        ...event,
        order: { ...event.order, items: [{ productCode: 'sku', quantity: 0.0001 }] },
      }),
    ]) {
      await expect(anonymous(h).externalOrders.receive(signed(c, event, { body }))).rejects.toThrow(
        'input is invalid'
      );
    }
    await expect(
      anonymous(h).externalOrders.receive({ ...signed(c, event), body: 'é'.repeat(40_000) })
    ).rejects.toThrow();
    expect(orders(h)).toHaveLength(0);
  });
  it('isolates connector namespaces and site-scoped operator reads, denying viewers and cashiers', async () => {
    const h = await harness(),
      other = await harness(),
      c = await connector(h),
      c2 = await connector(other),
      event = created();
    await anonymous(h).externalOrders.receive(signed(c, event));
    await anonymous(other).externalOrders.receive(signed(c2, event));
    expect(orders(h)).toHaveLength(1);
    expect(orders(other)).toHaveLength(1);
    const target = orders(h)[0]!;
    await expect(
      caller(other).externalOrders.get({ siteId: other.siteId, id: target.id })
    ).rejects.toThrow('unavailable');
    await expect(caller(other).externalOrders.list({ siteId: h.siteId })).rejects.toThrow();
    for (const role of ['viewer', 'cashier'] as const)
      await expect(
        appRouter.createCaller(context(h, role)).externalOrders.list({ siteId: h.siteId })
      ).rejects.toThrow();
    await expect(
      appRouter.createCaller(context(h, 'manager')).externalOrders.connectors({ siteId: h.siteId })
    ).rejects.toThrow();
    await expect(
      anonymous(h).externalOrders.get({ siteId: h.siteId, id: target.id })
    ).rejects.toThrow();
  });
  it('rotates and disables credentials with CAS; old signatures and disabled cached receives fail', async () => {
    const h = await harness(),
      c = await connector(h),
      event = created(),
      envelope = signed(c, event);
    await anonymous(h).externalOrders.receive(envelope);
    const rotated = randomBytes(32).toString('base64url');
    await caller(h).externalOrders.updateConnector({
      siteId: h.siteId,
      id: c.id,
      expectedVersion: 1,
      enabled: true,
      secret: rotated,
    });
    await expect(anonymous(h).externalOrders.receive(envelope)).rejects.toThrow(
      'authentication failed'
    );
    await expect(
      caller(h).externalOrders.updateConnector({
        siteId: h.siteId,
        id: c.id,
        expectedVersion: 1,
        enabled: false,
      })
    ).rejects.toThrow('conflicts');
    expect(
      (await anonymous(h).externalOrders.receive(signed({ id: c.id, secret: rotated }, event)))
        .version
    ).toBe(1);
    await caller(h).externalOrders.updateConnector({
      siteId: h.siteId,
      id: c.id,
      expectedVersion: 2,
      enabled: false,
    });
    await expect(
      anonymous(h).externalOrders.receive(signed({ id: c.id, secret: rotated }, event))
    ).rejects.toThrow('authentication failed');
  });
  it('fails closed for disabled module/site/tenant and missing or mismatched encryption keys', async () => {
    const h = await harness(),
      c = await connector(h),
      event = created(),
      db = getDatabase();
    configureExternalOrderSecretKey(undefined);
    await expect(
      caller(h).externalOrders.createConnector({
        siteId: h.siteId,
        name: 'No key',
        adapter: 'sandbox_v1',
        secret: c.secret,
      })
    ).rejects.toThrow('storage is unavailable');
    await expect(anonymous(h).externalOrders.receive(signed(c, event))).rejects.toThrow(
      'authentication failed'
    );
    configureExternalOrderSecretKey('external-test-key');
    db.update(sites).set({ isActive: false }).where(eq(sites.id, h.siteId)).run();
    await expect(anonymous(h).externalOrders.receive(signed(c, event))).rejects.toThrow(
      'unavailable'
    );
    db.update(sites).set({ isActive: true }).where(eq(sites.id, h.siteId)).run();
    db.update(tenants)
      .set({ settings: { modules: { delivery: false } } })
      .where(eq(tenants.id, h.tenantId))
      .run();
    await expect(anonymous(h).externalOrders.receive(signed(c, event))).rejects.toThrow(
      'unavailable'
    );
    db.update(tenants)
      .set({ settings: { modules: { delivery: true } }, isActive: false })
      .where(eq(tenants.id, h.tenantId))
      .run();
    await expect(anonymous(h).externalOrders.receive(signed(c, event))).rejects.toThrow(
      'unavailable'
    );
    expect(orders(h)).toHaveLength(0);
  });
  it('rolls back order, events, outbox and receipt on a late nonce failure, then safely retries', async () => {
    const h = await harness(),
      c = await connector(h),
      envelope = signed(c, created()),
      db = getDatabase();
    db.run(
      sql`CREATE TEMP TRIGGER test_external_nonce_failure BEFORE INSERT ON external_order_nonces BEGIN SELECT RAISE(ABORT, 'injected nonce failure'); END`
    );
    try {
      expect(() => receiveExternalOrder(db, envelope)).toThrow('injected nonce failure');
    } finally {
      db.run(sql`DROP TRIGGER test_external_nonce_failure`);
    }
    expect(orders(h)).toHaveLength(0);
    expect(receipts(h)).toHaveLength(0);
    expect(events(h)).toHaveLength(0);
    expect(
      db.select().from(syncOutbox).where(eq(syncOutbox.tenantId, h.tenantId)).all()
    ).toHaveLength(0);
    expect(receiveExternalOrder(db, envelope).status).toBe('received');
  });
  it('hides unexpected SQLite details at the public signed-ingress boundary', async () => {
    const h = await harness(),
      c = await connector(h),
      envelope = signed(c, created()),
      db = getDatabase();
    db.run(
      sql`CREATE TEMP TRIGGER test_external_public_failure BEFORE INSERT ON external_order_nonces BEGIN SELECT RAISE(ABORT, 'PRIVATE_SQLITE_CONSTRAINT_DETAIL'); END`
    );
    try {
      const error = await anonymous(h)
        .externalOrders.receive(envelope)
        .catch((error: unknown) => error);
      expect(String(error)).not.toContain('PRIVATE_SQLITE_CONSTRAINT_DETAIL');
      expect(String(error)).toContain('temporarily unavailable');
    } finally {
      db.run(sql`DROP TRIGGER test_external_public_failure`);
    }
    expect(orders(h)).toHaveLength(0);
  });
  it('rolls back connector and audit when the authenticated completion fence fails', async () => {
    const h = await harness(),
      ctx = {
        ...context(h),
        user: { id: h.userId, role: 'admin' },
        envelope: { operationId: nanoid(), idempotencyKey: nanoid() },
        completeInTransaction: () => {
          throw new Error('injected fence');
        },
      } as unknown as CriticalCommandContext;
    expect(() =>
      createExternalConnector(ctx, {
        siteId: h.siteId,
        name: 'Rollback',
        adapter: 'sandbox_v1',
        secret: randomBytes(32).toString('base64url'),
      })
    ).toThrow('injected fence');
    expect(
      getDatabase()
        .select()
        .from(externalOrderConnectors)
        .where(eq(externalOrderConnectors.tenantId, h.tenantId))
        .all()
    ).toHaveLength(0);
    expect(
      getDatabase().select().from(auditLogs).where(eq(auditLogs.tenantId, h.tenantId)).all()
    ).toHaveLength(0);
  });
  it('rechecks envelope time under the writer lock', async () => {
    const h = await harness(),
      c = await connector(h),
      envelope = signed(c, created()),
      now = envelope.timestamp;
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(now)
      .mockReturnValue(now + 300_001);
    expect(() => receiveExternalOrder(getDatabase(), envelope)).toThrow('authentication failed');
    expect(orders(h)).toHaveLength(0);
  });
  it('accepts one local-priced parked draft atomically and replays without double stock or payment', async () => {
    const h = await harness(),
      item = seedCheckout(h),
      { row } = await intent(h);
    const quote = await caller(h).externalOrders.quote({ siteId: h.siteId, id: row.id });
    expect(quote).toMatchObject({ total: 10.01, quotedTotal: 4000, amountDiffers: true });
    const input = await acceptance(h, row.id),
      c = caller(h);
    const sale = await c.externalOrders.accept(input);
    expect(sale).toMatchObject({
      status: 'draft',
      total: 10.01,
      paymentStatus: 'pending',
    });
    expect(sale.suspendedAt).not.toBeNull();
    expect(
      getDatabase().select().from(sales).where(eq(sales.id, sale.id)).get()?.resumedBy
    ).toBeNull();
    expect((await c.externalOrders.accept(input)).id).toBe(sale.id);
    expect(stock(item.productId)).toBeCloseTo(6.999, 3);
    expect(orders(h)[0]).toMatchObject({ status: 'accepted', version: 2, saleId: sale.id });
    // The existing draft model records a pending tender plan; the header is
    // authoritative and no cash movement or settled payment is created here.
    expect(
      getDatabase().select().from(sales).where(eq(sales.id, sale.id)).get()?.paymentStatus
    ).toBe('pending');
    expect(
      getDatabase().select().from(cashMovements).where(eq(cashMovements.tenantId, h.tenantId)).all()
    ).toHaveLength(0);
    expect(
      getDatabase().select().from(sales).where(eq(sales.tenantId, h.tenantId)).all()
    ).toHaveLength(1);
    expect(events(h)).toHaveLength(2);
    await expect(caller(h).externalOrders.accept(input)).rejects.toThrow('conflicts');
    await caller(h).sales.resume({ saleId: sale.id });
    await caller(h).sales.completeDraft({
      saleId: sale.id,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 11,
    });
    expect(stock(item.productId)).toBeCloseTo(6.999, 3);
    expect(getDatabase().select().from(sales).where(eq(sales.id, sale.id)).get()?.status).toBe(
      'completed'
    );
  });
  it('rejects stale price review, missing explicit consent and foreign-site acceptance without stock writes', async () => {
    const h = await harness(),
      item = seedCheckout(h),
      { row } = await intent(h),
      input = await acceptance(h, row.id);
    await expect(
      caller(h).externalOrders.accept({ ...input, confirmedLocalPricing: false as true })
    ).rejects.toThrow();
    getDatabase()
      .update(unitXProduct)
      .set({ price: 12 })
      .where(eq(unitXProduct.productId, item.productId))
      .run();
    await expect(caller(h).externalOrders.accept(input)).rejects.toThrow('conflicts');
    expect(stock(item.productId)).toBe(8);
    expect(orders(h)[0]?.status).toBe('received');
    const other = await harness();
    await expect(caller(other).externalOrders.accept(input)).rejects.toThrow();
  });
  it('blocks acceptance after cancellation and blocks checkout after a signed cancellation request', async () => {
    const h = await harness(),
      item = seedCheckout(h),
      { c, event, row } = await intent(h);
    const sale = await caller(h).externalOrders.accept(await acceptance(h, row.id));
    await anonymous(h).externalOrders.receive(
      signed(c, {
        schemaVersion: 1,
        eventId: nanoid(),
        orderId: event.orderId,
        kind: 'order.cancelled',
        reason: 'Cancel please',
      })
    );
    expect(orders(h)[0]).toMatchObject({ status: 'cancel_requested', version: 3, saleId: sale.id });
    expect(stock(item.productId)).toBeCloseTo(6.999, 3);
    await caller(h).sales.resume({ saleId: sale.id });
    await expect(
      caller(h).sales.completeDraft({
        saleId: sale.id,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        amountReceived: 11,
      })
    ).rejects.toThrow('conflicts');
    await expect(
      caller(h).externalOrders.resolveCancellation({
        siteId: h.siteId,
        id: row.id,
        expectedVersion: 3,
        reason: 'Cannot pretend refunded',
      })
    ).rejects.toThrow('conflicts');
    await caller(h).sales.discardDraft({ saleId: sale.id });
    expect(stock(item.productId)).toBe(8);
    expect(orders(h)[0]).toMatchObject({ status: 'cancelled', version: 4 });
    // The existing draft model records a pending tender plan; the header is
    // authoritative and no cash movement or settled payment is created here.
    expect(
      getDatabase().select().from(sales).where(eq(sales.id, sale.id)).get()?.paymentStatus
    ).toBe('pending');
    expect(
      getDatabase().select().from(cashMovements).where(eq(cashMovements.tenantId, h.tenantId)).all()
    ).toHaveLength(0);
    await expect(
      caller(h).externalOrders.accept({
        siteId: h.siteId,
        id: row.id,
        expectedVersion: 4,
        fingerprint: 'a'.repeat(64),
        confirmedLocalPricing: true,
      })
    ).rejects.toThrow('conflicts');
  });
  it('rejects intent exactly once without inventory, then preserves terminal state on source cancellation', async () => {
    const h = await harness(),
      item = seedCheckout(h),
      { c, event, row } = await intent(h),
      client = caller(h);
    const input = {
      siteId: h.siteId,
      id: row.id,
      expectedVersion: 1,
      reason: 'Not available today',
    };
    const result = await client.externalOrders.reject(input);
    expect(await client.externalOrders.reject(input)).toEqual(result);
    await anonymous(h).externalOrders.receive(
      signed(c, {
        schemaVersion: 1,
        eventId: nanoid(),
        orderId: event.orderId,
        kind: 'order.cancelled',
        reason: 'Cancelled upstream',
      })
    );
    expect(orders(h)[0]).toMatchObject({ status: 'rejected', version: 2 });
    expect(stock(item.productId)).toBe(8);
  });
  it('rolls back accepted intent, reserved stock and KDS when sale completion fence fails', async () => {
    const h = await harness(),
      item = seedCheckout(h),
      { row } = await intent(h),
      input = await acceptance(h, row.id);
    const ctx = {
      ...context(h),
      tenantId: h.tenantId,
      siteId: h.siteId,
      user: { id: h.userId, role: 'admin' as const },
      envelope: { operationId: nanoid() },
      completeInTransaction: () => {
        throw new Error('acceptance fence failed');
      },
    };
    await expect(acceptExternalOrder(ctx, input)).rejects.toThrow('acceptance fence failed');
    expect(orders(h)[0]).toMatchObject({ status: 'received', version: 1, saleId: null });
    expect(stock(item.productId)).toBe(8);
    expect(events(h)).toHaveLength(1);
    expect(
      getDatabase().select().from(sales).where(eq(sales.tenantId, h.tenantId)).all()
    ).toHaveLength(0);
    expect(
      getDatabase().select().from(kdsOrders).where(eq(kdsOrders.tenantId, h.tenantId)).all()
    ).toHaveLength(0);
    expect((await caller(h).externalOrders.accept(input)).status).toBe('draft');
  });
  it('keeps cancellation after settlement non-financial and blocks delivery until an explicit full return', async () => {
    const h = await harness(),
      item = seedCheckout(h),
      { c, event, row } = await intent(h);
    const sale = await caller(h).externalOrders.accept(await acceptance(h, row.id));
    await caller(h).sales.resume({ saleId: sale.id });
    await caller(h).sales.completeDraft({
      saleId: sale.id,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 11,
    });
    const movementsBefore = getDatabase()
      .select()
      .from(cashMovements)
      .where(eq(cashMovements.tenantId, h.tenantId))
      .all();
    await anonymous(h).externalOrders.receive(
      signed(c, {
        schemaVersion: 1,
        eventId: nanoid(),
        orderId: event.orderId,
        kind: 'order.cancelled',
        reason: 'Changed my mind',
      })
    );
    expect(stock(item.productId)).toBeCloseTo(6.999, 3);
    expect(
      getDatabase().select().from(cashMovements).where(eq(cashMovements.tenantId, h.tenantId)).all()
    ).toEqual(movementsBefore);
    await expect(
      caller(h).deliveryOrders.createFromSale({
        siteId: h.siteId,
        saleId: sale.id,
        customerName: 'Guest',
        address: 'Destination',
      })
    ).rejects.toThrow('conflicts');
    await expect(
      caller(h).externalOrders.resolveCancellation({
        siteId: h.siteId,
        id: row.id,
        expectedVersion: 3,
        reason: 'Not refunded yet',
      })
    ).rejects.toThrow('conflicts');
    await caller(h).sales.returnSale({ id: sale.id, reason: 'Return after source cancellation' });
    expect(stock(item.productId)).toBe(8);
    expect(
      (
        await caller(h).externalOrders.resolveCancellation({
          siteId: h.siteId,
          id: row.id,
          expectedVersion: 3,
          reason: 'Full refund verified',
        })
      ).status
    ).toBe('cancelled');
    expect(events(h)).toHaveLength(4);
  });
  it('blocks splitting source quantities away from a linked draft', async () => {
    const h = await harness(),
      item = seedCheckout(h),
      c = await connector(h),
      event = created();
    event.order.items.push({ productCode: 'sku-1', quantity: 1 });
    await anonymous(h).externalOrders.receive(signed(c, event));
    const row = orders(h)[0]!,
      sale = await caller(h).externalOrders.accept(await acceptance(h, row.id));
    await expect(
      caller(h).sales.splitDraft({
        sourceSaleId: sale.id,
        saleItemIds: [sale.items[0]!.id],
        tableId: null,
        label: 'Split source',
      })
    ).rejects.toThrow('conflicts');
    expect(
      getDatabase().select().from(sales).where(eq(sales.tenantId, h.tenantId)).all()
    ).toHaveLength(1);
    expect(stock(item.productId)).toBeCloseTo(5.999, 3);
  });
  it('paginates site orders without duplication and retains all immutable event history', async () => {
    const h = await harness(),
      c = await connector(h);
    for (let i = 0; i < 5; i++) await anonymous(h).externalOrders.receive(signed(c, created()));
    const first = await caller(h).externalOrders.list({ siteId: h.siteId, limit: 3 });
    expect(first.hasMore).toBe(true);
    const last = first.rows.at(-1)!;
    const next = await caller(h).externalOrders.list({
      siteId: h.siteId,
      limit: 3,
      cursor: { id: last.id, createdAt: last.createdAt },
    });
    expect(next.hasMore).toBe(false);
    expect(new Set([...first.rows, ...next.rows].map(row => row.id)).size).toBe(5);
    expect(
      (await caller(h).externalOrders.get({ siteId: h.siteId, id: last.id })).events
    ).toHaveLength(1);
  });
});
