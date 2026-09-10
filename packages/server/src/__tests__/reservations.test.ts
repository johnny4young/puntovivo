import * as businessClockModule from '../services/pharmacy/business-clock.js';
/** Migrated SQLite reservation scheduling, authorization, replay and atomic service binding. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { hash } from 'argon2';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  inventoryBalances,
  kdsOrders,
  cashSessions,
  companies,
  products,
  restaurantReservations,
  reservationEvents,
  restaurantServices,
  restaurantTables,
  sales,
  sites,
  syncOutbox,
  tenants,
  users,
  units,
  unitXProduct,
  sequentials,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { freshCriticalContext } from './utils/criticalCommandFixture.js';
import { createReservation } from '../application/reservations/commands.js';
import type { CriticalCommandContext } from '../trpc/middleware/commandEnvelope.js';
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
  const tenantId = `rv-tenant-${suffix}`;
  const companyId = `rv-company-${suffix}`;
  const siteId = `rv-site-${suffix}`;
  const adminId = `rv-admin-${suffix}`;

  await db.insert(tenants).values({
    id: tenantId,
    name: `Reservation Tenant ${suffix}`,
    slug: `rv-${suffix}`,
    settings: { modules: { 'dine-in': true } },
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(companies).values({
    id: companyId,
    tenantId,
    name: `Reservation Company ${suffix}`,
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
    name: 'Reservation test',
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

function times(offset = 0) {
  return {
    startsAt: new Date(Date.now() + offset - 60_000).toISOString(),
    endsAt: new Date(Date.now() + offset + 3_600_000).toISOString(),
  };
}
function table(h: Harness, seatCount = 4) {
  const id = nanoid();
  getDatabase()
    .insert(restaurantTables)
    .values({ id, tenantId: h.tenantId, siteId: h.siteId, name: id, seatCount, isActive: true })
    .run();
  return id;
}
function booking(h: Harness, tableId: string | null = null) {
  return {
    siteId: h.siteId,
    tableId,
    guestName: 'Private guest',
    phone: 'Private phone',
    notes: 'Private notes',
    partySize: 2,
    ...times(),
  };
}
function stored(id: string) {
  return getDatabase()
    .select()
    .from(restaurantReservations)
    .where(eq(restaurantReservations.id, id))
    .get()!;
}
function events(id: string) {
  return getDatabase()
    .select()
    .from(reservationEvents)
    .where(eq(reservationEvents.reservationId, id))
    .all();
}
function withRef(
  h: Harness,
  row: { id: string; version: number },
  toStatus: 'arrived' | 'cancelled' | 'no_show',
  reason?: string
) {
  return {
    siteId: h.siteId,
    id: row.id,
    expectedVersion: row.version,
    toStatus,
    ...(reason ? { reason } : {}),
  };
}
function seedCheckout(h: Harness) {
  const db = getDatabase(),
    unitId = nanoid(),
    productId = nanoid();
  db.insert(units)
    .values({ id: unitId, tenantId: h.tenantId, name: 'Portion', abbreviation: 'pt' })
    .run();
  db.insert(products)
    .values({
      id: productId,
      tenantId: h.tenantId,
      sku: productId,
      name: 'Reservation meal',
      price: 10,
      tracksStock: false,
      taxRate: 0,
    })
    .run();
  db.insert(unitXProduct)
    .values({ id: nanoid(), productId, unitId, equivalence: 1, price: 10, isBase: true })
    .run();
  db.insert(cashSessions)
    .values({
      id: nanoid(),
      tenantId: h.tenantId,
      siteId: h.siteId,
      cashierId: h.adminId,
      registerName: 'Reserve',
      status: 'open',
      openingCountDenominations: [],
    })
    .run();
  db.insert(sequentials)
    .values({
      id: nanoid(),
      tenantId: h.tenantId,
      siteId: h.siteId,
      name: 'Reservation sales',
      documentType: 'sale',
      prefix: 'RS-' + h.siteId,
      currentNumber: 1,
      isActive: true,
    })
    .run();
  return { productId, unitId, quantity: 1, unitPrice: 10, discount: 0, taxRate: 0 };
}
describe('Reservations', () => {
  let a: Harness, b: Harness;
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    a = await seedHarness('a');
    b = await seedHarness('b');
  });
  afterAll(async () => {
    await server.close();
  });
  it('creates once, assigns a table, arrives, and cancels with immutable PII-free evidence', async () => {
    const ctx = buildCtx(a),
      input = booking(a);
    const row = await appRouter.createCaller(ctx).reservations.create(input);
    expect(await appRouter.createCaller(ctx).reservations.create(input)).toEqual(row);
    const updated = await caller(a).reservations.update({
      ...input,
      id: row.id,
      expectedVersion: 1,
      tableId: table(a),
    });
    const arrived = await caller(a).reservations.advance(withRef(a, updated, 'arrived'));
    const cancelled = await caller(a).reservations.advance(
      withRef(a, arrived, 'cancelled', 'Guest leaves')
    );
    expect(cancelled).toMatchObject({ status: 'cancelled', version: 4 });
    expect(events(row.id).map(e => e.kind)).toEqual(['created', 'updated', 'arrived', 'cancelled']);
    const audit = getDatabase()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, row.id))
      .all();
    const outbox = getDatabase()
      .select()
      .from(syncOutbox)
      .where(eq(syncOutbox.entityId, row.id))
      .all();
    expect(audit).toHaveLength(4);
    expect(outbox).toHaveLength(4);
    expect(JSON.stringify([audit, outbox, events(row.id)])).not.toContain('Private');
    expect(outbox.every(row => row.status === 'local_only')).toBe(true);
    expect(stored(row.id).serviceId).toBeNull();
  });
  it('rejects overlap but accepts exact back-to-back boundaries, with capacity and site checks', async () => {
    const tableId = table(a),
      input = booking(a, tableId);
    const first = await caller(a).reservations.create(input);
    await expect(caller(a).reservations.create(input)).rejects.toThrow();
    await expect(
      caller(a).reservations.create({
        ...input,
        startsAt: input.endsAt,
        endsAt: new Date(Date.parse(input.endsAt) + 3_600_000).toISOString(),
      })
    ).resolves.toMatchObject({ status: 'booked' });
    await expect(
      caller(a).reservations.update({ ...input, id: first.id, expectedVersion: 1, partySize: 5 })
    ).rejects.toThrow();
    await expect(
      caller(a).reservations.create({ ...booking(a), tableId: table(b) })
    ).rejects.toThrow();
    await expect(caller(a).reservations.get({ id: first.id, siteId: b.siteId })).rejects.toThrow();
    await expect(caller(b).reservations.get({ id: first.id, siteId: b.siteId })).rejects.toThrow();
  });
  it('racing edits and arrivals cannot overwrite a newer version', async () => {
    const input = booking(a, table(a)),
      row = await caller(a).reservations.create(input);
    const results = await Promise.allSettled([
      caller(a).reservations.update({ ...input, id: row.id, expectedVersion: 1, guestName: 'One' }),
      caller(a).reservations.update({ ...input, id: row.id, expectedVersion: 1, guestName: 'Two' }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(events(row.id)).toHaveLength(2);
    const arrived = await caller(a).reservations.advance(
      withRef(a, { ...row, version: 2 }, 'arrived')
    );
    await expect(
      caller(a).reservations.update({ ...input, id: row.id, expectedVersion: arrived.version })
    ).rejects.toThrow();
  });
  it.each(['cancelled', 'no_show'] as const)(
    'makes %s terminal and requires a reason',
    async toStatus => {
      const row = await caller(a).reservations.create(booking(a));
      await expect(caller(a).reservations.advance(withRef(a, row, toStatus))).rejects.toThrow();
      const terminal = await caller(a).reservations.advance(withRef(a, row, toStatus, 'Confirmed'));
      for (const next of ['arrived', 'cancelled', 'no_show'] as const)
        await expect(
          caller(a).reservations.advance(withRef(a, terminal, next, 'Again'))
        ).rejects.toThrow();
      expect(events(row.id)).toHaveLength(2);
    }
  );
  it('rejects premature no-show, missing table arrival, expired booking and unbounded windows', async () => {
    const future = await caller(a).reservations.create({ ...booking(a), ...times(86_400_000) });
    await expect(
      caller(a).reservations.advance(withRef(a, future, 'no_show', 'Not yet'))
    ).rejects.toThrow();
    await expect(caller(a).reservations.advance(withRef(a, future, 'arrived'))).rejects.toThrow();
    await expect(
      caller(a).reservations.create({ ...booking(a), ...times(-86_400_000) })
    ).rejects.toThrow();
    await expect(
      caller(a).reservations.create({
        ...booking(a),
        endsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      })
    ).rejects.toThrow();
  });
  it('normalizes offset timestamps before detecting overlap', async () => {
    const input = booking(a, table(a));
    await caller(a).reservations.create(input);
    const toOffset = (utc: string) =>
      new Date(Date.parse(utc) - 5 * 3_600_000).toISOString().replace('Z', '-05:00');
    await expect(
      caller(a).reservations.create({
        ...input,
        startsAt: toOffset(input.startsAt),
        endsAt: toOffset(input.endsAt),
      })
    ).rejects.toThrow();
  });
  it('checks authorization and module status before cached responses', async () => {
    const ctx = buildCtx(b),
      input = booking(b),
      row = await appRouter.createCaller(ctx).reservations.create(input);
    await expect(
      appRouter
        .createCaller({ ...ctx, user: { ...ctx.user!, role: 'viewer' } })
        .reservations.get({ siteId: b.siteId, id: row.id })
    ).rejects.toThrow();
    getDatabase()
      .update(tenants)
      .set({ settings: { modules: { 'dine-in': false } } })
      .where(eq(tenants.id, b.tenantId))
      .run();
    await expect(appRouter.createCaller(ctx).reservations.create(input)).rejects.toThrow();
    getDatabase()
      .update(tenants)
      .set({ settings: { modules: { 'dine-in': true } } })
      .where(eq(tenants.id, b.tenantId))
      .run();
  });
  it('rolls back reservation/event/audit/outbox when the completion fence fails', () => {
    const projectionCounts = () => [
      getDatabase().select().from(reservationEvents).all().length,
      getDatabase().select().from(auditLogs).all().length,
      getDatabase().select().from(syncOutbox).all().length,
    ];
    const beforeCounts = projectionCounts();
    const ctx = buildCtx(a),
      input = booking(a),
      count = getDatabase().select().from(restaurantReservations).all().length;
    expect(() =>
      createReservation(
        {
          ...ctx,
          deviceId: a.deviceId,
          envelope: { operationId: nanoid(), idempotencyKey: nanoid() },
          completeInTransaction: () => {
            throw new Error('fence');
          },
        } as CriticalCommandContext,
        input
      )
    ).toThrow('fence');
    expect(getDatabase().select().from(restaurantReservations).all()).toHaveLength(count);
    expect(projectionCounts()).toEqual(beforeCounts);
  });
  it('binds the arrived party to the first real check atomically and does not consume it twice', async () => {
    const item = seedCheckout(a),
      tableId = table(a),
      input = booking(a, tableId);
    const row = await caller(a).reservations.create(input);
    await expect(
      caller(a).restaurantServices.openCheck({ tableId, guestCount: 2, items: [item] })
    ).rejects.toThrow();
    const arrived = await caller(a).reservations.advance(withRef(a, row, 'arrived'));
    await expect(
      caller(a).restaurantServices.openCheck({
        tableId,
        guestCount: 1,
        reservation: { id: row.id, expectedVersion: 2 },
        items: [item],
      })
    ).rejects.toThrow();
    const ctx = buildCtx(a),
      checkInput = {
        tableId,
        guestCount: 2,
        reservation: { id: row.id, expectedVersion: arrived.version },
        items: [item],
      };
    const sale = await appRouter.createCaller(ctx).restaurantServices.openCheck(checkInput);
    expect(
      await appRouter.createCaller(ctx).restaurantServices.openCheck(checkInput)
    ).toMatchObject({ id: sale.id });
    const seated = stored(row.id);
    expect(seated).toMatchObject({ status: 'seated', version: 3 });
    expect(seated.serviceId).toBeTruthy();
    expect(events(row.id).map(e => e.kind)).toEqual(['created', 'arrived', 'seated']);
    await expect(caller(a).restaurantServices.openCheck(checkInput)).rejects.toThrow();
    expect(
      getDatabase()
        .select()
        .from(sales)
        .where(and(eq(sales.tenantId, a.tenantId), eq(sales.tableId, tableId)))
        .all()
    ).toHaveLength(1);
    await expect(
      caller(a).reservations.advance(
        withRef(a, { ...row, version: 3 }, 'cancelled', 'Cannot cancel service here')
      )
    ).rejects.toThrow();
    // A later booking is permitted, but arrival cannot displace an occupied party.
    const next = await caller(a).reservations.create({ ...input, ...times(7_200_000) });
    await expect(caller(a).reservations.advance(withRef(a, next, 'arrived'))).rejects.toThrow();
    expect(
      getDatabase()
        .select()
        .from(restaurantServices)
        .where(eq(restaurantServices.id, seated.serviceId!))
        .get()?.status
    ).toBe('open');
  });
  it('rejects legacy table creation before any sale, inventory or kitchen effect', async () => {
    const h = await seedHarness('legacy'),
      item = seedCheckout(h),
      tableId = table(h),
      db = getDatabase();
    db.update(products).set({ tracksStock: true }).where(eq(products.id, item.productId)).run();
    db.insert(inventoryBalances)
      .values({
        id: nanoid(),
        tenantId: h.tenantId,
        siteId: h.siteId,
        productId: item.productId,
        onHand: 10,
        reserved: 0,
      })
      .run();
    db.update(tenants)
      .set({ settings: { modules: { 'dine-in': true, kds: true } } })
      .where(eq(tenants.id, h.tenantId))
      .run();
    const row = await caller(h).reservations.create(booking(h, tableId));
    const stock = () =>
      db
        .select()
        .from(inventoryBalances)
        .where(eq(inventoryBalances.productId, item.productId))
        .get();
    const before = stock();
    for (const phase of ['booked', 'arrived']) {
      if (phase === 'arrived') await caller(h).reservations.advance(withRef(h, row, 'arrived'));
      for (const status of ['draft', 'completed'] as const)
        await expect(
          caller(h).sales.create({
            tableId,
            items: [item],
            status,
            paymentMethod: 'cash',
            paymentStatus: status === 'draft' ? 'pending' : 'paid',
            amountReceived: 10,
          })
        ).rejects.toThrow();
    }
    expect(stock()).toEqual(before);
    expect(db.select().from(sales).where(eq(sales.tenantId, h.tenantId)).all()).toEqual([]);
    expect(db.select().from(kdsOrders).where(eq(kdsOrders.tenantId, h.tenantId)).all()).toEqual([]);
  });
  it('checks current holds after preflight rather than using the frozen sale timestamp', async () => {
    const h = await seedHarness('clock'),
      item = seedCheckout(h),
      tableId = table(h);
    const bookingInput = booking(h, tableId);
    await caller(h).reservations.create(bookingInput);
    const original = businessClockModule.resolveTenantBusinessClock;
    const spy = vi
      .spyOn(businessClockModule, 'resolveTenantBusinessClock')
      .mockImplementationOnce(async (db, tenantId) => {
        const value = await original(db, tenantId);
        return {
          ...value,
          nowIso: new Date(Date.parse(bookingInput.startsAt) - 60_000).toISOString(),
        };
      });
    try {
      await expect(
        caller(h).restaurantServices.openCheck({ tableId, guestCount: 2, items: [item] })
      ).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(getDatabase().select().from(sales).where(eq(sales.tenantId, h.tenantId)).all()).toEqual(
      []
    );
  });
  it('retains outstanding arrivals outside the selected day and exposes only minimal table metadata', async () => {
    const tableId = table(a),
      row = await caller(a).reservations.create(booking(a, tableId));
    await caller(a).reservations.advance(withRef(a, row, 'arrived'));
    const oldStart = new Date(Date.now() - 3 * 86_400_000).toISOString(),
      oldEnd = new Date(Date.now() - 2 * 86_400_000).toISOString();
    getDatabase()
      .update(restaurantReservations)
      .set({ startsAt: oldStart, endsAt: oldEnd })
      .where(eq(restaurantReservations.id, row.id))
      .run();
    const list = await caller(a).reservations.list({
      siteId: a.siteId,
      from: new Date(Date.now() - 1_000).toISOString(),
      to: new Date(Date.now() + 1_000).toISOString(),
    });
    expect(list.rows.some(r => r.id === row.id)).toBe(true);
    const state = await caller(a).restaurantServices.getTableState({ tableId });
    expect(state.reservation).toEqual({
      id: row.id,
      version: 2,
      guestName: 'Private guest',
      partySize: 2,
    });
    expect(state.reservation).not.toHaveProperty('phone');
    const detail = await caller(a).reservations.get({ siteId: a.siteId, id: row.id });
    expect(detail.events.map(e => e.version)).toEqual([2, 1]);
    const ended = await caller(a).reservations.advance(
      withRef(a, { id: row.id, version: 2 }, 'cancelled', 'Expired arrival resolved')
    );
    expect(ended.status).toBe('cancelled');
  });
  it('blocks an inactive site and lets a cashier host without granting viewer access', async () => {
    const h = await seedHarness('cashier'),
      ctx = buildCtx(h);
    const cashier = appRouter.createCaller({ ...ctx, user: { ...ctx.user!, role: 'cashier' } });
    const row = await cashier.reservations.create(booking(h));
    expect(row.status).toBe('booked');
    getDatabase().update(sites).set({ isActive: false }).where(eq(sites.id, h.siteId)).run();
    await expect(caller(h).reservations.get({ siteId: h.siteId, id: row.id })).rejects.toThrow();
    await expect(caller(h).reservations.create(booking(h))).rejects.toThrow();
  });
  it('lists bounded ordered pages scoped to tenant and site', async () => {
    const first = await caller(a).reservations.list({
      siteId: a.siteId,
      from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date(Date.now() + 4 * 86_400_000).toISOString(),
      limit: 2,
    });
    expect(first.rows).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    const last = first.rows.at(-1)!;
    const second = await caller(a).reservations.list({
      siteId: a.siteId,
      from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date(Date.now() + 4 * 86_400_000).toISOString(),
      limit: 2,
      cursor: { id: last.id, startsAt: last.startsAt },
    });
    expect(
      second.rows.every(
        row => row.tenantId === a.tenantId && !first.rows.some(p => p.id === row.id)
      )
    ).toBe(true);
  });
});
