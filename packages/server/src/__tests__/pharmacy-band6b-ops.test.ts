import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  cashSessions,
  inventoryBalances,
  inventoryLots,
  inventoryMovements,
  pharmacyFneLedger,
  pharmacyProductProfiles,
  products,
  providers,
  sites,
  syncOutbox,
  tenantLocaleSettings,
  tenants,
  units,
  users,
} from '../db/schema.js';
import { resolveDosesPerPack } from '../application/pharmacy/generic-alternatives.js';
import { createServer, type PuntovivoServer } from '../index.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { resolveTenantBusinessClock } from '../services/pharmacy/business-clock.js';
import { addCalendarDays } from '../services/reports/day-window.js';
import { appRouter } from '../trpc/router.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let adminId: string;
let siteId: string;
let baseUnitId: string;
let otherSiteId: string;
let businessDate: string;
let fresh: ReturnType<typeof makeFreshContextFactory>;

function caller(role: 'admin' | 'manager' | 'cashier' | 'viewer' = 'admin') {
  return appRouter.createCaller(fresh({ role }));
}

async function createMedicine(spec: {
  name: string;
  price: number;
  cost?: number;
  activeIngredient: string;
  genericName?: string;
  concentration?: string;
  dosageForm?: string;
  presentation?: string;
  dosesPerPack?: number | null;
  cumCode?: string | null;
  sanitaryRegistration?: string;
  classification?: 'otc' | 'prescription' | 'controlled';
}) {
  const suffix = nanoid(6);
  return caller().products.create({
    name: spec.name,
    sku: `B6B-${suffix}`,
    price: spec.price,
    cost: spec.cost ?? 1_000,
    initialCost: spec.cost ?? 1_000,
    tracksStock: true,
    tracksLots: true,
    tracksSerials: false,
    unitAssignments: [{ unitId: baseUnitId, equivalence: 1, price: spec.price, isBase: true }],
    pharmacy: {
      activeIngredient: spec.activeIngredient,
      genericName: spec.genericName ?? spec.activeIngredient,
      concentration: spec.concentration ?? '500 mg',
      dosageForm: spec.dosageForm ?? 'Tableta',
      administrationRoute: 'Oral',
      presentation: spec.presentation ?? 'Caja x 30 tabletas',
      dosesPerPack: spec.dosesPerPack ?? null,
      cumCode: spec.cumCode ?? null,
      manufacturer: `Lab ${suffix}`,
      authorizationHolder: `Titular ${suffix}`,
      sanitaryRegistration: spec.sanitaryRegistration ?? `INVIMA-2026M-${suffix}`,
      registrationExpiresAt: addCalendarDays(businessDate, 365),
      classification: spec.classification ?? 'otc',
      storageConditions: 'Menor a 30 C',
      requiresColdChain: false,
    },
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
  if (!site) throw new Error('Expected seeded site');

  tenantId = admin.tenantId;
  adminId = admin.id;
  siteId = site.id;
  const baseUnit = (await db.select().from(units).where(eq(units.tenantId, tenantId)).all()).find(
    u => u.abbreviation === 'UND'
  );
  if (!baseUnit) throw new Error('Expected seeded UND unit');
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

  otherSiteId = `b6b-other-site-${nanoid(6)}`;
  await db.insert(sites).values({
    id: otherSiteId,
    tenantId,
    companyId: site.companyId,
    name: 'Sucursal Sur',
    isActive: true,
  });

  const device = await registerDeviceService(db, {
    tenantId,
    userId: admin.id,
    kind: 'web',
    name: 'pharmacy-band6b-ops.test',
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

  // Ensure an active cash session for checkout tests
  const openSession = await db
    .select({ id: cashSessions.id })
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.tenantId, tenantId),
        eq(cashSessions.siteId, siteId),
        eq(cashSessions.status, 'open')
      )
    )
    .get();
  if (!openSession) {
    await caller().cashSessions.open({ openingFloat: 0 });
  }
});

afterAll(async () => {
  await server.close();
});

describe('Band 6B — Pharmacy operational closure (Colombia)', () => {
  it('6B.1 fractionates box -> blister preserving lot, expiry, sanitary registration, exact cents, and recall lineage', async () => {
    const db = getDatabase();
    const ingredient = `Amoxicilina ${nanoid(5)}`;
    const registration = `INVIMA 2025M-${nanoid(6)}`;
    const expiry = addCalendarDays(businessDate, 240);

    const box = await createMedicine({
      name: 'Amoxicilina 500 mg Caja x 30',
      price: 18_000,
      cost: 15_000,
      activeIngredient: ingredient,
      presentation: 'Caja x 30 cápsulas',
      dosageForm: 'Cápsula',
      dosesPerPack: 30,
      sanitaryRegistration: registration,
      classification: 'prescription',
    });
    const blister = await createMedicine({
      name: 'Amoxicilina 500 mg Blíster x 10',
      price: 6_500,
      cost: 5_000,
      activeIngredient: ingredient,
      presentation: 'Blíster x 10 cápsulas',
      dosageForm: 'Cápsula',
      dosesPerPack: 10,
      sanitaryRegistration: registration,
      classification: 'prescription',
    });
    const mismatched = await createMedicine({
      name: 'Ibuprofeno Blíster x 10',
      price: 4_000,
      activeIngredient: `Ibuprofeno ${nanoid(5)}`,
      presentation: 'Blíster x 10 cápsulas',
      dosageForm: 'Cápsula',
      sanitaryRegistration: registration,
      classification: 'prescription',
    });
    const relaxedOtc = await createMedicine({
      name: 'Amoxicilina OTC inválida',
      price: 6_000,
      activeIngredient: ingredient,
      presentation: 'Blíster x 10 cápsulas',
      dosageForm: 'Cápsula',
      sanitaryRegistration: registration,
      classification: 'otc',
    });

    const boxLot = await caller().inventoryLots.receive({
      siteId,
      productId: box.id,
      lotNumber: `L-FRAC-${nanoid(4)}`,
      expiresAt: expiry,
      quantity: 2,
      unitCost: 15_000,
    });

    // Rejects mismatched active ingredient
    await expect(
      caller().pharmacy.fractionateLot({
        sourceLotId: boxLot.lotId,
        targetProductId: mismatched.id,
        sourceQuantity: 1,
        targetQuantity: 3,
        reason: 'Intento inválido ingrediente distinto',
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'PHARMACY_FRACTIONATION_INVALID' } });

    // Rejects relaxing regulatory classification (prescription -> otc)
    await expect(
      caller().pharmacy.fractionateLot({
        sourceLotId: boxLot.lotId,
        targetProductId: relaxedOtc.id,
        sourceQuantity: 1,
        targetQuantity: 3,
        reason: 'Intento inválido rebaja clasificación',
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'PHARMACY_FRACTIONATION_INVALID' } });

    // Valid fractionation: 1 box -> 3 blisters
    const result = await caller('manager').pharmacy.fractionateLot({
      sourceLotId: boxLot.lotId,
      targetProductId: blister.id,
      sourceQuantity: 1,
      targetQuantity: 3,
      reason: 'Apertura de caja para venta por blíster',
    });

    expect(result.sourceOnHand).toBe(1);
    expect(result.targetOnHand).toBe(3);
    expect(result.expiresAt).toBe(expiry);
    expect(result.sanitaryRegistration).toBe(registration);
    expect(result.transferredValueCents).toBe(1_500_000); // $15,000.00 exact cents

    const targetLotRow = db
      .select()
      .from(inventoryLots)
      .where(and(eq(inventoryLots.id, result.targetLotId), eq(inventoryLots.tenantId, tenantId)))
      .get();
    expect(targetLotRow).toMatchObject({
      lotNumber: result.lotNumber,
      expiresAt: expiry,
      onHand: 3,
      carryingValueCents: 1_500_000,
      status: 'active',
    });

    const targetBalance = db
      .select({ onHand: inventoryBalances.onHand })
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, tenantId),
          eq(inventoryBalances.siteId, siteId),
          eq(inventoryBalances.productId, blister.id)
        )
      )
      .get();
    expect(targetBalance?.onHand).toBe(3);

    const history = await caller('manager').pharmacy.listFractionations({ siteId });
    expect(history.items.some(row => row.id === result.id && row.unitsPerSource === 3)).toBe(true);

    // Recall on parent box lot MUST propagate to the fractionated blister lot!
    const recall = await caller('manager').pharmacy.createRecall({
      scopeType: 'lot',
      lotId: boxLot.lotId,
      reason: 'Alerta sanitaria de calidad del lote',
    });
    expect(recall.lotCount).toBeGreaterThanOrEqual(2);

    const recalledBlisterLot = db
      .select({ status: inventoryLots.status })
      .from(inventoryLots)
      .where(eq(inventoryLots.id, result.targetLotId))
      .get();
    expect(recalledBlisterLot?.status).toBe('recalled');
  });

  it('6B.2 compares generic equivalents across presentations by cost per dose', async () => {
    const ingredient = `Loratadina ${nanoid(5)}`;
    const brandBox = await createMedicine({
      name: 'Clarityne Caja x 30',
      price: 30_000, // $1,000 / dosis
      activeIngredient: ingredient,
      concentration: '10 mg',
      dosageForm: 'Tableta',
      presentation: 'Caja x 30 tabletas',
      dosesPerPack: 30,
    });
    const cheapBlister = await createMedicine({
      name: 'Loratadina Genfar Blíster x 10',
      price: 6_000, // $600 / dosis -> ahorro $400/dosis
      activeIngredient: ingredient,
      concentration: '10 mg',
      dosageForm: 'Tableta',
      presentation: 'Blíster x 10 tabletas',
    });
    const priceyBlister = await createMedicine({
      name: 'Loratadina Premium Blíster x 10',
      price: 12_000, // $1,200 / dosis -> más caro por dosis
      activeIngredient: ingredient,
      concentration: '10 mg',
      dosageForm: 'Tableta',
      presentation: 'Blíster x 10 tabletas',
    });
    const cheapBox = await createMedicine({
      name: 'Loratadina MK Caja x 30',
      price: 12_000, // $400 / dosis -> más barato por dosis que el blíster de $600
      activeIngredient: ingredient,
      concentration: '10 mg',
      dosageForm: 'Tableta',
      presentation: 'Caja x 30 tabletas',
    });

    for (const p of [brandBox, cheapBlister, priceyBlister, cheapBox]) {
      await caller().inventoryLots.receive({
        siteId,
        productId: p.id,
        lotNumber: `L-ALT-${nanoid(4)}`,
        expiresAt: addCalendarDays(businessDate, 300),
        quantity: 10,
        unitCost: 1_000,
      });
    }

    const fromBrand = await caller('cashier').pharmacy.genericAlternatives({
      productId: brandBox.id,
      limit: 5,
    });
    expect(fromBrand.items.map(i => i.productId)).toEqual([cheapBox.id, cheapBlister.id]);
    expect(fromBrand.items[1]).toMatchObject({
      productId: cheapBlister.id,
      comparisonMode: 'per_dose',
      dosesPerPack: 10,
      pricePerDose: 600,
      sourceDosesPerPack: 30,
      sourcePricePerDose: 1_000,
      savingsPerDose: 400,
      savings: 4_000,
    });

    // Reverse direction: from Blíster x 10 ($600/dosis), Caja x 30 ($400/dosis) appears even though pack price $12,000 > $6,000
    const fromBlister = await caller('cashier').pharmacy.genericAlternatives({
      productId: cheapBlister.id,
      limit: 5,
    });
    expect(fromBlister.items[0]).toMatchObject({
      productId: cheapBox.id,
      comparisonMode: 'per_dose',
      pricePerDose: 400,
      sourcePricePerDose: 600,
      savingsPerDose: 200,
    });
  });

  it('6B.3 records daily temperature & relative humidity readings (Res. 1403/2007), flags deviations, and builds printable report', async () => {
    // Rejects ambient reading without relative humidity
    await expect(
      caller('cashier').pharmacy.recordEnvironmentalLog({
        period: 'morning',
        zone: 'ambient',
        temperatureC: 22.5,
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'PHARMACY_ENVIRONMENTAL_INVALID' } });

    const okAmbient = await caller('cashier').pharmacy.recordEnvironmentalLog({
      period: 'morning',
      zone: 'ambient',
      temperatureC: 22.5,
      humidityPercent: 54,
      instrumentCode: 'TH-AMB-01',
    });
    expect(okAmbient.isOutOfRange).toBe(false);
    expect(okAmbient.deviationReasons).toEqual([]);

    const hotFridge = await caller('cashier').pharmacy.recordEnvironmentalLog({
      period: 'afternoon',
      zone: 'refrigerator',
      temperatureC: 10.4,
      instrumentCode: 'TH-FRIO-01',
      correctiveAction: 'Traslado inmediato a nevera de respaldo y revisión técnica',
    });
    expect(hotFridge.isOutOfRange).toBe(true);
    expect(hotFridge.deviationReasons).toEqual(['temp_high']);

    const humidAmbient = await caller('cashier').pharmacy.recordEnvironmentalLog({
      period: 'afternoon',
      zone: 'ambient',
      temperatureC: 25.0,
      humidityPercent: 78,
      correctiveAction: 'Encendido de deshumidificador',
    });
    expect(humidAmbient.isOutOfRange).toBe(true);
    expect(humidAmbient.deviationReasons).toEqual(['humidity_high']);

    const onlyDev = await caller('cashier').pharmacy.listEnvironmentalLogs({
      fromDate: businessDate,
      toDate: businessDate,
      onlyDeviations: true,
    });
    expect(onlyDev.total).toBe(2);

    const report = await caller('manager').pharmacy.getEnvironmentalReport({
      fromDate: businessDate,
      toDate: businessDate,
    });
    expect(report).toMatchObject({
      standard: 'Resolución 1403 de 2007 (Colombia)',
      totalReadings: 3,
      deviationCount: 2,
      ambient: { count: 2, deviations: 1, minTempC: 22.5, maxTempC: 25.0, maxHumidityPercent: 78 },
      refrigerator: { count: 1, deviations: 1, minTempC: 10.4, maxTempC: 10.4 },
    });
  });

  it('6B.4 imports official INVIMA/CUM semicolon CSV, upserts cleanly, links matching products, and searches catalog', async () => {
    const db = getDatabase();
    const regCode = `INVIMA 2024M-00${nanoid(4).toUpperCase()}`;
    const med = await createMedicine({
      name: 'Ibuprofeno 400 mg Genfar',
      price: 5_000,
      activeIngredient: 'Ibuprofeno',
      concentration: '400 mg',
      sanitaryRegistration: regCode,
    });

    const csv = [
      'expediente;consecutivocum;producto;titular;registrosanitario;fechavencimiento;estadoregistro;descripcioncomercial;principioactivo;cantidad;unidadmedida;formafarmaceutica;viaadministracion;condicionventa',
      `19991001;1;IBUPROFENO 400 MG TABLETA;GENFAR S.A.;${regCode};31/12/2029;Vigente;CAJA X 20 TABLETAS;IBUPROFENO;400;mg;TABLETA;ORAL;Venta libre`,
      `19992002;2;CLONAZEPAM 2 MG TABLETA;ROCHE S.A.;INVIMA 2023M-009988;15/06/2028;Vigente;CAJA X 30 TABLETAS;CLONAZEPAM;2;mg;TABLETA;ORAL;Medicamento de control especial`,
    ].join('\n');

    const first = await caller('manager').pharmacy.importInvimaCatalog({
      csvText: csv,
      syncMatchingProducts: true,
    });
    expect(first).toEqual({ imported: 2, skipped: 0, inserted: 2, updated: 0, linkedProducts: 1 });
    const readVersion = () =>
      db.select({ version: products.version }).from(products).where(eq(products.id, med.id)).get()
        ?.version;
    const versionAfterLink = readVersion();
    expect(versionAfterLink).toBeGreaterThan(med.version);

    // An unchanged re-link must not invalidate open product editors
    await caller('manager').pharmacy.importInvimaCatalog({
      csvText: csv,
      syncMatchingProducts: true,
    });
    expect(readVersion()).toBe(versionAfterLink);

    // Re-importing same CSV updates instead of duplicating
    const second = await caller('manager').pharmacy.importInvimaCatalog({
      csvText: csv,
      syncMatchingProducts: false,
    });
    expect(second).toEqual({ imported: 2, skipped: 0, inserted: 0, updated: 2, linkedProducts: 0 });

    const updatedProfile = db
      .select({
        cumCode: pharmacyProductProfiles.cumCode,
        registrationExpiresAt: pharmacyProductProfiles.registrationExpiresAt,
        dosesPerPack: pharmacyProductProfiles.dosesPerPack,
      })
      .from(pharmacyProductProfiles)
      .where(eq(pharmacyProductProfiles.productId, med.id))
      .get();
    expect(updatedProfile).toEqual({
      cumCode: '19991001-01',
      registrationExpiresAt: '2029-12-31',
      dosesPerPack: 20,
    });

    const search = await caller('cashier').pharmacy.searchInvimaCatalog({ search: 'clonazepam' });
    expect(search.items).toHaveLength(1);
    expect(search.items[0]).toMatchObject({
      cumCode: '19992002-02',
      classification: 'controlled',
      dosesPerPack: 30,
      registrationExpiresAt: '2028-06-15',
      registrationStatus: 'vigente',
    });
  });

  it('6B.5 unlocks controlled medicines under FNE authorization with official ledger + monthly report, and surfaces allergy/duplicity alerts', async () => {
    const db = getDatabase();
    const controlledMed = await createMedicine({
      name: 'Clonazepam 2 mg FNE',
      price: 22_000,
      cost: 12_000,
      activeIngredient: 'Clonazepam',
      concentration: '2 mg',
      presentation: 'Caja x 30 tabletas',
      dosesPerPack: 30,
      classification: 'controlled',
    });
    const customer = await caller().customers.create({ name: `Paciente FNE ${nanoid(5)}` });

    // 1. Before FNE authorization, controlled medicine MUST stay fail-closed
    const blockedReq = await caller('cashier').pharmacy.checkoutRequirements({
      customerId: customer.id,
      items: [{ productId: controlledMed.id, quantity: 1, unitEquivalence: 1 }],
    });
    expect(blockedReq.fneEnabled).toBe(false);
    expect(blockedReq.requirements[0]?.blockedErrorCode).toBe('PHARMACY_CONTROLLED_NOT_ENABLED');

    // 2. Register professional authorization + FNE resolution
    await caller('admin').pharmacy.createAuthorization({
      userId: adminId,
      siteId,
      countryCode: 'CO',
      credentialType: 'Regente de Farmacia',
      credential: `RF-CO-${nanoid(6)}`,
      validFrom: businessDate,
    });
    const fneAuth = await caller('admin').pharmacy.createFneAuthorization({
      siteId,
      countryCode: 'CO',
      resolutionNumber: `RES-FNE-2026-${nanoid(4)}`,
      issuingAuthority: 'Fondo Nacional de Estupefacientes - MinSalud',
      responsibleUserId: adminId,
      validFrom: businessDate,
      validUntil: addCalendarDays(businessDate, 365),
    });

    // 3. Receive controlled stock -> auto-recorded in pharmacy_fne_ledger
    await caller().inventoryLots.receive({
      siteId,
      productId: controlledMed.id,
      lotNumber: `L-FNE-${nanoid(4)}`,
      expiresAt: addCalendarDays(businessDate, 365),
      quantity: 5,
      unitCost: 12_000,
    });

    // 4. Evidence for controlled medicine requires buyerDocument (retained formula)
    await expect(
      caller('cashier').pharmacy.recordEvidence({
        productId: controlledMed.id,
        customerId: customer.id,
        reference: `FNE-RX-MISS-${nanoid(5)}`,
        prescriberName: 'Dra. Gómez',
        prescriberCredential: 'RM-991122',
        authorizedQuantity: 1,
        validFrom: businessDate,
        expiresAt: addCalendarDays(businessDate, 15),
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'PHARMACY_EVIDENCE_INVALID' } });

    const evidence = await caller('cashier').pharmacy.recordEvidence({
      productId: controlledMed.id,
      customerId: customer.id,
      reference: `FNE-RX-OK-${nanoid(5)}`,
      prescriberName: 'Dra. Gómez',
      prescriberCredential: 'RM-991122',
      buyerDocument: 'CC 1020304050',
      authorizedQuantity: 1,
      validFrom: businessDate,
      expiresAt: addCalendarDays(businessDate, 15),
    });
    await caller('admin').pharmacy.approveEvidence({ id: evidence.id });

    const readyReq = await caller('cashier').pharmacy.checkoutRequirements({
      customerId: customer.id,
      items: [{ productId: controlledMed.id, quantity: 1, unitEquivalence: 1 }],
    });
    expect(readyReq.fneEnabled).toBe(true);
    expect(readyReq.ready).toBe(true);

    // 5. Complete controlled sale -> writes pharmacy_fne_ledger dispensation & dedicated audit
    const sale = await caller('cashier').sales.create({
      customerId: customer.id,
      paymentMethod: 'cash',
      pharmacyEvidenceIds: [evidence.id],
      items: [{ productId: controlledMed.id, unitId: baseUnitId, quantity: 1, unitPrice: 22_000 }],
    });
    expect(sale.status).toBe('completed');

    const ledgerRows = db
      .select()
      .from(pharmacyFneLedger)
      .where(
        and(
          eq(pharmacyFneLedger.tenantId, tenantId),
          eq(pharmacyFneLedger.productId, controlledMed.id)
        )
      )
      .all();
    expect(ledgerRows.map(r => r.movementType)).toEqual(['receipt', 'dispensation']);
    expect(ledgerRows[1]?.retainedFormulaDigest).toBeTruthy();

    const fneAudit = db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, 'pharmacy.fne.dispense')))
      .get();
    expect(fneAudit?.action).toBe('pharmacy.fne.dispense');

    const month = businessDate.slice(0, 7);
    const fneReport = await caller('manager').pharmacy.getFneMonthlyReport({ month });
    const row = fneReport.summary.find(s => s.productId === controlledMed.id);
    expect(row).toMatchObject({
      receipts: 5,
      dispensations: 1,
      closingBalance: 4,
    });
    expect(fneReport.activeAuthorization?.id).toBe(fneAuth.id);

    // 6. Revoking FNE authorization immediately re-locks controlled medicines
    await caller('admin').pharmacy.revokeFneAuthorization({
      id: fneAuth.id,
      reason: 'Vencimiento o suspensión de resolución FNE',
    });
    const relocked = await caller('cashier').pharmacy.checkoutRequirements({
      customerId: customer.id,
      items: [{ productId: controlledMed.id, quantity: 1, unitEquivalence: 1 }],
    });
    expect(relocked.fneEnabled).toBe(false);
    expect(relocked.requirements[0]?.blockedErrorCode).toBe('PHARMACY_CONTROLLED_NOT_ENABLED');

    // 7. Patient allergy + duplicate active ingredient safety alerts
    const acet1 = await createMedicine({
      name: 'Dolex Forte',
      price: 9_000,
      activeIngredient: 'Acetaminofén',
    });
    const acet2 = await createMedicine({
      name: 'Winasorb Gripa',
      price: 8_000,
      activeIngredient: 'ACETAMINOFEN',
    });
    const ibu = await createMedicine({
      name: 'Advil 400 mg',
      price: 11_000,
      activeIngredient: 'Ibuprofeno',
    });
    const allergy = await caller('cashier').pharmacy.addCustomerAllergy({
      customerId: customer.id,
      activeIngredient: 'Ibuprofeno',
      severity: 'severe',
      notes: 'Anafilaxia reportada a AINEs',
    });
    const listedAllergies = await caller('cashier').pharmacy.listCustomerAllergies({
      customerId: customer.id,
    });
    expect(listedAllergies.items).toHaveLength(1);

    const safety = await caller('cashier').pharmacy.checkoutRequirements({
      customerId: customer.id,
      items: [
        { productId: acet1.id, quantity: 1, unitEquivalence: 1 },
        { productId: acet2.id, quantity: 1, unitEquivalence: 1 },
        { productId: ibu.id, quantity: 1, unitEquivalence: 1 },
      ],
    });
    expect(safety.safetyAlerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'duplicate_active_ingredient',
          severity: 'warning',
        }),
        expect.objectContaining({
          kind: 'customer_allergy',
          severity: 'severe',
          productId: ibu.id,
          activeIngredient: 'Ibuprofeno',
        }),
      ])
    );

    await expect(
      caller('cashier').pharmacy.removeCustomerAllergy({ id: allergy.id })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await caller('manager').pharmacy.removeCustomerAllergy({ id: allergy.id });
    const afterRemove = await caller('cashier').pharmacy.listCustomerAllergies({
      customerId: customer.id,
    });
    expect(afterRemove.items).toHaveLength(0);
  });

  it('6B.6 enforces FNE credential site-scope, controlled fractionation gate, purchase/return/void ledger completeness, sequential balanceAfter, and historical month balances', async () => {
    const db = getDatabase();
    const otherSitePharmacistId = `u-fne-other-${nanoid(6)}`;
    await db.insert(users).values({
      id: otherSitePharmacistId,
      tenantId,
      email: `qf-sur-${nanoid(4)}@localhost`,
      passwordHash: 'hash',
      name: 'QF Solo Sucursal Sur',
      role: 'manager',
      isActive: true,
    });
    await caller('admin').pharmacy.createAuthorization({
      userId: otherSitePharmacistId,
      siteId: otherSiteId,
      countryCode: 'CO',
      credentialType: 'Químico Farmacéutico',
      credential: `QF-SUR-${nanoid(6)}`,
      validFrom: businessDate,
    });

    // Cross-site pharmacist credential cannot authorize FNE at main site
    await expect(
      caller('admin').pharmacy.createFneAuthorization({
        siteId,
        countryCode: 'CO',
        resolutionNumber: `RES-CROSS-${nanoid(6)}`,
        issuingAuthority: 'Fondo Nacional de Estupefacientes',
        responsibleUserId: otherSitePharmacistId,
        validFrom: businessDate,
      })
    ).rejects.toThrow(/PHARMACY_AUTHORIZATION_NOT_EFFECTIVE|professional authorization/i);

    const sharedReg = `INVIMA-2026M-FNE-${nanoid(6)}`;
    const ctrlBox = await createMedicine({
      name: 'Morfina Caja x 10 ampollas',
      price: 50_000,
      cost: 20_000,
      activeIngredient: 'Morfina clorhidrato',
      concentration: '10 mg/ml',
      dosageForm: 'Solución inyectable',
      presentation: 'Caja x 10 ampollas',
      dosesPerPack: 10,
      sanitaryRegistration: sharedReg,
      classification: 'controlled',
    });
    const ctrlAmp = await createMedicine({
      name: 'Morfina Ampolla x 1 unidad',
      price: 6_000,
      cost: 2_000,
      activeIngredient: 'Morfina clorhidrato',
      concentration: '10 mg/ml',
      dosageForm: 'Solución inyectable',
      presentation: '1 ampolla',
      dosesPerPack: 1,
      sanitaryRegistration: sharedReg,
      classification: 'controlled',
    });

    // Controlled fractionation fails closed while no FNE authorization is active
    const preLot = await caller('manager').inventoryLots.receive({
      siteId,
      productId: ctrlBox.id,
      lotNumber: `L-CTRL-LOCK-${nanoid(4)}`,
      expiresAt: addCalendarDays(businessDate, 365),
      quantity: 1,
      unitCost: 20_000,
    });
    await expect(
      caller('manager').pharmacy.fractionateLot({
        sourceLotId: preLot.lotId,
        targetProductId: ctrlAmp.id,
        sourceQuantity: 1,
        targetQuantity: 10,
        reason: 'Intento sin FNE activo',
      })
    ).rejects.toThrow(/active FNE authorization|not enabled/i);

    // Enable tenant-wide (siteId: null) FNE authorization backed by main pharmacist
    const mainQfId = `u-fne-main-${nanoid(6)}`;
    await db.insert(users).values({
      id: mainQfId,
      tenantId,
      email: `qf-main-${nanoid(4)}@localhost`,
      passwordHash: 'hash',
      name: 'QF Global FNE',
      role: 'manager',
      isActive: true,
    });
    await caller('admin').pharmacy.createAuthorization({
      userId: mainQfId,
      siteId: null,
      countryCode: 'CO',
      credentialType: 'Químico Farmacéutico',
      credential: `QF-GLB-${nanoid(6)}`,
      validFrom: businessDate,
    });
    const globalFne = await caller('admin').pharmacy.createFneAuthorization({
      siteId: null,
      countryCode: 'CO',
      resolutionNumber: `RES-GLB-${nanoid(6)}`,
      issuingAuthority: 'Fondo Nacional de Estupefacientes',
      responsibleUserId: mainQfId,
      validFrom: businessDate,
    });

    // Tenant-wide FNE resolution is visible when listing for a specific site
    const siteFneList = await caller('manager').pharmacy.listFneAuthorizations({
      siteId,
      activeOnly: true,
      page: 1,
      perPage: 20,
    });
    expect(siteFneList.items.some(a => a.id === globalFne.id)).toBe(true);

    // Supplier purchase receipt -> writes 'receipt' to FNE ledger
    const providerId = `prov-fne-${nanoid(6)}`;
    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Distribuidora FNE S.A.S.',
      isActive: true,
    });
    const trackedCtrl = await createMedicine({
      name: 'Fentanilo Parche Caja x 5',
      price: 40_000,
      cost: 18_000,
      activeIngredient: 'Fentanilo',
      concentration: '25 mcg/h',
      dosageForm: 'Parche transdérmico',
      presentation: 'Caja x 5 parches',
      dosesPerPack: 5,
      classification: 'controlled',
    });
    const lotNumber = `L-PUR-FNE-${nanoid(4)}`;
    const purchase = await caller('manager').purchases.create({
      providerId,
      notes: `FAC-FNE-${nanoid(5)}`,
      items: [
        {
          productId: trackedCtrl.id,
          unitId: baseUnitId,
          quantity: 10,
          costPerUnit: 18_000,
          lotReceipts: [
            {
              lotNumber,
              expiresAt: addCalendarDays(businessDate, 400),
              baseQuantity: 10,
            },
          ],
        },
      ],
    });
    expect(purchase.id).toBeTruthy();

    // Multi-prescription controlled sale (1 + 2 = 3 units) -> sequential balanceAfter [9, 7] & lotNumber
    const patient = await caller('manager').customers.create({
      name: 'Paciente Controlado Ciclo',
      taxId: `CC-${nanoid(7)}`,
    });
    const qfCaller = () => appRouter.createCaller(fresh({ role: 'manager', userId: mainQfId }));
    const ev1 = await qfCaller().pharmacy.recordEvidence({
      productId: trackedCtrl.id,
      customerId: patient.id,
      reference: `FNE-MULT-1-${nanoid(5)}`,
      prescriberName: 'Dra. Sofía Restrepo',
      prescriberCredential: 'RM-99881',
      buyerDocument: 'CC-77665544',
      authorizedQuantity: 1,
      validFrom: businessDate,
      expiresAt: addCalendarDays(businessDate, 10),
    });
    await qfCaller().pharmacy.approveEvidence({ id: ev1.id });
    const ev2 = await qfCaller().pharmacy.recordEvidence({
      productId: trackedCtrl.id,
      customerId: patient.id,
      reference: `FNE-MULT-2-${nanoid(5)}`,
      prescriberName: 'Dra. Sofía Restrepo',
      prescriberCredential: 'RM-99881',
      buyerDocument: 'CC-77665544',
      authorizedQuantity: 2,
      validFrom: businessDate,
      expiresAt: addCalendarDays(businessDate, 10),
    });
    await qfCaller().pharmacy.approveEvidence({ id: ev2.id });

    const multiSale = await caller('cashier').sales.create({
      customerId: patient.id,
      paymentMethod: 'cash',
      pharmacyEvidenceIds: [ev1.id, ev2.id],
      items: [{ productId: trackedCtrl.id, unitId: baseUnitId, quantity: 3, unitPrice: 40_000 }],
    });
    const multiSaleDetail = await caller('manager').sales.getById({ id: multiSale.id });
    const saleItemId = multiSaleDetail.items[0]!.id;

    // Return 1 unit from sale -> writes 'return' (+1, balanceAfter: 8)
    await caller('manager').sales.returnSale({
      id: multiSale.id,
      reason: 'Devolución parcial auditada',
      items: [{ saleItemId, quantity: 1 }],
    });

    const rowsAfterReturn = db
      .select()
      .from(pharmacyFneLedger)
      .where(
        and(
          eq(pharmacyFneLedger.tenantId, tenantId),
          eq(pharmacyFneLedger.productId, trackedCtrl.id)
        )
      )
      .all();
    expect(rowsAfterReturn.map(r => r.movementType)).toEqual([
      'receipt',
      'dispensation',
      'dispensation',
      'return',
    ]);
    expect(rowsAfterReturn.map(r => r.balanceAfter)).toEqual([10, 9, 7, 8]);
    expect(rowsAfterReturn[1]?.lotNumber).toBe(lotNumber);

    // Current month report reconciles and strips retainedFormulaDigest
    const curMonth = businessDate.slice(0, 7);
    const curReport = await caller('manager').pharmacy.getFneMonthlyReport({ month: curMonth });
    const medSummary = curReport.summary.find(s => s.productId === trackedCtrl.id);
    expect(medSummary).toMatchObject({
      openingBalance: 0,
      receipts: 10,
      dispensations: 3,
      returns: 1,
      closingBalance: 8,
    });
    for (const entry of curReport.entries) {
      expect('retainedFormulaDigest' in entry).toBe(false);
    }

    // Prior empty month reports 0 -> 0 instead of leaking today's live stock (8)
    const [yr, mo] = curMonth.split('-').map(Number);
    const prevMonth = mo === 1 ? `${yr! - 1}-12` : `${yr!}-${String(mo! - 1).padStart(2, '0')}`;
    const prevReport = await caller('manager').pharmacy.getFneMonthlyReport({ month: prevMonth });
    const prevSummary = prevReport.summary.find(s => s.productId === trackedCtrl.id);
    expect(prevSummary).toMatchObject({
      openingBalance: 0,
      receipts: 0,
      dispensations: 0,
      returns: 0,
      closingBalance: 0,
    });

    // Immutability trigger blocks UPDATE and DELETE on pharmacy_fne_ledger
    expect(() =>
      db
        .update(pharmacyFneLedger)
        .set({ notes: 'tamper' })
        .where(eq(pharmacyFneLedger.id, rowsAfterReturn[0]!.id))
        .run()
    ).toThrow(/immutable/i);

    // A dispensation drawn from two lots writes one ledger row per lot
    const earlyLot = await caller('manager').inventoryLots.receive({
      siteId,
      productId: trackedCtrl.id,
      lotNumber: `L-EARLY-${nanoid(4)}`,
      expiresAt: addCalendarDays(businessDate, 100),
      quantity: 2,
      unitCost: 18_000,
    });
    const ev3 = await qfCaller().pharmacy.recordEvidence({
      productId: trackedCtrl.id,
      customerId: patient.id,
      reference: `FNE-MULTILOT-${nanoid(5)}`,
      prescriberName: 'Dra. Sofía Restrepo',
      prescriberCredential: 'RM-99881',
      buyerDocument: 'CC-77665544',
      authorizedQuantity: 3,
      validFrom: businessDate,
      expiresAt: addCalendarDays(businessDate, 10),
    });
    await qfCaller().pharmacy.approveEvidence({ id: ev3.id });
    await caller('cashier').sales.create({
      customerId: patient.id,
      paymentMethod: 'cash',
      pharmacyEvidenceIds: [ev3.id],
      items: [{ productId: trackedCtrl.id, unitId: baseUnitId, quantity: 3, unitPrice: 40_000 }],
    });
    const multiLotRows = db
      .select({
        lotId: pharmacyFneLedger.lotId,
        quantityDelta: pharmacyFneLedger.quantityDelta,
        balanceAfter: pharmacyFneLedger.balanceAfter,
        evidenceId: pharmacyFneLedger.evidenceId,
      })
      .from(pharmacyFneLedger)
      .where(
        and(
          eq(pharmacyFneLedger.tenantId, tenantId),
          eq(pharmacyFneLedger.productId, trackedCtrl.id)
        )
      )
      .orderBy(sql`rowid`)
      .all()
      .slice(-2);
    const firstLotId = rowsAfterReturn[0]!.lotId;
    expect(multiLotRows).toEqual([
      { lotId: earlyLot.lotId, quantityDelta: -2, balanceAfter: 8, evidenceId: ev3.id },
      { lotId: firstLotId, quantityDelta: -1, balanceAfter: 7, evidenceId: ev3.id },
    ]);

    await caller('admin').pharmacy.revokeFneAuthorization({
      id: globalFne.id,
      reason: 'Fin de prueba 6B.6',
    });
  });

  it('6B.7 preserves COGS pool deltas, movement signs, outbox rows, preventive recall blocks, and multi-hop recall lineage', async () => {
    const db = getDatabase();
    const reg = `INVIMA-2026M-HOP-${nanoid(6)}`;
    const box = await createMedicine({
      name: 'Cetirizina Caja x 20',
      price: 20_000,
      cost: 10_000,
      activeIngredient: 'Cetirizina',
      concentration: '10 mg',
      dosageForm: 'Tableta',
      presentation: 'Caja x 20 tabletas',
      dosesPerPack: 20,
      sanitaryRegistration: reg,
    });
    const blister = await createMedicine({
      name: 'Cetirizina Blíster x 10',
      price: 11_000,
      cost: 5_000,
      activeIngredient: 'Cetirizina',
      concentration: '10 mg',
      dosageForm: 'Tableta',
      presentation: 'Blíster x 10 tabletas',
      dosesPerPack: 10,
      sanitaryRegistration: reg,
    });
    const tablet = await createMedicine({
      name: 'Cetirizina Unidad x 1',
      price: 1_200,
      cost: 500,
      activeIngredient: 'Cetirizina',
      concentration: '10 mg',
      dosageForm: 'Tableta',
      presentation: '1 tableta',
      dosesPerPack: 1,
      sanitaryRegistration: reg,
    });

    const boxLot = await caller('manager').inventoryLots.receive({
      siteId,
      productId: box.id,
      lotNumber: `L-HOP-${nanoid(4)}`,
      expiresAt: addCalendarDays(businessDate, 500),
      quantity: 1,
      unitCost: 10_000,
    });

    // Rejects underflow unitsPerSource cleanly with BAD_REQUEST instead of SQLite CHECK 500
    await expect(
      caller('manager').pharmacy.fractionateLot({
        sourceLotId: boxLot.lotId,
        targetProductId: blister.id,
        sourceQuantity: 1,
        targetQuantity: 1e-7,
        reason: 'Underflow ratio test',
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    // Hop 1: 1 Box -> 2 Blisters ($10,000 = 1,000,000 cents)
    const hop1 = await caller('manager').pharmacy.fractionateLot({
      sourceLotId: boxLot.lotId,
      targetProductId: blister.id,
      sourceQuantity: 1,
      targetQuantity: 2,
      reason: 'Apertura caja a blíster',
    });

    const srcMov = db
      .select()
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.tenantId, tenantId),
          eq(inventoryMovements.productId, box.id),
          eq(inventoryMovements.type, 'transformation')
        )
      )
      .get();
    const tgtMov = db
      .select()
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.tenantId, tenantId),
          eq(inventoryMovements.productId, blister.id),
          eq(inventoryMovements.type, 'transformation')
        )
      )
      .get();
    expect(srcMov).toMatchObject({
      quantity: -1,
      inventoryValueDeltaCents: -1_000_000,
      cogsValueDeltaCents: -1_000_000,
    });
    expect(tgtMov).toMatchObject({
      quantity: 2,
      inventoryValueDeltaCents: 1_000_000,
      cogsValueDeltaCents: 1_000_000,
    });

    const movOutbox = db
      .select()
      .from(syncOutbox)
      .where(
        and(eq(syncOutbox.tenantId, tenantId), eq(syncOutbox.entityType, 'inventory_movements'))
      )
      .all();
    expect(movOutbox.some(o => o.entityId === srcMov!.id)).toBe(true);
    expect(movOutbox.some(o => o.entityId === tgtMov!.id)).toBe(true);

    // Hop 2: 1 Blister -> 10 Tablets; then recall on Tablet propagates back to Blister & Box
    const hop2 = await caller('manager').pharmacy.fractionateLot({
      sourceLotId: hop1.targetLotId,
      targetProductId: tablet.id,
      sourceQuantity: 1,
      targetQuantity: 10,
      reason: 'Apertura blíster a tableta',
    });

    await caller('manager').pharmacy.createRecall({
      scopeType: 'lot',
      lotId: hop2.targetLotId,
      reason: 'Alerta sanitaria sobre tableta derivada',
    });

    const blisterAfterRecall = db
      .select({ status: inventoryLots.status })
      .from(inventoryLots)
      .where(eq(inventoryLots.id, hop1.targetLotId))
      .get();
    expect(blisterAfterRecall?.status).toBe('recalled');
  });

  it('6B.8 handles Colombian multi-blister & UI dose parsing, conflicting Frasco doses, and INVIMA sibling SKUs / CSV limits', async () => {
    const db = getDatabase();
    expect(resolveDosesPerPack(null, 'CAJA POR 3 BLISTER POR 10 TABLETAS')).toBe(30);
    expect(resolveDosesPerPack(null, 'Cápsula blanda x 25000 UI')).toBeNull();

    // Two 'Frasco' presentations with different explicit doses: candidate is MORE expensive per dose ($1,000 vs $500)
    const frasco60 = await createMedicine({
      name: 'Jarabe Marca Frasco',
      price: 30_000,
      activeIngredient: 'Desloratadina',
      concentration: '5 mg',
      dosageForm: 'Tableta',
      presentation: 'Frasco',
      dosesPerPack: 60,
    });
    const frasco20 = await createMedicine({
      name: 'Jarabe Genérico Frasco Pequeño',
      price: 20_000,
      activeIngredient: 'Desloratadina',
      concentration: '5 mg',
      dosageForm: 'Tableta',
      presentation: 'Frasco',
      dosesPerPack: 20,
    });
    await caller('manager').inventoryLots.receive({
      siteId,
      productId: frasco20.id,
      lotNumber: `L-FR20-${nanoid(4)}`,
      expiresAt: addCalendarDays(businessDate, 365),
      quantity: 5,
      unitCost: 8_000,
    });
    const frascoAlts = await caller('cashier').pharmacy.genericAlternatives({
      productId: frasco60.id,
      siteId,
      priceTier: 1,
    });
    expect(frascoAlts.items).toEqual([]);

    // INVIMA CSV with two CUM siblings sharing one sanitaryRegistration does NOT clobber each other's cumCode/dosesPerPack
    const sharedInvima = `INVIMA 2026M-SIB${nanoid(4)}`;
    const sibBox = await createMedicine({
      name: 'Losartán Caja x 30',
      price: 18_000,
      activeIngredient: 'Losartán',
      concentration: '50 mg',
      dosageForm: 'Tableta',
      presentation: 'Caja x 30 tabletas',
      dosesPerPack: 30,
      cumCode: '20010001-01',
      sanitaryRegistration: sharedInvima,
    });
    const sibBlister = await createMedicine({
      name: 'Losartán Blíster x 10',
      price: 7_000,
      activeIngredient: 'Losartán',
      concentration: '50 mg',
      dosageForm: 'Tableta',
      presentation: 'Blíster x 10 tabletas',
      dosesPerPack: 10,
      cumCode: '20010001-02',
      sanitaryRegistration: sharedInvima,
    });

    const csv = [
      'expediente;consecutivocum;producto;titular;registrosanitario;fechavencimiento;estadoregistro;descripcioncomercial;principioactivo;concentracion;formafarmaceutica;condicionventa',
      `20010001;01;"=LOSARTAN\n50 MG";LAB COL;${sharedInvima};2026-02-29;Vigente;CAJA POR 3 BLISTER POR 10 TABLETAS;LOSARTAN;50 mg;TABLETA;Con formula medica`,
      `20010001;02;LOSARTAN 50 MG BLISTER;LAB COL;${sharedInvima};2030-05-15;Vigente;BLISTER POR 10 TABLETAS;LOSARTAN;50 mg;TABLETA;Con formula medica`,
    ].join('\n');

    const imp = await caller('manager').pharmacy.importInvimaCatalog({
      csvText: `${csv}\n20010001;03;;LAB COL;${sharedInvima};2030-05-15;Vigente;;LOSARTAN;50 mg;TABLETA;Con formula medica\n`,
      syncMatchingProducts: true,
    });
    expect(imp.imported).toBe(2);
    expect(imp.skipped).toBe(1);

    const pBox = db
      .select()
      .from(pharmacyProductProfiles)
      .where(eq(pharmacyProductProfiles.productId, sibBox.id))
      .get();
    const pBlister = db
      .select()
      .from(pharmacyProductProfiles)
      .where(eq(pharmacyProductProfiles.productId, sibBlister.id))
      .get();
    expect(pBox?.cumCode).toBe('20010001-01');
    expect(pBox?.dosesPerPack).toBe(30);
    expect(pBlister?.cumCode).toBe('20010001-02');
    expect(pBlister?.dosesPerPack).toBe(10);

    const importedFirst = await caller('cashier').pharmacy.searchInvimaCatalog({
      search: '20010001-01',
      page: 1,
      perPage: 5,
    });
    expect(importedFirst.items[0]?.productName.startsWith('=')).toBe(false);
    expect(importedFirst.items[0]?.registrationExpiresAt).toBeNull();
  });

  it('6B.9 matches salt-form allergies without leaking clinical notes, exports/scrubs allergies on DSAR anonymization, and isolates cross-tenant calls', async () => {
    const db = getDatabase();
    const cust = await caller('manager').customers.create({
      name: 'Paciente Privacidad DSAR',
      taxId: `CC-DSAR-${nanoid(6)}`,
    });
    const amox = await createMedicine({
      name: 'Amoxicilina 500 mg Cápsula',
      price: 12_000,
      activeIngredient: 'Amoxicilina',
      dosageForm: 'Cápsula',
    });
    const hierro = await createMedicine({
      name: 'Sulfato Ferroso 300 mg',
      price: 8_000,
      activeIngredient: 'Sulfato ferroso',
      dosageForm: 'Tableta',
    });
    await caller('manager').inventoryLots.receive({
      siteId,
      productId: hierro.id,
      lotNumber: `L-FE-${nanoid(4)}`,
      expiresAt: addCalendarDays(businessDate, 365),
      quantity: 5,
      unitCost: 3_000,
    });

    await caller('cashier').pharmacy.addCustomerAllergy({
      customerId: cust.id,
      activeIngredient: 'Amoxicilina trihidrato',
      severity: 'severe',
      notes: 'Dato clínico sensible confidencial',
    });
    await caller('cashier').pharmacy.addCustomerAllergy({
      customerId: cust.id,
      activeIngredient: 'Sulfa',
      severity: 'moderate',
    });
    const removedAllergy = await caller('cashier').pharmacy.addCustomerAllergy({
      customerId: cust.id,
      activeIngredient: 'Penicilina',
      severity: 'mild',
    });
    await caller('manager').pharmacy.removeCustomerAllergy({ id: removedAllergy.id });

    const preflight = await caller('cashier').pharmacy.checkoutRequirements({
      customerId: cust.id,
      items: [
        { productId: amox.id, quantity: 1, unitEquivalence: 1 },
        { productId: hierro.id, quantity: 1, unitEquivalence: 1 },
      ],
    });
    const allergyAlerts = preflight.safetyAlerts.filter(a => a.kind === 'customer_allergy');
    // Matches Amoxicilina via base INN, does NOT false-match Sulfato ferroso on 'Sulfa', and omits clinical notes
    expect(allergyAlerts).toHaveLength(1);
    expect(allergyAlerts[0]?.productId).toBe(amox.id);
    expect('notes' in allergyAlerts[0]!).toBe(false);

    // Complete a sale so disposePersonalData takes the 'anonymize' path
    await caller('cashier').sales.create({
      customerId: cust.id,
      paymentMethod: 'cash',
      items: [{ productId: hierro.id, unitId: baseUnitId, quantity: 1, unitPrice: 8_000 }],
    });

    const exported = await caller('admin').customers.exportPersonalData({ id: cust.id });
    expect(exported.records.pharmacyCustomerAllergies).toHaveLength(2);

    const custRow = db.select().from(users).where(eq(users.id, adminId)).get()!;
    expect(custRow.id).toBe(adminId);
    const currentCust = await caller('admin').customers.getById({ id: cust.id });
    const disposed = await caller('admin').customers.disposePersonalData({
      id: cust.id,
      version: currentCust.version,
      confirmation: 'Paciente Privacidad DSAR',
    });
    expect(disposed.disposition).toBe('anonymized');
    const removedAllergyAudits = db
      .select({ before: auditLogs.before, after: auditLogs.after })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.resourceType, 'pharmacy_customer_allergy'),
          eq(auditLogs.resourceId, removedAllergy.id)
        )
      )
      .all();
    expect(removedAllergyAudits).toHaveLength(2);
    expect(JSON.stringify(removedAllergyAudits)).not.toContain(cust.id);

    const afterAnon = await caller('cashier').pharmacy.listCustomerAllergies({
      customerId: cust.id,
    });
    expect(afterAnon.items).toEqual([]);

    // Cross-tenant isolation: another tenant sees 0 INVIMA rows, 0 fractionations, and cannot access main site
    const foreignTenantId = `t-b6b-foreign-${nanoid(6)}`;
    const foreignUserId = `u-b6b-foreign-${nanoid(6)}`;
    const foreignEmail = `foreign-${nanoid(5)}@localhost`;
    await db
      .insert(tenants)
      .values({ id: foreignTenantId, name: 'Otra Droguería', slug: foreignTenantId });
    await db.insert(users).values({
      id: foreignUserId,
      tenantId: foreignTenantId,
      email: foreignEmail,
      passwordHash: 'hash',
      name: 'Admin Externo',
      role: 'admin',
      isActive: true,
    });
    const foreignDevice = await registerDeviceService(db, {
      tenantId: foreignTenantId,
      userId: foreignUserId,
      kind: 'web',
      name: 'foreign-device',
    });
    const foreignFresh = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId: foreignTenantId,
      userId: foreignUserId,
      email: foreignEmail,
      siteId: '',
      deviceId: foreignDevice.deviceId,
      defaultRole: 'admin',
    });
    const foreignCaller = appRouter.createCaller(foreignFresh());
    const foreignInvima = await foreignCaller.pharmacy.searchInvimaCatalog({
      page: 1,
      perPage: 50,
    });
    expect(foreignInvima.items).toEqual([]);
    const foreignFrac = await foreignCaller.pharmacy.listFractionations({ page: 1, perPage: 50 });
    expect(foreignFrac.items).toEqual([]);
    await expect(
      foreignCaller.pharmacy.listEnvironmentalLogs({ siteId, page: 1, perPage: 20 })
    ).rejects.toThrow();
  });

  it('6B.10 keeps the FNE book reconciled with lot stock across legacy stock, transfers and counts', async () => {
    const db = getDatabase();
    const ledger = (productId: string, atSite: string) =>
      db
        .select({
          movementType: pharmacyFneLedger.movementType,
          quantityDelta: pharmacyFneLedger.quantityDelta,
          balanceAfter: pharmacyFneLedger.balanceAfter,
        })
        .from(pharmacyFneLedger)
        .where(
          and(
            eq(pharmacyFneLedger.tenantId, tenantId),
            eq(pharmacyFneLedger.siteId, atSite),
            eq(pharmacyFneLedger.productId, productId)
          )
        )
        .orderBy(sql`rowid`)
        .all();

    const ctrl = await createMedicine({
      name: 'Clonazepam Caja x 30',
      price: 30_000,
      cost: 10_000,
      activeIngredient: 'Clonazepam',
      concentration: '2 mg',
      presentation: 'Caja x 30 tabletas',
      dosesPerPack: 30,
      classification: 'controlled',
    });

    // Stock that predates the ledger opens the book instead of being ignored
    const legacyLotId = `lot-legacy-${nanoid(6)}`;
    await db.insert(inventoryLots).values({
      id: legacyLotId,
      tenantId,
      siteId,
      productId: ctrl.id,
      lotNumber: `L-LEGACY-${nanoid(4)}`,
      expiresAt: addCalendarDays(businessDate, 300),
      onHand: 50,
      unitCost: 10_000,
    });
    await caller('manager').inventoryLots.receive({
      siteId,
      productId: ctrl.id,
      lotNumber: `L-NEW-${nanoid(4)}`,
      expiresAt: addCalendarDays(businessDate, 400),
      quantity: 10,
      unitCost: 10_000,
    });
    expect(ledger(ctrl.id, siteId)).toEqual([
      { movementType: 'opening_balance', quantityDelta: 50, balanceAfter: 50 },
      { movementType: 'receipt', quantityDelta: 10, balanceAfter: 60 },
    ]);

    // An unledgered stock change surfaces as an explicit reconciliation row
    await db.update(inventoryLots).set({ onHand: 45 }).where(eq(inventoryLots.id, legacyLotId));
    await caller('manager').inventoryLots.receive({
      siteId,
      productId: ctrl.id,
      lotNumber: `L-NEW2-${nanoid(4)}`,
      expiresAt: addCalendarDays(businessDate, 420),
      quantity: 5,
      unitCost: 10_000,
    });
    expect(ledger(ctrl.id, siteId).slice(2)).toEqual([
      { movementType: 'reconciliation', quantityDelta: -5, balanceAfter: 55 },
      { movementType: 'receipt', quantityDelta: 5, balanceAfter: 60 },
    ]);

    // Transfers write transfer_out at origin and transfer_in at destination, and void reverses both
    const transfer = await caller('manager').transfers.create({
      fromSiteId: siteId,
      toSiteId: otherSiteId,
      items: [
        { productId: ctrl.id, quantity: 8, lotAllocations: [{ lotId: legacyLotId, quantity: 8 }] },
      ],
    });
    expect(ledger(ctrl.id, siteId).at(-1)).toEqual({
      movementType: 'transfer_out',
      quantityDelta: -8,
      balanceAfter: 52,
    });
    expect(ledger(ctrl.id, otherSiteId)).toEqual([
      { movementType: 'transfer_in', quantityDelta: 8, balanceAfter: 8 },
    ]);
    await caller('manager').transfers.void({ transferId: transfer.id, reason: 'Traslado errado' });
    expect(ledger(ctrl.id, otherSiteId).at(-1)).toEqual({
      movementType: 'transfer_out',
      quantityDelta: -8,
      balanceAfter: 0,
    });
    expect(ledger(ctrl.id, siteId).at(-1)).toEqual({
      movementType: 'transfer_in',
      quantityDelta: 8,
      balanceAfter: 60,
    });

    const report = await caller('manager').pharmacy.getFneMonthlyReport({
      month: businessDate.slice(0, 7),
    });
    expect(report.summary.find(row => row.productId === ctrl.id)).toMatchObject({
      openingBalance: 50,
      receipts: 15,
      transfersNet: 0,
      adjustmentsNet: -5,
      closingBalance: 60,
    });

    // An approved count writes the lot difference as a count_adjustment
    const counted = await createMedicine({
      name: 'Alprazolam Caja x 30',
      price: 20_000,
      activeIngredient: 'Alprazolam',
      concentration: '0.5 mg',
      presentation: 'Caja x 30 tabletas',
      dosesPerPack: 30,
      classification: 'controlled',
    });
    const countedLotNumber = `L-COUNT-${nanoid(4)}`;
    await caller('manager').inventoryLots.receive({
      siteId,
      productId: counted.id,
      lotNumber: countedLotNumber,
      expiresAt: addCalendarDays(businessDate, 300),
      quantity: 10,
      unitCost: 5_000,
    });
    const created = await caller('manager').inventory.createCountSession({
      siteId,
      productIds: [counted.id],
    });
    const saved = await caller('manager').inventory.saveCountSession({
      id: created.id,
      version: created.version,
      lines: [
        {
          lineId: created.lines[0]!.id,
          version: 0,
          countedQuantity: 7,
          identities: [{ code: countedLotNumber, quantity: 7 }],
        },
      ],
    });
    const submitted = await caller('manager').inventory.submitCountSession({
      id: saved.id,
      version: saved.version,
    });
    await caller('admin').inventory.approveCountSession({
      id: submitted.id,
      version: submitted.version,
    });
    expect(ledger(counted.id, siteId)).toEqual([
      { movementType: 'receipt', quantityDelta: 10, balanceAfter: 10 },
      { movementType: 'count_adjustment', quantityDelta: -3, balanceAfter: 7 },
    ]);
  });

  it('6B.11 rejects dose-changing fractionation, client-side 1403 limits and registrations the INVIMA catalog deactivated', async () => {
    const reg = `INVIMA-2026M-DOSE-${nanoid(6)}`;
    const box = await createMedicine({
      name: 'Loratadina Caja x 30',
      price: 15_000,
      activeIngredient: 'Loratadina',
      concentration: '10 mg',
      presentation: 'Caja x 30 tabletas',
      dosesPerPack: 30,
      sanitaryRegistration: reg,
    });
    const blister = await createMedicine({
      name: 'Loratadina Blíster x 10',
      price: 6_000,
      activeIngredient: 'Loratadina',
      concentration: '10 mg',
      presentation: 'Blíster x 10 tabletas',
      dosesPerPack: 10,
      sanitaryRegistration: reg,
    });
    const boxLot = await caller('manager').inventoryLots.receive({
      siteId,
      productId: box.id,
      lotNumber: `L-DOSE-${nanoid(4)}`,
      expiresAt: addCalendarDays(businessDate, 300),
      quantity: 2,
      unitCost: 9_000,
    });
    await expect(
      caller('manager').pharmacy.fractionateLot({
        sourceLotId: boxLot.lotId,
        targetProductId: blister.id,
        sourceQuantity: 1,
        targetQuantity: 100,
        reason: 'Intento de crear dosis',
      })
    ).rejects.toThrow(/exactly the doses/i);

    await expect(
      caller('cashier').pharmacy.recordEnvironmentalLog({
        period: 'morning',
        zone: 'ambient',
        temperatureC: 35,
        humidityPercent: 50,
        maxTempC: 40,
      } as never)
    ).rejects.toThrow();
    await expect(
      caller('cashier').pharmacy.recordEnvironmentalLog({
        period: 'morning',
        zone: 'ambient',
        temperatureC: 35,
        humidityPercent: 50,
      })
    ).rejects.toThrow(/corrective action/i);

    const cum = `2099${nanoid(4).replace(/[^0-9]/g, '1')}`;
    await caller('manager').pharmacy.importInvimaCatalog({
      csvText: [
        'expediente;consecutivocum;producto;titular;registrosanitario;fechavencimiento;estadoregistro;principioactivo;formafarmaceutica;condicionventa',
        `${cum};1;LORATADINA 10 MG;LAB;${reg};31/12/2030;Cancelado;LORATADINA;TABLETA;Venta libre`,
      ].join('\n'),
      syncMatchingProducts: true,
    });
    const preflight = await caller('cashier').pharmacy.checkoutRequirements({
      items: [{ productId: box.id, quantity: 1, unitEquivalence: 1 }],
    });
    expect(preflight.requirements[0]?.blockedErrorCode).toBe(
      'PHARMACY_PRODUCT_REGISTRATION_INACTIVE'
    );
    await expect(
      caller('cashier').sales.create({
        paymentMethod: 'cash',
        items: [{ productId: box.id, unitId: baseUnitId, quantity: 1, unitPrice: 15_000 }],
      })
    ).rejects.toThrow(/INVIMA catalog marks/i);
  });
});
