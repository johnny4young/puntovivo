/**
 * DIAN numbering ranges: registration rules, roles, tenant isolation, and the
 * relief of a spent range inside the emission transaction.
 * @module __tests__/fiscal-numbering-ranges
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { TRPCError } from '@trpc/server';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  companies,
  fiscalDocuments,
  fiscalEmissionIntents,
  fiscalNumberingResolutions,
  inventoryBalances,
  products,
  sites,
  tenantLocaleSettings,
  tenants,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';
import { appRouter } from '../trpc/router.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';
import { selectNumberingRange } from '../services/fiscal/numbering/select.js';
import { materializeFiscalEmissionIntent } from '../services/fiscal/orchestrator/intents.js';
import { alignLegacyNumberingEnvironment } from '../db/numbering-environment.js';

const DAY_MS = 86_400_000;
const TECHNICAL_KEY = 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let saleSiteId: string;
let siteB: string;
let siteC: string;
let baseUnitId: string;
let foreignTenantId: string;
let foreignSiteId: string;
let api: (role?: 'admin' | 'manager' | 'cashier') => ReturnType<typeof appRouter.createCaller>;
let foreignApi: () => ReturnType<typeof appRouter.createCaller>;

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function rangeInput(overrides: Record<string, unknown> = {}) {
  return {
    siteId: siteB,
    kind: 'DEE' as const,
    resolutionNumber: '18764000001',
    resolutionDate: iso(-DAY_MS),
    prefix: `P${nanoid(3)
      .replace(/[^A-Za-z0-9]/gu, 'X')
      .toUpperCase()}`,
    fromNumber: 1,
    toNumber: 1000,
    validFrom: iso(-60_000),
    validUntil: iso(365 * DAY_MS),
    environment: 'habilitacion' as const,
    ...overrides,
  };
}

async function errorOf(
  promise: Promise<unknown>
): Promise<{ code: string; errorCode?: string; details?: unknown }> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(TRPCError);
  const cause = (error as TRPCError).cause;
  return {
    code: (error as TRPCError).code,
    ...(cause instanceof ServerErrorWithCode
      ? { errorCode: cause.errorCode, details: cause.details }
      : {}),
  };
}

function rangeRow(id: string) {
  return getDatabase()
    .select()
    .from(fiscalNumberingResolutions)
    .where(eq(fiscalNumberingResolutions.id, id))
    .get();
}

async function seedProduct(price: number): Promise<string> {
  const db = getDatabase();
  const productId = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id: productId,
    tenantId,
    name: `Martillo ${productId.slice(0, 4)}`,
    sku: `NR-${nanoid(6)}`,
    price,
    price2: price,
    price3: price,
    cost: price / 2,
    marginPercent1: 0,
    marginPercent2: 0,
    marginPercent3: 0,
    marginAmount1: 0,
    marginAmount2: 0,
    marginAmount3: 0,
    taxRate: 0,
    initialCost: price / 2,
    minStock: 0,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(unitXProduct).values({
    id: nanoid(),
    productId,
    unitId: baseUnitId,
    equivalence: 1,
    price,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(inventoryBalances).values({
    id: nanoid(),
    tenantId,
    siteId: saleSiteId,
    productId,
    onHand: 50,
    reserved: 0,
    createdAt: now,
    updatedAt: now,
  });
  return productId;
}

async function sell(price = 10_000) {
  const productId = await seedProduct(price);
  return api().sales.create({
    items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice: price, discount: 0 }],
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    amountReceived: price,
    discountAmount: 0,
  });
}

async function settledIntent(saleId: string) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const intent = getDatabase()
      .select()
      .from(fiscalEmissionIntents)
      .where(
        and(
          eq(fiscalEmissionIntents.tenantId, tenantId),
          eq(fiscalEmissionIntents.sourceId, saleId),
          eq(fiscalEmissionIntents.kind, 'DEE')
        )
      )
      .get();
    if (intent && intent.status !== 'queued' && intent.status !== 'materializing') return intent;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Fiscal intent for ${saleId} never settled`);
}

function documentOf(saleId: string) {
  return getDatabase()
    .select()
    .from(fiscalDocuments)
    .where(
      and(
        eq(fiscalDocuments.tenantId, tenantId),
        eq(fiscalDocuments.sourceId, saleId),
        eq(fiscalDocuments.kind, 'DEE')
      )
    )
    .get();
}

async function insertSite(targetTenantId: string, companyId: string, name: string) {
  const id = nanoid();
  await getDatabase()
    .insert(sites)
    .values({ id, tenantId: targetTenantId, companyId, name, isActive: true });
  return id;
}

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
  saleSiteId = site.id;
  siteB = await insertSite(tenantId, site.companyId, 'Sede Norte');
  siteC = await insertSite(tenantId, site.companyId, 'Sede Sur');
  const unit = await db
    .select()
    .from(units)
    .where(and(eq(units.tenantId, tenantId), eq(units.abbreviation, 'UND')))
    .get();
  if (!unit) throw new Error('Expected seeded UND unit');
  baseUnitId = unit.id;

  const tenantRow = await db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
  await db
    .update(tenants)
    .set({
      settings: {
        ...((tenantRow?.settings as Record<string, unknown>) ?? {}),
        fiscal_dian_enabled: true,
        fiscal: {
          co: { nit: '900373115-3', softwareId: 'sw-test', softwarePin: '12301' },
        },
      },
    })
    .where(eq(tenants.id, tenantId))
    .run();
  const now = new Date().toISOString();
  await db
    .insert(tenantLocaleSettings)
    .values({ tenantId, countryCode: 'CO', updatedAt: now })
    .onConflictDoUpdate({
      target: tenantLocaleSettings.tenantId,
      set: { countryCode: 'CO', updatedAt: now },
    });

  const device = await registerDevice(db, {
    tenantId,
    userId,
    kind: 'web',
    name: 'fiscal-numbering-ranges.test',
  });
  const fresh = makeFreshContextFactory({
    db,
    serverApp: server.app,
    tenantId,
    userId,
    email: 'admin@localhost',
    siteId: saleSiteId,
    deviceId: device.deviceId,
    defaultRole: 'admin',
  });
  api = role => appRouter.createCaller(fresh(role ? { role } : undefined));
  await api().cashSessions.open({
    registerName: `numbering-${nanoid(4)}`,
    openingFloat: 100,
    denominations: [{ value: 100, count: 1 }],
  });

  foreignTenantId = nanoid();
  const foreignCompanyId = nanoid();
  const foreignUserId = nanoid();
  await db.insert(tenants).values({
    id: foreignTenantId,
    name: 'Numbering Foreign Tenant',
    slug: `numbering-foreign-${foreignTenantId.slice(0, 8)}`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(companies).values({
    id: foreignCompanyId,
    tenantId: foreignTenantId,
    name: 'Numbering Foreign Company',
    createdAt: now,
    updatedAt: now,
  });
  foreignSiteId = await insertSite(foreignTenantId, foreignCompanyId, 'Foreign Site');
  await db.insert(users).values({
    id: foreignUserId,
    tenantId: foreignTenantId,
    email: `numbering-foreign-${foreignTenantId.slice(0, 8)}@example.com`,
    name: 'Foreign Admin',
    passwordHash: 'x',
    sessionVersion: 1,
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  const foreignDevice = await registerDevice(db, {
    tenantId: foreignTenantId,
    userId: foreignUserId,
    kind: 'web',
    name: 'fiscal-numbering-ranges.foreign',
  });
  const foreignFresh = makeFreshContextFactory({
    db,
    serverApp: server.app,
    tenantId: foreignTenantId,
    userId: foreignUserId,
    email: `numbering-foreign-${foreignTenantId.slice(0, 8)}@example.com`,
    siteId: foreignSiteId,
    deviceId: foreignDevice.deviceId,
    defaultRole: 'admin',
  });
  foreignApi = () => appRouter.createCaller(foreignFresh());
});

afterAll(async () => {
  await server.close();
});

describe('fiscalNumbering.create — registration rules', () => {
  it('1. upper-cases the prefix and refuses one that is not 1-4 letters or digits', async () => {
    const created = await api().fiscalNumbering.create(rangeInput({ prefix: 'nt1' }));
    expect(rangeRow(created.id)?.prefix).toBe('NT1');
    expect(
      (await errorOf(api().fiscalNumbering.create(rangeInput({ prefix: 'N-1' })))).errorCode
    ).toBe('FISCAL_NUMBERING_RANGE_INVALID');
    expect(
      (await errorOf(api().fiscalNumbering.create(rangeInput({ prefix: 'NORTE' })))).code
    ).toBe('BAD_REQUEST');
  });

  it('1. requires a prefix while the tenant has more than one active site', async () => {
    const refused = await errorOf(api().fiscalNumbering.create(rangeInput({ prefix: '' })));
    expect(refused).toMatchObject({
      errorCode: 'FISCAL_NUMBERING_RANGE_INVALID',
      details: { field: 'prefix', reason: 'required_with_multiple_sites' },
    });

    const db = getDatabase();
    db.update(sites).set({ isActive: false }).where(eq(sites.id, siteB)).run();
    db.update(sites).set({ isActive: false }).where(eq(sites.id, siteC)).run();
    try {
      const created = await api().fiscalNumbering.create(
        rangeInput({ siteId: saleSiteId, kind: 'FEV', prefix: '', technicalKey: TECHNICAL_KEY })
      );
      expect(rangeRow(created.id)?.prefix).toBe('');
      await api().fiscalNumbering.remove({ id: created.id });
    } finally {
      db.update(sites).set({ isActive: true }).where(eq(sites.id, siteB)).run();
      db.update(sites).set({ isActive: true }).where(eq(sites.id, siteC)).run();
    }
  });

  it('2. needs a range that starts at 1 or more and does not end before it starts', async () => {
    expect((await errorOf(api().fiscalNumbering.create(rangeInput({ fromNumber: 0 })))).code).toBe(
      'BAD_REQUEST'
    );
    expect(
      await errorOf(api().fiscalNumbering.create(rangeInput({ fromNumber: 50, toNumber: 49 })))
    ).toMatchObject({ details: { field: 'toNumber', reason: 'below_from' } });
  });

  it('3. needs a validity that ends after it starts and lasts two years at most', async () => {
    const from = iso(-60_000);
    expect(
      await errorOf(api().fiscalNumbering.create(rangeInput({ validFrom: from, validUntil: from })))
    ).toMatchObject({ details: { field: 'validUntil', reason: 'not_after_valid_from' } });
    expect(
      await errorOf(api().fiscalNumbering.create(rangeInput({ validUntil: iso(2 * 366 * DAY_MS) })))
    ).toMatchObject({ details: { field: 'validUntil', reason: 'longer_than_two_years' } });
  });

  it('4. refuses consecutives already claimed by the same prefix, at any site', async () => {
    const first = await api().fiscalNumbering.create(
      rangeInput({ prefix: 'OVL', fromNumber: 1, toNumber: 100 })
    );
    const clash = await errorOf(
      api().fiscalNumbering.create(
        rangeInput({ siteId: siteC, prefix: 'OVL', fromNumber: 100, toNumber: 200 })
      )
    );
    expect(clash).toMatchObject({
      errorCode: 'FISCAL_NUMBERING_RANGE_OVERLAP',
      details: { conflictingRangeId: first.id },
    });
    await expect(
      api().fiscalNumbering.create(
        rangeInput({ siteId: siteC, prefix: 'OVL', fromNumber: 101, toNumber: 200 })
      )
    ).resolves.toMatchObject({ status: 'active' });
    // Document numbers are unique per tenant, so kind and environment do not separate prefixes.
    for (const other of [
      { kind: 'FEV', technicalKey: TECHNICAL_KEY },
      { environment: 'produccion' },
    ]) {
      expect(
        (
          await errorOf(
            api().fiscalNumbering.create(
              rangeInput({ siteId: siteC, prefix: 'OVL', fromNumber: 50, toNumber: 60, ...other })
            )
          )
        ).errorCode
      ).toBe('FISCAL_NUMBERING_RANGE_OVERLAP');
    }
  });

  it('4. counts the numbers a live range already issued as claimed', async () => {
    const live = await api().fiscalNumbering.create(
      rangeInput({ siteId: siteC, prefix: 'LIV', fromNumber: 1, toNumber: 1000 })
    );
    getDatabase()
      .update(fiscalNumberingResolutions)
      .set({ currentNumber: 500 })
      .where(eq(fiscalNumberingResolutions.id, live.id))
      .run();
    expect(
      (
        await errorOf(
          api().fiscalNumbering.create(
            rangeInput({ siteId: siteC, prefix: 'LIV', fromNumber: 1, toNumber: 400 })
          )
        )
      ).errorCode
    ).toBe('FISCAL_NUMBERING_RANGE_OVERLAP');
  });

  it('5. registers only DEE and FEV ranges', async () => {
    expect(
      (await errorOf(api().fiscalNumbering.create(rangeInput({ kind: 'NC' as never })))).code
    ).toBe('BAD_REQUEST');
  });

  it('6. requires the technical key for FEV and drops it for DEE', async () => {
    expect(
      await errorOf(api().fiscalNumbering.create(rangeInput({ siteId: saleSiteId, kind: 'FEV' })))
    ).toMatchObject({ details: { field: 'technicalKey', reason: 'required_for_fev' } });
    const dee = await api().fiscalNumbering.create(
      rangeInput({ siteId: siteC, prefix: 'TKD', technicalKey: TECHNICAL_KEY })
    );
    expect(rangeRow(dee.id)?.technicalKey).toBeNull();
  });

  it('6. never returns the full technical key, nor writes it to the audit log', async () => {
    const fev = await api().fiscalNumbering.create(
      rangeInput({ siteId: siteB, kind: 'FEV', prefix: 'TKF', technicalKey: TECHNICAL_KEY })
    );
    const listed = (await api().fiscalNumbering.list({ siteId: siteB })).find(
      range => range.id === fev.id
    );
    expect(listed?.technicalKeyHint).toBe(TECHNICAL_KEY.slice(-4));
    expect(JSON.stringify(listed)).not.toContain(TECHNICAL_KEY);
    const audit = getDatabase()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.resourceId, fev.id)))
      .all();
    expect(audit.map(row => row.action)).toEqual(['fiscal_numbering.create']);
    expect(JSON.stringify(audit)).not.toContain(TECHNICAL_KEY);
  });

  it('7. keeps a range of the other environment scheduled and refuses to activate it', async () => {
    const prod = await api().fiscalNumbering.create(
      rangeInput({ siteId: siteC, prefix: 'PRD', environment: 'produccion' })
    );
    expect(prod.status).toBe('scheduled');
    expect(await errorOf(api().fiscalNumbering.activate({ id: prod.id }))).toMatchObject({
      errorCode: 'FISCAL_NUMBERING_RANGE_LOCKED',
      details: { reason: 'environment_mismatch' },
    });
  });

  it('8. starts before the first number unless a later one is declared with a reason', async () => {
    const fresh = await api().fiscalNumbering.create(rangeInput({ prefix: 'ST0' }));
    expect(rangeRow(fresh.id)?.currentNumber).toBe(0);
    expect(
      await errorOf(
        api().fiscalNumbering.create(rangeInput({ prefix: 'ST1', lastIssuedNumber: 40 }))
      )
    ).toMatchObject({ details: { field: 'openingReason', reason: 'required' } });
    expect(
      await errorOf(
        api().fiscalNumbering.create(
          rangeInput({ prefix: 'ST1', lastIssuedNumber: 1000, openingReason: 'Sistema anterior' })
        )
      )
    ).toMatchObject({ details: { field: 'lastIssuedNumber', reason: 'outside_range' } });
    const continued = await api().fiscalNumbering.create(
      rangeInput({ prefix: 'ST1', lastIssuedNumber: 40, openingReason: 'Sistema anterior' })
    );
    const listed = (await api().fiscalNumbering.list()).find(range => range.id === continued.id);
    expect(listed).toMatchObject({ currentNumber: 40, nextNumber: 41, remaining: 960 });
  });

  it('8. lets a later range reuse the unissued tail of a retired one', async () => {
    const original = await api().fiscalNumbering.create(
      rangeInput({ siteId: siteC, prefix: 'TAIL', fromNumber: 1, toNumber: 100 })
    );
    getDatabase()
      .update(fiscalNumberingResolutions)
      .set({ currentNumber: 10 })
      .where(eq(fiscalNumberingResolutions.id, original.id))
      .run();
    await api().fiscalNumbering.retire({ id: original.id, reason: 'Fecha mal digitada' });
    expect(
      (
        await errorOf(
          api().fiscalNumbering.create(
            rangeInput({ siteId: siteC, prefix: 'TAIL', fromNumber: 1, toNumber: 100 })
          )
        )
      ).errorCode
    ).toBe('FISCAL_NUMBERING_RANGE_OVERLAP');
    await expect(
      api().fiscalNumbering.create(
        rangeInput({
          siteId: siteC,
          prefix: 'TAIL',
          fromNumber: 1,
          toNumber: 100,
          lastIssuedNumber: 10,
          openingReason: 'Corrige la vigencia',
        })
      )
    ).resolves.toBeTruthy();
  });

  it('9. exposes no way to edit a registered range', () => {
    const procedures = Object.keys(appRouter._def.procedures).filter(name =>
      name.startsWith('fiscalNumbering.')
    );
    expect(procedures.sort()).toEqual([
      'fiscalNumbering.activate',
      'fiscalNumbering.create',
      'fiscalNumbering.list',
      'fiscalNumbering.remove',
      'fiscalNumbering.retire',
      'fiscalNumbering.usage',
    ]);
  });

  it('10. deletes a range only while it has issued nothing', async () => {
    const unused = await api().fiscalNumbering.create(rangeInput({ prefix: 'DEL' }));
    await api().fiscalNumbering.remove({ id: unused.id });
    expect(rangeRow(unused.id)).toBeUndefined();

    const used = await api().fiscalNumbering.create(rangeInput({ prefix: 'DEL2' }));
    getDatabase()
      .update(fiscalNumberingResolutions)
      .set({ currentNumber: 1 })
      .where(eq(fiscalNumberingResolutions.id, used.id))
      .run();
    expect(await errorOf(api().fiscalNumbering.remove({ id: used.id }))).toMatchObject({
      errorCode: 'FISCAL_NUMBERING_RANGE_LOCKED',
      details: { reason: 'numbers_issued' },
    });
  });

  it('11. refuses a site of another tenant', async () => {
    expect(
      (await errorOf(api().fiscalNumbering.create(rangeInput({ siteId: foreignSiteId })))).code
    ).toBe('NOT_FOUND');
    expect((await errorOf(api().fiscalNumbering.list({ siteId: foreignSiteId }))).code).toBe(
      'NOT_FOUND'
    );
    expect((await errorOf(api().fiscalNumbering.usage({ siteId: foreignSiteId }))).code).toBe(
      'NOT_FOUND'
    );
  });
});

describe('fiscalNumbering — lifecycle, roles and isolation', () => {
  it('schedules a second range and activates it on demand, retiring the first', async () => {
    const first = await api().fiscalNumbering.create(rangeInput({ prefix: 'LC1' }));
    // siteB already has an active DEE range from the rules above.
    expect(first.status).toBe('scheduled');
    const active = (await api().fiscalNumbering.list({ siteId: siteB })).find(
      range => range.kind === 'DEE' && range.status === 'active'
    );
    await api().fiscalNumbering.activate({ id: first.id });
    expect(rangeRow(first.id)?.status).toBe('active');
    expect(rangeRow(active!.id)).toMatchObject({
      status: 'retired',
      isActive: false,
      retireReason: 'replaced',
    });
  });

  it('retires with a reason and audits it', async () => {
    const range = await api().fiscalNumbering.create(rangeInput({ prefix: 'RT1' }));
    expect((await errorOf(api().fiscalNumbering.retire({ id: range.id, reason: ' ' }))).code).toBe(
      'BAD_REQUEST'
    );
    await api().fiscalNumbering.retire({ id: range.id, reason: 'Resolución anulada' });
    expect(rangeRow(range.id)).toMatchObject({
      status: 'retired',
      retireReason: 'Resolución anulada',
    });
    expect(
      await errorOf(api().fiscalNumbering.retire({ id: range.id, reason: 'Otra vez' }))
    ).toMatchObject({ details: { reason: 'already_closed' } });
    const audit = getDatabase()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.resourceId, range.id)))
      .orderBy(desc(auditLogs.createdAt))
      .get();
    expect(audit?.action).toBe('fiscal_numbering.retire');
  });

  it('lets a manager read but not write, and keeps a cashier out', async () => {
    await expect(api('manager').fiscalNumbering.list()).resolves.toBeInstanceOf(Array);
    await expect(api('manager').fiscalNumbering.usage()).resolves.toBeInstanceOf(Array);
    expect((await errorOf(api('manager').fiscalNumbering.create(rangeInput()))).code).toBe(
      'FORBIDDEN'
    );
    expect((await errorOf(api('cashier').fiscalNumbering.list())).code).toBe('FORBIDDEN');
  });

  it('never shows or touches one tenant’s ranges from another', async () => {
    const ours = await api().fiscalNumbering.create(rangeInput({ prefix: 'ISO' }));
    expect(await foreignApi().fiscalNumbering.list()).toEqual([]);
    expect(await foreignApi().fiscalNumbering.usage()).toEqual([]);
    for (const attempt of [
      foreignApi().fiscalNumbering.activate({ id: ours.id }),
      foreignApi().fiscalNumbering.retire({ id: ours.id, reason: 'x' }),
      foreignApi().fiscalNumbering.remove({ id: ours.id }),
    ]) {
      expect((await errorOf(attempt)).errorCode).toBe('FISCAL_NUMBERING_RANGE_NOT_FOUND');
    }
    expect(rangeRow(ours.id)?.status).toBe('scheduled');
  });
});

describe('emission draws from the active range and relieves a spent one', () => {
  it('hands the last number to one sale and relieves the other to the scheduled range', async () => {
    const last = await api().fiscalNumbering.create(
      rangeInput({ siteId: saleSiteId, prefix: 'LST', fromNumber: 1, toNumber: 1 })
    );
    const next = await api().fiscalNumbering.create(
      rangeInput({ siteId: saleSiteId, prefix: 'NXT', fromNumber: 1, toNumber: 100 })
    );
    expect([last.status, next.status]).toEqual(['active', 'scheduled']);

    const [saleA, saleB] = await Promise.all([sell(), sell()]);
    await Promise.all([settledIntent(saleA.id), settledIntent(saleB.id)]);
    const numbers = [documentOf(saleA.id)?.documentNumber, documentOf(saleB.id)?.documentNumber];
    expect(numbers.sort()).toEqual(['LST0000000001', 'NXT0000000001']);
    expect(rangeRow(last.id)).toMatchObject({
      status: 'exhausted',
      isActive: false,
      currentNumber: 1,
    });
    expect(rangeRow(next.id)).toMatchObject({ status: 'active', isActive: true, currentNumber: 1 });

    const relief = getDatabase()
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, 'fiscal_numbering.relieve'))
      )
      .get();
    expect(relief).toMatchObject({ resourceId: next.id });
    expect(relief?.after).toMatchObject({ relievedRangeId: last.id, relievedStatus: 'exhausted' });
  });

  it('blocks the losing sale’s document, not the sale, when nothing can relieve the range', async () => {
    const active = (await api().fiscalNumbering.list({ siteId: saleSiteId })).find(
      range => range.kind === 'DEE' && range.status === 'active'
    );
    await api().fiscalNumbering.retire({ id: active!.id, reason: 'Fin de prueba' });
    const single = await api().fiscalNumbering.create(
      rangeInput({ siteId: saleSiteId, prefix: 'ONE', fromNumber: 1, toNumber: 1 })
    );
    expect(single.status).toBe('active');

    const [saleA, saleB] = await Promise.all([sell(), sell()]);
    const intents = await Promise.all([settledIntent(saleA.id), settledIntent(saleB.id)]);
    expect(intents.map(intent => intent.status).sort()).toEqual(['blocked', 'materialized']);
    const blocked = intents.find(intent => intent.status === 'blocked');
    expect(blocked?.lastError).toMatchObject({ reason: 'numbering_resolution_exhausted' });
    const issued = [documentOf(saleA.id), documentOf(saleB.id)].filter(Boolean);
    expect(issued.map(doc => doc?.documentNumber)).toEqual(['ONE0000000001']);
  });

  it('closes an expired range and promotes the scheduled one in the same transaction', () => {
    const db = getDatabase();
    const site = siteC;
    const now = new Date().toISOString();
    const base = {
      tenantId,
      siteId: site,
      kind: 'FEV' as const,
      resolutionNumber: 'EXP-1',
      fromNumber: 1,
      toNumber: 50,
      currentNumber: 0,
      technicalKey: TECHNICAL_KEY,
      environment: 'habilitacion' as const,
      createdAt: now,
      updatedAt: now,
    };
    db.update(fiscalNumberingResolutions)
      .set({ status: 'retired', isActive: false })
      .where(
        and(eq(fiscalNumberingResolutions.siteId, site), eq(fiscalNumberingResolutions.kind, 'FEV'))
      )
      .run();
    const expiredId = nanoid();
    const successorId = nanoid();
    db.insert(fiscalNumberingResolutions)
      .values([
        {
          ...base,
          id: expiredId,
          prefix: 'EXA',
          validFrom: iso(-30 * DAY_MS),
          validUntil: iso(-DAY_MS),
          status: 'active',
          isActive: true,
        },
        {
          ...base,
          id: successorId,
          prefix: 'EXB',
          validFrom: iso(-2 * DAY_MS),
          validUntil: iso(300 * DAY_MS),
          status: 'scheduled',
          isActive: false,
        },
      ])
      .run();

    const selection = db.transaction(tx =>
      selectNumberingRange(tx, {
        tenantId,
        siteId: site,
        kind: 'FEV',
        environment: 'habilitacion',
        at: now,
        actorId: userId,
      })
    );
    expect(selection).toMatchObject({ ok: true, relievedRangeId: expiredId });
    expect(rangeRow(expiredId)?.status).toBe('expired');
    expect(rangeRow(successorId)?.status).toBe('active');
  });

  it('never numbers an FEV from a range without a technical key', async () => {
    const db = getDatabase();
    db.update(fiscalNumberingResolutions)
      .set({ status: 'retired', isActive: false })
      .where(
        and(
          eq(fiscalNumberingResolutions.siteId, saleSiteId),
          eq(fiscalNumberingResolutions.kind, 'FEV')
        )
      )
      .run();
    const now = new Date().toISOString();
    db.insert(fiscalNumberingResolutions)
      .values({
        id: nanoid(),
        tenantId,
        siteId: saleSiteId,
        kind: 'FEV',
        resolutionNumber: 'LEGACY-FEV',
        prefix: 'LGF',
        fromNumber: 1,
        toNumber: 100,
        currentNumber: 0,
        technicalKey: null,
        environment: 'habilitacion',
        validFrom: iso(-DAY_MS),
        validUntil: iso(100 * DAY_MS),
        status: 'active',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    await expect(api().sales.electronicInvoiceAvailability()).resolves.toMatchObject({
      available: false,
    });
  });

  it('numbers a re-armed sale that had no range once one is registered', async () => {
    const active = (await api().fiscalNumbering.list({ siteId: saleSiteId })).filter(
      range => range.kind === 'DEE' && (range.status === 'active' || range.status === 'scheduled')
    );
    for (const range of active) {
      await api().fiscalNumbering.retire({ id: range.id, reason: 'Sin rango' });
    }
    const sale = await sell();
    const blocked = await settledIntent(sale.id);
    expect(blocked).toMatchObject({ status: 'blocked' });
    expect(blocked.lastError).toMatchObject({ reason: 'numbering_resolution_missing' });

    await api().fiscalNumbering.create(
      rangeInput({ siteId: saleSiteId, prefix: 'RAR', fromNumber: 1, toNumber: 10 })
    );
    await api().reports.fiscal.retryIntent({ intentId: blocked.id });
    await materializeFiscalEmissionIntent({
      db: getDatabase(),
      tenantId,
      intentId: blocked.id,
      log: { warn: () => {}, debug: () => {} },
    });
    expect(documentOf(sale.id)?.documentNumber).toBe('RAR0000000001');
  });

  it('reports consumption, expiry and whether a successor waits', async () => {
    const usage = await api().fiscalNumbering.usage({ siteId: saleSiteId });
    const dee = usage.find(entry => entry.kind === 'DEE');
    expect(dee).toMatchObject({ remaining: 9, remainingRatio: 0.9, hasScheduledSuccessor: false });
    expect(dee?.daysUntilExpiry).toBeGreaterThan(300);
    expect(dee?.dailyAverage).toBeCloseTo(1 / 14);
  });
});

describe('ranges registered before the environment existed', () => {
  it('follow their tenant into production, leaving API-registered ranges alone', () => {
    const db = getDatabase();
    db.update(tenants)
      .set({ settings: { fiscal: { co: { environment: 'produccion' } } } })
      .where(eq(tenants.id, foreignTenantId))
      .run();
    const now = new Date().toISOString();
    const base = {
      tenantId: foreignTenantId,
      siteId: foreignSiteId,
      resolutionNumber: 'OLD',
      fromNumber: 1,
      toNumber: 10,
      currentNumber: 0,
      environment: 'habilitacion' as const,
      validFrom: iso(-DAY_MS),
      validUntil: iso(DAY_MS),
      createdAt: now,
      updatedAt: now,
    };
    const legacyId = nanoid();
    const registeredId = nanoid();
    db.insert(fiscalNumberingResolutions)
      .values([
        { ...base, id: legacyId, kind: 'DEE', prefix: 'OLD' },
        {
          ...base,
          id: registeredId,
          kind: 'DEE',
          prefix: 'NEW',
          status: 'scheduled',
          isActive: false,
          createdBy: 'someone',
          resolutionDate: now,
        },
      ])
      .run();

    expect(alignLegacyNumberingEnvironment(db)).toBe(1);
    expect(rangeRow(legacyId)?.environment).toBe('produccion');
    expect(rangeRow(registeredId)?.environment).toBe('habilitacion');
    expect(alignLegacyNumberingEnvironment(db)).toBe(0);
  });
});
