import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  cashSessions,
  inventoryBalances,
  inventoryLots,
  pharmacyFneLedger,
  pharmacyProductProfiles,
  sites,
  tenantLocaleSettings,
  units,
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
    expect(first).toEqual({ imported: 2, inserted: 2, updated: 0, linkedProducts: 1 });

    // Re-importing same CSV updates instead of duplicating
    const second = await caller('manager').pharmacy.importInvimaCatalog({
      csvText: csv,
      syncMatchingProducts: false,
    });
    expect(second).toEqual({ imported: 2, inserted: 0, updated: 2, linkedProducts: 0 });

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

    await caller('cashier').pharmacy.removeCustomerAllergy({ id: allergy.id });
    const afterRemove = await caller('cashier').pharmacy.listCustomerAllergies({
      customerId: customer.id,
    });
    expect(afterRemove.items).toHaveLength(0);
  });
});
