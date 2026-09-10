/** Integration coverage for the factual, tenant-scoped vertical setup checklist. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  companies,
  inventoryTransformationRecipes,
  kdsStations,
  pharmacyProductProfiles,
  pharmacyProfessionalAuthorizations,
  products,
  restaurantTables,
  sitePeripherals,
  sites,
  tenantLocaleSettings,
  tenants,
  units,
  unitXProduct,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import type { VerticalPresetId } from '../services/modules/presets.js';
import {
  configurePharmacyEvidenceKey,
  digestPharmacyReference,
  sealPharmacyEvidence,
} from '../services/pharmacy/evidence-box.js';

const PHARMACY_EVIDENCE_KEY = 'vertical-readiness-pharmacy-evidence-key-2026';

interface TenantHarness {
  tenantId: string;
  adminId: string;
  cashierId: string;
  siteId: string;
  unitId: string;
}

let server: PuntovivoServer;

function contextFor(harness: TenantHarness, role: 'admin' | 'manager' | 'cashier' = 'admin') {
  const userId = role === 'cashier' ? harness.cashierId : harness.adminId;
  return {
    req: {
      server: server.app,
      headers: {},
      user: {
        userId,
        email: `${userId}@example.com`,
        role,
        tenantId: harness.tenantId,
      },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db: getDatabase(),
    user: {
      id: userId,
      email: `${userId}@example.com`,
      role,
      tenantId: harness.tenantId,
    },
    tenantId: harness.tenantId,
    siteId: harness.siteId,
  } satisfies Context;
}

function callerFor(harness: TenantHarness, role: 'admin' | 'manager' | 'cashier' = 'admin') {
  return appRouter.createCaller(contextFor(harness, role));
}

async function seedTenant(args: {
  businessType?: VerticalPresetId;
  countryCode?: string;
  modules?: Record<string, boolean>;
}): Promise<TenantHarness> {
  const db = getDatabase();
  const suffix = nanoid(8);
  const now = new Date().toISOString();
  const tenantId = nanoid();
  const companyId = nanoid();
  const siteId = nanoid();
  const adminId = nanoid();
  const cashierId = nanoid();
  const unitId = nanoid();

  await db.insert(tenants).values({
    id: tenantId,
    name: `Vertical readiness ${suffix}`,
    slug: `vertical-readiness-${suffix}`,
    settings: {
      ...(args.businessType ? { businessType: args.businessType } : {}),
      ...(args.modules ? { modules: args.modules } : {}),
    },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(tenantLocaleSettings).values({
    tenantId,
    countryCode: args.countryCode ?? 'CO',
  });
  await db.insert(companies).values({
    id: companyId,
    tenantId,
    name: `Company ${suffix}`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(sites).values({
    id: siteId,
    tenantId,
    companyId,
    name: `Site ${suffix}`,
    isActive: true,
  });
  await db.insert(users).values([
    {
      id: adminId,
      tenantId,
      email: `vertical-admin-${suffix}@example.com`,
      name: 'Vertical Admin',
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: cashierId,
      tenantId,
      email: `vertical-cashier-${suffix}@example.com`,
      name: 'Vertical Cashier',
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(units).values({
    id: unitId,
    tenantId,
    name: 'Unit',
    abbreviation: `u-${suffix}`,
    dimension: 'count',
    standardCode: 'H87',
    referenceFactor: 1,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  return { tenantId, adminId, cashierId, siteId, unitId };
}

async function seedProduct(
  harness: TenantHarness,
  args: {
    sellByFraction?: boolean;
    tracksLots?: boolean;
    tracksSerials?: boolean;
    classification?: 'otc' | 'prescription' | 'controlled';
    sanitaryRegistration?: string | null;
    registrationExpiresAt?: string | null;
  } = {}
): Promise<string> {
  const db = getDatabase();
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id,
    tenantId: harness.tenantId,
    name: `Readiness product ${id.slice(0, 6)}`,
    sku: `VR-${id}`,
    price: 100,
    sellByFraction: args.sellByFraction ?? false,
    tracksLots: args.tracksLots ?? false,
    tracksSerials: args.tracksSerials ?? false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(unitXProduct).values({
    id: nanoid(),
    productId: id,
    unitId: harness.unitId,
    equivalence: 1,
    price: 100,
    isBase: true,
  });
  if (args.classification) {
    await db.insert(pharmacyProductProfiles).values({
      productId: id,
      tenantId: harness.tenantId,
      classification: args.classification,
      sanitaryRegistration: args.sanitaryRegistration ?? null,
      registrationExpiresAt: args.registrationExpiresAt ?? null,
    });
  }
  return id;
}

async function seedPharmacyAuthorization(
  harness: TenantHarness,
  args: { countryCode: string; credential?: string }
): Promise<string> {
  const id = nanoid();
  const credential = args.credential ?? `credential-${id}`;
  const credentialType = args.countryCode === 'CO' ? 'regente' : 'license';
  const now = new Date().toISOString();
  await getDatabase()
    .insert(pharmacyProfessionalAuthorizations)
    .values({
      id,
      tenantId: harness.tenantId,
      userId: harness.adminId,
      countryCode: args.countryCode,
      credentialType,
      credentialDigest: digestPharmacyReference(credential, {
        purpose: 'professional-credential',
        tenantId: harness.tenantId,
        subjectId: args.countryCode,
      }),
      sealedCredential: sealPharmacyEvidence(
        { reference: credential, notes: credentialType },
        {
          purpose: 'professional-credential',
          tenantId: harness.tenantId,
          subjectId: id,
        }
      ),
      validFrom: '2026-01-01',
      status: 'active',
      createdBy: harness.adminId,
      createdAt: now,
      updatedAt: now,
    });
  return id;
}

function byId<T extends { id: string }>(rows: T[], id: string): T {
  const row = rows.find(candidate => candidate.id === id);
  if (!row) throw new Error(`Expected readiness check ${id}`);
  return row;
}

beforeAll(async () => {
  server = await createServer({
    dbPath: ':memory:',
    verbose: false,
    pharmacyEvidenceKey: PHARMACY_EVIDENCE_KEY,
  });
});

afterAll(async () => {
  await server.close();
});

describe('setupReadiness.vertical', () => {
  it('returns no invented checklist until the operator chooses a business type', async () => {
    const harness = await seedTenant({});
    await seedProduct(harness);

    await expect(callerFor(harness).setupReadiness.vertical()).resolves.toEqual({
      businessType: null,
      profile: null,
      checks: [],
      readyCount: 0,
      attentionCount: 0,
    });
  });

  it.each(['retail', 'wholesale'] as const)(
    'maps %s to the retail checklist and reports exact unit coverage',
    async businessType => {
      const harness = await seedTenant({
        businessType,
        modules: { 'customer-display': true },
      });
      await seedProduct(harness);

      const result = await callerFor(harness).setupReadiness.vertical();
      expect(result.businessType).toBe(businessType);
      expect(result.profile).toBe('retail');
      expect(result.checks.map(check => check.id)).toEqual([
        'catalog',
        'productUnits',
        'customerDisplay',
      ]);
      expect(result.checks.every(check => check.status === 'ready')).toBe(true);
      expect(result).toMatchObject({ readyCount: 3, attentionCount: 0 });
    }
  );

  it('keeps catalog and unit evidence isolated from a configured foreign tenant', async () => {
    const owner = await seedTenant({ businessType: 'retail' });
    const foreign = await seedTenant({ businessType: 'retail' });
    await seedProduct(foreign);

    const result = await callerFor(owner).setupReadiness.vertical();
    expect(byId(result.checks, 'catalog')).toMatchObject({
      status: 'attention',
      configuredCount: 0,
    });
    expect(byId(result.checks, 'productUnits')).toMatchObject({
      status: 'attention',
      configuredCount: 0,
    });
  });

  it('does not call an active product sellable when its only unit is inactive', async () => {
    const harness = await seedTenant({ businessType: 'retail' });
    await seedProduct(harness);
    await getDatabase().update(units).set({ isActive: false }).where(eq(units.id, harness.unitId));

    const result = await callerFor(harness).setupReadiness.vertical();
    expect(byId(result.checks, 'catalog')).toMatchObject({ status: 'ready', configuredCount: 1 });
    expect(byId(result.checks, 'productUnits')).toMatchObject({
      status: 'attention',
      configuredCount: 0,
    });
  });

  it('requires complete pharmacy lot, registration, policy and same-country authorization evidence', async () => {
    const harness = await seedTenant({ businessType: 'pharmacy', countryCode: 'CO' });
    await seedProduct(harness, {
      tracksLots: true,
      classification: 'otc',
      sanitaryRegistration: 'INVIMA-OTC',
    });
    await seedProduct(harness, {
      tracksLots: true,
      classification: 'prescription',
      sanitaryRegistration: 'INVIMA-RX',
    });
    await seedPharmacyAuthorization(harness, { countryCode: 'MX' });

    const withoutCountryCredential = await callerFor(harness).setupReadiness.vertical();
    expect(byId(withoutCountryCredential.checks, 'lotTracking').status).toBe('ready');
    expect(byId(withoutCountryCredential.checks, 'pharmacyPolicy').status).toBe('ready');
    expect(byId(withoutCountryCredential.checks, 'pharmacyAuthorizations')).toMatchObject({
      status: 'attention',
      configuredCount: 0,
    });

    const authorizationId = await seedPharmacyAuthorization(harness, { countryCode: 'CO' });
    const configured = await callerFor(harness).setupReadiness.vertical();
    expect(byId(configured.checks, 'pharmacyAuthorizations')).toMatchObject({
      status: 'ready',
      configuredCount: 1,
    });

    await getDatabase()
      .update(pharmacyProfessionalAuthorizations)
      .set({ sealedCredential: 'corrupt-credential' })
      .where(eq(pharmacyProfessionalAuthorizations.id, authorizationId));
    const corruptCredential = await callerFor(harness).setupReadiness.vertical();
    expect(byId(corruptCredential.checks, 'pharmacyAuthorizations')).toMatchObject({
      status: 'attention',
      configuredCount: 0,
    });

    await getDatabase()
      .delete(pharmacyProfessionalAuthorizations)
      .where(eq(pharmacyProfessionalAuthorizations.id, authorizationId));
    await seedPharmacyAuthorization(harness, { countryCode: 'CO' });

    configurePharmacyEvidenceKey(undefined);
    try {
      const unavailableKey = await callerFor(harness).setupReadiness.vertical();
      expect(byId(unavailableKey.checks, 'pharmacyAuthorizations')).toMatchObject({
        status: 'attention',
        configuredCount: 0,
      });
    } finally {
      configurePharmacyEvidenceKey(PHARMACY_EVIDENCE_KEY);
    }

    await getDatabase().update(users).set({ isActive: false }).where(eq(users.id, harness.adminId));
    const inactiveProfessional = await callerFor(harness).setupReadiness.vertical();
    expect(byId(inactiveProfessional.checks, 'pharmacyAuthorizations')).toMatchObject({
      status: 'attention',
      configuredCount: 0,
    });
  });

  it('does not call an expired sanitary registration policy-ready', async () => {
    const harness = await seedTenant({ businessType: 'pharmacy', countryCode: 'CO' });
    await seedProduct(harness, {
      classification: 'otc',
      sanitaryRegistration: 'INVIMA-EXPIRED',
      registrationExpiresAt: '2000-01-01',
      tracksLots: true,
    });

    const result = await callerFor(harness).setupReadiness.vertical();
    expect(byId(result.checks, 'pharmacyPolicy')).toMatchObject({
      status: 'attention',
      configuredCount: 0,
    });
  });

  it('fails pharmacy safety readiness closed for incomplete or unsupported products', async () => {
    const colombia = await seedTenant({ businessType: 'pharmacy', countryCode: 'CO' });
    await seedProduct(colombia, {
      classification: 'prescription',
      sanitaryRegistration: null,
      tracksLots: false,
    });
    const incomplete = await callerFor(colombia).setupReadiness.vertical();
    expect(byId(incomplete.checks, 'lotTracking').status).toBe('attention');
    expect(byId(incomplete.checks, 'pharmacyPolicy').status).toBe('attention');

    const unsupported = await seedTenant({ businessType: 'pharmacy', countryCode: 'PE' });
    await seedProduct(unsupported, {
      classification: 'prescription',
      sanitaryRegistration: 'PE-RX',
      tracksLots: true,
    });
    const unsupportedResult = await callerFor(unsupported).setupReadiness.vertical();
    expect(byId(unsupportedResult.checks, 'pharmacyPolicy')).toMatchObject({
      status: 'attention',
      configuredCount: 0,
    });
  });

  it('recognizes the hardware and butchery setup sources without mixing recipe kinds', async () => {
    const hardware = await seedTenant({ businessType: 'hardware' });
    await seedProduct(hardware, { sellByFraction: true, tracksSerials: true });
    await getDatabase().insert(inventoryTransformationRecipes).values({
      id: nanoid(),
      tenantId: hardware.tenantId,
      name: 'Cut cable',
      kind: 'cut',
      createdBy: hardware.adminId,
    });
    const hardwareResult = await callerFor(hardware).setupReadiness.vertical();
    for (const id of ['fractionalSales', 'serializedInventory', 'transformationRecipes']) {
      expect(byId(hardwareResult.checks, id).status).toBe('ready');
    }

    const butchery = await seedTenant({ businessType: 'butchery' });
    await seedProduct(butchery, { sellByFraction: true, tracksLots: true });
    await getDatabase()
      .insert(sitePeripherals)
      .values({
        id: nanoid(),
        tenantId: butchery.tenantId,
        siteId: butchery.siteId,
        kind: 'scanner',
        driver: 'wedge',
        config: { gs1Scheme: 'co' },
        isActive: true,
      });
    await getDatabase().insert(inventoryTransformationRecipes).values({
      id: nanoid(),
      tenantId: butchery.tenantId,
      name: 'Carcass breakdown',
      kind: 'disassembly',
      createdBy: butchery.adminId,
    });
    const butcheryResult = await callerFor(butchery).setupReadiness.vertical();
    for (const id of [
      'fractionalSales',
      'lotTracking',
      'weightedBarcode',
      'transformationRecipes',
    ]) {
      expect(byId(butcheryResult.checks, id).status).toBe('ready');
    }
  });

  it.each(['restaurant', 'quickservice'] as const)(
    'maps %s to the restaurant checklist and honors optional module applicability',
    async businessType => {
      const harness = await seedTenant({
        businessType,
        modules: { 'dine-in': true, kds: true, 'customer-display': true },
      });
      await seedProduct(harness);
      await getDatabase().insert(restaurantTables).values({
        id: nanoid(),
        tenantId: harness.tenantId,
        siteId: harness.siteId,
        name: 'Table 1',
        isActive: true,
      });
      await getDatabase().insert(kdsStations).values({
        id: nanoid(),
        tenantId: harness.tenantId,
        siteId: harness.siteId,
        code: 'hot',
        name: 'Hot line',
        isActive: true,
      });
      await getDatabase().insert(inventoryTransformationRecipes).values({
        id: nanoid(),
        tenantId: harness.tenantId,
        name: 'Prepared dish',
        kind: 'recipe',
        createdBy: harness.adminId,
      });

      const result = await callerFor(harness).setupReadiness.vertical();
      expect(result.profile).toBe('restaurant');
      expect(result.checks.every(check => check.status === 'ready')).toBe(true);
    }
  );

  it('marks disabled restaurant surfaces and Customer Display as optional, not broken', async () => {
    const harness = await seedTenant({ businessType: 'restaurant' });
    await seedProduct(harness);
    const result = await callerFor(harness).setupReadiness.vertical();

    for (const id of ['restaurantTables', 'kdsStations', 'customerDisplay']) {
      expect(byId(result.checks, id)).toMatchObject({
        status: 'not-applicable',
        configuredCount: 0,
        cta: null,
      });
    }
  });

  it('rejects cashier access to tenant-wide configuration evidence', async () => {
    const harness = await seedTenant({ businessType: 'retail' });
    await expect(callerFor(harness, 'cashier').setupReadiness.vertical()).rejects.toThrow(
      /administrators|managers/i
    );
  });

  it('reflects a persisted profile change without mutating catalog data', async () => {
    const harness = await seedTenant({ businessType: 'hardware' });
    await seedProduct(harness, { tracksSerials: true });
    const before = await callerFor(harness).setupReadiness.vertical();
    expect(before.profile).toBe('hardware');

    const row = await getDatabase()
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, harness.tenantId))
      .get();
    await getDatabase()
      .update(tenants)
      .set({ settings: { ...(row?.settings ?? {}), businessType: 'retail' } })
      .where(eq(tenants.id, harness.tenantId));

    const after = await callerFor(harness).setupReadiness.vertical();
    expect(after.profile).toBe('retail');
    expect(after.checks.some(check => check.id === 'serializedInventory')).toBe(false);
    expect(
      await getDatabase()
        .select({ total: products.id })
        .from(products)
        .where(eq(products.tenantId, harness.tenantId))
        .all()
    ).toHaveLength(1);
  });
});
