/**
 * ENG-199 — expiry-radar discount suggestions.
 *
 * Pins the four contracts of the feature:
 *   - the deterministic tier rule (≤7 → 30%, ≤15 → 20%, ≤30 → 10%) at its
 *     exact day boundaries, including the deliberate "expired is NOT
 *     eligible" rule;
 *   - the suggestion lifecycle: audited create, race-safe one-active-per-lot
 *     guard, audited dismiss, re-suggest after dismiss;
 *   - the read-side filter of `activeSuggestions` (no sweeper: depleted,
 *     expired, and dismissed rows drop off) and its cost-free payload;
 *   - role gating: managers own the CTA and the radar read, cashiers keep
 *     the badge read.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  companies,
  inventoryLots,
  priceSuggestions,
  products,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import {
  suggestedDiscountPctForExpiry,
  listActiveSuggestions,
} from '../services/price-suggestions.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';
import { appRouter } from '../trpc/router.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let fresh: ReturnType<typeof makeFreshContextFactory>;

/** ISO timestamp `days` days in the future (negative = past), noon UTC-ish offset from now. */
function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function seedProduct(name: string, sku: string): Promise<string> {
  const db = getDatabase();
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id,
    tenantId,
    name,
    sku,
    price: 100,
    cost: 40,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function seedLot(args: {
  productId: string;
  expiresAt: string | null;
  onHand?: number;
  status?: 'active' | 'depleted' | 'quarantined';
  ownTenantId?: string;
  ownSiteId?: string;
}): Promise<string> {
  const db = getDatabase();
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(inventoryLots).values({
    id,
    tenantId: args.ownTenantId ?? tenantId,
    siteId: args.ownSiteId ?? siteId,
    productId: args.productId,
    lotNumber: `L-${nanoid(6)}`,
    expiresAt: args.expiresAt,
    onHand: args.onHand ?? 10,
    unitCost: 4,
    status: args.status ?? 'active',
    receivedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

describe('price suggestions (ENG-199)', () => {
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

    const reg = await registerDeviceService(db, {
      tenantId,
      userId,
      kind: 'web',
      name: 'price-suggestions.test',
    });
    fresh = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      userId,
      email: 'admin@localhost',
      siteId,
      deviceId: reg.deviceId,
      defaultRole: 'admin',
    });
  });

  afterAll(async () => {
    await server.close();
  });

  describe('suggestedDiscountPctForExpiry (tier rule)', () => {
    const now = '2026-07-10T12:00:00.000Z';
    const days = (n: number) => new Date(Date.parse(now) + n * 24 * 60 * 60 * 1000).toISOString();

    it('applies the tier boundaries exactly (7/15/30 days, first match wins)', () => {
      expect(suggestedDiscountPctForExpiry(days(1), now)).toBe(30);
      expect(suggestedDiscountPctForExpiry(days(7), now)).toBe(30);
      expect(suggestedDiscountPctForExpiry(days(8), now)).toBe(20);
      expect(suggestedDiscountPctForExpiry(days(15), now)).toBe(20);
      expect(suggestedDiscountPctForExpiry(days(16), now)).toBe(10);
      expect(suggestedDiscountPctForExpiry(days(30), now)).toBe(10);
    });

    it('returns null outside the window, without expiry, and for expired lots', () => {
      expect(suggestedDiscountPctForExpiry(days(31), now)).toBeNull();
      expect(suggestedDiscountPctForExpiry(null, now)).toBeNull();
      expect(suggestedDiscountPctForExpiry(days(-1), now)).toBeNull();
      expect(suggestedDiscountPctForExpiry('not-a-date', now)).toBeNull();
    });
  });

  it('creates an audited suggestion with the server-computed percent', async () => {
    const productId = await seedProduct('Yogur Radar', 'PS-YOG');
    const lotId = await seedLot({ productId, expiresAt: isoDaysFromNow(10) });

    const caller = appRouter.createCaller(fresh());
    const suggestion = await caller.inventoryLots.suggestDiscount({ lotId });
    expect(suggestion.discountPct).toBe(20);
    expect(suggestion.productId).toBe(productId);

    const audit = await getDatabase()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.resourceId, suggestion.id)))
      .get();
    expect(audit?.action).toBe('inventory.lot.discount_suggested');
    expect(audit?.resourceType).toBe('price_suggestion');
    expect((audit?.metadata as { lotId?: string })?.lotId).toBe(lotId);

    const active = await caller.inventoryLots.activeSuggestions();
    expect(active.items.some(item => item.id === suggestion.id)).toBe(true);
  });

  it('guards one active suggestion per lot and allows re-suggest after dismiss', async () => {
    const productId = await seedProduct('Queso Radar', 'PS-QUESO');
    const lotId = await seedLot({ productId, expiresAt: isoDaysFromNow(5) });
    const caller = appRouter.createCaller(fresh());

    const first = await caller.inventoryLots.suggestDiscount({ lotId });
    expect(first.discountPct).toBe(30);
    await expect(caller.inventoryLots.suggestDiscount({ lotId })).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    await caller.inventoryLots.dismissSuggestion({ suggestionId: first.id });
    const dismissAudit = await getDatabase()
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.resourceId, first.id),
          eq(auditLogs.action, 'inventory.lot.discount_suggestion_dismissed')
        )
      )
      .get();
    expect(dismissAudit).toBeTruthy();
    expect(dismissAudit?.metadata).toMatchObject({
      lotId,
      productId,
      productName: 'Queso Radar',
    });
    expect((dismissAudit?.metadata as { lotNumber?: unknown } | null)?.lotNumber).toEqual(
      expect.any(String)
    );

    // Dismissed rows do not block the partial unique index.
    const second = await caller.inventoryLots.suggestDiscount({ lotId });
    expect(second.id).not.toBe(first.id);
  });

  it('rejects ineligible lots with BAD_REQUEST', async () => {
    const productId = await seedProduct('Pan Radar', 'PS-PAN');
    const caller = appRouter.createCaller(fresh());

    const noExpiry = await seedLot({ productId, expiresAt: null });
    await expect(caller.inventoryLots.suggestDiscount({ lotId: noExpiry })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });

    const expired = await seedLot({ productId, expiresAt: isoDaysFromNow(-2) });
    await expect(caller.inventoryLots.suggestDiscount({ lotId: expired })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });

    const farOut = await seedLot({ productId, expiresAt: isoDaysFromNow(45) });
    await expect(caller.inventoryLots.suggestDiscount({ lotId: farOut })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });

    const depleted = await seedLot({ productId, expiresAt: isoDaysFromNow(5), onHand: 0 });
    await expect(caller.inventoryLots.suggestDiscount({ lotId: depleted })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('rejects lots from another tenant with NOT_FOUND', async () => {
    const db = getDatabase();
    const now = new Date().toISOString();
    const tenantB = nanoid();
    const userB = nanoid();
    const companyB = nanoid();
    const siteB = nanoid();
    await db.insert(tenants).values({
      id: tenantB,
      name: 'Radar Tenant B',
      slug: `radar-b-${nanoid(6)}`.toLowerCase(),
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(users).values({
      id: userB,
      tenantId: tenantB,
      email: `radar-b-${nanoid(6)}@example.com`.toLowerCase(),
      passwordHash: 'x',
      name: 'B',
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db
      .insert(companies)
      .values({ id: companyB, tenantId: tenantB, name: 'B co', createdAt: now, updatedAt: now });
    await db.insert(sites).values({
      id: siteB,
      tenantId: tenantB,
      companyId: companyB,
      name: 'B site',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const productB = nanoid();
    await db.insert(products).values({
      id: productB,
      tenantId: tenantB,
      name: 'B product',
      sku: 'PS-B',
      price: 1,
      cost: 1,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const foreignLot = await seedLot({
      productId: productB,
      expiresAt: isoDaysFromNow(5),
      ownTenantId: tenantB,
      ownSiteId: siteB,
    });

    await expect(
      appRouter.createCaller(fresh()).inventoryLots.suggestDiscount({ lotId: foreignLot })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // And tenant B's suggestions never leak into tenant A's read.
    const items = listActiveSuggestions(db, { tenantId });
    expect(items.every(item => item.lotId !== foreignLot)).toBe(true);
  });

  it('drops depleted, snapshot-expired, and dismissed suggestions from the active read', async () => {
    const db = getDatabase();
    const productId = await seedProduct('Leche Radar', 'PS-LECHE');
    const caller = appRouter.createCaller(fresh());

    const depletable = await seedLot({ productId, expiresAt: isoDaysFromNow(6) });
    const expirable = await seedLot({ productId, expiresAt: isoDaysFromNow(6) });
    const dismissable = await seedLot({ productId, expiresAt: isoDaysFromNow(6) });
    const keeper = await seedLot({ productId, expiresAt: isoDaysFromNow(6) });

    const sDepleted = await caller.inventoryLots.suggestDiscount({ lotId: depletable });
    const sExpired = await caller.inventoryLots.suggestDiscount({ lotId: expirable });
    const sDismissed = await caller.inventoryLots.suggestDiscount({ lotId: dismissable });
    const sKeeper = await caller.inventoryLots.suggestDiscount({ lotId: keeper });

    await db.update(inventoryLots).set({ onHand: 0 }).where(eq(inventoryLots.id, depletable));
    // The suggestion expiry is a snapshot: later lot edits must not make an
    // active suggestion immortal or make a still-valid snapshot disappear.
    await db
      .update(priceSuggestions)
      .set({ lotExpiresAt: isoDaysFromNow(-1) })
      .where(eq(priceSuggestions.id, sExpired.id));
    await db
      .update(inventoryLots)
      .set({ expiresAt: isoDaysFromNow(-1) })
      .where(eq(inventoryLots.id, keeper));
    await caller.inventoryLots.dismissSuggestion({ suggestionId: sDismissed.id });

    const active = await caller.inventoryLots.activeSuggestions();
    const ids = new Set(active.items.map(item => item.id));
    expect(ids.has(sKeeper.id)).toBe(true);
    expect(ids.has(sDepleted.id)).toBe(false);
    expect(ids.has(sExpired.id)).toBe(false);
    expect(ids.has(sDismissed.id)).toBe(false);

    // The shared payload carries no cost fields (cashiers read it).
    const keeperRow = active.items.find(item => item.id === sKeeper.id);
    expect(keeperRow).toBeTruthy();
    expect(keeperRow).not.toHaveProperty('unitCost');
  });

  it('keeps already-expired lots out of the manager radar', async () => {
    const productId = await seedProduct('Expired Radar', 'PS-EXPIRED');
    const expiredLotId = await seedLot({ productId, expiresAt: isoDaysFromNow(-1) });

    const radar = await appRouter.createCaller(fresh()).inventoryLots.expiring({ withinDays: 30 });

    expect(radar.items.some(lot => lot.id === expiredLotId)).toBe(false);
  });

  it('gates the CTA and the radar read to manager/admin, keeps the badge read open', async () => {
    const productId = await seedProduct('Roles Radar', 'PS-ROLES');
    const lotId = await seedLot({ productId, expiresAt: isoDaysFromNow(5) });

    const cashier = appRouter.createCaller(fresh({ role: 'cashier' }));
    await expect(cashier.inventoryLots.suggestDiscount({ lotId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(cashier.inventoryLots.expiring({ withinDays: 30 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(cashier.inventoryLots.activeSuggestions()).resolves.toMatchObject({
      items: expect.any(Array),
    });

    const manager = appRouter.createCaller(fresh({ role: 'manager' }));
    const suggestion = await manager.inventoryLots.suggestDiscount({ lotId });
    expect(suggestion.discountPct).toBe(30);
    await expect(manager.inventoryLots.expiring({ withinDays: 30 })).resolves.toMatchObject({
      items: expect.any(Array),
    });
  });
});
