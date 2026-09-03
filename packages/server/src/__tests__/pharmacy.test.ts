import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { completeSale } from '../application/sales/completeSale.js';
import { findEffectivePharmacyAuthorization } from '../application/pharmacy/authorizations.js';
import type { CompleteSaleContext } from '../application/sales/types.js';
import { getDatabase } from '../db/index.js';
import {
  companies,
  customers,
  inventoryBalances,
  inventoryLotEvents,
  inventoryLots,
  inventoryMovements,
  pharmacyDispensations,
  pharmacyEvidenceKeys,
  pharmacyPrescriptionEvidence,
  pharmacyProfessionalAuthorizations,
  pharmacyRecallLots,
  pharmacyRecalls,
  products,
  saleItemLots,
  saleItems,
  sales,
  sites,
  syncOutbox,
  tenantLocaleSettings,
  tenants,
  units,
  users,
} from '../db/schema.js';
import { createServer, type PuntovivoServer } from '../index.js';
import { addCalendarDays } from '../services/reports/day-window.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import {
  assertTenantBusinessClockCurrent,
  resolveTenantBusinessClock,
} from '../services/pharmacy/business-clock.js';
import {
  digestPharmacyReference,
  sealPharmacyEvidence,
} from '../services/pharmacy/evidence-box.js';
import { resolvePharmacyPolicy } from '../services/pharmacy/policy.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let baseUnitId: string;
let businessDate: string;
let fresh: ReturnType<typeof makeFreshContextFactory>;
let recordedEvidenceId: string;
let recordedRecallId: string;

function sqliteClient(): Database.Database {
  return (getDatabase() as unknown as { $client: Database.Database }).$client;
}

function caller() {
  return appRouter.createCaller(fresh());
}

function saleContext(): CompleteSaleContext {
  return {
    db: getDatabase(),
    tenantId,
    siteId,
    user: { id: userId, role: 'admin' },
    envelope: null,
    deviceId: null,
  };
}

async function createMedicine(args: {
  classification: 'otc' | 'prescription' | 'controlled';
  suffix: string;
  requiresColdChain?: boolean;
}) {
  return caller().products.create({
    name: `Medicine ${args.classification} ${args.suffix}`,
    sku: `MED-${args.classification.toUpperCase()}-${args.suffix}`,
    price: 100,
    cost: 40,
    initialCost: 40,
    tracksStock: true,
    tracksLots: true,
    tracksSerials: false,
    pharmacy: {
      activeIngredient: `Ingredient ${args.suffix}`,
      genericName: `Generic ${args.suffix}`,
      concentration: '500 mg',
      dosageForm: 'tablet',
      administrationRoute: 'oral',
      presentation: 'box',
      manufacturer: `Laboratory ${args.suffix}`,
      authorizationHolder: `Holder ${args.suffix}`,
      sanitaryRegistration: `INVIMA-${args.suffix}`,
      registrationExpiresAt: addCalendarDays(businessDate, 365),
      classification: args.classification,
      storageConditions: 'Store according to labeled conditions',
      requiresColdChain: args.requiresColdChain ?? false,
    },
  });
}

async function receiveLot(args: {
  productId: string;
  lotNumber: string;
  expiresInDays: number;
  quantity: number;
}) {
  return caller().inventoryLots.receive({
    siteId,
    productId: args.productId,
    lotNumber: args.lotNumber,
    expiresAt: addCalendarDays(businessDate, args.expiresInDays),
    quantity: args.quantity,
    unitCost: 40,
    notes: `Receipt ${args.lotNumber}`,
  });
}

async function sell(args: {
  productId: string;
  quantity: number;
  customerId?: string | null;
  evidenceIds?: string[];
}) {
  return completeSale(saleContext(), {
    mode: 'fresh',
    customerId: args.customerId ?? null,
    items: [
      {
        productId: args.productId,
        unitId: baseUnitId,
        quantity: args.quantity,
        unitPrice: 100,
        discount: 0,
      },
    ],
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    amountReceived: args.quantity * 100,
    discountAmount: 0,
    pharmacyEvidenceIds: args.evidenceIds ?? [],
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
  const baseUnit = (
    await db.select().from(units).where(eq(units.tenantId, admin.tenantId)).all()
  ).find(unit => unit.abbreviation === 'UND');
  if (!baseUnit) throw new Error('Expected seeded base unit');

  tenantId = admin.tenantId;
  userId = admin.id;
  siteId = site.id;
  baseUnitId = baseUnit.id;
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
  const device = await registerDeviceService(db, {
    tenantId,
    userId,
    kind: 'web',
    name: 'pharmacy.test',
  });
  fresh = makeFreshContextFactory({
    db,
    serverApp: server.app,
    tenantId,
    userId,
    email: admin.email,
    siteId,
    deviceId: device.deviceId,
    defaultRole: 'admin',
  });
  await caller().cashSessions.open({
    registerName: 'pharmacy-test-register',
    openingFloat: 1_000,
    denominations: [{ value: 100, count: 10 }],
  });
});

afterAll(async () => {
  await server.close();
});

describe('pharmacy daily-operation invariants', () => {
  it('exposes the tenant business date instead of relying on the operator device clock', async () => {
    await expect(caller().pharmacy.context()).resolves.toEqual({
      countryCode: 'CO',
      businessDate,
      canApproveEvidence: false,
      approvalCapabilityErrorCode: null,
      hasOperationalData: false,
    });
  });

  it('fails closed when pharmacy checkout has no active site', async () => {
    const context = fresh();
    context.siteId = null;
    await expect(
      appRouter.createCaller(context).pharmacy.checkoutRequirements({
        customerId: null,
        items: [{ productId: 'unreachable-without-site', quantity: 1, unitEquivalence: 1 }],
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'CASH_SESSION_SITE_REQUIRED' },
    });
  });

  it('keeps pharmacy operations discoverable after the tenant changes vertical preset', async () => {
    const db = getDatabase();
    const tenant = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .get();
    if (!tenant) throw new Error('Expected pharmacy test tenant');

    await createMedicine({ classification: 'otc', suffix: nanoid(6) });
    try {
      await db
        .update(tenants)
        .set({ settings: { ...tenant.settings, businessType: 'retail' } })
        .where(eq(tenants.id, tenantId));

      await expect(caller().pharmacy.context()).resolves.toMatchObject({
        hasOperationalData: true,
      });
    } finally {
      await db.update(tenants).set({ settings: tenant.settings }).where(eq(tenants.id, tenantId));
    }
  });

  it('rejects a stale regulatory clock after tenant locale settings change', async () => {
    const db = getDatabase();
    const staleClock = await resolveTenantBusinessClock(db, tenantId);
    expect(() => assertTenantBusinessClockCurrent(db, tenantId, staleClock)).not.toThrow();

    db.update(tenantLocaleSettings)
      .set({ version: staleClock.localeVersion + 1 })
      .where(eq(tenantLocaleSettings.tenantId, tenantId))
      .run();

    expect(() => assertTenantBusinessClockCurrent(db, tenantId, staleClock)).toThrow(
      /Tenant locale changed/i
    );
    const refreshedClock = await resolveTenantBusinessClock(db, tenantId);
    expect(() => assertTenantBusinessClockCurrent(db, tenantId, refreshedClock)).not.toThrow();
  });

  it('rejects a regulatory command that acquires the writer on a later local day', async () => {
    const db = getDatabase();
    const resolvedAt = new Date('2026-08-08T12:00:00.000Z');
    const queuedClock = await resolveTenantBusinessClock(db, tenantId, resolvedAt);
    expect(() =>
      assertTenantBusinessClockCurrent(db, tenantId, queuedClock, resolvedAt)
    ).not.toThrow();

    const acquiredAfterMidnight = new Date(resolvedAt.getTime() + 24 * 60 * 60 * 1000);
    expect(() =>
      assertTenantBusinessClockCurrent(db, tenantId, queuedClock, acquiredAfterMidnight)
    ).toThrow(/business date changed/i);
  });

  it('detects a newly configured version-zero locale after resolving fallback policy', async () => {
    const db = getDatabase();
    const unconfiguredTenantId = `pharmacy-clock-${nanoid(12)}`;
    const now = new Date('2026-08-08T12:00:00.000Z');
    await db.insert(tenants).values({
      id: unconfiguredTenantId,
      name: 'Unconfigured pharmacy clock tenant',
      slug: unconfiguredTenantId,
      settings: {},
      isActive: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    const fallbackClock = await resolveTenantBusinessClock(db, unconfiguredTenantId, now);
    expect(fallbackClock).toMatchObject({
      countryCode: 'US',
      timezone: 'America/New_York',
      localeVersion: 0,
    });

    await db.insert(tenantLocaleSettings).values({
      tenantId: unconfiguredTenantId,
      countryCode: 'CO',
      version: 0,
    });
    expect(() =>
      assertTenantBusinessClockCurrent(db, unconfiguredTenantId, fallbackClock, now)
    ).toThrow(/Tenant locale changed/i);
  });

  it('selects site-scoped professional authority deterministically over tenant-wide authority', async () => {
    const globalAuthorization = await caller().pharmacy.createAuthorization({
      userId,
      countryCode: 'CO',
      credentialType: 'pharmacist-license',
      credential: `RETHUS-GLOBAL-${nanoid(8)}`,
      validFrom: businessDate,
    });
    const siteAuthorization = await caller().pharmacy.createAuthorization({
      userId,
      siteId,
      countryCode: 'CO',
      credentialType: 'pharmacist-license',
      credential: `RETHUS-SITE-${nanoid(8)}`,
      validFrom: businessDate,
    });

    expect(
      findEffectivePharmacyAuthorization(getDatabase(), {
        tenantId,
        userId,
        siteId,
        countryCode: 'CO',
        businessDate,
      })?.id
    ).toBe(siteAuthorization.id);

    await caller().pharmacy.revokeAuthorization({
      id: siteAuthorization.id,
      reason: 'Deterministic scope precedence regression cleanup',
    });
    await caller().pharmacy.revokeAuthorization({
      id: globalAuthorization.id,
      reason: 'Deterministic scope precedence regression cleanup',
    });
  });

  it('retains pharmacy records through customer privacy disposal without leaking sealed evidence', async () => {
    const db = getDatabase();
    const medicine = await createMedicine({
      classification: 'prescription',
      suffix: nanoid(6),
    });
    const customer = await caller().customers.create({
      name: `Pharmacy privacy customer ${nanoid(6)}`,
      email: `pharmacy-privacy-${nanoid(6)}@example.test`,
    });
    const reference = `RX-PRIVACY-${nanoid(10)}`;
    const evidence = await caller().pharmacy.recordEvidence({
      productId: medicine.id,
      customerId: customer.id,
      reference,
      prescriberName: 'Private Prescriber',
      prescriberCredential: `MED-${nanoid(8)}`,
      authorizedQuantity: 1,
      validFrom: businessDate,
      expiresAt: addCalendarDays(businessDate, 30),
    });

    const exported = await caller().customers.exportPersonalData({ id: customer.id });
    expect(exported.schemaVersion).toBe(5);
    expect(exported.records.pharmacyPrescriptionEvidence).toEqual([
      expect.objectContaining({
        id: evidence.id,
        productId: medicine.id,
        status: 'pending',
        authorizedQuantity: 1,
      }),
    ]);
    expect(exported.records.pharmacyDispensations).toEqual([]);
    const serializedExport = JSON.stringify(exported);
    expect(serializedExport).not.toContain(reference);
    expect(serializedExport).not.toContain('sealedEvidence');
    expect(serializedExport).not.toContain('referenceDigest');

    const preview = await caller().customers.previewPersonalDataDisposition({ id: customer.id });
    expect(preview).toMatchObject({
      disposition: 'anonymize',
      totalLinkedRecords: 1,
      linkedRecordCounts: {
        pharmacyPrescriptionEvidence: 1,
        pharmacyDispensations: 0,
      },
    });
    await expect(
      caller().customers.disposePersonalData({
        id: customer.id,
        version: preview.customer.version,
        confirmation: preview.customer.name,
      })
    ).resolves.toEqual({ success: true, id: customer.id, disposition: 'anonymized' });
    expect(
      await db
        .select({ privacyStatus: customers.privacyStatus, isActive: customers.isActive })
        .from(customers)
        .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customer.id)))
        .get()
    ).toEqual({ privacyStatus: 'anonymized', isActive: false });
    expect(
      await db
        .select({ id: pharmacyPrescriptionEvidence.id })
        .from(pharmacyPrescriptionEvidence)
        .where(
          and(
            eq(pharmacyPrescriptionEvidence.tenantId, tenantId),
            eq(pharmacyPrescriptionEvidence.id, evidence.id)
          )
        )
        .get()
    ).toEqual({ id: evidence.id });
  });

  it('renews professional credentials without permitting overlapping active periods', async () => {
    const renewalUserId = `pharmacy-renewal-user-${nanoid(8)}`;
    const now = new Date().toISOString();
    await getDatabase()
      .insert(users)
      .values({
        id: renewalUserId,
        tenantId,
        email: `${renewalUserId}@example.test`,
        name: 'Pharmacy Renewal Employee',
        passwordHash: 'not-a-real-password-hash',
        role: 'cashier',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const company = await getDatabase()
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.tenantId, tenantId))
      .get();
    if (!company) throw new Error('Expected seeded pharmacy company');
    const secondarySite = await caller().sites.create({
      companyId: company.id,
      name: `Pharmacy renewal site ${nanoid(6)}`,
      isActive: true,
    });
    const credential = `RETHUS-RENEW-${nanoid(12)}`;
    const expired = await caller().pharmacy.createAuthorization({
      userId: renewalUserId,
      siteId,
      countryCode: 'CO',
      credentialType: 'pharmacist-license',
      credential,
      validFrom: addCalendarDays(businessDate, -30),
      validUntil: addCalendarDays(businessDate, -1),
    });
    const renewed = await caller().pharmacy.createAuthorization({
      userId: renewalUserId,
      siteId,
      countryCode: 'CO',
      credentialType: 'pharmacist-license',
      credential,
      validFrom: businessDate,
      validUntil: addCalendarDays(businessDate, 365),
    });

    expect(renewed.id).not.toBe(expired.id);
    await expect(
      caller().pharmacy.createAuthorization({
        userId: renewalUserId,
        siteId: secondarySite.id,
        countryCode: 'CO',
        credentialType: 'pharmacist-license',
        credential,
        validFrom: businessDate,
        validUntil: addCalendarDays(businessDate, 365),
      })
    ).resolves.toMatchObject({ status: 'active' });
    await expect(
      caller().pharmacy.createAuthorization({
        userId: renewalUserId,
        siteId,
        countryCode: 'CO',
        credentialType: 'pharmacist-license',
        credential,
        validFrom: addCalendarDays(businessDate, 30),
        validUntil: addCalendarDays(businessDate, 400),
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'PHARMACY_AUTHORIZATION_DUPLICATE' } });
    await expect(
      caller().pharmacy.createAuthorization({
        userId: renewalUserId,
        siteId: null,
        countryCode: 'CO',
        credentialType: 'pharmacist-license',
        credential,
        validFrom: businessDate,
        validUntil: addCalendarDays(businessDate, 365),
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'PHARMACY_AUTHORIZATION_DUPLICATE' } });

    await caller().pharmacy.revokeAuthorization({
      id: renewed.id,
      reason: 'Credential replaced by a corrected effective period',
    });
    await expect(
      caller().pharmacy.createAuthorization({
        userId: renewalUserId,
        siteId,
        countryCode: 'CO',
        credentialType: 'pharmacist-license',
        credential,
        validFrom: businessDate,
        validUntil: addCalendarDays(businessDate, 365),
      })
    ).resolves.toMatchObject({ status: 'active' });
  });

  it('keeps a preventive product recall active for lots received later', async () => {
    const db = getDatabase();
    const medicine = await createMedicine({ classification: 'otc', suffix: nanoid(6) });
    const recall = await caller().pharmacy.createRecall({
      scopeType: 'product',
      productId: medicine.id,
      reason: 'Preventive withdrawal before the shipment arrives',
    });
    expect(recall).toMatchObject({ status: 'active', lotCount: 0 });
    await expect(
      caller().products.update({ id: medicine.id, version: medicine.version, pharmacy: null })
    ).rejects.toMatchObject({
      cause: {
        errorCode: 'PHARMACY_PRODUCT_PROFILE_LOCKED',
        details: expect.objectContaining({ reason: 'active_recall' }),
      },
    });

    const received = await receiveLot({
      productId: medicine.id,
      lotNumber: `PREVENTIVE-RECALL-${nanoid(5)}`,
      expiresInDays: 180,
      quantity: 2,
    });
    expect(received.status).toBe('recalled');
    expect(
      await db
        .select({ previousStatus: pharmacyRecallLots.previousStatus })
        .from(pharmacyRecallLots)
        .where(
          and(
            eq(pharmacyRecallLots.tenantId, tenantId),
            eq(pharmacyRecallLots.recallId, recall.id),
            eq(pharmacyRecallLots.lotId, received.lotId)
          )
        )
        .get()
    ).toEqual({ previousStatus: 'active' });
    await caller().pharmacy.closeRecall({
      id: recall.id,
      reason: 'Preventive campaign formally closed',
    });
    await expect(
      caller().pharmacy.transitionLot({
        lotId: received.lotId,
        action: 'release',
        reason: 'Manager verified the newly received batch',
      })
    ).resolves.toMatchObject({ status: 'active' });
  });

  it('retains a voided completed sale in the recall exposure history', async () => {
    const medicine = await createMedicine({ classification: 'otc', suffix: nanoid(6) });
    const lot = await receiveLot({
      productId: medicine.id,
      lotNumber: `VOIDED-EXPOSURE-${nanoid(5)}`,
      expiresInDays: 180,
      quantity: 1,
    });
    const customer = await caller().customers.create({
      name: `Voided recall customer ${nanoid(6)}`,
    });
    const completed = await sell({
      productId: medicine.id,
      quantity: 1,
      customerId: customer.id,
    });
    await caller().sales.void({
      id: completed.sale.id,
      reason: 'Administrative void after the medicine left custody',
    });

    const recall = await caller().pharmacy.createRecall({
      scopeType: 'lot',
      lotId: lot.lotId,
      reason: 'Retrospective manufacturer withdrawal',
    });
    await expect(
      caller().pharmacy.affectedSales({ id: recall.id, page: 1, perPage: 20 })
    ).resolves.toMatchObject({
      total: 1,
      items: [
        expect.objectContaining({
          saleId: completed.sale.id,
          lotId: lot.lotId,
          customerId: customer.id,
        }),
      ],
    });
    await caller().pharmacy.closeRecall({
      id: recall.id,
      reason: 'Exposure history verified and campaign handed off',
    });
  });

  it('sells OTC by FEFO, blocks recalls, and requires explicit safe release', async () => {
    const db = getDatabase();
    const medicine = await createMedicine({ classification: 'otc', suffix: nanoid(6) });
    const expired = await receiveLot({
      productId: medicine.id,
      lotNumber: `OTC-EXPIRED-${nanoid(4)}`,
      expiresInDays: -1,
      quantity: 2,
    });
    const soon = await receiveLot({
      productId: medicine.id,
      lotNumber: `OTC-SOON-${nanoid(4)}`,
      expiresInDays: 10,
      quantity: 2,
    });
    const later = await receiveLot({
      productId: medicine.id,
      lotNumber: `OTC-LATER-${nanoid(4)}`,
      expiresInDays: 30,
      quantity: 3,
    });
    const recallCustomer = await caller().customers.create({
      name: `Recall customer ${nanoid(6)}`,
      email: `recall-${nanoid(6)}@example.test`,
      phone: '+57 300 555 0199',
    });

    const completed = await sell({
      productId: medicine.id,
      quantity: 3,
      customerId: recallCustomer.id,
    });
    const saleId = completed.sale.id;
    const lots = await db
      .select({
        id: inventoryLots.id,
        onHand: inventoryLots.onHand,
        status: inventoryLots.status,
        syncVersion: inventoryLots.syncVersion,
      })
      .from(inventoryLots)
      .where(inArray(inventoryLots.id, [expired.lotId, soon.lotId, later.lotId]))
      .all();
    const byId = new Map(lots.map(lot => [lot.id, lot]));
    expect(byId.get(expired.lotId)).toMatchObject({ onHand: 2, status: 'expired', syncVersion: 0 });
    expect(byId.get(soon.lotId)).toMatchObject({ onHand: 0, status: 'depleted', syncVersion: 1 });
    expect(byId.get(later.lotId)).toMatchObject({ onHand: 2, status: 'active', syncVersion: 1 });

    const line = await db
      .select({ id: saleItems.id })
      .from(saleItems)
      .where(eq(saleItems.saleId, saleId))
      .get();
    expect(line).toBeTruthy();
    const provenance = await db
      .select({ lotId: saleItemLots.lotId, quantity: saleItemLots.quantity })
      .from(saleItemLots)
      .where(eq(saleItemLots.saleItemId, line!.id))
      .all();
    expect(provenance).toEqual([
      { lotId: soon.lotId, quantity: 2 },
      { lotId: later.lotId, quantity: 1 },
    ]);
    const balance = await db
      .select({ onHand: inventoryBalances.onHand })
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, tenantId),
          eq(inventoryBalances.siteId, siteId),
          eq(inventoryBalances.productId, medicine.id)
        )
      )
      .get();
    const lotTotal = Number(
      (
        await db
          .select({ total: sql<number>`sum(${inventoryLots.onHand})` })
          .from(inventoryLots)
          .where(
            and(eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.productId, medicine.id))
          )
          .get()
      )?.total ?? 0
    );
    expect(balance?.onHand).toBe(4);
    expect(lotTotal).toBe(4);

    const recall = await caller().pharmacy.createRecall({
      scopeType: 'lot',
      lotId: later.lotId,
      reason: 'Manufacturer quality withdrawal',
    });
    recordedRecallId = recall.id;
    await expect(
      caller().inventoryLots.list({ siteId, productId: medicine.id, activeOnly: false })
    ).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ id: later.lotId, activeRecallCount: 1 }),
      ]),
    });
    await expect(
      caller().pharmacy.listRecalls({ page: 99, perPage: 1, status: 'active' })
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          id: recall.id,
          lotNumber: expect.stringMatching(/^OTC-LATER-/),
        }),
      ],
      total: 1,
      page: 1,
      perPage: 1,
    });
    await expect(
      caller().pharmacy.getRecall({ id: recall.id, page: 99, perPage: 1 })
    ).resolves.toMatchObject({
      id: recall.id,
      lotNumber: expect.stringMatching(/^OTC-LATER-/),
      lots: [expect.objectContaining({ lotId: later.lotId })],
      lotsTotal: 1,
      lotsPage: 1,
      lotsPerPage: 1,
    });
    await expect(
      caller().pharmacy.affectedSales({ id: recall.id, page: 99, perPage: 1 })
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          saleId,
          lotId: later.lotId,
          customerId: recallCustomer.id,
          customerName: recallCustomer.name,
          customerEmail: recallCustomer.email,
          customerPhone: recallCustomer.phone,
          customerIdentityRestricted: false,
        }),
      ],
      total: 1,
      page: 1,
      perPage: 1,
    });
    await expect(
      appRouter
        .createCaller(fresh({ role: 'manager' }))
        .pharmacy.affectedSales({ id: recall.id, page: 1, perPage: 1 })
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          saleId,
          customerId: null,
          customerName: null,
          customerEmail: null,
          customerPhone: null,
          customerIdentityRestricted: true,
        }),
      ],
    });
    await expect(
      appRouter
        .createCaller(fresh({ role: 'cashier' }))
        .pharmacy.affectedSales({ id: recall.id, page: 1, perPage: 1 })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const saleCountBefore = Number(
      (
        await db
          .select({ count: sql<number>`count(*)` })
          .from(sales)
          .get()
      )?.count ?? 0
    );
    await expect(sell({ productId: medicine.id, quantity: 1 })).rejects.toMatchObject({
      cause: { errorCode: 'LOT_STOCK_INCONSISTENT' },
    });
    expect(
      Number(
        (
          await db
            .select({ count: sql<number>`count(*)` })
            .from(sales)
            .get()
        )?.count ?? 0
      )
    ).toBe(saleCountBefore);

    const closed = await caller().pharmacy.closeRecall({
      id: recall.id,
      reason: 'Recall scope reviewed and closed',
    });
    expect(closed.lotsRemainBlocked).toBe(true);
    await expect(
      caller().inventoryLots.list({ siteId, productId: medicine.id, activeOnly: false })
    ).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ id: later.lotId, activeRecallCount: 0 }),
      ]),
    });
    await expect(sell({ productId: medicine.id, quantity: 1 })).rejects.toMatchObject({
      cause: { errorCode: 'LOT_STOCK_INCONSISTENT' },
    });
    await expect(
      caller().pharmacy.transitionLot({
        lotId: later.lotId,
        action: 'release',
        reason: 'Manager verified release evidence',
      })
    ).resolves.toMatchObject({ previousStatus: 'recalled', status: 'active' });
    await expect(sell({ productId: medicine.id, quantity: 1 })).resolves.toBeTruthy();

    const recallLot = await db
      .select()
      .from(pharmacyRecallLots)
      .where(eq(pharmacyRecallLots.recallId, recall.id))
      .get();
    const lotEvent = await db
      .select()
      .from(inventoryLotEvents)
      .where(eq(inventoryLotEvents.lotId, later.lotId))
      .get();
    expect(recallLot).toBeTruthy();
    expect(lotEvent).toBeTruthy();
    expect(() =>
      sqliteClient()
        .prepare('UPDATE pharmacy_recall_lots SET previous_status = ? WHERE recall_id = ?')
        .run('expired', recall.id)
    ).toThrow(/immutable/);
    expect(() =>
      sqliteClient().prepare('DELETE FROM inventory_lot_events WHERE id = ?').run(lotEvent!.id)
    ).toThrow(/immutable/);
  });

  it('scopes provider recalls to immutable lot receipt provenance', async () => {
    const db = getDatabase();
    const medicine = await createMedicine({ classification: 'otc', suffix: nanoid(6) });
    const primarySite = await db
      .select({ companyId: sites.companyId })
      .from(sites)
      .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId)))
      .get();
    if (!primarySite) throw new Error('Expected primary pharmacy site');
    const secondarySiteId = nanoid();
    const now = new Date().toISOString();
    await db.insert(sites).values({
      id: secondarySiteId,
      tenantId,
      companyId: primarySite.companyId,
      name: `Pharmacy recall destination ${nanoid(5)}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const providerA = await caller().providers.create({
      name: `Pharmacy supplier A ${nanoid(6)}`,
      isActive: true,
    });
    const providerB = await caller().providers.create({
      name: `Pharmacy supplier B ${nanoid(6)}`,
      isActive: true,
    });
    const purchaseA = await caller().purchases.create({
      providerId: providerA.id,
      items: [
        {
          productId: medicine.id,
          unitId: baseUnitId,
          quantity: 2,
          costPerUnit: 40,
          lotReceipts: [
            {
              lotNumber: `SUPPLIER-A-${nanoid(5)}`,
              expiresAt: addCalendarDays(businessDate, 90),
              baseQuantity: 2,
            },
          ],
        },
      ],
    });
    const purchaseB = await caller().purchases.create({
      providerId: providerB.id,
      items: [
        {
          productId: medicine.id,
          unitId: baseUnitId,
          quantity: 3,
          costPerUnit: 40,
          lotReceipts: [
            {
              lotNumber: `SUPPLIER-B-${nanoid(5)}`,
              expiresAt: addCalendarDays(businessDate, 120),
              baseQuantity: 3,
            },
          ],
        },
      ],
    });
    const voidedPurchaseA = await caller().purchases.create({
      providerId: providerA.id,
      items: [
        {
          productId: medicine.id,
          unitId: baseUnitId,
          quantity: 1,
          costPerUnit: 40,
          lotReceipts: [
            {
              lotNumber: `SUPPLIER-A-VOIDED-${nanoid(5)}`,
              expiresAt: addCalendarDays(businessDate, 120),
              baseQuantity: 1,
            },
          ],
        },
      ],
    });
    const voidedProviderALotId = voidedPurchaseA.items[0]!.lots[0]!.inventoryLotId;
    await caller().purchases.void({
      id: voidedPurchaseA.id,
      reason: 'Receipt entered for the wrong supplier shipment',
    });
    const providerALotId = purchaseA.items[0]!.lots[0]!.inventoryLotId;
    const providerBLotId = purchaseB.items[0]!.lots[0]!.inventoryLotId;
    const providerATransfer = await caller().transfers.create({
      fromSiteId: siteId,
      toSiteId: secondarySiteId,
      items: [
        {
          productId: medicine.id,
          quantity: 1,
          lotAllocations: [{ lotId: providerALotId, quantity: 1 }],
        },
      ],
    });
    const providerADestinationLotId = providerATransfer.items[0]!.lots[0]!.destinationLotId!;

    const manualLot = await receiveLot({
      productId: medicine.id,
      lotNumber: `MANUAL-LINEAGE-${nanoid(5)}`,
      expiresInDays: 150,
      quantity: 2,
    });
    const manualTransfer = await caller().transfers.create({
      fromSiteId: siteId,
      toSiteId: secondarySiteId,
      items: [
        {
          productId: medicine.id,
          quantity: 1,
          lotAllocations: [{ lotId: manualLot.lotId, quantity: 1 }],
        },
      ],
    });
    const manualDestinationLotId = manualTransfer.items[0]!.lots[0]!.destinationLotId!;
    const lotRecall = await caller().pharmacy.createRecall({
      scopeType: 'lot',
      lotId: manualDestinationLotId,
      reason: 'Batch withdrawal initiated from the destination site',
    });
    expect(
      new Set(
        (
          await db
            .select({ lotId: pharmacyRecallLots.lotId })
            .from(pharmacyRecallLots)
            .where(
              and(
                eq(pharmacyRecallLots.tenantId, tenantId),
                eq(pharmacyRecallLots.recallId, lotRecall.id)
              )
            )
            .all()
        ).map(row => row.lotId)
      )
    ).toEqual(new Set([manualLot.lotId, manualDestinationLotId]));

    // A catalog-level preferred supplier applies to the product, not every
    // physical lot. It must never broaden a supplier recall.
    await db
      .update(products)
      .set({ providerId: providerA.id })
      .where(and(eq(products.id, medicine.id), eq(products.tenantId, tenantId)));

    const recall = await caller().pharmacy.createRecall({
      scopeType: 'provider',
      providerId: providerA.id,
      reason: 'Supplier-specific quality withdrawal',
    });
    expect(
      await db
        .select({ lotId: pharmacyRecallLots.lotId })
        .from(pharmacyRecallLots)
        .where(
          and(eq(pharmacyRecallLots.tenantId, tenantId), eq(pharmacyRecallLots.recallId, recall.id))
        )
        .all()
    ).toEqual(
      expect.arrayContaining([{ lotId: providerALotId }, { lotId: providerADestinationLotId }])
    );
    expect(recall.lotCount).toBe(2);
    const lotRows = await db
      .select({ id: inventoryLots.id, status: inventoryLots.status })
      .from(inventoryLots)
      .where(
        inArray(inventoryLots.id, [
          providerALotId,
          providerADestinationLotId,
          providerBLotId,
          voidedProviderALotId,
        ])
      )
      .all();
    const statusByLotId = new Map(lotRows.map(row => [row.id, row.status]));
    expect(statusByLotId.get(providerALotId)).toBe('recalled');
    expect(statusByLotId.get(providerADestinationLotId)).toBe('recalled');
    expect(statusByLotId.get(providerBLotId)).toBe('active');
    expect(statusByLotId.get(voidedProviderALotId)).toBe('depleted');

    const laterProviderAReceipt = await caller().purchases.create({
      providerId: providerA.id,
      items: [
        {
          productId: medicine.id,
          unitId: baseUnitId,
          quantity: 1,
          costPerUnit: 40,
          lotReceipts: [
            {
              lotNumber: `SUPPLIER-A-AFTER-RECALL-${nanoid(5)}`,
              expiresAt: addCalendarDays(businessDate, 150),
              baseQuantity: 1,
            },
          ],
        },
      ],
    });
    const laterProviderALotId = laterProviderAReceipt.items[0]!.lots[0]!.inventoryLotId;
    expect(
      await db
        .select({ status: inventoryLots.status })
        .from(inventoryLots)
        .where(eq(inventoryLots.id, laterProviderALotId))
        .get()
    ).toEqual({ status: 'recalled' });
    expect(
      await db
        .select({ recallId: pharmacyRecallLots.recallId })
        .from(pharmacyRecallLots)
        .where(
          and(
            eq(pharmacyRecallLots.tenantId, tenantId),
            eq(pharmacyRecallLots.recallId, recall.id),
            eq(pharmacyRecallLots.lotId, laterProviderALotId)
          )
        )
        .get()
    ).toEqual({ recallId: recall.id });
  });

  it('keeps regulation locked while a draft reserves the last medicine units', async () => {
    const db = getDatabase();
    const medicine = await createMedicine({
      classification: 'prescription',
      suffix: nanoid(6),
    });
    await receiveLot({
      productId: medicine.id,
      lotNumber: `RX-DRAFT-LOCK-${nanoid(5)}`,
      expiresInDays: 90,
      quantity: 1,
    });
    const customer = await caller().customers.create({
      name: `Draft regulation customer ${nanoid(6)}`,
    });
    await caller().sales.create({
      customerId: customer.id,
      items: [
        {
          productId: medicine.id,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 100,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      amountReceived: 0,
      discountAmount: 0,
    });
    expect(
      await db
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, tenantId),
            eq(inventoryBalances.siteId, siteId),
            eq(inventoryBalances.productId, medicine.id)
          )
        )
        .get()
    ).toEqual({ onHand: 0 });

    await expect(
      caller().products.update({ id: medicine.id, version: medicine.version, pharmacy: null })
    ).rejects.toMatchObject({ cause: { errorCode: 'PHARMACY_PRODUCT_PROFILE_LOCKED' } });
  });

  it('keeps a sanitary registration bound to depleted lot history', async () => {
    const suffix = nanoid(6);
    const medicine = await createMedicine({ classification: 'otc', suffix });
    const lot = await receiveLot({
      productId: medicine.id,
      lotNumber: `REGISTRATION-LOCK-${nanoid(5)}`,
      expiresInDays: 90,
      quantity: 1,
    });
    await sell({ productId: medicine.id, quantity: 1 });
    expect(
      await getDatabase()
        .select({ onHand: inventoryLots.onHand })
        .from(inventoryLots)
        .where(eq(inventoryLots.id, lot.lotId))
        .get()
    ).toEqual({ onHand: 0 });

    await expect(
      caller().products.update({
        id: medicine.id,
        version: medicine.version,
        pharmacy: {
          sanitaryRegistration: `INVIMA-REASSIGNED-${suffix}`,
          registrationExpiresAt: addCalendarDays(businessDate, 730),
          classification: 'otc',
          requiresColdChain: false,
        },
      })
    ).rejects.toMatchObject({
      cause: {
        errorCode: 'PHARMACY_PRODUCT_PROFILE_LOCKED',
        details: { reason: 'sanitary_registration_has_lot_history' },
      },
    });
  });

  it('keeps cold-chain handling enabled while medicine stock remains', async () => {
    const medicine = await createMedicine({
      classification: 'otc',
      suffix: nanoid(6),
      requiresColdChain: true,
    });
    await receiveLot({
      productId: medicine.id,
      lotNumber: `COLD-CHAIN-PROFILE-LOCK-${nanoid(5)}`,
      expiresInDays: 90,
      quantity: 1,
    });

    await expect(
      caller().products.update({
        id: medicine.id,
        version: medicine.version,
        pharmacy: {
          ...medicine.pharmacy!,
          requiresColdChain: false,
        },
      })
    ).rejects.toMatchObject({
      cause: {
        errorCode: 'PHARMACY_PRODUCT_PROFILE_LOCKED',
        details: {
          reason: 'cold_chain_in_use',
          currentStock: 1,
          hasOpenDraft: false,
        },
      },
    });
  });

  it('requires explicit adoption before existing stock acquires a cold-chain claim', async () => {
    const medicine = await createMedicine({
      classification: 'otc',
      suffix: nanoid(6),
      requiresColdChain: false,
    });
    const lot = await receiveLot({
      productId: medicine.id,
      lotNumber: `COLD-CHAIN-ADOPTION-${nanoid(5)}`,
      expiresInDays: 90,
      quantity: 1,
    });

    await expect(
      caller().products.update({
        id: medicine.id,
        version: medicine.version,
        pharmacy: {
          ...medicine.pharmacy!,
          requiresColdChain: true,
        },
      })
    ).rejects.toMatchObject({
      cause: {
        errorCode: 'PHARMACY_PRODUCT_PROFILE_LOCKED',
        details: {
          reason: 'cold_chain_adoption_required',
          currentStock: 1,
          hasOpenDraft: false,
        },
      },
    });

    await caller().pharmacy.destroyLot({
      lotId: lot.lotId,
      quantity: 1,
      reason: 'Remove units whose historical cold-chain custody cannot be proven',
    });
    await expect(
      caller().products.update({
        id: medicine.id,
        version: medicine.version,
        pharmacy: {
          ...medicine.pharmacy!,
          requiresColdChain: true,
        },
      })
    ).resolves.toMatchObject({
      pharmacy: { requiresColdChain: true },
    });
  });

  it('keeps a registration-free pharmacy profile bound to depleted lot history', async () => {
    const suffix = nanoid(6);
    const medicine = await caller().products.create({
      name: `Registration-free medicine ${suffix}`,
      sku: `MED-NO-REG-${suffix}`,
      price: 100,
      cost: 40,
      initialCost: 40,
      tracksStock: true,
      tracksLots: true,
      tracksSerials: false,
      pharmacy: {
        classification: 'otc',
        requiresColdChain: false,
      },
    });
    const lot = await receiveLot({
      productId: medicine.id,
      lotNumber: `PROFILE-LOCK-${nanoid(5)}`,
      expiresInDays: 90,
      quantity: 1,
    });
    await caller().pharmacy.destroyLot({
      lotId: lot.lotId,
      quantity: 1,
      reason: 'Deplete incomplete catalog stock without dispensing it',
    });

    await expect(
      caller().products.update({ id: medicine.id, version: medicine.version, pharmacy: null })
    ).rejects.toMatchObject({
      cause: {
        errorCode: 'PHARMACY_PRODUCT_PROFILE_LOCKED',
        details: { reason: 'pharmacy_profile_has_lot_history' },
      },
    });
  });

  it('requires an explicit adoption flow before existing lot history becomes pharmacy stock', async () => {
    const suffix = nanoid(6);
    const existingProduct = await caller().products.create({
      name: `Existing tracked product ${suffix}`,
      sku: `EXISTING-LOT-${suffix}`,
      price: 100,
      cost: 40,
      initialCost: 40,
      tracksStock: true,
      tracksLots: true,
      tracksSerials: false,
    });
    await receiveLot({
      productId: existingProduct.id,
      lotNumber: `PRE-PHARMACY-${nanoid(5)}`,
      expiresInDays: 90,
      quantity: 1,
    });

    await expect(
      caller().products.update({
        id: existingProduct.id,
        version: existingProduct.version,
        pharmacy: {
          sanitaryRegistration: `INVIMA-ADOPTION-${suffix}`,
          registrationExpiresAt: addCalendarDays(businessDate, 365),
          classification: 'otc',
          requiresColdChain: false,
        },
      })
    ).rejects.toMatchObject({
      cause: {
        errorCode: 'PHARMACY_PRODUCT_PROFILE_LOCKED',
        details: {
          reason: 'pharmacy_profile_adoption_required',
          currentStock: 1,
          hasLotHistory: true,
        },
      },
    });
  });

  it('keeps a medicine profile attached after prescription evidence is recorded', async () => {
    const medicine = await createMedicine({
      classification: 'prescription',
      suffix: nanoid(6),
    });
    const customer = await caller().customers.create({
      name: `Profile evidence customer ${nanoid(6)}`,
    });
    await caller().pharmacy.recordEvidence({
      productId: medicine.id,
      customerId: customer.id,
      reference: `RX-PROFILE-LOCK-${nanoid(8)}`,
      prescriberName: 'Authorized Prescriber',
      prescriberCredential: `MED-${nanoid(8)}`,
      authorizedQuantity: 1,
      validFrom: businessDate,
      expiresAt: addCalendarDays(businessDate, 30),
    });

    await expect(caller().products.getById({ id: medicine.id })).resolves.toMatchObject({
      pharmacyProfileLocks: ['evidence_history'],
    });

    await expect(
      caller().products.update({ id: medicine.id, version: medicine.version, pharmacy: null })
    ).rejects.toMatchObject({
      cause: {
        errorCode: 'PHARMACY_PRODUCT_PROFILE_LOCKED',
        details: { reason: 'pharmacy_profile_has_evidence_history' },
      },
    });
    await expect(
      caller().products.update({
        id: medicine.id,
        version: medicine.version,
        pharmacy: {
          ...medicine.pharmacy!,
          sanitaryRegistration: `INVIMA-REASSIGNED-${nanoid(6)}`,
        },
      })
    ).rejects.toMatchObject({
      cause: {
        errorCode: 'PHARMACY_PRODUCT_PROFILE_LOCKED',
        details: { reason: 'sanitary_registration_has_evidence_history' },
      },
    });
  });

  it('rejects a tampered sealed prescription before professional approval', async () => {
    const db = getDatabase();
    const medicine = await createMedicine({
      classification: 'prescription',
      suffix: nanoid(6),
    });
    const customer = await caller().customers.create({
      name: `Tampered evidence customer ${nanoid(6)}`,
    });
    const evidence = await caller().pharmacy.recordEvidence({
      productId: medicine.id,
      customerId: customer.id,
      reference: `RX-TAMPERED-${nanoid(8)}`,
      prescriberName: 'Authorized Prescriber',
      prescriberCredential: `MED-${nanoid(8)}`,
      authorizedQuantity: 1,
      validFrom: businessDate,
      expiresAt: addCalendarDays(businessDate, 30),
    });
    await db
      .update(pharmacyPrescriptionEvidence)
      .set({ sealedEvidence: 'v2.prescription.invalid.invalid.invalid' })
      .where(
        and(
          eq(pharmacyPrescriptionEvidence.id, evidence.id),
          eq(pharmacyPrescriptionEvidence.tenantId, tenantId)
        )
      );

    await expect(caller().pharmacy.approveEvidence({ id: evidence.id })).rejects.toMatchObject({
      cause: { errorCode: 'PHARMACY_EVIDENCE_INVALID' },
    });
    expect(
      await db
        .select({ status: pharmacyPrescriptionEvidence.status })
        .from(pharmacyPrescriptionEvidence)
        .where(eq(pharmacyPrescriptionEvidence.id, evidence.id))
        .get()
    ).toEqual({ status: 'pending' });
  });

  it('requires current authorization and consumes prescription evidence exactly once', async () => {
    const db = getDatabase();
    const medicine = await createMedicine({ classification: 'prescription', suffix: nanoid(6) });
    const lot = await receiveLot({
      productId: medicine.id,
      lotNumber: `RX-${nanoid(6)}`,
      expiresInDays: 90,
      quantity: 3,
    });
    const customer = await caller().customers.create({ name: `Pharmacy customer ${nanoid(6)}` });

    const withoutCustomer = await caller().pharmacy.checkoutRequirements({
      customerId: null,
      items: [{ productId: medicine.id, quantity: 1, unitEquivalence: 1 }],
    });
    expect(withoutCustomer).toMatchObject({ ready: false, customerValid: null });
    expect(withoutCustomer.requirements[0]).toMatchObject({
      evidenceRequired: true,
      blockedErrorCode: 'PHARMACY_CUSTOMER_REQUIRED',
    });

    await expect(
      caller().pharmacy.recordEvidence({
        productId: medicine.id,
        customerId: customer.id,
        reference: `RX-MISSING-${nanoid(6)}`,
        authorizedQuantity: 1,
        validFrom: businessDate,
        expiresAt: addCalendarDays(businessDate, 30),
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'PHARMACY_EVIDENCE_INVALID' } });

    const pendingWithoutAuthorization = await caller().pharmacy.recordEvidence({
      productId: medicine.id,
      customerId: customer.id,
      reference: `RX-NO-AUTH-${nanoid(6)}`,
      prescriberName: 'Authorized Prescriber',
      prescriberCredential: `MED-${nanoid(8)}`,
      authorizedQuantity: 1,
      validFrom: businessDate,
      expiresAt: addCalendarDays(businessDate, 30),
    });
    await expect(
      caller().pharmacy.approveEvidence({ id: pendingWithoutAuthorization.id })
    ).rejects.toMatchObject({ cause: { errorCode: 'PHARMACY_AUTHORIZATION_NOT_EFFECTIVE' } });
    await caller().pharmacy.revokeEvidence({
      id: pendingWithoutAuthorization.id,
      reason: 'Approval attempted before authorization setup',
    });

    await expect(
      caller().pharmacy.listAuthorizations({
        siteId: 'other-tenant-site',
        page: 1,
        perPage: 20,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      caller().pharmacy.createAuthorization({
        userId,
        siteId: 'other-tenant-site',
        countryCode: 'CO',
        credentialType: 'pharmacist-license',
        credential: `RETHUS-FOREIGN-SITE-${nanoid(8)}`,
        validFrom: businessDate,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const authorization = await caller().pharmacy.createAuthorization({
      userId,
      siteId,
      countryCode: 'CO',
      credentialType: 'pharmacist-license',
      credential: `RETHUS-${nanoid(12)}`,
      validFrom: addCalendarDays(businessDate, -1),
      validUntil: addCalendarDays(businessDate, 365),
    });
    await expect(caller().pharmacy.context()).resolves.toMatchObject({
      countryCode: 'CO',
      businessDate,
      canApproveEvidence: true,
      approvalCapabilityErrorCode: null,
    });
    const authenticAuthorization = await db
      .select({
        credentialDigest: pharmacyProfessionalAuthorizations.credentialDigest,
        sealedCredential: pharmacyProfessionalAuthorizations.sealedCredential,
      })
      .from(pharmacyProfessionalAuthorizations)
      .where(eq(pharmacyProfessionalAuthorizations.id, authorization.id))
      .get();
    if (!authenticAuthorization) throw new Error('Expected professional authorization secret');
    await expect(
      caller().pharmacy.listAuthorizations({
        userId,
        page: 99,
        perPage: 1,
        activeOnly: true,
      })
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: authorization.id, userId })],
      total: 1,
      page: 1,
      perPage: 1,
    });
    const invalidAuthorizationEvidence = await caller().pharmacy.recordEvidence({
      productId: medicine.id,
      customerId: customer.id,
      reference: `RX-AUTH-TAMPER-${nanoid(6)}`,
      prescriberName: 'Authorized Prescriber',
      prescriberCredential: `MED-${nanoid(8)}`,
      authorizedQuantity: 1,
      validFrom: businessDate,
      expiresAt: addCalendarDays(businessDate, 30),
    });
    await db
      .update(pharmacyProfessionalAuthorizations)
      .set({ sealedCredential: 'v2.professional-credential.invalid.invalid.invalid' })
      .where(eq(pharmacyProfessionalAuthorizations.id, authorization.id));
    await expect(caller().pharmacy.context()).resolves.toMatchObject({
      canApproveEvidence: false,
      approvalCapabilityErrorCode: 'PHARMACY_AUTHORIZATION_INVALID',
      hasOperationalData: true,
    });
    await expect(
      caller().pharmacy.approveEvidence({ id: invalidAuthorizationEvidence.id })
    ).rejects.toMatchObject({ cause: { errorCode: 'PHARMACY_AUTHORIZATION_INVALID' } });
    await db
      .update(pharmacyProfessionalAuthorizations)
      .set(authenticAuthorization)
      .where(eq(pharmacyProfessionalAuthorizations.id, authorization.id));
    await caller().pharmacy.revokeEvidence({
      id: invalidAuthorizationEvidence.id,
      reason: 'Credential-integrity regression cleanup',
    });
    const expiredEvidence = await caller().pharmacy.recordEvidence({
      productId: medicine.id,
      customerId: customer.id,
      reference: `RX-EXPIRED-${nanoid(6)}`,
      prescriberName: 'Authorized Prescriber',
      prescriberCredential: `MED-${nanoid(8)}`,
      authorizedQuantity: 1,
      validFrom: addCalendarDays(businessDate, -30),
      expiresAt: addCalendarDays(businessDate, -1),
    });
    await expect(
      caller().pharmacy.approveEvidence({ id: expiredEvidence.id })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PHARMACY_EVIDENCE_EXPIRED' },
    });
    const evidenceReference = `RX-VALID-${nanoid(10)}`;
    const evidence = await caller().pharmacy.recordEvidence({
      productId: medicine.id,
      customerId: customer.id,
      reference: evidenceReference,
      prescriberName: 'Authorized Prescriber',
      prescriberCredential: `MED-${nanoid(8)}`,
      authorizedQuantity: 1,
      validFrom: businessDate,
      expiresAt: addCalendarDays(businessDate, 30),
    });
    recordedEvidenceId = evidence.id;
    await expect(
      caller().pharmacy.recordEvidence({
        productId: medicine.id,
        customerId: customer.id,
        reference: `  ${evidenceReference.toLocaleLowerCase('en-US')}  `,
        prescriberName: 'Authorized Prescriber',
        prescriberCredential: `MED-${nanoid(8)}`,
        authorizedQuantity: 1,
        validFrom: businessDate,
        expiresAt: addCalendarDays(businessDate, 30),
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'PHARMACY_EVIDENCE_ALREADY_EXISTS' } });
    await expect(caller().pharmacy.approveEvidence({ id: evidence.id })).resolves.toEqual({
      id: evidence.id,
      status: 'approved',
    });

    const ready = await caller().pharmacy.checkoutRequirements({
      customerId: customer.id,
      items: [{ productId: medicine.id, quantity: 1, unitEquivalence: 1 }],
    });
    expect(ready).toMatchObject({ ready: true, canApproveEvidence: true });
    expect(ready.requirements[0]?.eligibleEvidence).toEqual([
      expect.objectContaining({ id: evidence.id, remainingQuantity: 1, status: 'approved' }),
    ]);

    const saleCountBefore = Number(
      (
        await db
          .select({ count: sql<number>`count(*)` })
          .from(sales)
          .get()
      )?.count ?? 0
    );
    await expect(
      sell({ productId: medicine.id, quantity: 1, customerId: customer.id })
    ).rejects.toMatchObject({ cause: { errorCode: 'PHARMACY_EVIDENCE_QUANTITY_EXCEEDED' } });
    expect(
      Number(
        (
          await db
            .select({ count: sql<number>`count(*)` })
            .from(sales)
            .get()
        )?.count ?? 0
      )
    ).toBe(saleCountBefore);
    expect(
      await db
        .select({ onHand: inventoryLots.onHand })
        .from(inventoryLots)
        .where(eq(inventoryLots.id, lot.lotId))
        .get()
    ).toEqual({ onHand: 3 });

    const authenticEvidence = await db
      .select({
        referenceDigest: pharmacyPrescriptionEvidence.referenceDigest,
        sealedEvidence: pharmacyPrescriptionEvidence.sealedEvidence,
      })
      .from(pharmacyPrescriptionEvidence)
      .where(eq(pharmacyPrescriptionEvidence.id, evidence.id))
      .get();
    if (!authenticEvidence) throw new Error('Expected approved prescription evidence');
    await db
      .update(pharmacyPrescriptionEvidence)
      .set({ referenceDigest: '0'.repeat(64) })
      .where(eq(pharmacyPrescriptionEvidence.id, evidence.id));
    await expect(
      caller().pharmacy.checkoutRequirements({
        customerId: customer.id,
        items: [{ productId: medicine.id, quantity: 1, unitEquivalence: 1 }],
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'PHARMACY_EVIDENCE_INVALID' } });
    await expect(
      caller().sales.create({
        customerId: customer.id,
        priceTier: 1,
        items: [
          {
            productId: medicine.id,
            unitId: baseUnitId,
            quantity: 1,
            unitPrice: 100,
            discount: 0,
          },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: 100,
        discountAmount: 0,
        pharmacyEvidenceIds: [evidence.id],
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'PHARMACY_EVIDENCE_INVALID' } });
    expect(
      Number(
        (
          await db
            .select({ count: sql<number>`count(*)` })
            .from(sales)
            .get()
        )?.count ?? 0
      )
    ).toBe(saleCountBefore);
    await db
      .update(pharmacyPrescriptionEvidence)
      .set(authenticEvidence)
      .where(eq(pharmacyPrescriptionEvidence.id, evidence.id));

    await db
      .update(pharmacyProfessionalAuthorizations)
      .set({ credentialDigest: '0'.repeat(64) })
      .where(eq(pharmacyProfessionalAuthorizations.id, authorization.id));
    await expect(
      caller().pharmacy.checkoutRequirements({
        customerId: customer.id,
        items: [{ productId: medicine.id, quantity: 1, unitEquivalence: 1 }],
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'PHARMACY_AUTHORIZATION_INVALID' } });
    await expect(
      caller().sales.create({
        customerId: customer.id,
        priceTier: 1,
        items: [
          {
            productId: medicine.id,
            unitId: baseUnitId,
            quantity: 1,
            unitPrice: 100,
            discount: 0,
          },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        amountReceived: 100,
        discountAmount: 0,
        pharmacyEvidenceIds: [evidence.id],
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'PHARMACY_AUTHORIZATION_INVALID' } });
    expect(
      Number(
        (
          await db
            .select({ count: sql<number>`count(*)` })
            .from(sales)
            .get()
        )?.count ?? 0
      )
    ).toBe(saleCountBefore);
    await db
      .update(pharmacyProfessionalAuthorizations)
      .set(authenticAuthorization)
      .where(eq(pharmacyProfessionalAuthorizations.id, authorization.id));

    // Exercise the real tRPC adapter used by the renderer. Keeping this on
    // the application helper would miss an adapter that accepts but drops
    // pharmacyEvidenceIds before the transaction.
    const completed = await caller().sales.create({
      customerId: customer.id,
      priceTier: 1,
      items: [
        {
          productId: medicine.id,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 100,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 100,
      discountAmount: 0,
      pharmacyEvidenceIds: [evidence.id],
    });
    const evidenceRow = await db
      .select()
      .from(pharmacyPrescriptionEvidence)
      .where(eq(pharmacyPrescriptionEvidence.id, evidence.id))
      .get();
    expect(evidenceRow).toMatchObject({
      status: 'consumed',
      authorizedQuantity: 1,
      dispensedQuantity: 1,
      approvedBy: userId,
      approvalAuthorizationId: authorization.id,
      version: 2,
    });
    expect(evidenceRow?.sealedEvidence).not.toContain(evidenceReference);
    const dispensations = await db
      .select()
      .from(pharmacyDispensations)
      .where(eq(pharmacyDispensations.saleId, completed.id))
      .all();
    expect(dispensations).toEqual([
      expect.objectContaining({
        evidenceId: evidence.id,
        authorizationId: authorization.id,
        productId: medicine.id,
        customerId: customer.id,
        quantity: 1,
        businessDate,
      }),
    ]);

    await expect(
      sell({
        productId: medicine.id,
        quantity: 1,
        customerId: customer.id,
        evidenceIds: [evidence.id],
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'PHARMACY_EVIDENCE_NOT_APPROVED' } });
    expect(() =>
      sqliteClient()
        .prepare('UPDATE pharmacy_dispensations SET quantity = 2 WHERE id = ?')
        .run(dispensations[0]!.id)
    ).toThrow(/immutable/);
    expect(() =>
      sqliteClient()
        .prepare('DELETE FROM pharmacy_dispensations WHERE id = ?')
        .run(dispensations[0]!.id)
    ).toThrow(/immutable/);

    // The resumed-cart adapter has a separate input projection and must carry
    // the same evidence selection into its completion transaction.
    const draftEvidence = await caller().pharmacy.recordEvidence({
      productId: medicine.id,
      customerId: customer.id,
      reference: `RX-DRAFT-${nanoid(10)}`,
      prescriberName: 'Authorized Prescriber',
      prescriberCredential: `MED-${nanoid(8)}`,
      authorizedQuantity: 1,
      validFrom: businessDate,
      expiresAt: addCalendarDays(businessDate, 30),
    });
    await caller().pharmacy.approveEvidence({ id: draftEvidence.id });
    const draft = await caller().sales.create({
      customerId: customer.id,
      items: [
        {
          productId: medicine.id,
          unitId: baseUnitId,
          quantity: 1,
          unitPrice: 100,
          discount: 0,
        },
      ],
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'draft',
      amountReceived: 0,
      discountAmount: 0,
    });
    const completedDraft = await caller().sales.completeDraft({
      saleId: draft.id,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: 100,
      pharmacyEvidenceIds: [draftEvidence.id],
    });
    expect(completedDraft.status).toBe('completed');
    expect(
      await db
        .select({ status: pharmacyPrescriptionEvidence.status })
        .from(pharmacyPrescriptionEvidence)
        .where(eq(pharmacyPrescriptionEvidence.id, draftEvidence.id))
        .get()
    ).toEqual({ status: 'consumed' });
    expect(
      await db
        .select({ evidenceId: pharmacyDispensations.evidenceId })
        .from(pharmacyDispensations)
        .where(eq(pharmacyDispensations.saleId, completedDraft.id))
        .get()
    ).toEqual({ evidenceId: draftEvidence.id });

    const inactiveApproverEvidence = await caller().pharmacy.recordEvidence({
      productId: medicine.id,
      customerId: customer.id,
      reference: `RX-INACTIVE-APPROVER-${nanoid(10)}`,
      prescriberName: 'Authorized Prescriber',
      prescriberCredential: `MED-${nanoid(8)}`,
      authorizedQuantity: 1,
      validFrom: businessDate,
      expiresAt: addCalendarDays(businessDate, 30),
    });
    await caller().pharmacy.approveEvidence({ id: inactiveApproverEvidence.id });
    const stockBeforeInactiveApprovalAttempt = (
      await db
        .select({ onHand: inventoryLots.onHand })
        .from(inventoryLots)
        .where(eq(inventoryLots.id, lot.lotId))
        .get()
    )?.onHand;
    await db.update(users).set({ isActive: false }).where(eq(users.id, userId));
    try {
      expect(
        (
          await caller().pharmacy.listAuthorizations({
            userId,
            page: 1,
            perPage: 20,
            activeOnly: false,
          })
        ).items.some(item => item.id === authorization.id && item.userIsActive === false)
      ).toBe(true);
      await expect(
        caller().pharmacy.checkoutRequirements({
          customerId: customer.id,
          items: [{ productId: medicine.id, quantity: 1, unitEquivalence: 1 }],
        })
      ).resolves.toMatchObject({
        ready: false,
        canApproveEvidence: false,
        requirements: [
          expect.objectContaining({
            productId: medicine.id,
            eligibleEvidence: [],
          }),
        ],
      });
      await expect(
        sell({
          productId: medicine.id,
          quantity: 1,
          customerId: customer.id,
          evidenceIds: [inactiveApproverEvidence.id],
        })
      ).rejects.toMatchObject({ cause: { errorCode: 'PHARMACY_AUTHORIZATION_NOT_EFFECTIVE' } });
    } finally {
      await db.update(users).set({ isActive: true }).where(eq(users.id, userId));
    }
    expect(
      await db
        .select({
          status: pharmacyPrescriptionEvidence.status,
          dispensedQuantity: pharmacyPrescriptionEvidence.dispensedQuantity,
        })
        .from(pharmacyPrescriptionEvidence)
        .where(eq(pharmacyPrescriptionEvidence.id, inactiveApproverEvidence.id))
        .get()
    ).toEqual({ status: 'approved', dispensedQuantity: 0 });
    expect(
      await db
        .select({ onHand: inventoryLots.onHand })
        .from(inventoryLots)
        .where(eq(inventoryLots.id, lot.lotId))
        .get()
    ).toEqual({ onHand: stockBeforeInactiveApprovalAttempt });

    const consumedEvidencePageOne = await caller().pharmacy.listEvidence({
      status: 'consumed',
      page: 1,
      perPage: 1,
    });
    const consumedEvidencePageTwo = await caller().pharmacy.listEvidence({
      status: 'consumed',
      page: 2,
      perPage: 1,
    });
    expect(consumedEvidencePageOne.total).toBe(2);
    expect(consumedEvidencePageTwo.total).toBe(2);
    expect(
      new Set([consumedEvidencePageOne.items[0]?.id, consumedEvidencePageTwo.items[0]?.id])
    ).toEqual(new Set([evidence.id, draftEvidence.id]));
    const consumedEvidenceLastPage = await caller().pharmacy.listEvidence({
      status: 'consumed',
      page: 99,
      perPage: 1,
    });
    expect(consumedEvidenceLastPage).toMatchObject({
      items: [expect.objectContaining({ id: consumedEvidencePageTwo.items[0]?.id })],
      total: 2,
      page: 2,
      perPage: 1,
    });

    const regulatedRows = await db
      .select({
        entityType: syncOutbox.entityType,
        status: syncOutbox.status,
        payload: syncOutbox.payload,
      })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          inArray(syncOutbox.entityType, [
            'pharmacy_professional_authorizations',
            'pharmacy_prescription_evidence',
            'pharmacy_dispensations',
          ])
        )
      )
      .all();
    expect(regulatedRows.length).toBeGreaterThanOrEqual(5);
    expect(regulatedRows.every(row => row.status === 'local_only')).toBe(true);
    expect(
      regulatedRows.every(
        row =>
          !('sealedEvidence' in row.payload) &&
          !('sealedCredential' in row.payload) &&
          !('referenceDigest' in row.payload) &&
          !('credentialDigest' in row.payload)
      )
    ).toBe(true);
    const listedEvidence = await caller().pharmacy.listEvidence({
      productId: medicine.id,
      customerId: customer.id,
      page: 1,
      perPage: 20,
    });
    const listedEvidenceItem = listedEvidence.items.find(item => item.id === evidence.id);
    expect(listedEvidenceItem).toMatchObject({ policyMismatch: false });
    if (!listedEvidenceItem) throw new Error('Expected listed prescription evidence');
    expect(
      listedEvidence.items.every(
        item => !('sealedEvidence' in item) && !('referenceDigest' in item)
      )
    ).toBe(true);

    await db
      .update(pharmacyPrescriptionEvidence)
      .set({ policyVersion: 'retired-policy-version' })
      .where(eq(pharmacyPrescriptionEvidence.id, evidence.id));
    const policyMismatchedEvidence = await caller().pharmacy.listEvidence({
      productId: medicine.id,
      customerId: customer.id,
      page: 1,
      perPage: 20,
    });
    expect(policyMismatchedEvidence.items.find(item => item.id === evidence.id)).toMatchObject({
      policyMismatch: true,
    });
    await db
      .update(pharmacyPrescriptionEvidence)
      .set({ policyVersion: listedEvidenceItem.policyVersion })
      .where(eq(pharmacyPrescriptionEvidence.id, evidence.id));
  });

  it('re-approves valid prescription evidence after its frozen authorization is replaced', async () => {
    const db = getDatabase();
    const existingAuthorizations = await db
      .select({ id: pharmacyProfessionalAuthorizations.id })
      .from(pharmacyProfessionalAuthorizations)
      .where(
        and(
          eq(pharmacyProfessionalAuthorizations.tenantId, tenantId),
          eq(pharmacyProfessionalAuthorizations.userId, userId),
          eq(pharmacyProfessionalAuthorizations.status, 'active')
        )
      )
      .all();
    for (const authorization of existingAuthorizations) {
      await caller().pharmacy.revokeAuthorization({
        id: authorization.id,
        reason: 'Isolate the replacement-authorization scenario',
      });
    }
    const medicine = await createMedicine({ classification: 'prescription', suffix: nanoid(6) });
    await receiveLot({
      productId: medicine.id,
      lotNumber: `RX-REAPPROVAL-${nanoid(6)}`,
      expiresInDays: 90,
      quantity: 2,
    });
    const customer = await caller().customers.create({
      name: `Reapproval customer ${nanoid(6)}`,
    });
    const originalAuthorization = await caller().pharmacy.createAuthorization({
      userId,
      siteId,
      countryCode: 'CO',
      credentialType: 'pharmacist-license',
      credential: `RETHUS-ORIGINAL-${nanoid(12)}`,
      validFrom: businessDate,
      validUntil: addCalendarDays(businessDate, 365),
    });
    const evidence = await caller().pharmacy.recordEvidence({
      productId: medicine.id,
      customerId: customer.id,
      reference: `RX-REAPPROVAL-${nanoid(10)}`,
      prescriberName: 'Authorized Prescriber',
      prescriberCredential: `MED-${nanoid(8)}`,
      authorizedQuantity: 2,
      validFrom: businessDate,
      expiresAt: addCalendarDays(businessDate, 30),
    });
    await caller().pharmacy.approveEvidence({ id: evidence.id });
    await expect(
      sell({
        productId: medicine.id,
        quantity: 1,
        customerId: customer.id,
        evidenceIds: [evidence.id],
      })
    ).resolves.toMatchObject({ sale: { status: 'completed' } });
    await caller().pharmacy.revokeAuthorization({
      id: originalAuthorization.id,
      reason: 'Professional credential replaced while prescription remains valid',
    });

    const blocked = await caller().pharmacy.checkoutRequirements({
      customerId: customer.id,
      items: [{ productId: medicine.id, quantity: 1, unitEquivalence: 1 }],
    });
    expect(blocked).toMatchObject({ ready: false, canApproveEvidence: false });
    expect(blocked.requirements[0]).toMatchObject({
      eligibleEvidence: [],
      reapprovalEvidence: [
        {
          id: evidence.id,
          reasonCode: 'PHARMACY_AUTHORIZATION_NOT_EFFECTIVE',
        },
      ],
    });
    expect(
      (
        await caller().pharmacy.listEvidence({
          productId: medicine.id,
          customerId: customer.id,
          page: 1,
          perPage: 20,
        })
      ).items.find(item => item.id === evidence.id)
    ).toMatchObject({ approvalErrorCode: 'PHARMACY_AUTHORIZATION_NOT_EFFECTIVE' });

    const replacementAuthorization = await caller().pharmacy.createAuthorization({
      userId,
      siteId,
      countryCode: 'CO',
      credentialType: 'pharmacist-license',
      credential: `RETHUS-REPLACEMENT-${nanoid(12)}`,
      validFrom: businessDate,
      validUntil: addCalendarDays(businessDate, 365),
    });
    await expect(caller().pharmacy.approveEvidence({ id: evidence.id })).resolves.toEqual({
      id: evidence.id,
      status: 'approved',
    });
    await expect(caller().pharmacy.approveEvidence({ id: evidence.id })).rejects.toMatchObject({
      cause: { errorCode: 'PHARMACY_EVIDENCE_STATE_INVALID' },
    });
    expect(
      await db
        .select({
          authorizationId: pharmacyPrescriptionEvidence.approvalAuthorizationId,
          dispensedQuantity: pharmacyPrescriptionEvidence.dispensedQuantity,
        })
        .from(pharmacyPrescriptionEvidence)
        .where(eq(pharmacyPrescriptionEvidence.id, evidence.id))
        .get()
    ).toEqual({ authorizationId: replacementAuthorization.id, dispensedQuantity: 1 });

    const recovered = await caller().pharmacy.checkoutRequirements({
      customerId: customer.id,
      items: [{ productId: medicine.id, quantity: 1, unitEquivalence: 1 }],
    });
    expect(recovered.requirements[0]).toMatchObject({
      eligibleEvidence: [expect.objectContaining({ id: evidence.id, remainingQuantity: 1 })],
      reapprovalEvidence: [],
    });
    await expect(
      sell({
        productId: medicine.id,
        quantity: 1,
        customerId: customer.id,
        evidenceIds: [evidence.id],
      })
    ).resolves.toMatchObject({ sale: { status: 'completed' } });
  });

  it('allocates selected prescription evidence in deterministic expiry order', async () => {
    const db = getDatabase();
    const medicine = await createMedicine({ classification: 'prescription', suffix: nanoid(6) });
    await receiveLot({
      productId: medicine.id,
      lotNumber: `RX-FEFO-${nanoid(6)}`,
      expiresInDays: 90,
      quantity: 2,
    });
    const customer = await caller().customers.create({ name: `Evidence FEFO ${nanoid(6)}` });
    await caller().pharmacy.createAuthorization({
      userId,
      siteId,
      countryCode: 'CO',
      credentialType: 'pharmacist-license',
      credential: `RETHUS-FEFO-${nanoid(12)}`,
      validFrom: businessDate,
      validUntil: addCalendarDays(businessDate, 365),
    });
    const laterEvidence = await caller().pharmacy.recordEvidence({
      productId: medicine.id,
      customerId: customer.id,
      reference: `RX-LATER-${nanoid(10)}`,
      prescriberName: 'Authorized Prescriber',
      prescriberCredential: `MED-${nanoid(8)}`,
      authorizedQuantity: 0.75,
      validFrom: businessDate,
      expiresAt: addCalendarDays(businessDate, 30),
    });
    const earlierEvidence = await caller().pharmacy.recordEvidence({
      productId: medicine.id,
      customerId: customer.id,
      reference: `RX-EARLIER-${nanoid(10)}`,
      prescriberName: 'Authorized Prescriber',
      prescriberCredential: `MED-${nanoid(8)}`,
      authorizedQuantity: 0.75,
      validFrom: businessDate,
      expiresAt: addCalendarDays(businessDate, 10),
    });
    await caller().pharmacy.approveEvidence({ id: laterEvidence.id });
    await caller().pharmacy.approveEvidence({ id: earlierEvidence.id });

    const preflight = await caller().pharmacy.checkoutRequirements({
      customerId: customer.id,
      items: [{ productId: medicine.id, quantity: 1, unitEquivalence: 1 }],
    });
    expect(preflight.requirements[0]?.eligibleEvidence.map(item => item.id)).toEqual([
      earlierEvidence.id,
      laterEvidence.id,
    ]);

    await sell({
      productId: medicine.id,
      quantity: 1,
      customerId: customer.id,
      // Reverse client order deliberately: allocation is authoritative FEFO.
      evidenceIds: [laterEvidence.id, earlierEvidence.id],
    });
    const evidenceRows = await db
      .select({
        id: pharmacyPrescriptionEvidence.id,
        dispensedQuantity: pharmacyPrescriptionEvidence.dispensedQuantity,
        status: pharmacyPrescriptionEvidence.status,
      })
      .from(pharmacyPrescriptionEvidence)
      .where(inArray(pharmacyPrescriptionEvidence.id, [earlierEvidence.id, laterEvidence.id]))
      .all();
    const byId = new Map(evidenceRows.map(row => [row.id, row]));
    expect(byId.get(earlierEvidence.id)).toMatchObject({
      dispensedQuantity: 0.75,
      status: 'consumed',
    });
    expect(byId.get(laterEvidence.id)).toMatchObject({
      dispensedQuantity: 0.25,
      status: 'approved',
    });
  });

  it('bounds fragmented checkout evidence at the authoritative sale transport limit', async () => {
    const db = getDatabase();
    const medicine = await createMedicine({
      classification: 'prescription',
      suffix: nanoid(6),
    });
    const customer = await caller().customers.create({
      name: `Fragmented evidence customer ${nanoid(6)}`,
    });
    const authorization = await caller().pharmacy.createAuthorization({
      userId,
      siteId,
      countryCode: 'CO',
      credentialType: 'pharmacist-license',
      credential: `RETHUS-FRAGMENTED-${nanoid(12)}`,
      validFrom: businessDate,
      validUntil: addCalendarDays(businessDate, 365),
    });
    const policyVersion = resolvePharmacyPolicy('CO', businessDate, 'prescription').policyVersion;
    const fragments = Array.from({ length: 201 }, (_, index) => {
      const id = nanoid();
      const reference = `RX-FRAGMENTED-${index}-${nanoid(8)}`;
      return {
        id,
        tenantId,
        productId: medicine.id,
        customerId: customer.id,
        countryCode: 'CO',
        policyVersion,
        referenceDigest: digestPharmacyReference(reference, {
          purpose: 'prescription',
          tenantId,
          subjectId: medicine.id,
        }),
        sealedEvidence: sealPharmacyEvidence(
          {
            reference,
            prescriberName: 'Authorized Prescriber',
            prescriberCredential: `MED-${index}`,
          },
          { purpose: 'prescription', tenantId, subjectId: id }
        ),
        authorizedQuantity: 0.001,
        dispensedQuantity: 0,
        validFrom: businessDate,
        expiresAt: addCalendarDays(businessDate, 30),
        status: 'approved' as const,
        approvedBy: userId,
        approvalAuthorizationId: authorization.id,
        createdBy: userId,
      };
    });
    await db.insert(pharmacyPrescriptionEvidence).values(fragments);

    const checkoutPlan = sqliteClient()
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id
         FROM pharmacy_prescription_evidence
         WHERE tenant_id = ? AND customer_id = ? AND product_id = ?
           AND country_code = ? AND policy_version = ? AND status = 'approved'
           AND valid_from <= ? AND expires_at >= ?
           AND dispensed_quantity < authorized_quantity
         ORDER BY expires_at, created_at, id
         LIMIT 201`
      )
      .all(
        tenantId,
        customer.id,
        medicine.id,
        'CO',
        policyVersion,
        businessDate,
        businessDate
      ) as Array<{ detail: string }>;
    expect(checkoutPlan.map(step => step.detail).join('\n')).toContain(
      'idx_pharmacy_evidence_checkout'
    );

    const requirements = await caller().pharmacy.checkoutRequirements({
      customerId: customer.id,
      items: [{ productId: medicine.id, quantity: 0.201, unitEquivalence: 1 }],
    });

    expect(requirements.ready).toBe(false);
    expect(requirements.requirements[0]).toMatchObject({
      blockedErrorCode: 'PHARMACY_EVIDENCE_SELECTION_INVALID',
    });
    expect(requirements.requirements[0]?.eligibleEvidence).toHaveLength(200);
  });

  it('keeps controlled medicines disabled without an externally validated adapter', async () => {
    const db = getDatabase();
    const medicine = await createMedicine({ classification: 'controlled', suffix: nanoid(6) });
    const lot = await receiveLot({
      productId: medicine.id,
      lotNumber: `CONTROLLED-${nanoid(6)}`,
      expiresInDays: 60,
      quantity: 1,
    });
    const customer = await caller().customers.create({ name: `Controlled customer ${nanoid(6)}` });

    const requirements = await caller().pharmacy.checkoutRequirements({
      customerId: customer.id,
      items: [{ productId: medicine.id, quantity: 1, unitEquivalence: 1 }],
    });
    expect(requirements).toMatchObject({ ready: false, countryCode: 'CO' });
    expect(requirements.requirements[0]).toMatchObject({
      classification: 'controlled',
      blockedErrorCode: 'PHARMACY_CONTROLLED_NOT_ENABLED',
    });
    await expect(
      sell({ productId: medicine.id, quantity: 1, customerId: customer.id })
    ).rejects.toMatchObject({ cause: { errorCode: 'PHARMACY_CONTROLLED_NOT_ENABLED' } });
    expect(
      await db
        .select({ onHand: inventoryLots.onHand })
        .from(inventoryLots)
        .where(eq(inventoryLots.id, lot.lotId))
        .get()
    ).toEqual({ onHand: 1 });
    await expect(
      caller().pharmacy.recordEvidence({
        productId: medicine.id,
        customerId: customer.id,
        reference: `CONTROLLED-RX-${nanoid(6)}`,
        prescriberName: 'Controlled Prescriber',
        prescriberCredential: `MED-${nanoid(8)}`,
        buyerDocument: `BUYER-${nanoid(8)}`,
        authorizedQuantity: 1,
        validFrom: businessDate,
        expiresAt: addCalendarDays(businessDate, 30),
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'PHARMACY_CONTROLLED_NOT_ENABLED' } });
  });

  it('keeps quarantine beneath recall and reconciles exact destruction', async () => {
    const db = getDatabase();
    const medicine = await createMedicine({
      classification: 'otc',
      suffix: nanoid(6),
      requiresColdChain: true,
    });
    const lot = await receiveLot({
      productId: medicine.id,
      lotNumber: `COLD-${nanoid(6)}`,
      expiresInDays: 60,
      quantity: 5,
    });

    await expect(
      caller().pharmacy.transitionLot({
        lotId: lot.lotId,
        action: 'cold_chain_incident',
        reason: 'Temperature excursion detected',
      })
    ).resolves.toMatchObject({ status: 'quarantined' });
    const recall = await caller().pharmacy.createRecall({
      scopeType: 'lot',
      lotId: lot.lotId,
      reason: 'Cold-chain investigation recall',
    });
    await caller().pharmacy.closeRecall({
      id: recall.id,
      reason: 'Recall investigation completed',
    });
    await expect(
      caller().pharmacy.transitionLot({
        lotId: lot.lotId,
        action: 'release',
        reason: 'Remove recall overlay only',
      })
    ).resolves.toMatchObject({ previousStatus: 'recalled', status: 'quarantined' });
    await expect(sell({ productId: medicine.id, quantity: 1 })).rejects.toMatchObject({
      cause: { errorCode: 'LOT_STOCK_INCONSISTENT' },
    });
    await expect(
      caller().pharmacy.transitionLot({
        lotId: lot.lotId,
        action: 'release',
        reason: 'Independent cold-chain release approved',
      })
    ).resolves.toMatchObject({ previousStatus: 'quarantined', status: 'active' });
    await caller().pharmacy.transitionLot({
      lotId: lot.lotId,
      action: 'quarantine',
      reason: 'Units selected for destruction',
    });

    const destroyed = await caller().pharmacy.destroyLot({
      lotId: lot.lotId,
      quantity: 2,
      reason: 'Documented pharmaceutical destruction',
    });
    expect(destroyed).toMatchObject({ destroyedQuantity: 2, onHand: 3, status: 'quarantined' });
    expect(
      await db
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, tenantId),
            eq(inventoryBalances.siteId, siteId),
            eq(inventoryBalances.productId, medicine.id)
          )
        )
        .get()
    ).toEqual({ onHand: 3 });
    expect(
      await db
        .select({ onHand: inventoryLots.onHand, status: inventoryLots.status })
        .from(inventoryLots)
        .where(eq(inventoryLots.id, lot.lotId))
        .get()
    ).toEqual({ onHand: 3, status: 'quarantined' });
    expect(
      await db
        .select({
          quantity: inventoryMovements.quantity,
          previousStock: inventoryMovements.previousStock,
          newStock: inventoryMovements.newStock,
        })
        .from(inventoryMovements)
        .where(eq(inventoryMovements.id, destroyed.movementId))
        .get()
    ).toEqual({ quantity: 2, previousStock: 5, newStock: 3 });
    expect(
      await db
        .select({
          eventType: inventoryLotEvents.eventType,
          nextStatus: inventoryLotEvents.nextStatus,
        })
        .from(inventoryLotEvents)
        .where(
          and(
            eq(inventoryLotEvents.lotId, lot.lotId),
            eq(inventoryLotEvents.referenceId, destroyed.movementId)
          )
        )
        .get()
    ).toEqual({ eventType: 'destruction', nextStatus: 'quarantined' });
  });

  it('preserves the recall overlay through quantity-only custody events', async () => {
    const medicine = await createMedicine({ classification: 'otc', suffix: nanoid(6) });
    const lot = await receiveLot({
      productId: medicine.id,
      lotNumber: `RECALL-DESTRUCTION-${nanoid(6)}`,
      expiresInDays: 60,
      quantity: 3,
    });
    const recall = await caller().pharmacy.createRecall({
      scopeType: 'lot',
      lotId: lot.lotId,
      reason: 'Recall remains authoritative during physical destruction',
    });
    await caller().pharmacy.destroyLot({
      lotId: lot.lotId,
      quantity: 1,
      reason: 'One recalled unit physically destroyed',
    });
    const longHistoryBase = Date.now() + 1_000;
    getDatabase().transaction(tx => {
      for (let index = 0; index < 140; index += 1) {
        tx.insert(inventoryLotEvents)
          .values({
            id: `pharmacy-long-history-${nanoid(12)}`,
            tenantId,
            siteId,
            productId: medicine.id,
            lotId: lot.lotId,
            eventType: 'destruction',
            previousStatus: 'recalled',
            nextStatus: 'recalled',
            quantitySnapshot: 2,
            reason: 'Bounded long-history regression fixture',
            referenceType: 'test_history',
            referenceId: `history-${index}`,
            actorId: userId,
            occurredAt: new Date(longHistoryBase + index).toISOString(),
            createdAt: new Date(longHistoryBase + index).toISOString(),
          })
          .run();
      }
    });
    await caller().pharmacy.closeRecall({
      id: recall.id,
      reason: 'Official recall closure received',
    });

    await expect(
      caller().pharmacy.transitionLot({
        lotId: lot.lotId,
        action: 'release',
        reason: 'Release remaining units after recall closure',
      })
    ).resolves.toMatchObject({ previousStatus: 'recalled', status: 'active' });
    expect(
      await getDatabase()
        .select({ onHand: inventoryLots.onHand, status: inventoryLots.status })
        .from(inventoryLots)
        .where(eq(inventoryLots.id, lot.lotId))
        .get()
    ).toEqual({ onHand: 2, status: 'active' });
  });

  it('fails closed outside Colombia while preserving OTC operation', async () => {
    const db = getDatabase();
    const otc = await createMedicine({ classification: 'otc', suffix: nanoid(6) });
    const prescription = await createMedicine({
      classification: 'prescription',
      suffix: nanoid(6),
    });
    await receiveLot({
      productId: otc.id,
      lotNumber: `MX-OTC-${nanoid(4)}`,
      expiresInDays: 30,
      quantity: 1,
    });
    await receiveLot({
      productId: prescription.id,
      lotNumber: `MX-RX-${nanoid(4)}`,
      expiresInDays: 30,
      quantity: 1,
    });
    const locale = await db
      .select()
      .from(tenantLocaleSettings)
      .where(eq(tenantLocaleSettings.tenantId, tenantId))
      .get();
    if (!locale) throw new Error('Expected seeded tenant locale');

    try {
      await db
        .update(tenantLocaleSettings)
        .set({ countryCode: 'MX', version: locale.version + 1 })
        .where(eq(tenantLocaleSettings.tenantId, tenantId));
      await expect(sell({ productId: otc.id, quantity: 1 })).resolves.toBeTruthy();
      await expect(sell({ productId: prescription.id, quantity: 1 })).rejects.toMatchObject({
        cause: { errorCode: 'PHARMACY_POLICY_UNAVAILABLE' },
      });
    } finally {
      await db
        .update(tenantLocaleSettings)
        .set({ countryCode: locale.countryCode, version: locale.version + 2 })
        .where(eq(tenantLocaleSettings.tenantId, tenantId));
    }
  });

  it('isolates evidence and recall reads by tenant and protects the key row', async () => {
    expect(recordedEvidenceId).toBeTruthy();
    expect(recordedRecallId).toBeTruthy();
    const db = getDatabase();
    const foreignTenantId = `pharmacy-foreign-${nanoid(8)}`;
    const foreignUserId = `pharmacy-foreign-user-${nanoid(8)}`;
    const now = new Date().toISOString();
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Pharmacy Foreign Tenant',
      slug: foreignTenantId,
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(users).values({
      id: foreignUserId,
      tenantId: foreignTenantId,
      email: `${foreignUserId}@example.test`,
      name: 'Foreign Manager',
      passwordHash: 'not-a-real-password-hash',
      role: 'manager',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const foreignContext: Context = {
      req: {
        server: server.app,
        headers: {},
        user: {
          userId: foreignUserId,
          email: `${foreignUserId}@example.test`,
          role: 'manager',
          tenantId: foreignTenantId,
        },
        jwtVerify: async () => {},
      } as unknown as Context['req'],
      res: {} as Context['res'],
      db,
      user: {
        id: foreignUserId,
        email: `${foreignUserId}@example.test`,
        role: 'manager',
        tenantId: foreignTenantId,
      },
      tenantId: foreignTenantId,
      siteId: null,
    };
    const foreignCaller = appRouter.createCaller(foreignContext);
    await expect(foreignCaller.pharmacy.context()).resolves.toMatchObject({
      approvalCapabilityErrorCode: null,
      hasOperationalData: false,
    });
    await expect(
      foreignCaller.pharmacy.listEvidence({ page: 1, perPage: 20 })
    ).resolves.toMatchObject({
      items: [],
      total: 0,
    });
    await expect(
      foreignCaller.pharmacy.listRecalls({ page: 1, perPage: 20 })
    ).resolves.toMatchObject({
      items: [],
      total: 0,
    });
    await expect(
      foreignCaller.pharmacy.listAuthorizations({ page: 1, perPage: 20, activeOnly: false })
    ).resolves.toMatchObject({
      items: [],
      total: 0,
    });
    await expect(foreignCaller.pharmacy.getRecall({ id: recordedRecallId })).rejects.toMatchObject({
      cause: { errorCode: 'PHARMACY_RECALL_NOT_FOUND' },
    });

    const key = await db.select().from(pharmacyEvidenceKeys).get();
    expect(key).toBeTruthy();
    expect(() =>
      sqliteClient()
        .prepare('UPDATE pharmacy_evidence_keys SET secret_material = ? WHERE id = ?')
        .run('replacement-key-material-that-is-long-enough', key!.id)
    ).toThrow(/re-encryption migration/);
    expect(() =>
      sqliteClient().prepare('DELETE FROM pharmacy_evidence_keys WHERE id = ?').run(key!.id)
    ).toThrow(/re-encryption migration/);
  });
});
