/** Promotion lifecycle, targeting, checkout pricing and frozen evidence. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  categories,
  customers,
  inventoryBalances,
  inventoryLots,
  priceSuggestions,
  products,
  promotions,
  saleItemPromotions,
  saleItems,
  sites,
  syncOutbox,
  tenants,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import {
  createPromotion,
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
let customerId: string;
let fresh: ReturnType<typeof makeFreshContextFactory>;

const NOW = '2026-09-01T12:00:00.000Z';

function rule(overrides: Partial<PromotionRuleInput> = {}): PromotionRuleInput {
  return {
    name: `Promo ${nanoid(6)}`,
    discountPct: 10,
    siteId: null,
    productId: null,
    categoryId: null,
    customerId: null,
    minQuantity: 1,
    startsAt: null,
    endsAt: null,
    priority: 0,
    combinable: false,
    ...overrides,
  };
}

function createActivePromotion(overrides: Partial<PromotionRuleInput> = {}) {
  const created = createPromotion(getDatabase(), {
    tenantId,
    actorId: userId,
    rule: rule(overrides),
  });
  return transitionPromotion(getDatabase(), {
    tenantId,
    actorId: userId,
    id: created.id,
    version: created.version,
    status: 'active',
  });
}

async function seedCategory(name: string) {
  const id = nanoid();
  const now = new Date().toISOString();
  await getDatabase().insert(categories).values({
    id,
    tenantId,
    name,
    parentId: null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function seedProduct(args: {
  name: string;
  categoryId?: string | null;
  tracksLots?: boolean;
  stock?: number;
}) {
  const db = getDatabase();
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id,
    tenantId,
    name: args.name,
    sku: `PROMO-${nanoid(7)}`,
    categoryId: args.categoryId ?? null,
    price: 100,
    cost: 40,
    tracksLots: args.tracksLots ?? false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(unitXProduct).values({
    id: nanoid(),
    productId: id,
    unitId: baseUnitId,
    equivalence: 1,
    price: 100,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(inventoryBalances).values({
    id: nanoid(),
    tenantId,
    siteId,
    productId: id,
    onHand: args.stock ?? 100,
    reserved: 0,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

function quoteLine(args: {
  lineKey?: string;
  productId: string;
  categoryId?: string | null;
  quantity?: number;
  manualDiscountRate?: number;
  tracksLots?: boolean;
}) {
  const quantity = args.quantity ?? 1;
  return {
    lineKey: args.lineKey ?? `line-${nanoid(6)}`,
    productId: args.productId,
    categoryId: args.categoryId ?? null,
    quantity,
    normalizedQuantity: quantity,
    unitPrice: 100,
    manualDiscountRate: args.manualDiscountRate ?? 0,
    taxComponents: [legacyComponent({ vatRateId: null, taxKind: 'none', taxRate: 0 })],
    tracksLots: args.tracksLots ?? false,
  };
}

describe('promotions', () => {
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
    const baseUnit = (await db.select().from(units).where(eq(units.tenantId, tenantId)).all()).find(
      candidate => candidate.abbreviation === 'UND'
    );
    if (!baseUnit) throw new Error('Expected seeded base unit');
    baseUnitId = baseUnit.id;
    customerId = nanoid();
    const now = new Date().toISOString();
    await db.insert(customers).values({
      id: customerId,
      tenantId,
      name: 'Cliente Promociones',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const registration = await registerDeviceService(db, {
      tenantId,
      userId,
      kind: 'web',
      name: 'promotions.test',
    });
    fresh = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      userId,
      email: 'admin@localhost',
      siteId,
      deviceId: registration.deviceId,
      defaultRole: 'admin',
    });
    await appRouter.createCaller(fresh()).cashSessions.open({
      registerName: 'promotion register',
      openingFloat: 0,
      denominations: [],
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('owns an audited, versioned lifecycle and rejects stale or forbidden mutations', async () => {
    const productId = await seedProduct({ name: 'Lifecycle target' });
    const caller = appRouter.createCaller(fresh({ role: 'manager' }));
    const created = await caller.promotions.create({
      name: 'Oferta de ciclo',
      discountPct: 12.5,
      productId,
      minQuantity: 2,
      priority: 10,
      combinable: false,
      // Same instant through different offsets. Persistence must canonicalize
      // both before SQLite applies lexical window comparisons.
      startsAt: '2026-09-01T07:00:00-05:00',
      endsAt: '2026-09-02T07:00:00-05:00',
    });
    expect(created).toMatchObject({
      status: 'draft',
      version: 1,
      startsAt: '2026-09-01T12:00:00.000Z',
      endsAt: '2026-09-02T12:00:00.000Z',
    });

    const updated = await caller.promotions.update({
      id: created.id,
      version: created.version,
      name: 'Oferta de ciclo actualizada',
      discountPct: 15,
      productId,
      minQuantity: 2,
      priority: 10,
      combinable: false,
      startsAt: null,
      endsAt: null,
      siteId: null,
      categoryId: null,
      customerId: null,
    });
    expect(updated.version).toBe(2);
    await expect(
      caller.promotions.update({
        id: created.id,
        version: 1,
        name: 'Escritura obsoleta',
        discountPct: 20,
        productId,
        minQuantity: 1,
        priority: 0,
        combinable: false,
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const active = await caller.promotions.transition({
      id: updated.id,
      version: updated.version,
      status: 'active',
    });
    expect(active).toMatchObject({ status: 'active', version: 3 });
    await expect(
      caller.promotions.update({
        id: active.id,
        version: active.version,
        name: 'No editable activa',
        discountPct: 30,
        productId,
        minQuantity: 1,
        priority: 0,
        combinable: false,
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const listed = await caller.promotions.list({ page: 1, perPage: 25, status: 'active' });
    expect(listed.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: active.id, productName: 'Lifecycle target' }),
      ])
    );
    await expect(
      appRouter.createCaller(fresh({ role: 'cashier' })).promotions.list({ page: 1, perPage: 10 })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const auditActions = getDatabase()
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.resourceId, active.id)))
      .all()
      .map(row => row.action);
    expect(auditActions).toEqual(
      expect.arrayContaining(['promotion.create', 'promotion.update', 'promotion.status_changed'])
    );
    const syncRows = getDatabase()
      .select()
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          eq(syncOutbox.entityType, 'promotions'),
          eq(syncOutbox.entityId, active.id)
        )
      )
      .all();
    expect(syncRows).toHaveLength(3);
  });

  it('applies product, category, site, customer, quantity and window targets deterministically', async () => {
    const categoryId = await seedCategory('Target category');
    const productId = await seedProduct({ name: 'Target product', categoryId });
    createActivePromotion({
      name: 'Producto vigente',
      productId,
      discountPct: 10,
      priority: 100,
      combinable: true,
      minQuantity: 2,
      startsAt: '2026-08-31T12:00:00.000Z',
      endsAt: '2026-09-02T12:00:00.000Z',
    });
    createActivePromotion({
      name: 'Categoría cliente sede',
      categoryId,
      customerId,
      siteId,
      discountPct: 20,
      priority: 90,
      combinable: true,
    });
    createActivePromotion({
      name: 'Todavía no inicia',
      productId,
      discountPct: 99,
      priority: 1_000,
      startsAt: '2026-09-02T12:00:00.000Z',
    });
    createActivePromotion({
      name: 'Ya terminó',
      productId,
      discountPct: 99,
      priority: 1_000,
      endsAt: '2026-09-01T11:59:59.999Z',
    });

    const quote = quotePromotions(getDatabase(), {
      tenantId,
      siteId,
      customerId,
      lines: [quoteLine({ productId, categoryId, quantity: 2 })],
      priceIncludesTax: false,
      nowIso: NOW,
    });
    expect(quote.lines[0]).toMatchObject({
      lineTotal: 144,
      promotionDiscountAmount: 56,
      effectiveDiscountRate: 28,
    });
    expect(quote.lines[0]!.promotions.map(item => item.name)).toEqual([
      'Producto vigente',
      'Categoría cliente sede',
    ]);

    const wrongCustomer = quotePromotions(getDatabase(), {
      tenantId,
      siteId,
      customerId: null,
      lines: [quoteLine({ productId, categoryId, quantity: 2 })],
      priceIncludesTax: false,
      nowIso: NOW,
    });
    expect(wrongCustomer.lines[0]!.promotions.map(item => item.name)).toEqual(['Producto vigente']);
    const underMinimum = quotePromotions(getDatabase(), {
      tenantId,
      siteId,
      customerId,
      lines: [quoteLine({ productId, categoryId, quantity: 1 })],
      priceIncludesTax: false,
      nowIso: NOW,
    });
    expect(underMinimum.lines[0]!.promotions.map(item => item.name)).toEqual([
      'Categoría cliente sede',
    ]);
  });

  it('gives a higher-priority exclusive rule precedence and applies manual discount first', async () => {
    const productId = await seedProduct({ name: 'Precedence product' });
    createActivePromotion({
      name: 'Combinable 10',
      productId,
      discountPct: 10,
      priority: 100,
      combinable: true,
    });
    createActivePromotion({
      name: 'Exclusive 25',
      productId,
      discountPct: 25,
      priority: 200,
      combinable: false,
    });
    createActivePromotion({
      name: 'Combinable 50 lower',
      productId,
      discountPct: 50,
      priority: 50,
      combinable: true,
    });

    const quote = quotePromotions(getDatabase(), {
      tenantId,
      siteId,
      customerId: null,
      lines: [quoteLine({ productId, manualDiscountRate: 10 })],
      priceIncludesTax: false,
      nowIso: NOW,
    });
    expect(quote.lines[0]!.promotions).toHaveLength(1);
    expect(quote.lines[0]!.promotions[0]).toMatchObject({
      name: 'Exclusive 25',
      discountAmount: 22.5,
    });
    expect(quote.lines[0]).toMatchObject({
      manualDiscountRate: 10,
      effectiveDiscountRate: 32.5,
      lineTotal: 67.5,
    });
  });

  it('keeps duplicate cart lines positional and freezes the accepted rule snapshot', async () => {
    const productId = await seedProduct({ name: 'Snapshot product' });
    const active = createActivePromotion({
      name: 'Snapshot 10',
      productId,
      discountPct: 10,
      priority: 10,
    });
    const caller = appRouter.createCaller(fresh());
    const items = [
      { productId, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 0 },
      { productId, unitId: baseUnitId, quantity: 2, unitPrice: 100, discount: 0 },
    ];
    const quote = await caller.sales.quotePromotions({
      mode: 'fresh',
      customerId,
      items,
      discountAmount: 0,
    });
    expect(quote.lines.map(line => line.lineKey)).toEqual(['fresh:0', 'fresh:1']);
    expect(quote.total).toBe(270);

    const completed = await caller.sales.create({
      customerId,
      items,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: quote.total,
      discountAmount: 0,
      promotionFingerprint: quote.fingerprint,
    });
    expect(completed.total).toBe(270);
    const lineRows = getDatabase()
      .select({ id: saleItems.id, quantity: saleItems.quantity, discount: saleItems.discount })
      .from(saleItems)
      .where(eq(saleItems.saleId, completed.id))
      .all();
    expect(lineRows).toHaveLength(2);
    expect(lineRows.map(row => row.discount)).toEqual([10, 10]);
    const snapshots = getDatabase()
      .select()
      .from(saleItemPromotions)
      .where(eq(saleItemPromotions.tenantId, tenantId))
      .all()
      .filter(row => lineRows.some(line => line.id === row.saleItemId));
    expect(snapshots).toHaveLength(2);
    expect(snapshots.map(row => row.discountAmount).sort((a, b) => a - b)).toEqual([10, 20]);
    expect(snapshots.every(row => row.promotionVersion === active.version)).toBe(true);
    const saleRead = await caller.sales.getById({ id: completed.id });
    expect(saleRead.items).toHaveLength(2);
    expect(saleRead.items.every(item => item.manualDiscountRate === 0)).toBe(true);
    expect(
      saleRead.items.every(item =>
        item.promotions.some(promotion => promotion.promotionId === active.id)
      )
    ).toBe(true);
    const personalData = await caller.customers.exportPersonalData({ id: customerId });
    expect(
      personalData.records.saleItemPromotions.filter(row => row.promotionId === active.id)
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nameSnapshot: 'Snapshot 10', promotionVersion: active.version }),
      ])
    );
    const snapshotOutboxIds = getDatabase()
      .select({ entityId: syncOutbox.entityId })
      .from(syncOutbox)
      .where(
        and(eq(syncOutbox.tenantId, tenantId), eq(syncOutbox.entityType, 'sale_item_promotions'))
      )
      .all()
      .map(row => row.entityId);
    expect(snapshots.every(row => snapshotOutboxIds.includes(row.id))).toBe(true);

    await caller.promotions.transition({
      id: active.id,
      version: active.version,
      status: 'paused',
    });
    const frozen = getDatabase()
      .select()
      .from(saleItemPromotions)
      .where(eq(saleItemPromotions.promotionId, active.id))
      .all();
    expect(frozen.every(row => row.nameSnapshot === 'Snapshot 10')).toBe(true);
    expect(frozen.every(row => row.promotionVersion === active.version)).toBe(true);
  });

  it('rejects a stale quote while legacy clients stay deliberately unpromoted', async () => {
    const productId = await seedProduct({ name: 'Stale quote product' });
    const active = createActivePromotion({
      name: 'Stale 30',
      productId,
      discountPct: 30,
      priority: 10,
    });
    const caller = appRouter.createCaller(fresh());
    const items = [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: 100, discount: 0 }];
    const quote = await caller.sales.quotePromotions({
      mode: 'fresh',
      customerId,
      items,
      discountAmount: 0,
    });
    await caller.promotions.transition({
      id: active.id,
      version: active.version,
      status: 'paused',
    });
    await expect(
      caller.sales.create({
        customerId,
        items,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: quote.total,
        discountAmount: 0,
        promotionFingerprint: quote.fingerprint,
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const legacyRule = createActivePromotion({
      name: 'Legacy ignored 40',
      productId,
      discountPct: 40,
      priority: 100,
    });
    const legacy = await appRouter.createCaller(fresh()).sales.create({
      customerId,
      items,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 100,
      discountAmount: 0,
    });
    expect(legacy.total).toBe(100);
    const legacyLines = getDatabase()
      .select({ id: saleItems.id })
      .from(saleItems)
      .where(eq(saleItems.saleId, legacy.id))
      .all();
    const legacySnapshots = getDatabase()
      .select()
      .from(saleItemPromotions)
      .where(eq(saleItemPromotions.promotionId, legacyRule.id))
      .all()
      .filter(row => legacyLines.some(line => line.id === row.saleItemId));
    expect(legacySnapshots).toEqual([]);
  });

  it('converts an approved expiry suggestion only when FEFO can consume its lot', async () => {
    const db = getDatabase();
    const productId = await seedProduct({ name: 'FEFO promotion product', tracksLots: true });
    const now = new Date().toISOString();
    const firstLotId = nanoid();
    const laterLotId = nanoid();
    await db.insert(inventoryLots).values([
      {
        id: firstLotId,
        tenantId,
        siteId,
        productId,
        lotNumber: 'FEFO-FIRST',
        expiresAt: '2026-09-06T12:00:00.000Z',
        onHand: 2,
        unitCost: 40,
        status: 'active',
        receivedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: laterLotId,
        tenantId,
        siteId,
        productId,
        lotNumber: 'FEFO-LATER',
        expiresAt: '2026-09-20T12:00:00.000Z',
        onHand: 20,
        unitCost: 40,
        status: 'active',
        receivedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const suggestionId = nanoid();
    await db.insert(priceSuggestions).values({
      id: suggestionId,
      tenantId,
      siteId,
      productId,
      lotId: firstLotId,
      discountPct: 30,
      lotExpiresAt: '2026-09-06T12:00:00.000Z',
      status: 'active',
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    const activated = await appRouter
      .createCaller(fresh({ role: 'manager' }))
      .promotions.activateExpirySuggestion({ suggestionId });
    expect(activated).toMatchObject({
      source: 'expiry',
      sourceLotId: firstLotId,
      status: 'active',
      discountPct: 30,
    });
    await expect(
      appRouter
        .createCaller(fresh({ role: 'manager' }))
        .promotions.expiryForLots({ lotIds: [firstLotId, laterLotId] })
    ).resolves.toEqual([
      expect.objectContaining({
        id: activated.id,
        sourceLotId: firstLotId,
        status: 'active',
        discountPct: 30,
      }),
    ]);
    await expect(
      appRouter
        .createCaller(fresh({ role: 'cashier' }))
        .promotions.expiryForLots({ lotIds: [firstLotId] })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const covered = quotePromotions(db, {
      tenantId,
      siteId,
      customerId: null,
      lines: [quoteLine({ productId, quantity: 2, tracksLots: true })],
      priceIncludesTax: false,
      nowIso: NOW,
    });
    expect(covered.lines[0]!.promotions[0]).toMatchObject({
      source: 'expiry',
      sourceLotId: firstLotId,
    });

    const spillsIntoAnotherLot = quotePromotions(db, {
      tenantId,
      siteId,
      customerId: null,
      lines: [quoteLine({ productId, quantity: 3, tracksLots: true })],
      priceIncludesTax: false,
      nowIso: NOW,
    });
    expect(spillsIntoAnotherLot.lines[0]!.promotions).toEqual([]);
    await expect(
      appRouter.createCaller(fresh({ role: 'manager' })).inventoryLots.suggestDiscount({
        lotId: firstLotId,
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('fails closed for pharmacy expiry activation and foreign tenant targets', async () => {
    const db = getDatabase();
    const productId = await seedProduct({ name: 'Pharmacy expiry product', tracksLots: true });
    const now = new Date().toISOString();
    const lotId = nanoid();
    await db.insert(inventoryLots).values({
      id: lotId,
      tenantId,
      siteId,
      productId,
      lotNumber: 'PHARMACY-LOT',
      expiresAt: '2026-09-10T12:00:00.000Z',
      onHand: 5,
      unitCost: 40,
      status: 'active',
      receivedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const suggestionId = nanoid();
    await db.insert(priceSuggestions).values({
      id: suggestionId,
      tenantId,
      siteId,
      productId,
      lotId,
      discountPct: 20,
      lotExpiresAt: '2026-09-10T12:00:00.000Z',
      status: 'active',
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    const tenant = await db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
    const originalSettings = (tenant?.settings ?? {}) as Record<string, unknown>;
    await db
      .update(tenants)
      .set({ settings: { ...originalSettings, businessType: 'pharmacy' } })
      .where(eq(tenants.id, tenantId));
    try {
      await expect(
        appRouter
          .createCaller(fresh({ role: 'manager' }))
          .promotions.activateExpirySuggestion({ suggestionId })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    } finally {
      await db.update(tenants).set({ settings: originalSettings }).where(eq(tenants.id, tenantId));
    }

    const foreignTenantId = nanoid();
    const foreignCategoryId = nanoid();
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Foreign promotions tenant',
      slug: `foreign-promo-${nanoid(6)}`.toLowerCase(),
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(categories).values({
      id: foreignCategoryId,
      tenantId: foreignTenantId,
      name: 'Foreign category',
      parentId: null,
      createdAt: now,
      updatedAt: now,
    });
    await expect(
      appRouter.createCaller(fresh()).promotions.create({
        name: 'Cross-tenant target',
        discountPct: 10,
        categoryId: foreignCategoryId,
        minQuantity: 1,
        priority: 0,
        combinable: false,
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(
      db
        .select()
        .from(promotions)
        .where(and(eq(promotions.tenantId, tenantId), eq(promotions.categoryId, foreignCategoryId)))
        .all()
    ).toEqual([]);
  });
});
