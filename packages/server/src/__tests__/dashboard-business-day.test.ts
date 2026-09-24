import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  cashSessions,
  products,
  saleItems,
  saleReturnItems,
  saleReturns,
  sales,
  tenantLocaleSettings,
  tenants,
  users,
} from '../db/schema.js';
import { dailyDatedRevenueSql } from '../services/reports/net-sales.js';
import { appRouter } from '../trpc/router.js';
import { seedCommittedSaleSession } from './utils/cashSessionFixture.js';
import { createCriticalCommandFixture } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;

beforeEach(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-22T02:00:00.000Z'));
});

afterEach(async () => {
  vi.useRealTimers();
  await server.close();
});

async function createTenant(timezone: string | null) {
  const db = getDatabase();
  const tenantId = nanoid();
  const userId = nanoid();
  const email = `${userId}@dashboard.test`;
  await db.insert(tenants).values({ id: tenantId, name: tenantId, slug: tenantId });
  await db.insert(users).values({
    id: userId,
    tenantId,
    email,
    name: 'Dashboard reader',
    role: 'admin',
    passwordHash: 'unused-direct-caller-fixture',
  });
  if (timezone !== null) {
    await db
      .insert(tenantLocaleSettings)
      .values({ tenantId, countryCode: 'CO', timezoneOverride: timezone });
  }
  const cashSessionId = await seedCommittedSaleSession({ tenantId, cashierId: userId });
  const session = await db
    .select()
    .from(cashSessions)
    .where(eq(cashSessions.id, cashSessionId))
    .get();
  if (!session) throw new Error('Expected historical cash session');
  const productId = nanoid();
  await db.insert(products).values({
    id: productId,
    tenantId,
    name: 'Calendar product',
    sku: productId,
    price: 100,
    cost: 0,
    taxRate: 0,
    minStock: 0,
  });
  const { context } = await createCriticalCommandFixture({
    db,
    serverApp: server.app,
    tenantId,
    userId,
    email,
    role: 'admin',
    siteId: session.siteId,
  });
  return {
    tenantId,
    userId,
    productId,
    cashSessionId,
    siteId: session.siteId,
    caller: appRouter.createCaller(context),
  };
}

/** Independent tenant, historical drawer and product used by calendar-boundary fixtures. */
type Fixture = Awaited<ReturnType<typeof createTenant>>;

async function addSale(
  fixture: Fixture,
  instant: string,
  total: number,
  options: {
    createdAt?: string;
    legacy?: boolean;
    status?: 'completed' | 'draft' | 'cancelled';
  } = {}
) {
  const db = getDatabase();
  const id = nanoid();
  const itemId = nanoid();
  await db.insert(sales).values({
    id,
    tenantId: fixture.tenantId,
    saleNumber: id,
    subtotal: total,
    total,
    taxAmount: 0,
    discountAmount: 0,
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: options.status ?? 'completed',
    cashSessionId: fixture.cashSessionId,
    createdBy: fixture.userId,
    checkoutCompletedAt: options.legacy ? null : instant,
    createdAt: options.createdAt ?? instant,
    updatedAt: instant,
  });
  await db.insert(saleItems).values({
    id: itemId,
    saleId: id,
    productId: fixture.productId,
    quantity: 1,
    unitPrice: total,
    total,
    costAtSale: 0,
    discount: 0,
    taxRate: 0,
    taxAmount: 0,
  });
  return { id, itemId, total };
}

async function addReturn(
  fixture: Fixture,
  sale: Awaited<ReturnType<typeof addSale>>,
  instant: string,
  amount: number
) {
  const db = getDatabase();
  const id = nanoid();
  await db.insert(saleReturns).values({
    id,
    tenantId: fixture.tenantId,
    saleId: sale.id,
    destination: 'original',
    subtotal: amount,
    refundAmount: amount,
    currencyCode: 'COP',
    tipAmount: 0,
    serviceChargeAmount: 0,
    discountAmount: 0,
    taxAmount: 0,
    createdBy: fixture.userId,
    createdAt: instant,
  });
  await db.insert(saleReturnItems).values({
    id: nanoid(),
    tenantId: fixture.tenantId,
    saleReturnId: id,
    saleItemId: sale.itemId,
    productId: fixture.productId,
    productNameSnapshot: 'Calendar product',
    productSkuSnapshot: fixture.productId,
    quantity: amount / sale.total,
    baseQuantity: amount / sale.total,
    unitPrice: sale.total,
    unitEquivalence: 1,
    discountRate: 0,
    taxKind: 'iva',
    taxRate: 0,
    subtotal: amount,
    discountAmount: 0,
    taxAmount: 0,
    total: amount,
    costAmount: 0,
    currencyCode: 'COP',
    createdAt: instant,
  });
}

describe('dashboard tenant calendar days', () => {
  it.each([
    [
      'America/Bogota',
      '2026-09-22T02:00:00.000Z',
      '2026-09-21',
      '2026-09-21T05:00:00.000Z',
      '2026-09-22T05:00:00.000Z',
    ],
    [
      'America/New_York',
      '2026-03-08T16:00:00.000Z',
      '2026-03-08',
      '2026-03-08T05:00:00.000Z',
      '2026-03-09T04:00:00.000Z',
    ],
    [
      'America/New_York',
      '2026-11-01T17:00:00.000Z',
      '2026-11-01',
      '2026-11-01T04:00:00.000Z',
      '2026-11-02T05:00:00.000Z',
    ],
    [
      'America/Santiago',
      '2026-09-06T16:00:00.000Z',
      '2026-09-06',
      '2026-09-06T04:00:00.000Z',
      '2026-09-07T03:00:00.000Z',
    ],
    [
      'Asia/Tokyo',
      '2026-09-21T16:00:00.000Z',
      '2026-09-22',
      '2026-09-21T15:00:00.000Z',
      '2026-09-22T15:00:00.000Z',
    ],
  ])('uses half-open boundaries in %s at %s', async (zone, now, day, start, end) => {
    vi.setSystemTime(new Date(now));
    const fixture = await createTenant(zone);
    await addSale(fixture, new Date(Date.parse(start) - 1).toISOString(), 10);
    await addSale(fixture, start, 20);
    await addSale(fixture, new Date(Date.parse(end) - 1).toISOString(), 30);
    await addSale(fixture, end, 40);

    const result = await fixture.caller.dashboard.summary();
    expect(result.revenueChart).toHaveLength(30);
    expect(result.revenueChart.at(-1)).toEqual({ date: day, revenue: 50, orders: 2 });
    expect(result.stats.todayRevenue.value).toBe(50);
    expect(result.stats.todayOrders.value).toBe(2);
    expect(result.stats.revenueThirtyDays.value).toBe(60);
    expect(result.revenueChart.at(-2)?.revenue).toBe(10);
    expect(
      result.revenueChart.slice(0, -2).every(point => point.revenue === 0 && point.orders === 0)
    ).toBe(true);
    expect(result.topProducts).toHaveLength(1);
    expect(result.topProducts[0]).toMatchObject({
      productId: fixture.productId,
      sales: 3,
      revenue: 60,
    });
  });

  it('books refunds on their local booking day without restating the old sale', async () => {
    const fixture = await createTenant('America/Bogota');
    const oldSale = await addSale(fixture, '2026-08-01T16:00:00.000Z', 100);
    await addReturn(fixture, oldSale, '2026-09-21T04:59:59.999Z', 4);
    await addReturn(fixture, oldSale, '2026-09-21T05:00:00.000Z', 5);
    await addReturn(fixture, oldSale, '2026-09-22T04:59:59.999Z', 6);
    await addReturn(fixture, oldSale, '2026-09-22T05:00:00.000Z', 7);
    const result = await fixture.caller.dashboard.summary();
    expect(result.stats.todayRevenue.value).toBe(-11);
    expect(result.stats.todayOrders.value).toBe(0);
    expect(result.revenueChart.at(-1)).toEqual({ date: '2026-09-21', revenue: -11, orders: 0 });
    expect(result.revenueChart.at(-2)?.revenue).toBe(-4);
    expect(result.stats.revenueThirtyDays.value).toBe(-15);
    expect(result.topProducts).toEqual([]);
  });

  it('uses completion time, retains legacy timestamps and excludes draft/cancelled sales', async () => {
    const fixture = await createTenant('America/Bogota');
    await addSale(fixture, '2026-09-22T01:00:00.000Z', 10, {
      createdAt: '2026-08-01T16:00:00.000Z',
    });
    await addSale(fixture, '2026-09-21T15:00:00.000Z', 20, { legacy: true });
    await addSale(fixture, '2026-09-21T15:00:00.000Z', 30, { status: 'draft' });
    await addSale(fixture, '2026-09-21T15:00:00.000Z', 40, { status: 'cancelled' });
    const result = await fixture.caller.dashboard.summary();
    expect(result.stats.todayRevenue.value).toBe(30);
    expect(result.stats.todayOrders.value).toBe(2);
    expect(result.revenueChart.at(-1)).toEqual({ date: '2026-09-21', revenue: 30, orders: 2 });
    expect(result.recentSales).toHaveLength(2);
    expect(result.recentSales[0]?.createdAt).toBe('2026-09-22T01:00:00.000Z');
  });

  it('isolates tenants with different local days at the same instant', async () => {
    const bogota = await createTenant('America/Bogota');
    const tokyo = await createTenant('Asia/Tokyo');
    await addSale(bogota, '2026-09-21T16:00:00.000Z', 25);
    await addSale(tokyo, '2026-09-21T16:00:00.000Z', 700);
    const a = await bogota.caller.dashboard.summary();
    const b = await tokyo.caller.dashboard.summary();
    expect(a.revenueChart.at(-1)).toEqual({ date: '2026-09-21', revenue: 25, orders: 1 });
    expect(b.revenueChart.at(-1)).toEqual({ date: '2026-09-22', revenue: 700, orders: 1 });
    expect(a.topProducts.map(item => item.productId)).toEqual([bogota.productId]);
    expect(b.topProducts.map(item => item.productId)).toEqual([tokyo.productId]);
  });

  it('bounds the rolling thirty and seven calendar days independently', async () => {
    const fixture = await createTenant('America/Bogota');
    await addSale(fixture, '2026-08-23T04:59:59.999Z', 100);
    await addSale(fixture, '2026-08-23T05:00:00.000Z', 20);
    await addSale(fixture, '2026-09-15T04:59:59.999Z', 30);
    await addSale(fixture, '2026-09-15T05:00:00.000Z', 40);
    const result = await fixture.caller.dashboard.summary();
    expect(result.revenueChart[0]).toEqual({ date: '2026-08-23', revenue: 20, orders: 1 });
    expect(result.stats.revenueThirtyDays.value).toBe(90);
    expect(result.stats.todayRevenue.value).toBe(0);
    expect(result.topProducts[0]).toMatchObject({
      productId: fixture.productId,
      sales: 1,
      revenue: 40,
    });
  });

  it('keeps fully returned orders excluded without removing either dated money event', async () => {
    const fixture = await createTenant('America/Bogota');
    const sale = await addSale(fixture, '2026-09-21T15:00:00.000Z', 100);
    await addReturn(fixture, sale, '2026-09-21T16:00:00.000Z', 100);
    await getDatabase().update(sales).set({ returnState: 'refunded' }).where(eq(sales.id, sale.id));
    const result = await fixture.caller.dashboard.summary();
    expect(result.revenueChart.at(-1)).toEqual({ date: '2026-09-21', revenue: 0, orders: 0 });
    expect(result.stats.todayRevenue.value).toBe(0);
    expect(result.stats.todayOrders.value).toBe(0);
    expect(result.recentSales).toEqual([]);
    expect(result.topProducts).toEqual([]);
  });

  it('inherits the country timezone when there is no explicit override', async () => {
    const fixture = await createTenant('Asia/Tokyo');
    await getDatabase()
      .update(tenantLocaleSettings)
      .set({ timezoneOverride: null })
      .where(eq(tenantLocaleSettings.tenantId, fixture.tenantId));
    await addSale(fixture, '2026-09-21T16:00:00.000Z', 25);
    const result = await fixture.caller.dashboard.summary();
    expect(result.revenueChart.at(-1)).toEqual({ date: '2026-09-21', revenue: 25, orders: 1 });
  });

  it('rejects an empty internal day-window request rather than emitting invalid SQL', () => {
    expect(() => dailyDatedRevenueSql('tenant', [])).toThrow('at least one calendar day');
  });

  it('uses the existing unconfigured-tenant timezone fallback', async () => {
    const fixture = await createTenant(null);
    await addSale(fixture, '2026-09-21T16:00:00.000Z', 25);
    const result = await fixture.caller.dashboard.summary();
    expect(result.revenueChart.at(-1)).toEqual({ date: '2026-09-21', revenue: 25, orders: 1 });
    expect(result.stats.todayRevenue.value).toBe(25);
  });
});

describe('dashboard timezone configuration boundary', () => {
  it.each(['America/Bogotta', '+05:00'])(
    'rejects invalid override %s without changing persisted settings',
    async timezoneOverride => {
      const fixture = await createTenant('America/Bogota');
      const db = getDatabase();
      const before = await db
        .select()
        .from(tenantLocaleSettings)
        .where(eq(tenantLocaleSettings.tenantId, fixture.tenantId))
        .get();
      await expect(
        fixture.caller.tenantLocale.update({ countryCode: 'CO', timezoneOverride })
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        cause: { errorCode: 'TENANT_TIMEZONE_INVALID' },
      });
      expect(
        await db
          .select()
          .from(tenantLocaleSettings)
          .where(eq(tenantLocaleSettings.tenantId, fixture.tenantId))
          .get()
      ).toEqual(before);
      await expect(fixture.caller.dashboard.summary()).resolves.toMatchObject({
        revenueChart: expect.any(Array),
      });
    }
  );

  it('fails closed for legacy invalid configuration and recovers after clearing the override', async () => {
    const fixture = await createTenant('America/Bogotta');
    await expect(fixture.caller.dashboard.summary()).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      cause: { errorCode: 'TENANT_TIMEZONE_INVALID' },
    });
    await fixture.caller.tenantLocale.update({ countryCode: 'CO', timezoneOverride: null });
    const summary = await fixture.caller.dashboard.summary();
    expect(summary.revenueChart.at(-1)?.date).toBe('2026-09-21');
  });

  it.each(['UTC', 'America/Bogota', 'US/Eastern'])(
    'accepts supported timezone %s',
    async timezoneOverride => {
      const fixture = await createTenant(null);
      await fixture.caller.tenantLocale.update({ countryCode: 'CO', timezoneOverride });
      expect((await fixture.caller.tenantLocale.get()).timezone).toBe(timezoneOverride);
      await expect(fixture.caller.dashboard.summary()).resolves.toMatchObject({
        revenueChart: expect.any(Array),
      });
    }
  );

  it('does not subtract next-day refunds from a positive top product', async () => {
    const fixture = await createTenant('America/Bogota');
    const sale = await addSale(fixture, '2026-09-21T18:00:00.000Z', 100);
    await addReturn(fixture, sale, '2026-09-22T05:00:00.000Z', 20);
    const summary = await fixture.caller.dashboard.summary();
    expect(summary.topProducts).toEqual([
      expect.objectContaining({ productId: fixture.productId, revenue: 100, sales: 1 }),
    ]);
    expect(summary.stats.todayRevenue.value).toBe(100);
  });
});
