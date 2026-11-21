import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { pharmacyEquivalenceKey } from '../application/pharmacy/generic-alternatives.js';
import { getDatabase } from '../db/index.js';
import {
  inventoryLots,
  pharmacyProductProfiles,
  products,
  sites,
  tenantLocaleSettings,
  users,
} from '../db/schema.js';
import { createServer, type PuntovivoServer } from '../index.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { resolveTenantBusinessClock } from '../services/pharmacy/business-clock.js';
import { addCalendarDays } from '../services/reports/day-window.js';
import { appRouter } from '../trpc/router.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let siteId: string;
let otherSiteId: string;
let businessDate: string;
let fresh: ReturnType<typeof makeFreshContextFactory>;

function caller(role: 'admin' | 'cashier' | 'viewer' = 'admin') {
  return appRouter.createCaller(fresh({ role }));
}

interface MedicineSpec {
  name: string;
  price: number;
  price2?: number;
  activeIngredient?: string;
  concentration?: string | null;
  dosageForm?: string | null;
  presentation?: string | null;
  classification?: 'otc' | 'prescription' | 'controlled';
}

/** Each test gets its own ingredient so earlier fixtures never become candidates. */
function newIngredient() {
  return `Acetaminofén ${nanoid(6)}`;
}

async function createMedicine(ingredient: string, spec: MedicineSpec) {
  const suffix = nanoid(6);
  return caller().products.create({
    name: spec.name,
    sku: `GEN-${suffix}`,
    price: spec.price,
    ...(spec.price2 !== undefined ? { price2: spec.price2 } : {}),
    cost: 1_000,
    initialCost: 1_000,
    tracksStock: true,
    tracksLots: true,
    tracksSerials: false,
    pharmacy: {
      activeIngredient: spec.activeIngredient ?? ingredient,
      genericName: 'Acetaminofén',
      concentration: spec.concentration === undefined ? '500 mg' : spec.concentration,
      dosageForm: spec.dosageForm === undefined ? 'Tableta' : spec.dosageForm,
      administrationRoute: 'oral',
      presentation: spec.presentation === undefined ? 'Caja x 24 tabletas' : spec.presentation,
      manufacturer: `Laboratorio ${suffix}`,
      authorizationHolder: `Titular ${suffix}`,
      sanitaryRegistration: `INVIMA-${suffix}`,
      registrationExpiresAt: addCalendarDays(businessDate, 365),
      classification: spec.classification ?? 'otc',
      storageConditions: 'Store according to labeled conditions',
      requiresColdChain: false,
    },
  });
}

async function receiveLot(
  productId: string,
  args: { lotNumber?: string; expiresInDays?: number; quantity?: number; site?: string } = {}
) {
  return caller().inventoryLots.receive({
    siteId: args.site ?? siteId,
    productId,
    lotNumber: args.lotNumber ?? `L-${nanoid(5)}`,
    expiresAt: addCalendarDays(businessDate, args.expiresInDays ?? 300),
    quantity: args.quantity ?? 10,
    unitCost: 1_000,
  });
}

async function alternatives(
  productId: string,
  extra: { priceTier?: 1 | 2 | 3; limit?: number } = {}
) {
  return caller('cashier').pharmacy.genericAlternatives({ productId, ...extra });
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
  tenantId = admin.tenantId;
  siteId = site.id;

  const locale = await db
    .select({ tenantId: tenantLocaleSettings.tenantId })
    .from(tenantLocaleSettings)
    .where(eq(tenantLocaleSettings.tenantId, tenantId))
    .get();
  if (!locale) {
    await db.insert(tenantLocaleSettings).values({ tenantId, countryCode: 'CO' });
  } else {
    await db
      .update(tenantLocaleSettings)
      .set({ countryCode: 'CO' })
      .where(eq(tenantLocaleSettings.tenantId, tenantId));
  }
  businessDate = (await resolveTenantBusinessClock(db, tenantId)).businessDate;

  otherSiteId = `generic-other-site-${nanoid(6)}`;
  await db.insert(sites).values({
    id: otherSiteId,
    tenantId,
    companyId: site.companyId,
    name: 'Sede Norte',
    isActive: true,
  });

  const device = await registerDeviceService(db, {
    tenantId,
    userId: admin.id,
    kind: 'web',
    name: 'pharmacy-generic-alternatives.test',
  });
  fresh = makeFreshContextFactory({
    db,
    serverApp: server.app,
    tenantId,
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

describe('pharmacyEquivalenceKey', () => {
  it('ignores case, accents, spacing and the decimal separator', () => {
    expect(pharmacyEquivalenceKey('Acetaminofén')).toBe(pharmacyEquivalenceKey(' ACETAMINOFEN '));
    expect(pharmacyEquivalenceKey('500 mg')).toBe(pharmacyEquivalenceKey('500MG'));
    expect(pharmacyEquivalenceKey('0,5 mg/ml')).toBe(pharmacyEquivalenceKey('0.5 mg / ml'));
    expect(pharmacyEquivalenceKey('   ')).toBeNull();
    expect(pharmacyEquivalenceKey(null)).toBeNull();
  });
});

describe('pharmacy.genericAlternatives', () => {
  it('suggests cheaper equivalents in stock at the site, biggest saving first', async () => {
    const ingredient = newIngredient();
    const brand = await createMedicine(ingredient, { name: 'Dolex 500 mg', price: 9_300 });
    const generic = await createMedicine(ingredient, {
      name: 'Acetaminofén MK 500 mg',
      price: 3_200,
      activeIngredient: ingredient.toUpperCase().replace('É', 'E'),
      concentration: '500MG',
      dosageForm: 'tableta',
    });
    const cheaper = await createMedicine(ingredient, { name: 'Acetaminofén Genfar', price: 6_000 });
    const pricier = await createMedicine(ingredient, { name: 'Premium', price: 12_000 });
    const otherStrength = await createMedicine(ingredient, {
      name: 'Acetaminofén 1 g',
      price: 2_000,
      concentration: '1 g',
    });
    const syrup = await createMedicine(ingredient, {
      name: 'Acetaminofén jarabe',
      price: 2_500,
      dosageForm: 'Jarabe',
    });
    await receiveLot(brand.id);
    await receiveLot(generic.id, { lotNumber: 'L-LATE', expiresInDays: 400, quantity: 25 });
    await receiveLot(generic.id, { lotNumber: 'L-SOON', expiresInDays: 90, quantity: 15 });
    for (const product of [cheaper, pricier, otherStrength, syrup]) await receiveLot(product.id);

    const result = await alternatives(brand.id);

    expect(result.sourcePrice).toBe(9_300);
    expect(result.items.map(item => item.productId)).toEqual([generic.id, cheaper.id]);
    expect(result.items[0]).toMatchObject({
      name: 'Acetaminofén MK 500 mg',
      price: 3_200,
      savings: 6_100,
      classification: 'otc',
      siteStock: 40,
      nextLot: { lotNumber: 'L-SOON', expiresAt: addCalendarDays(businessDate, 90) },
    });
    await expect(alternatives(brand.id, { limit: 1 })).resolves.toMatchObject({
      items: [{ productId: generic.id }],
    });
  });

  it('never suggests or answers for controlled medicines', async () => {
    const ingredient = newIngredient();
    const brand = await createMedicine(ingredient, { name: 'Brand', price: 9_000 });
    const controlled = await createMedicine(ingredient, {
      name: 'Controlled generic',
      price: 1_000,
      classification: 'controlled',
    });
    const controlledBrand = await createMedicine(ingredient, {
      name: 'Controlled brand',
      price: 20_000,
      classification: 'controlled',
    });
    const otc = await createMedicine(ingredient, { name: 'OTC generic', price: 3_000 });
    for (const product of [brand, controlled, controlledBrand, otc]) await receiveLot(product.id);

    await expect(alternatives(brand.id)).resolves.toMatchObject({
      items: [{ productId: otc.id }],
    });
    await expect(alternatives(controlledBrand.id)).resolves.toMatchObject({ items: [] });
  });

  it('skips equivalents the site cannot sell now', async () => {
    const ingredient = newIngredient();
    const brand = await createMedicine(ingredient, { name: 'Brand', price: 9_000 });
    // Never receives a lot.
    await createMedicine(ingredient, { name: 'No stock', price: 1_000 });
    const elsewhere = await createMedicine(ingredient, { name: 'Other site', price: 1_100 });
    const expiredLot = await createMedicine(ingredient, { name: 'Expired lot', price: 1_200 });
    const inactive = await createMedicine(ingredient, { name: 'Inactive', price: 1_300 });
    const expiredRegistration = await createMedicine(ingredient, {
      name: 'Expired registration',
      price: 1_400,
    });
    const recalled = await createMedicine(ingredient, { name: 'Recalled', price: 1_500 });
    const sellable = await createMedicine(ingredient, { name: 'Sellable', price: 5_000 });

    await receiveLot(elsewhere.id, { site: otherSiteId });
    await receiveLot(expiredLot.id, { expiresInDays: 1 });
    for (const product of [inactive, expiredRegistration, recalled, sellable]) {
      await receiveLot(product.id);
    }
    const db = getDatabase();
    await db.update(products).set({ isActive: false }).where(eq(products.id, inactive.id));
    await db
      .update(pharmacyProductProfiles)
      .set({ registrationExpiresAt: addCalendarDays(businessDate, -1) })
      .where(eq(pharmacyProductProfiles.productId, expiredRegistration.id));
    await db
      .update(inventoryLots)
      .set({ expiresAt: addCalendarDays(businessDate, -1) })
      .where(eq(inventoryLots.productId, expiredLot.id));
    await caller().pharmacy.createRecall({
      scopeType: 'product',
      productId: recalled.id,
      reason: 'Manufacturer withdrawal of every lot',
    });

    await expect(alternatives(brand.id)).resolves.toMatchObject({
      items: [{ productId: sellable.id }],
    });
    expect(
      (
        await caller('cashier').pharmacy.genericAlternatives({
          productId: brand.id,
          siteId: otherSiteId,
        })
      ).items.map(item => item.productId)
    ).toEqual([elsewhere.id]);
  });

  it('compares the same pack and never a stricter class', async () => {
    const ingredient = newIngredient();
    const brand = await createMedicine(ingredient, {
      name: 'Brand x30',
      price: 15_000,
      presentation: 'Caja x 30 tabletas',
    });
    const smallerPack = await createMedicine(ingredient, {
      name: 'Generic x10',
      price: 8_000,
      presentation: 'Caja x 10 tabletas',
    });
    const samePack = await createMedicine(ingredient, {
      name: 'Generic x30',
      price: 9_000,
      presentation: 'caja x30 tabletas',
    });
    const noPack = await createMedicine(ingredient, {
      name: 'Generic no pack',
      price: 7_000,
      presentation: null,
    });
    const prescriptionOnly = await createMedicine(ingredient, {
      name: 'Prescription x30',
      price: 6_000,
      presentation: 'Caja x 30 tabletas',
      classification: 'prescription',
    });
    for (const product of [brand, smallerPack, samePack, noPack, prescriptionOnly]) {
      await receiveLot(product.id);
    }

    await expect(alternatives(brand.id)).resolves.toMatchObject({
      items: [{ productId: samePack.id, savings: 6_000 }],
    });
    const prescriptionBrand = await createMedicine(ingredient, {
      name: 'Prescription brand x30',
      price: 20_000,
      presentation: 'Caja x 30 tabletas',
      classification: 'prescription',
    });
    expect((await alternatives(prescriptionBrand.id)).items.map(item => item.productId)).toEqual([
      prescriptionOnly.id,
      samePack.id,
      brand.id,
    ]);
  });

  it('prices by the requested tier, falling back to tier 1 when unset', async () => {
    const ingredient = newIngredient();
    const brand = await createMedicine(ingredient, { name: 'Brand', price: 9_000, price2: 4_000 });
    const tierTwoOnly = await createMedicine(ingredient, {
      name: 'Wholesale generic',
      price: 9_500,
      price2: 2_500,
    });
    const retailOnly = await createMedicine(ingredient, { name: 'Retail generic', price: 3_000 });
    for (const product of [brand, tierTwoOnly, retailOnly]) await receiveLot(product.id);

    await expect(alternatives(brand.id)).resolves.toMatchObject({
      sourcePrice: 9_000,
      items: [{ productId: retailOnly.id, savings: 6_000 }],
    });
    await expect(alternatives(brand.id, { priceTier: 2 })).resolves.toMatchObject({
      sourcePrice: 4_000,
      items: [
        { productId: tierTwoOnly.id, price: 2_500, savings: 1_500 },
        { productId: retailOnly.id, price: 3_000, savings: 1_000 },
      ],
    });
  });

  it('returns nothing for products without an equivalence key or outside the tenant', async () => {
    const ingredient = newIngredient();
    const unspecified = await createMedicine(ingredient, {
      name: 'No concentration',
      price: 9_000,
      concentration: null,
    });
    await expect(alternatives(unspecified.id)).resolves.toEqual({ sourcePrice: 9_000, items: [] });

    const formIngredient = newIngredient();
    const noForm = await createMedicine(formIngredient, {
      name: 'No dosage form',
      price: 9_000,
      dosageForm: null,
    });
    const noFormCheaper = await createMedicine(formIngredient, {
      name: 'No dosage form generic',
      price: 2_000,
      dosageForm: null,
    });
    for (const product of [noForm, noFormCheaper]) await receiveLot(product.id);
    await expect(alternatives(noForm.id)).resolves.toEqual({ sourcePrice: 9_000, items: [] });
    await expect(alternatives('not-a-product')).resolves.toEqual({ sourcePrice: null, items: [] });
  });

  it('guards site scope and roles', async () => {
    const noSite = fresh({ role: 'cashier' });
    noSite.siteId = null;
    await expect(
      appRouter.createCaller(noSite).pharmacy.genericAlternatives({ productId: 'any' })
    ).rejects.toMatchObject({ cause: { errorCode: 'CASH_SESSION_SITE_REQUIRED' } });
    await expect(
      caller('cashier').pharmacy.genericAlternatives({
        productId: 'any',
        siteId: 'generic-foreign-site',
      })
    ).rejects.toThrow();
    await expect(
      caller('viewer').pharmacy.genericAlternatives({ productId: 'any' })
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
