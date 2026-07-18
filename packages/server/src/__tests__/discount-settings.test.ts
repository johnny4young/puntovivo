/**
 * ENG-211 — tenant-tunable expiry-discount tiers.
 *
 * Pins three contracts:
 *   - normalization is defensive: the settings blob is free-form JSON, so a
 *     corrupt/partial/unsorted ladder can never leave the radar ruleless or
 *     order-dependent-broken;
 *   - the settings round-trip through the router with admin-only writes;
 *   - the tuned ladder actually decides the percent the radar CTA records
 *     (the whole point of the follow-up).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { inventoryLots, products, sites, tenants, users } from '../db/schema.js';
import {
  DEFAULT_EXPIRY_DISCOUNT_TIERS,
  normalizeExpiryTiers,
  resolveDiscountSettings,
  writeDiscountSettings,
} from '../services/discount-settings.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';
import { appRouter } from '../trpc/router.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let fresh: ReturnType<typeof makeFreshContextFactory>;

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function seedLot(expiresAt: string): Promise<string> {
  const db = getDatabase();
  const productId = nanoid();
  const lotId = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id: productId,
    tenantId,
    name: `Tier Product ${productId.slice(0, 4)}`,
    sku: `TIER-${productId.slice(0, 6)}`,
    price: 100,
    cost: 40,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(inventoryLots).values({
    id: lotId,
    tenantId,
    siteId,
    productId,
    lotNumber: `L-${nanoid(6)}`,
    expiresAt,
    onHand: 10,
    unitCost: 4,
    status: 'active',
    receivedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return lotId;
}

describe('discount settings (ENG-211)', () => {
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
      name: 'discount-settings.test',
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

  describe('normalizeExpiryTiers', () => {
    it('sorts ascending so the first-match-wins rule stays correct', () => {
      expect(
        normalizeExpiryTiers([
          { maxDays: 30, pct: 10 },
          { maxDays: 3, pct: 40 },
          { maxDays: 15, pct: 20 },
        ])
      ).toEqual([
        { maxDays: 3, pct: 40 },
        { maxDays: 15, pct: 20 },
        { maxDays: 30, pct: 10 },
      ]);
    });

    it('falls back to the ENG-199 ladder on garbage, empty, or non-array blobs', () => {
      expect(normalizeExpiryTiers(undefined)).toEqual(DEFAULT_EXPIRY_DISCOUNT_TIERS);
      expect(normalizeExpiryTiers([])).toEqual(DEFAULT_EXPIRY_DISCOUNT_TIERS);
      expect(normalizeExpiryTiers('nope')).toEqual(DEFAULT_EXPIRY_DISCOUNT_TIERS);
      expect(normalizeExpiryTiers([{ maxDays: 0, pct: 500 }, null, 7])).toEqual(
        DEFAULT_EXPIRY_DISCOUNT_TIERS
      );
    });

    it('drops invalid entries and duplicates while keeping the valid ones', () => {
      expect(
        normalizeExpiryTiers([
          { maxDays: 7, pct: 30 },
          { maxDays: 7, pct: 99 },
          { maxDays: 400, pct: 50 },
          { maxDays: 20, pct: 15 },
        ])
      ).toEqual([
        { maxDays: 7, pct: 30 },
        { maxDays: 20, pct: 15 },
      ]);
    });
  });

  it('defaults to the ENG-199 ladder and round-trips a tuned one', async () => {
    const caller = appRouter.createCaller(fresh());
    const initial = await caller.discountSettings.get();
    expect(initial.expiryTiers).toEqual(DEFAULT_EXPIRY_DISCOUNT_TIERS);

    const tuned = [
      { maxDays: 3, pct: 40 },
      { maxDays: 10, pct: 15 },
    ];
    const updated = await caller.discountSettings.update({ expiryTiers: tuned });
    expect(updated.expiryTiers).toEqual(tuned);

    const persisted = await resolveDiscountSettings(getDatabase(), tenantId);
    expect(persisted.expiryTiers).toEqual(tuned);

    // An empty patch is a true no-op.
    const noop = await writeDiscountSettings(getDatabase(), tenantId, {});
    expect(noop.expiryTiers).toEqual(tuned);
  });

  it('lets the tuned ladder decide the percent the radar records', async () => {
    const caller = appRouter.createCaller(fresh());
    // Ladder from the previous test is active: <=3d → 40%, <=10d → 15%.
    const lotId = await seedLot(isoDaysFromNow(8));
    const suggestion = await caller.inventoryLots.suggestDiscount({ lotId });
    // Under the DEFAULT ladder this lot would have earned 20%.
    expect(suggestion.discountPct).toBe(15);

    // A lot outside the tuned window is no longer eligible at all, even
    // though the default ladder would have covered it (30 days → 10%).
    const farLot = await seedLot(isoDaysFromNow(25));
    await expect(caller.inventoryLots.suggestDiscount({ lotId: farLot })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('gates writes to admins and isolates tenants', async () => {
    const manager = appRouter.createCaller(fresh({ role: 'manager' }));
    await expect(
      manager.discountSettings.update({ expiryTiers: [{ maxDays: 5, pct: 50 }] })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Managers still READ (the settings card is manager-visible).
    await expect(manager.discountSettings.get()).resolves.toMatchObject({
      expiryTiers: expect.any(Array),
    });

    const cashier = appRouter.createCaller(fresh({ role: 'cashier' }));
    await expect(cashier.discountSettings.get()).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // A foreign tenant keeps the defaults — the write above never leaked.
    const db = getDatabase();
    const now = new Date().toISOString();
    const tenantB = nanoid();
    await db.insert(tenants).values({
      id: tenantB,
      name: 'Discount Tenant B',
      slug: `discount-b-${nanoid(6)}`.toLowerCase(),
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const foreign = await resolveDiscountSettings(db, tenantB);
    expect(foreign.expiryTiers).toEqual(DEFAULT_EXPIRY_DISCOUNT_TIERS);
  });
});
