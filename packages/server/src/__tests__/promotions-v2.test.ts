/** Promotions v2: NxM (2x1/3x2), fixed_amount, recurring weekday/hour schedules, and checkout. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { categories, products, sites, tenants, unitXProduct, units, users } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import {
  createPromotion,
  isPromotionScheduledAt,
  quotePromotions,
  transitionPromotion,
  type PromotionRuleInput,
} from '../services/promotions.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { legacyComponent } from '../services/tax-components.js';
import { appRouter } from '../trpc/router.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let baseUnitId: string;
let fresh: ReturnType<typeof makeFreshContextFactory>;

function baseRule(overrides: Partial<PromotionRuleInput> = {}): PromotionRuleInput {
  return {
    name: `PromoV2 ${nanoid(6)}`,
    ruleKind: 'percentage',
    discountPct: 10,
    discountAmount: null,
    buyQuantity: null,
    payQuantity: null,
    siteId: null,
    productId: null,
    categoryId: null,
    customerId: null,
    minQuantity: 1,
    startsAt: null,
    endsAt: null,
    scheduleDays: null,
    scheduleStartTime: null,
    scheduleEndTime: null,
    priority: 0,
    combinable: false,
    ...overrides,
  };
}

function activate(overrides: Partial<PromotionRuleInput>) {
  const created = createPromotion(getDatabase(), {
    tenantId,
    actorId: userId,
    rule: baseRule(overrides),
  });
  return transitionPromotion(getDatabase(), {
    tenantId,
    actorId: userId,
    id: created.id,
    version: created.version,
    status: 'active',
  });
}

async function seedProduct(price: number) {
  const db = getDatabase();
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id,
    tenantId,
    name: `Prod ${nanoid(5)}`,
    sku: `PV2-${nanoid(6)}`,
    price,
    cost: Math.round(price * 0.4),
    taxRate: 0,
    taxKind: 'iva',
    tracksStock: false,
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
    price,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

describe('Promotions v2 engine (NxM, fixed_amount, recurring schedule)', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!admin) throw new Error('Expected seeded admin user');
    tenantId = admin.tenantId;
    userId = admin.id;
    await db
      .update(tenants)
      .set({ settings: { timezone: 'America/Bogota', currency: 'COP', priceIncludesTax: true } })
      .where(eq(tenants.id, tenantId))
      .run();
    const site = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!site) throw new Error('Expected seeded site');
    siteId = site.id;
    const baseUnit = (await db.select().from(units).where(eq(units.tenantId, tenantId)).all()).find(
      candidate => candidate.abbreviation === 'UND'
    );
    if (!baseUnit) throw new Error('Expected seeded base unit');
    baseUnitId = baseUnit.id;
    const device = await registerDeviceService(db, {
      tenantId,
      userId,
      kind: 'desktop',
      name: 'Caja PromoV2',
    });
    fresh = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      siteId,
      deviceId: device.deviceId,
      userId,
      email: 'admin@localhost',
      defaultRole: 'admin',
    });
    await appRouter.createCaller(fresh()).cashSessions.open({
      registerName: 'Caja 1',
      openingFloat: 0,
      denominations: [],
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('computes 2x1 and 3x2 NxM discounts across exact and remainder quantities', async () => {
    const product2x1 = await seedProduct(5000);
    const product3x2 = await seedProduct(3000);
    activate({
      name: 'Gaseosa 2x1',
      ruleKind: 'nxm',
      buyQuantity: 2,
      payQuantity: 1,
      minQuantity: 2,
      productId: product2x1,
    });
    activate({
      name: 'Galletas 3x2',
      ruleKind: 'nxm',
      buyQuantity: 3,
      payQuantity: 2,
      minQuantity: 3,
      productId: product3x2,
    });

    const quote = quotePromotions(getDatabase(), {
      tenantId,
      siteId,
      customerId: null,
      priceIncludesTax: true,
      nowIso: '2026-11-26T15:00:00.000Z',
      timezone: 'America/Bogota',
      lines: [
        {
          lineKey: 'fresh:0',
          productId: product2x1,
          categoryId: null,
          quantity: 3,
          normalizedQuantity: 3, // 1 free unit (5000 off of 15000)
          unitPrice: 5000,
          taxComponents: [legacyComponent({ vatRateId: null, taxKind: 'iva', taxRate: 0 })],
          manualDiscountRate: 0,
          tracksLots: false,
        },
        {
          lineKey: 'fresh:1',
          productId: product3x2,
          categoryId: null,
          quantity: 6,
          normalizedQuantity: 6, // 2 free units (6000 off of 18000)
          unitPrice: 3000,
          taxComponents: [legacyComponent({ vatRateId: null, taxKind: 'iva', taxRate: 0 })],
          manualDiscountRate: 0,
          tracksLots: false,
        },
      ],
    });

    expect(quote.lines[0]?.promotionDiscountAmount).toBe(5000);
    expect(quote.lines[0]?.lineTotal).toBe(10000);
    expect(quote.lines[1]?.promotionDiscountAmount).toBe(6000);
    expect(quote.lines[1]?.lineTotal).toBe(12000);
    expect(quote.promotionDiscountAmount).toBe(11000);
  });

  it('computes fixed_amount discounts and caps at remaining line total', async () => {
    const product = await seedProduct(4000);
    activate({
      name: 'Bono $5.000',
      ruleKind: 'fixed_amount',
      discountAmount: 5000,
      productId: product,
    });

    const quoteOne = quotePromotions(getDatabase(), {
      tenantId,
      siteId,
      customerId: null,
      priceIncludesTax: true,
      nowIso: '2026-11-26T15:00:00.000Z',
      timezone: 'America/Bogota',
      lines: [
        {
          lineKey: 'fresh:0',
          productId: product,
          categoryId: null,
          quantity: 1,
          normalizedQuantity: 1,
          unitPrice: 4000,
          taxComponents: [legacyComponent({ vatRateId: null, taxKind: 'iva', taxRate: 0 })],
          manualDiscountRate: 0,
          tracksLots: false,
        },
      ],
    });
    expect(quoteOne.lines[0]?.promotionDiscountAmount).toBe(4000);
    expect(quoteOne.lines[0]?.lineTotal).toBe(0);

    const quoteTwo = quotePromotions(getDatabase(), {
      tenantId,
      siteId,
      customerId: null,
      priceIncludesTax: true,
      nowIso: '2026-11-26T15:00:00.000Z',
      timezone: 'America/Bogota',
      lines: [
        {
          lineKey: 'fresh:0',
          productId: product,
          categoryId: null,
          quantity: 2,
          normalizedQuantity: 2,
          unitPrice: 4000,
          taxComponents: [legacyComponent({ vatRateId: null, taxKind: 'iva', taxRate: 0 })],
          manualDiscountRate: 0,
          tracksLots: false,
        },
      ],
    });
    expect(quoteTwo.lines[0]?.promotionDiscountAmount).toBe(5000);
    expect(quoteTwo.lines[0]?.lineTotal).toBe(3000);
  });

  it('grants a fixed_amount promotion once per sale, split across its lines', async () => {
    const categoryId = nanoid();
    getDatabase()
      .insert(categories)
      .values({ id: categoryId, tenantId, name: `Cat ${nanoid(5)}` })
      .run();
    const productIds = [await seedProduct(3000), await seedProduct(1000), await seedProduct(6000)];
    activate({
      name: 'Bono categoría $1.000',
      ruleKind: 'fixed_amount',
      discountAmount: 1000,
      categoryId,
    });

    const line = (productId: string, index: number, unitPrice: number) => ({
      lineKey: `fresh:${index}`,
      productId,
      categoryId,
      quantity: 1,
      normalizedQuantity: 1,
      unitPrice,
      taxComponents: [legacyComponent({ vatRateId: null, taxKind: 'iva', taxRate: 0 })],
      manualDiscountRate: 0,
      tracksLots: false,
    });
    const quote = quotePromotions(getDatabase(), {
      tenantId,
      siteId,
      customerId: null,
      priceIncludesTax: true,
      nowIso: '2026-11-26T15:00:00.000Z',
      timezone: 'America/Bogota',
      lines: [
        line(productIds[0]!, 0, 3000),
        line(productIds[1]!, 1, 1000),
        line(productIds[2]!, 2, 6000),
      ],
    });

    expect(quote.lines.map(priced => priced.promotionDiscountAmount)).toEqual([300, 100, 600]);
    expect(quote.promotionDiscountAmount).toBe(1000);
  });

  it('evaluates recurring weekday and time windows (normal and overnight) in tenant timezone', () => {
    // 2026-11-25 is Wednesday (weekday 3). 19:30Z = 14:30 America/Bogota (UTC-5).
    const wedAfternoon = '2026-11-25T19:30:00.000Z';
    expect(
      isPromotionScheduledAt(
        { scheduleDays: [3], scheduleStartTime: '14:00', scheduleEndTime: '17:00' },
        wedAfternoon,
        'America/Bogota'
      )
    ).toBe(true);
    expect(
      isPromotionScheduledAt(
        { scheduleDays: [2], scheduleStartTime: '14:00', scheduleEndTime: '17:00' },
        wedAfternoon,
        'America/Bogota'
      )
    ).toBe(false);
    expect(
      isPromotionScheduledAt(
        { scheduleDays: [3], scheduleStartTime: '15:00', scheduleEndTime: '18:00' },
        wedAfternoon,
        'America/Bogota'
      )
    ).toBe(false);

    // Overnight 22:00–02:00 in America/Bogota: 2026-11-26T04:30:00Z = Wed 23:30 Bogota.
    expect(
      isPromotionScheduledAt(
        { scheduleDays: [3], scheduleStartTime: '22:00', scheduleEndTime: '02:00' },
        '2026-11-26T04:30:00.000Z',
        'America/Bogota'
      )
    ).toBe(true);
    // 2026-11-26T06:30:00Z = Thu 01:30 Bogota: still Wednesday's overnight window.
    expect(
      isPromotionScheduledAt(
        { scheduleDays: [3], scheduleStartTime: '22:00', scheduleEndTime: '02:00' },
        '2026-11-26T06:30:00.000Z',
        'America/Bogota'
      )
    ).toBe(true);
    expect(
      isPromotionScheduledAt(
        { scheduleDays: [4], scheduleStartTime: '22:00', scheduleEndTime: '02:00' },
        '2026-11-26T06:30:00.000Z',
        'America/Bogota'
      )
    ).toBe(false);
    // 2026-11-26T08:30:00Z = Thu 03:30 Bogota: outside the window on any day.
    expect(
      isPromotionScheduledAt(
        { scheduleDays: [3], scheduleStartTime: '22:00', scheduleEndTime: '02:00' },
        '2026-11-26T08:30:00.000Z',
        'America/Bogota'
      )
    ).toBe(false);
  });

  it('completes a sale end-to-end with an active 2x1 promotion', async () => {
    const product = await seedProduct(6000);
    activate({
      name: 'Café 2x1 Checkout',
      ruleKind: 'nxm',
      buyQuantity: 2,
      payQuantity: 1,
      minQuantity: 2,
      productId: product,
    });

    const quoteCaller = appRouter.createCaller(fresh());
    const items = [
      { productId: product, unitId: baseUnitId, quantity: 2, unitPrice: 6000, discount: 0 },
    ];
    const quote = await quoteCaller.sales.quotePromotions({
      mode: 'fresh',
      items,
      discountAmount: 0,
    });
    expect(quote.promotionDiscountAmount).toBe(6000);

    const saleCaller = appRouter.createCaller(fresh());
    const sale = await saleCaller.sales.create({
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 6000,
      discountAmount: 0,
      promotionFingerprint: quote.fingerprint,
      items,
    });
    expect(sale.total).toBe(6000);
  });
});
