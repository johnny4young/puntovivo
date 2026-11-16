import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  cashMovements,
  cashSessions,
  companies,
  dayCloseSignoffs,
  salePayments,
  sales,
  sites,
  tenantLocaleSettings,
  tenants,
  users,
} from '../db/schema.js';
import { hashStaffPin } from '../security/staffPins.js';
import { writeCashCloseSettings } from '../services/cash-close-settings.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { computeOperationsToday } from '../services/operations/today.js';
import { appRouter } from '../trpc/router.js';
import { freshCriticalContext } from './utils/criticalCommandFixture.js';

const DATE = '2026-07-14';
const NOON = '2026-07-14T17:00:00.000Z';
const SIGNATURE = 'data:image/png;base64,iVBORw0KGgo=';

let server: PuntovivoServer;

async function seedTenant(suffix: string) {
  const db = getDatabase();
  const ids = {
    tenantId: `dcg-tenant-${suffix}`,
    siteId: `dcg-site-${suffix}`,
    managerId: `dcg-manager-${suffix}`,
    cashierId: `dcg-cashier-${suffix}`,
  };
  await db.insert(tenants).values({
    id: ids.tenantId,
    name: `Guide ${suffix}`,
    slug: `guide-${suffix}`,
    settings: {},
    defaultCurrencyCode: 'COP',
  });
  await db.insert(tenantLocaleSettings).values({ tenantId: ids.tenantId, countryCode: 'CO' });
  await db
    .insert(companies)
    .values({ id: `dcg-company-${suffix}`, tenantId: ids.tenantId, name: `Company ${suffix}` });
  await db.insert(sites).values({
    id: ids.siteId,
    tenantId: ids.tenantId,
    companyId: `dcg-company-${suffix}`,
    name: `Site ${suffix}`,
    isActive: true,
  });
  await db.insert(users).values([
    {
      id: ids.managerId,
      tenantId: ids.tenantId,
      email: `${ids.managerId}@example.com`,
      name: `Manager ${suffix}`,
      passwordHash: 'x',
      staffPinHash: await hashStaffPin('246810'),
      role: 'manager',
    },
    {
      id: ids.cashierId,
      tenantId: ids.tenantId,
      email: `${ids.cashierId}@example.com`,
      name: `Cashier ${suffix}`,
      passwordHash: 'x',
      role: 'cashier',
    },
  ]);
  const device = await registerDevice(db, {
    tenantId: ids.tenantId,
    userId: ids.managerId,
    kind: 'web',
    name: `guide-${suffix}`,
  });
  const callerAs = (userId: string, role: 'manager' | 'cashier') =>
    appRouter.createCaller(
      freshCriticalContext({
        db,
        serverApp: server.app,
        tenantId: ids.tenantId,
        userId,
        email: `${userId}@example.com`,
        role,
        siteId: ids.siteId,
        deviceId: device.deviceId,
      })
    );
  return {
    ...ids,
    manager: () => callerAs(ids.managerId, 'manager'),
    cashier: () => callerAs(ids.cashierId, 'cashier'),
  };
}

type Tenant = Awaited<ReturnType<typeof seedTenant>>;

async function closedSession(tenant: Tenant, id: string, registerName: string, overShort: number) {
  await getDatabase()
    .insert(cashSessions)
    .values({
      id,
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
      cashierId: tenant.cashierId,
      registerName,
      openingFloat: 50000,
      openingCountDenominations: [],
      expectedBalance: 100000,
      actualCount: 100000 + overShort,
      overShort,
      status: 'closed',
      openedAt: '2026-07-14T13:00:00.000Z',
      closedAt: NOON,
    });
}

async function parkedDraft(tenant: Tenant, id: string) {
  await getDatabase().insert(sales).values({
    id,
    tenantId: tenant.tenantId,
    saleNumber: id,
    total: 42100,
    paymentStatus: 'pending',
    status: 'draft',
    createdBy: tenant.cashierId,
    suspendedAt: '2026-07-14T16:00:00.000Z',
    suspendedBy: tenant.cashierId,
    suspendedLabel: 'Domicilio',
    createdAt: '2026-07-14T16:00:00.000Z',
  });
}

describe('guided day close', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
  });

  afterAll(async () => {
    await server.close();
  });

  it('asks for a reason only over the tolerance and blocks the signature until it has one', async () => {
    const tenant = await seedTenant('reason');
    const db = getDatabase();
    await writeCashCloseSettings(db, tenant.tenantId, { differenceTolerance: 5000 });
    await closedSession(tenant, 'dcg-over', 'Caja 1', -12300);
    await closedSession(tenant, 'dcg-within', 'Caja 2', -2000);
    await closedSession(tenant, 'dcg-even', 'Caja 3', 0);
    await db.insert(sales).values({
      id: 'dcg-sale',
      tenantId: tenant.tenantId,
      saleNumber: 'DCG-1',
      total: 80000,
      paymentStatus: 'paid',
      status: 'completed',
      cashSessionId: 'dcg-over',
      createdBy: tenant.cashierId,
      createdAt: '2026-07-14T15:00:00.000Z',
    });
    await db.insert(salePayments).values([
      {
        id: 'dcg-pay-cash',
        tenantId: tenant.tenantId,
        saleId: 'dcg-sale',
        method: 'cash',
        amount: 50000,
      },
      {
        id: 'dcg-pay-card',
        tenantId: tenant.tenantId,
        saleId: 'dcg-sale',
        method: 'card',
        amount: 30000,
      },
    ]);

    await db.insert(cashMovements).values({
      id: 'dcg-skim',
      tenantId: tenant.tenantId,
      sessionId: 'dcg-even',
      type: 'skim',
      amount: -10000,
      createdBy: tenant.cashierId,
    });

    const guide = await tenant.manager().reports.dayClose.guide({ date: DATE });
    expect(guide.differenceTolerance).toBe(5000);
    expect(guide.sessions).toMatchObject({ closed: 3, open: 0 });
    expect(
      guide.differences.map(row => [row.sessionId, row.overTolerance, row.needsReason])
    ).toEqual([
      ['dcg-over', true, true],
      ['dcg-within', false, false],
    ]);
    expect(guide.figures).toMatchObject({
      sold: 80000,
      // (87700 + 98000 + 100000) counted, minus three 50000 floats, plus the 10000 skim.
      cashToDeposit: 145700,
      electronic: 30000,
      cashDifference: -14300,
    });
    expect(guide.blockers).toEqual(['unexplained_differences']);
    expect(guide.readyToSign).toBe(false);

    await expect(
      tenant.manager().reports.dayClose.signOff({ date: DATE, attestationAccepted: true })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        errorCode: 'DAY_CLOSE_NOT_READY',
        details: expect.objectContaining({ blockers: ['cash_differences_unexplained'] }),
      }),
    });

    await expect(
      tenant
        .manager()
        .reports.dayClose.explainDifference({ sessionId: 'dcg-over', reason: 'other' })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'CASH_VARIANCE_NOTE_REQUIRED' }),
    });
    await expect(
      tenant
        .manager()
        .reports.dayClose.explainDifference({ sessionId: 'dcg-even', reason: 'wrong_change' })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'CASH_VARIANCE_NOT_APPLICABLE' }),
    });
    await expect(
      tenant
        .cashier()
        .reports.dayClose.explainDifference({ sessionId: 'dcg-over', reason: 'wrong_change' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await tenant
      .manager()
      .reports.dayClose.explainDifference({ sessionId: 'dcg-over', reason: 'wrong_change' });
    expect(
      db.select().from(cashSessions).where(eq(cashSessions.id, 'dcg-over')).get()
    ).toMatchObject({
      varianceReason: 'wrong_change',
      varianceExplainedBy: tenant.managerId,
    });
    expect(
      db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'cash_session.variance_explained'),
            eq(auditLogs.resourceId, 'dcg-over')
          )
        )
        .all()
    ).toHaveLength(1);

    const ready = await tenant.manager().reports.dayClose.guide({ date: DATE });
    expect(ready.blockers).toEqual([]);
    expect(ready.readyToSign).toBe(true);
  });

  it('keeps another tenant away from a session and a draft', async () => {
    const owner = await seedTenant('owner');
    const intruder = await seedTenant('intruder');
    await closedSession(owner, 'dcg-owned', 'Caja 1', -9000);
    await parkedDraft(owner, 'dcg-owned-draft');

    await expect(
      intruder
        .manager()
        .reports.dayClose.explainDifference({ sessionId: 'dcg-owned', reason: 'wrong_change' })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'CASH_SESSION_NOT_FOUND' }),
    });
    await expect(
      intruder.manager().reports.dayClose.carryOverDraft({ saleId: 'dcg-owned-draft' })
    ).rejects.toMatchObject({ cause: expect.objectContaining({ errorCode: 'SALE_NOT_FOUND' }) });
    const guide = await intruder.manager().reports.dayClose.guide({ date: DATE });
    expect(guide.differences).toEqual([]);
    expect(guide.drafts).toEqual([]);
  });

  it('asks about a parked sale until it is left for tomorrow, then seals the day with the signature', async () => {
    const tenant = await seedTenant('seal');
    const db = getDatabase();
    await closedSession(tenant, 'dcg-seal', 'Caja 1', -700);
    await parkedDraft(tenant, 'dcg-draft');

    const before = await tenant.manager().reports.dayClose.guide({ date: DATE });
    expect(before.blockers).toEqual(['unexplained_differences']);
    expect(before.drafts).toEqual([
      expect.objectContaining({ id: 'dcg-draft', label: 'Domicilio', carriedOver: false }),
    ]);

    await tenant.manager().reports.dayClose.explainDifference({
      sessionId: 'dcg-seal',
      reason: 'other',
      note: 'Moneda caída',
    });
    expect((await tenant.manager().reports.dayClose.guide({ date: DATE })).readyToSign).toBe(false);

    await expect(
      tenant.cashier().reports.dayClose.carryOverDraft({ saleId: 'dcg-draft' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await tenant.manager().reports.dayClose.carryOverDraft({ saleId: 'dcg-draft' });
    const draft = db.select().from(sales).where(eq(sales.id, 'dcg-draft')).get();
    expect(draft).toMatchObject({ status: 'draft', carriedOverBy: tenant.managerId });
    expect(draft?.suspendedAt).not.toBeNull();
    // The flag is stamped now, after the fixture day, so it counts for any later close too.
    expect((await tenant.manager().reports.dayClose.guide({ date: DATE })).readyToSign).toBe(true);

    await expect(
      tenant.manager().reports.dayClose.signOff({
        date: DATE,
        attestationAccepted: true,
        signature: { method: 'pin', pin: '000000' },
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'DAY_CLOSE_SIGNATURE_INVALID' }),
    });
    expect(
      db.select().from(dayCloseSignoffs).where(eq(dayCloseSignoffs.tenantId, tenant.tenantId)).all()
    ).toHaveLength(0);

    await tenant.manager().reports.dayClose.signOff({
      date: DATE,
      attestationAccepted: true,
      signature: { method: 'drawn', image: SIGNATURE },
    });
    const sealed = await tenant.manager().reports.dayClose.guide({ date: DATE });
    expect(sealed.signoff).toMatchObject({
      signedByName: 'Manager seal',
      signatureMethod: 'drawn',
      signatureImage: SIGNATURE,
    });

    await expect(
      tenant
        .manager()
        .reports.dayClose.explainDifference({ sessionId: 'dcg-seal', reason: 'wrong_change' })
    ).rejects.toMatchObject({ cause: expect.objectContaining({ errorCode: 'DAY_CLOSE_SEALED' }) });
  });

  it('attests with the signer PIN and stores no image', async () => {
    const tenant = await seedTenant('pin');
    await tenant.manager().reports.dayClose.signOff({
      date: DATE,
      attestationAccepted: true,
      signature: { method: 'pin', pin: '246810' },
    });
    const row = getDatabase()
      .select()
      .from(dayCloseSignoffs)
      .where(eq(dayCloseSignoffs.tenantId, tenant.tenantId))
      .get();
    expect(row).toMatchObject({ signatureMethod: 'pin', signatureImage: null });
  });

  it('queues an unexplained difference in Hoy before the close', async () => {
    const tenant = await seedTenant('queue');
    await closedSession(tenant, 'dcg-queue', 'Caja 4', -8000);
    const now = new Date('2026-07-14T20:00:00.000Z');

    const pending = (await computeOperationsToday(getDatabase(), tenant.tenantId, now)).pending;
    expect(pending.find(item => item.kind === 'cashDifference')).toMatchObject({
      id: 'dcg-queue',
      severity: 'beforeClose',
      registerName: 'Caja 4',
      overShort: -8000,
    });

    await tenant.manager().reports.dayClose.explainDifference({
      sessionId: 'dcg-queue',
      reason: 'unrecorded_withdrawal',
    });
    const after = (await computeOperationsToday(getDatabase(), tenant.tenantId, now)).pending;
    expect(after.some(item => item.kind === 'cashDifference')).toBe(false);
  });
});
