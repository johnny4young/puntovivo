import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { getDatabase } from '../db/index.js';
import { sites, tenantLocaleSettings, users } from '../db/schema.js';
import { createServer, type PuntovivoServer } from '../index.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { daysUntilLotExpiry } from '../services/inventory-lots/expiry.js';
import { resolveTenantBusinessClock } from '../services/pharmacy/business-clock.js';
import { addCalendarDays } from '../services/reports/day-window.js';
import { appRouter } from '../trpc/router.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let siteId: string;
let tenantId: string;
let userId: string;
let userName: string;
let businessDate: string;
let fresh: ReturnType<typeof makeFreshContextFactory>;

function caller(role: 'admin' | 'cashier' | 'viewer' = 'admin') {
  return appRouter.createCaller(fresh({ role }));
}

async function createMedicine(name: string, classification: 'otc' | 'prescription' | 'controlled') {
  const suffix = nanoid(6);
  return caller().products.create({
    name,
    sku: `HINT-${suffix}`,
    price: 5_000,
    cost: 1_000,
    initialCost: 1_000,
    tracksStock: true,
    tracksLots: true,
    tracksSerials: false,
    pharmacy: {
      activeIngredient: `Loratadina ${suffix}`,
      genericName: 'Loratadina',
      concentration: '10 mg',
      dosageForm: 'Tableta',
      administrationRoute: 'oral',
      presentation: 'Caja x 10 tabletas',
      manufacturer: `Laboratorio ${suffix}`,
      authorizationHolder: `Titular ${suffix}`,
      sanitaryRegistration: `INVIMA-${suffix}`,
      registrationExpiresAt: addCalendarDays(businessDate, 365),
      classification,
      storageConditions: 'Store according to labeled conditions',
      requiresColdChain: false,
    },
  });
}

async function receiveLot(productId: string, lotNumber: string, expiresInDays: number) {
  return caller().inventoryLots.receive({
    siteId,
    productId,
    lotNumber,
    expiresAt: addCalendarDays(businessDate, expiresInDays),
    quantity: 10,
    unitCost: 1_000,
  });
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!admin) throw new Error('Expected seeded admin');
  const site = await db
    .select()
    .from(sites)
    .where(and(eq(sites.tenantId, admin.tenantId), eq(sites.isActive, true)))
    .get();
  if (!site) throw new Error('Expected seeded active site');
  siteId = site.id;
  tenantId = admin.tenantId;
  userId = admin.id;
  userName = admin.name;

  const locale = await db
    .select({ tenantId: tenantLocaleSettings.tenantId })
    .from(tenantLocaleSettings)
    .where(eq(tenantLocaleSettings.tenantId, admin.tenantId))
    .get();
  if (!locale) {
    await db.insert(tenantLocaleSettings).values({ tenantId: admin.tenantId, countryCode: 'CO' });
  } else {
    await db
      .update(tenantLocaleSettings)
      .set({ countryCode: 'CO' })
      .where(eq(tenantLocaleSettings.tenantId, admin.tenantId));
  }
  businessDate = (await resolveTenantBusinessClock(db, admin.tenantId)).businessDate;

  const device = await registerDeviceService(db, {
    tenantId: admin.tenantId,
    userId: admin.id,
    kind: 'web',
    name: 'pharmacy-register-hints.test',
  });
  fresh = makeFreshContextFactory({
    db,
    serverApp: server.app,
    tenantId: admin.tenantId,
    userId: admin.id,
    email: admin.email,
    siteId,
    deviceId: device.deviceId,
    defaultRole: 'admin',
  });
});

afterAll(async () => {
  await server.close();
});

describe('daysUntilLotExpiry', () => {
  it('counts whole days on the business date and ignores expired or missing expiries', () => {
    const nowIso = '2026-11-21T23:30:00.000Z';
    expect(daysUntilLotExpiry('2026-12-31', nowIso, '2026-11-21')).toBe(40);
    expect(daysUntilLotExpiry('2026-11-21', nowIso, '2026-11-21')).toBe(0);
    expect(daysUntilLotExpiry('2026-11-20', nowIso, '2026-11-21')).toBeNull();
    expect(daysUntilLotExpiry('2026-11-23T12:00:00.000Z', nowIso)).toBe(2);
    expect(daysUntilLotExpiry('2026-02-30', nowIso, '2026-01-01')).toBeNull();
    expect(daysUntilLotExpiry(null, nowIso)).toBeNull();
    expect(daysUntilLotExpiry('2026-12-31', nowIso, '2026-02-30')).toBeNull();
  });
});

describe('products.search lot hints', () => {
  it('names the FEFO lot at the site and flags it inside the expiry window', async () => {
    const soon = await createMedicine(`Loratadina pronto ${nanoid(4)}`, 'otc');
    await receiveLot(soon.id, 'L-LATE', 400);
    await receiveLot(soon.id, 'L-SOON', 20);
    const later = await createMedicine(`Loratadina lejos ${nanoid(4)}`, 'otc');
    await receiveLot(later.id, 'L-FAR', 300);

    const { items } = await caller('cashier').products.search({
      q: 'Loratadina',
      siteId,
      includeNextLot: true,
      limit: 25,
    });
    const bySku = new Map(items.map(item => [item.sku, item]));
    expect(bySku.get(soon.sku)?.nextLot).toEqual({
      lotNumber: 'L-SOON',
      expiresAt: addCalendarDays(businessDate, 20),
      daysToExpiry: 20,
      nearExpiry: true,
    });
    expect(bySku.get(later.sku)?.nextLot).toMatchObject({
      lotNumber: 'L-FAR',
      daysToExpiry: 300,
      nearExpiry: false,
    });
  });

  it('leaves the lot out without a site, without asking or for products without lots', async () => {
    const plain = await caller().products.create({
      name: `Crema sin lote ${nanoid(4)}`,
      sku: `PLAIN-${nanoid(6)}`,
      price: 2_000,
      cost: 500,
      initialCost: 500,
      tracksStock: true,
    });
    const lotted = await createMedicine(`Loratadina con lote ${nanoid(4)}`, 'otc');
    await receiveLot(lotted.id, 'L-ONE', 200);

    const siteSearch = await caller('cashier').products.search({
      q: plain.sku,
      siteId,
      includeNextLot: true,
      limit: 5,
    });
    expect(siteSearch.items[0]?.nextLot).toBeNull();
    const tenantSearch = await caller('cashier').products.search({
      q: lotted.sku,
      includeNextLot: true,
      limit: 5,
    });
    expect(tenantSearch.items[0]?.nextLot).toBeNull();
    // Lots are a register hint: a read-only role never receives them.
    const viewerSearch = await caller('viewer').products.search({
      q: lotted.sku,
      siteId,
      includeNextLot: true,
      limit: 5,
    });
    expect(viewerSearch.items[0]?.nextLot).toBeNull();
    // Searches outside the register never pay for the lot read.
    const paletteSearch = await caller('cashier').products.search({
      q: lotted.sku,
      siteId,
      limit: 5,
    });
    expect(paletteSearch.items[0]?.nextLot).toBeNull();
  });

  it('still answers the search when the tenant locale cannot give a business date', async () => {
    const product = await createMedicine(`Loratadina reloj ${nanoid(4)}`, 'otc');
    await receiveLot(product.id, 'L-CLOCK', 200);
    const db = getDatabase();
    await db
      .update(tenantLocaleSettings)
      .set({ timezoneOverride: 'America/Bogotta' })
      .where(eq(tenantLocaleSettings.tenantId, tenantId));
    try {
      const { items } = await caller('cashier').products.search({
        q: product.sku,
        siteId,
        includeNextLot: true,
        limit: 5,
      });
      expect(items[0]).toMatchObject({ id: product.id, nextLot: null });
    } finally {
      await db
        .update(tenantLocaleSettings)
        .set({ timezoneOverride: null })
        .where(eq(tenantLocaleSettings.tenantId, tenantId));
    }
  });
});

describe('pharmacy.checkoutRequirements ticket hints', () => {
  it('returns the next lot, whether a customer is required and who approved the prescription', async () => {
    const otc = await createMedicine(`Loratadina OTC ${nanoid(4)}`, 'otc');
    await receiveLot(otc.id, 'L-OTC', 200);
    const rx = await createMedicine(`Amoxicilina ${nanoid(4)}`, 'prescription');
    await receiveLot(rx.id, 'L-RX', 250);
    const controlled = await createMedicine(`Clonazepam ${nanoid(4)}`, 'controlled');
    const customer = await caller().customers.create({ name: `Luis Herrera ${nanoid(4)}` });
    const authorization = await caller().pharmacy.createAuthorization({
      userId,
      countryCode: 'CO',
      credentialType: 'pharmacist-license',
      credential: `RETHUS-${nanoid(8)}`,
      validFrom: businessDate,
    });
    const evidence = await caller().pharmacy.recordEvidence({
      productId: rx.id,
      customerId: customer.id,
      reference: `RX-${nanoid(10)}`,
      prescriberName: 'Prescriptora',
      prescriberCredential: `MED-${nanoid(8)}`,
      authorizedQuantity: 21,
      validFrom: businessDate,
      expiresAt: addCalendarDays(businessDate, 4),
    });
    await caller().pharmacy.approveEvidence({ id: evidence.id });

    const items = [otc, rx, controlled].map(product => ({
      productId: product.id,
      quantity: 1,
      unitEquivalence: 1,
    }));
    const walkIn = await caller('cashier').pharmacy.checkoutRequirements({
      customerId: null,
      items,
    });
    const walkInByProduct = new Map(walkIn.requirements.map(row => [row.productId, row]));
    expect(walkInByProduct.get(otc.id)).toMatchObject({
      customerRequired: false,
      blockedErrorCode: null,
      nextLot: { lotNumber: 'L-OTC', daysToExpiry: 200, nearExpiry: false },
    });
    expect(walkInByProduct.get(rx.id)).toMatchObject({
      customerRequired: true,
      blockedErrorCode: 'PHARMACY_CUSTOMER_REQUIRED',
      nextLot: { lotNumber: 'L-RX' },
    });
    expect(walkInByProduct.get(controlled.id)).toMatchObject({
      blockedErrorCode: 'PHARMACY_CONTROLLED_NOT_ENABLED',
      nextLot: null,
    });

    const named = await caller('cashier').pharmacy.checkoutRequirements({
      customerId: customer.id,
      items: items.slice(0, 2),
    });
    expect(named.requirements.find(row => row.productId === rx.id)).toMatchObject({
      blockedErrorCode: null,
      eligibleEvidence: [
        {
          id: evidence.id,
          approverName: userName,
          authorizedQuantity: 21,
          remainingQuantity: 21,
          expiresAt: addCalendarDays(businessDate, 4),
        },
      ],
    });
    expect(named.ready).toBe(true);

    await caller().pharmacy.revokeAuthorization({
      id: authorization.id,
      reason: 'Register hints fixture cleanup',
    });
  });
});
