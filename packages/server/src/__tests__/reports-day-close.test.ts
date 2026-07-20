/** -141b — comprehensive day-close report and immutable sign-off integration. */

import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  cashSessions,
  companies,
  dayCloseArtifacts,
  dayCloseSignoffs,
  fiscalDocuments,
  fiscalNumberingResolutions,
  salePayments,
  saleReturns,
  sales,
  sites,
  tenantLocaleSettings,
  tenants,
  users,
} from '../db/schema.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { signAccessToken } from '../security/authTokens.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import {
  freshCriticalContext,
  type FreshContextOverrides,
} from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;

function context(tenantId: string, userId: string, role: 'admin' | 'manager' | 'cashier'): Context {
  const db = getDatabase();
  const req = {
    server: server.app,
    headers: {},
    user: { userId, email: `${userId}@example.com`, role, tenantId },
    jwtVerify: async () => {},
  } as unknown as Context['req'];
  return {
    req,
    res: {} as Context['res'],
    db,
    user: { id: userId, email: `${userId}@example.com`, role, tenantId },
    tenantId,
    siteId: null,
  };
}

async function seedTenant(suffix: string) {
  const db = getDatabase();
  const now = '2026-07-15T12:00:00.000Z';
  const tenantId = `dcr-tenant-${suffix}`;
  const companyId = `dcr-company-${suffix}`;
  const siteId = `dcr-site-${suffix}`;
  const adminId = `dcr-admin-${suffix}`;
  const managerId = `dcr-manager-${suffix}`;
  const cashierId = `dcr-cashier-${suffix}`;
  await db.insert(tenants).values({
    id: tenantId,
    name: `Day close ${suffix}`,
    slug: `day-close-${suffix}`,
    settings: {},
    defaultCurrencyCode: 'COP',
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(tenantLocaleSettings).values({ tenantId, countryCode: 'CO' });
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
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values([
    {
      id: adminId,
      tenantId,
      email: `${adminId}@example.com`,
      name: `Admin ${suffix}`,
      passwordHash: 'x',
      role: 'admin',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: managerId,
      tenantId,
      email: `${managerId}@example.com`,
      name: `Manager ${suffix}`,
      passwordHash: 'x',
      role: 'manager',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: cashierId,
      tenantId,
      email: `${cashierId}@example.com`,
      name: `Cashier ${suffix}`,
      passwordHash: 'x',
      role: 'cashier',
      createdAt: now,
      updatedAt: now,
    },
  ]);
  return { tenantId, companyId, siteId, adminId, managerId, cashierId };
}

async function createCriticalActor(
  tenant: Awaited<ReturnType<typeof seedTenant>>,
  userId: string,
  role: 'admin' | 'manager' | 'cashier'
) {
  const db = getDatabase();
  const registration = await registerDevice(db, {
    tenantId: tenant.tenantId,
    userId,
    kind: 'web',
    name: `day-close-${role}-${userId}`,
  });
  return {
    fresh(overrides?: FreshContextOverrides) {
      return freshCriticalContext({
        db,
        serverApp: server.app,
        tenantId: tenant.tenantId,
        userId,
        email: `${userId}@example.com`,
        role,
        siteId: tenant.siteId,
        deviceId: registration.deviceId,
        ...overrides,
      });
    },
  };
}

describe('reports.dayClose.preview', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
  });

  afterAll(async () => {
    await server.close();
  });

  it('aggregates the tenant-local day and excludes both UTC-boundary and foreign rows', async () => {
    const db = getDatabase();
    const a = await seedTenant('a');
    const b = await seedTenant('b');
    const targetDate = '2026-07-14';

    await db.insert(cashSessions).values([
      {
        id: 'dcr-session-a-closed',
        tenantId: a.tenantId,
        siteId: a.siteId,
        cashierId: a.cashierId,
        registerName: 'Caja 1',
        openingFloat: 50,
        openingCountDenominations: [],
        expectedBalance: 150,
        actualCount: 149,
        overShort: -1,
        status: 'closed',
        openedAt: '2026-07-14T12:00:00.000Z',
        closedAt: '2026-07-14T22:00:00.000Z',
      },
      {
        id: 'dcr-session-a-open',
        tenantId: a.tenantId,
        siteId: a.siteId,
        cashierId: a.cashierId,
        registerName: 'Caja 2',
        openingFloat: 0,
        openingCountDenominations: [],
        expectedBalance: 0,
        status: 'open',
        openedAt: '2026-07-14T23:00:00.000Z',
      },
      {
        id: 'dcr-session-a-incomplete',
        tenantId: a.tenantId,
        siteId: a.siteId,
        cashierId: a.cashierId,
        registerName: 'Caja importada',
        openingFloat: 0,
        openingCountDenominations: [],
        expectedBalance: 25,
        actualCount: null,
        overShort: null,
        status: 'closed',
        openedAt: '2026-07-14T10:00:00.000Z',
        closedAt: '2026-07-14T20:00:00.000Z',
      },
      {
        id: 'dcr-session-b',
        tenantId: b.tenantId,
        siteId: b.siteId,
        cashierId: b.cashierId,
        registerName: 'Foreign',
        openingFloat: 0,
        openingCountDenominations: [],
        expectedBalance: 500,
        actualCount: 999,
        overShort: 499,
        status: 'closed',
        openedAt: '2026-07-14T12:00:00.000Z',
        closedAt: '2026-07-14T22:00:00.000Z',
      },
    ]);

    await db.insert(sales).values([
      {
        id: 'dcr-sale-in',
        tenantId: a.tenantId,
        saleNumber: 'DCR-1',
        subtotal: 80,
        taxAmount: 19,
        discountAmount: 5,
        tipAmount: 4,
        serviceChargeAmount: 2,
        total: 100,
        paymentMethod: 'cash',
        paymentStatus: 'refunded',
        status: 'completed',
        cashSessionId: 'dcr-session-a-closed',
        createdBy: a.cashierId,
        createdAt: '2026-07-14T05:00:00.000Z',
        updatedAt: '2026-07-14T05:00:00.000Z',
      },
      {
        id: 'dcr-sale-before',
        tenantId: a.tenantId,
        saleNumber: 'DCR-0',
        total: 70,
        paymentStatus: 'paid',
        status: 'completed',
        cashSessionId: 'dcr-session-a-closed',
        createdBy: a.cashierId,
        createdAt: '2026-07-14T04:59:59.999Z',
        updatedAt: '2026-07-14T04:59:59.999Z',
      },
      {
        id: 'dcr-sale-void',
        tenantId: a.tenantId,
        saleNumber: 'DCR-V',
        total: 30,
        paymentStatus: 'paid',
        status: 'voided',
        cashSessionId: 'dcr-session-a-closed',
        createdBy: a.cashierId,
        createdAt: '2026-07-14T14:00:00.000Z',
        updatedAt: '2026-07-14T15:00:00.000Z',
      },
      {
        id: 'dcr-sale-foreign',
        tenantId: b.tenantId,
        saleNumber: 'DCR-B',
        total: 900,
        paymentStatus: 'paid',
        status: 'completed',
        cashSessionId: 'dcr-session-b',
        createdBy: b.cashierId,
        createdAt: '2026-07-14T14:00:00.000Z',
        updatedAt: '2026-07-14T14:00:00.000Z',
      },
    ]);
    await db.insert(salePayments).values([
      {
        id: 'dcr-payment-cash',
        tenantId: a.tenantId,
        saleId: 'dcr-sale-in',
        method: 'cash',
        amount: 60,
        createdAt: '2026-07-14T05:00:00.000Z',
      },
      {
        id: 'dcr-payment-card',
        tenantId: a.tenantId,
        saleId: 'dcr-sale-in',
        method: 'card',
        amount: 40,
        createdAt: '2026-07-14T05:00:00.000Z',
      },
    ]);
    await db.insert(saleReturns).values({
      id: 'dcr-return-a',
      tenantId: a.tenantId,
      saleId: 'dcr-sale-in',
      refundAmount: 10,
      reason: 'Test',
      createdBy: a.managerId,
      createdAt: '2026-07-14T16:00:00.000Z',
      updatedAt: '2026-07-14T16:00:00.000Z',
    });
    await db.insert(auditLogs).values({
      id: 'dcr-void-audit',
      tenantId: a.tenantId,
      actorId: a.managerId,
      action: 'sale.void',
      resourceType: 'sale',
      resourceId: 'dcr-sale-void',
      createdAt: '2026-07-14T15:00:00.000Z',
    });

    await db.insert(fiscalNumberingResolutions).values({
      id: 'dcr-resolution-a',
      tenantId: a.tenantId,
      siteId: a.siteId,
      kind: 'FEV',
      resolutionNumber: 'DCR-RES',
      prefix: 'DCR',
      fromNumber: 1,
      toNumber: 100,
      currentNumber: 1,
      technicalKey: 'test-key',
      validFrom: '2026-01-01T00:00:00.000Z',
      validUntil: '2026-12-31T23:59:59.999Z',
    });
    await db.insert(fiscalDocuments).values([
      {
        id: 'dcr-fiscal-a',
        tenantId: a.tenantId,
        source: 'sale',
        sourceId: 'dcr-sale-in',
        kind: 'FEV',
        resolutionId: 'dcr-resolution-a',
        consecutive: 1,
        documentNumber: 'DCR-1',
        cufe: 'a'.repeat(96),
        status: 'accepted',
        buyerTaxId: '222222222222',
        buyerCountryCode: 'CO',
        buyerTaxIdTypeCode: '13',
        buyerName: 'Consumidor final',
        subtotal: 80,
        taxAmount: 19,
        discountAmount: 5,
        totalAmount: 100,
        currencyCode: 'COP',
        localeCode: 'es-CO',
        providerId: 'mock',
        emittedByUserId: a.cashierId,
        emittedAt: '2026-07-14T05:00:00.000Z',
      },
      {
        id: 'dcr-fiscal-return-a',
        tenantId: a.tenantId,
        source: 'return',
        sourceId: 'dcr-return-a',
        kind: 'NC',
        resolutionId: 'dcr-resolution-a',
        consecutive: 2,
        documentNumber: 'DCR-NC-1',
        cufe: 'b'.repeat(96),
        status: 'accepted',
        buyerTaxId: '222222222222',
        buyerCountryCode: 'CO',
        buyerTaxIdTypeCode: '13',
        buyerName: 'Consumidor final',
        subtotal: 10,
        taxAmount: 0,
        discountAmount: 0,
        totalAmount: 10,
        currencyCode: 'COP',
        localeCode: 'es-CO',
        originalCufe: 'a'.repeat(96),
        providerId: 'mock',
        emittedByUserId: a.managerId,
        emittedAt: '2026-07-14T16:00:00.000Z',
      },
    ]);

    const report = await appRouter
      .createCaller(context(a.tenantId, a.managerId, 'manager'))
      .reports.dayClose.preview({ date: targetDate });

    expect(report.window).toEqual({
      start: '2026-07-14T05:00:00.000Z',
      endExclusive: '2026-07-15T05:00:00.000Z',
    });
    expect(report.sales).toMatchObject({
      count: 2,
      subtotal: 80,
      discounts: 5,
      taxes: 19,
      tips: 4,
      serviceCharges: 2,
      grossRevenue: 130,
      refundAmount: 10,
      netRevenue: 90,
    });
    expect(report.payments).toEqual([
      { method: 'card', amount: 40, transactionCount: 1 },
      { method: 'cash', amount: 60, transactionCount: 1 },
    ]);
    expect(report.cash).toEqual({
      closedSessions: 2,
      openSessions: 1,
      expected: 175,
      counted: 149,
      overShort: -1,
      balancedSessions: 0,
      discrepancySessions: 2,
    });
    expect(report.fiscal).toMatchObject({ total: 2, totalAmount: 90 });
    expect(report.fiscal.byStatus.accepted).toBe(2);
    expect(report.adjustments).toEqual({
      voids: { count: 1, amount: 30 },
      refunds: { count: 1, amount: 10 },
    });
    expect(report.anomalies.total).toBe(0);
    expect(report.readiness).toMatchObject({
      readyToSign: false,
      blockers: ['open_sessions'],
    });
    expect(report.readiness.warnings).toEqual([
      'cash_discrepancies',
      'commissions_not_tracked',
      'waste_not_tracked',
    ]);
  });

  it('allows admin, rejects cashier, validates dates, and returns an honest empty report', async () => {
    const tenant = await seedTenant('roles');
    const caller = appRouter.createCaller(context(tenant.tenantId, tenant.adminId, 'admin'));
    const report = await caller.reports.dayClose.preview({ date: '2026-07-14' });
    expect(report.sales.count).toBe(0);
    expect(report.capabilities).toEqual({ commissions: 'not_tracked', waste: 'not_tracked' });

    await expect(
      appRouter
        .createCaller(context(tenant.tenantId, tenant.cashierId, 'cashier'))
        .reports.dayClose.preview({ date: '2026-07-14' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.reports.dayClose.preview({ date: '2999-01-01' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      cause: expect.objectContaining({ errorCode: 'DAY_CLOSE_FUTURE_DATE' }),
    });
  });

  it('signs one immutable snapshot with frozen signer and audit evidence', async () => {
    const db = getDatabase();
    const tenant = await seedTenant('signoff');
    const manager = await createCriticalActor(tenant, tenant.managerId, 'manager');
    const caller = appRouter.createCaller(manager.fresh());

    expect(await caller.reports.dayClose.signoff({ date: '2026-07-14' })).toBeNull();
    const signed = await caller.reports.dayClose.signOff({
      date: '2026-07-14',
      attestationAccepted: true,
    });

    expect(signed).toMatchObject({
      date: '2026-07-14',
      schemaVersion: 1,
      currencyCode: 'COP',
      signedBy: { id: tenant.managerId, name: 'Manager signoff' },
    });
    expect(signed.reportHash).toMatch(/^[a-f0-9]{64}$/);
    expect(signed.pdf).toMatchObject({
      rendererVersion: 1,
      locale: 'es-CO',
      mimeType: 'application/pdf',
      createdAt: expect.any(String),
    });
    expect(signed.pdf?.filename).toMatch(/^puntovivo-cierre-2026-07-14-[a-f0-9]{8}\.pdf$/);

    const artifact = db
      .select()
      .from(dayCloseArtifacts)
      .where(eq(dayCloseArtifacts.id, signed.pdf!.id))
      .get();
    expect(artifact?.payload.subarray(0, 8).toString()).toBe('%PDF-1.3');
    expect(artifact?.payload.subarray(-5).toString()).toBe('%%EOF');
    expect(artifact?.byteSize).toBe(artifact?.payload.byteLength);
    expect(artifact?.payloadHash).toBe(
      createHash('sha256').update(artifact!.payload).digest('hex')
    );

    const evidence = await appRouter
      .createCaller(context(tenant.tenantId, tenant.managerId, 'manager'))
      .reports.dayClose.signoff({ date: '2026-07-14' });
    expect(evidence?.report.sales.count).toBe(0);
    expect(evidence?.reportHash).toBe(signed.reportHash);

    const audit = db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.tenantId, tenant.tenantId), eq(auditLogs.action, 'day_close.sign_off'))
      )
      .get();
    expect(audit).toMatchObject({
      actorId: tenant.managerId,
      resourceType: 'day_close_signoff',
      resourceId: signed.id,
      operationId: expect.any(String),
      metadata: { attestationAccepted: true },
    });
    expect(audit?.after).toMatchObject({
      businessDate: '2026-07-14',
      reportHash: signed.reportHash,
      pdfArtifactId: signed.pdf?.id,
      pdfPayloadHash: signed.pdf?.payloadHash,
      pdfByteSize: signed.pdf?.byteSize,
      pdfFilename: signed.pdf?.filename,
    });

    await db
      .update(users)
      .set({ name: 'Renamed manager' })
      .where(eq(users.id, tenant.managerId))
      .run();
    await db.insert(cashSessions).values({
      id: 'dcr-late-session',
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
      cashierId: tenant.cashierId,
      registerName: 'Caja tardía',
      openingFloat: 0,
      openingCountDenominations: [],
      expectedBalance: 42,
      actualCount: 42,
      overShort: 0,
      status: 'closed',
      openedAt: '2026-07-14T17:00:00.000Z',
      closedAt: '2026-07-14T19:00:00.000Z',
    });
    await db.insert(sales).values({
      id: 'dcr-late-sale',
      tenantId: tenant.tenantId,
      saleNumber: 'DCR-LATE',
      total: 42,
      paymentStatus: 'paid',
      status: 'completed',
      cashSessionId: 'dcr-late-session',
      createdBy: tenant.cashierId,
      createdAt: '2026-07-14T18:00:00.000Z',
      updatedAt: '2026-07-14T18:00:00.000Z',
    });

    const frozen = await appRouter
      .createCaller(context(tenant.tenantId, tenant.adminId, 'admin'))
      .reports.dayClose.signoff({ date: '2026-07-14' });
    const live = await appRouter
      .createCaller(context(tenant.tenantId, tenant.adminId, 'admin'))
      .reports.dayClose.preview({ date: '2026-07-14' });
    expect(frozen?.signedBy.name).toBe('Manager signoff');
    expect(frozen?.report.sales.count).toBe(0);
    expect(live.sales.count).toBe(1);

    expect(() =>
      db
        .update(dayCloseSignoffs)
        .set({ signedByName: 'Rewritten' })
        .where(eq(dayCloseSignoffs.id, signed.id))
        .run()
    ).toThrow(/day_close_signoffs are immutable/);
    expect(() =>
      db.delete(dayCloseSignoffs).where(eq(dayCloseSignoffs.id, signed.id)).run()
    ).toThrow(/day_close_signoffs are immutable/);
    expect(() =>
      db
        .update(dayCloseArtifacts)
        .set({ filename: 'rewritten.pdf' })
        .where(eq(dayCloseArtifacts.id, signed.pdf!.id))
        .run()
    ).toThrow(/day_close_artifacts are immutable/);
    expect(() =>
      db.delete(dayCloseArtifacts).where(eq(dayCloseArtifacts.id, signed.pdf!.id)).run()
    ).toThrow(/day_close_artifacts are immutable/);
  });

  it('serves a verified PDF only to a manager or admin in the owning tenant', async () => {
    const db = getDatabase();
    const tenant = await seedTenant('pdf-route');
    const foreign = await seedTenant('pdf-route-foreign');
    const manager = await createCriticalActor(tenant, tenant.managerId, 'manager');
    const signed = await appRouter.createCaller(manager.fresh()).reports.dayClose.signOff({
      date: '2026-07-10',
      attestationAccepted: true,
    });
    expect(signed.pdf).not.toBeNull();
    const url = `/api/reports/day-close/artifacts/${signed.pdf!.id}`;
    const tokenFor = (
      identity: Awaited<ReturnType<typeof seedTenant>>,
      userId: string,
      role: 'admin' | 'manager' | 'cashier'
    ) =>
      signAccessToken(server.app, {
        id: userId,
        tenantId: identity.tenantId,
        email: `${userId}@example.com`,
        role,
        sessionVersion: 1,
      });

    expect((await server.app.inject({ method: 'GET', url })).statusCode).toBe(401);
    expect(
      (
        await server.app.inject({
          method: 'GET',
          url,
          headers: { authorization: `Bearer ${tokenFor(tenant, tenant.cashierId, 'cashier')}` },
        })
      ).statusCode
    ).toBe(403);
    expect(
      (
        await server.app.inject({
          method: 'GET',
          url: '/api/reports/day-close/artifacts/not-valid!',
          headers: { authorization: `Bearer ${tokenFor(tenant, tenant.managerId, 'manager')}` },
        })
      ).statusCode
    ).toBe(400);
    expect(
      (
        await server.app.inject({
          method: 'GET',
          url,
          headers: {
            authorization: `Bearer ${tokenFor(foreign, foreign.managerId, 'manager')}`,
          },
        })
      ).statusCode
    ).toBe(404);

    const response = await server.app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${tokenFor(tenant, tenant.managerId, 'manager')}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['cache-control']).toBe('private, no-store, max-age=0');
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="${signed.pdf!.filename}"`
    );
    expect(response.rawPayload.byteLength).toBe(signed.pdf!.byteSize);
    expect(createHash('sha256').update(response.rawPayload).digest('hex')).toBe(
      signed.pdf!.payloadHash
    );

    await db.run(sql.raw('DROP TRIGGER IF EXISTS day_close_artifacts_immutable_update'));
    try {
      db.update(dayCloseArtifacts)
        .set({ payload: Buffer.from('%PDF-1.3\ncorrupt\n%%EOF') })
        .where(eq(dayCloseArtifacts.id, signed.pdf!.id))
        .run();
      const corrupt = await server.app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${tokenFor(tenant, tenant.adminId, 'admin')}` },
      });
      expect(corrupt.statusCode).toBe(500);
      expect(corrupt.json()).toMatchObject({
        error: { errorCode: 'DAY_CLOSE_ARTIFACT_INTEGRITY_FAILED' },
      });

      db.update(dayCloseArtifacts)
        .set({
          filename: 'unsafe"; filename=spoofed.pdf',
          payload: response.rawPayload,
        })
        .where(eq(dayCloseArtifacts.id, signed.pdf!.id))
        .run();
      const unsafeFilename = await server.app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${tokenFor(tenant, tenant.adminId, 'admin')}` },
      });
      expect(unsafeFilename.statusCode).toBe(500);
      expect(unsafeFilename.json()).toMatchObject({
        error: { errorCode: 'DAY_CLOSE_ARTIFACT_INTEGRITY_FAILED' },
      });
    } finally {
      await db.run(
        sql.raw(`CREATE TRIGGER IF NOT EXISTS day_close_artifacts_immutable_update
          BEFORE UPDATE ON day_close_artifacts
          BEGIN
            SELECT RAISE(ABORT, 'day_close_artifacts are immutable');
          END`)
      );
    }
  });

  it('rolls back the sign-off and audit row when PDF storage fails', async () => {
    const db = getDatabase();
    const tenant = await seedTenant('pdf-atomic');
    const manager = await createCriticalActor(tenant, tenant.managerId, 'manager');
    await db.run(
      sql.raw(`CREATE TRIGGER fail_day_close_pdf_insert
        BEFORE INSERT ON day_close_artifacts
        WHEN NEW.tenant_id = '${tenant.tenantId}'
        BEGIN
          SELECT RAISE(ABORT, 'forced PDF storage failure');
        END`)
    );
    try {
      await expect(
        appRouter.createCaller(manager.fresh()).reports.dayClose.signOff({
          date: '2026-07-09',
          attestationAccepted: true,
        })
      ).rejects.toThrow(/forced PDF storage failure/);
    } finally {
      await db.run(sql.raw('DROP TRIGGER IF EXISTS fail_day_close_pdf_insert'));
    }

    expect(
      db.select().from(dayCloseSignoffs).where(eq(dayCloseSignoffs.tenantId, tenant.tenantId)).all()
    ).toHaveLength(0);
    expect(
      db
        .select()
        .from(dayCloseArtifacts)
        .where(eq(dayCloseArtifacts.tenantId, tenant.tenantId))
        .all()
    ).toHaveLength(0);
    expect(
      db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.tenantId, tenant.tenantId), eq(auditLogs.action, 'day_close.sign_off'))
        )
        .all()
    ).toHaveLength(0);
  });

  it('rejects blocked, duplicate, unauthorized, and cross-tenant sign-off access', async () => {
    const db = getDatabase();
    const tenant = await seedTenant('guards');
    const foreign = await seedTenant('guards-foreign');
    const manager = await createCriticalActor(tenant, tenant.managerId, 'manager');
    const cashier = await createCriticalActor(tenant, tenant.cashierId, 'cashier');

    await db.insert(cashSessions).values({
      id: 'dcr-guards-open',
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
      cashierId: tenant.cashierId,
      registerName: 'Caja abierta',
      openingFloat: 0,
      openingCountDenominations: [],
      expectedBalance: 0,
      status: 'open',
      openedAt: '2026-07-14T12:00:00.000Z',
    });

    await expect(
      appRouter.createCaller(manager.fresh()).reports.dayClose.signOff({
        date: '2026-07-14',
        attestationAccepted: true,
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'DAY_CLOSE_NOT_READY' }),
    });

    await expect(
      appRouter.createCaller(cashier.fresh()).reports.dayClose.signOff({
        date: '2026-07-13',
        attestationAccepted: true,
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      appRouter
        .createCaller(context(tenant.tenantId, tenant.cashierId, 'cashier'))
        .reports.dayClose.signoff({ date: '2026-07-13' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const first = await appRouter.createCaller(manager.fresh()).reports.dayClose.signOff({
      date: '2026-07-13',
      attestationAccepted: true,
    });
    await expect(
      appRouter.createCaller(manager.fresh()).reports.dayClose.signOff({
        date: '2026-07-13',
        attestationAccepted: true,
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'DAY_CLOSE_ALREADY_SIGNED' }),
    });
    expect(first.date).toBe('2026-07-13');
    expect(
      await appRouter
        .createCaller(context(foreign.tenantId, foreign.managerId, 'manager'))
        .reports.dayClose.signoff({ date: '2026-07-13' })
    ).toBeNull();
  });

  it('serializes concurrent signers and rejects malformed persisted evidence', async () => {
    const db = getDatabase();
    const tenant = await seedTenant('race');
    const manager = await createCriticalActor(tenant, tenant.managerId, 'manager');

    const results = await Promise.allSettled([
      appRouter.createCaller(manager.fresh()).reports.dayClose.signOff({
        date: '2026-07-12',
        attestationAccepted: true,
      }),
      appRouter.createCaller(manager.fresh()).reports.dayClose.signOff({
        date: '2026-07-12',
        attestationAccepted: true,
      }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: {
        cause: expect.objectContaining({ errorCode: 'DAY_CLOSE_ALREADY_SIGNED' }),
      },
    });

    await db.insert(dayCloseSignoffs).values({
      id: 'dcr-corrupt-signoff',
      tenantId: tenant.tenantId,
      businessDate: '2026-07-11',
      timeZone: 'America/Bogota',
      currencyCode: 'COP',
      reportSnapshot: { date: '2026-07-11' },
      reportHash: '0'.repeat(64),
      signedByUserId: tenant.managerId,
      signedByName: 'Manager race',
      signedAt: '2026-07-12T05:00:00.000Z',
    });
    await expect(
      appRouter
        .createCaller(context(tenant.tenantId, tenant.managerId, 'manager'))
        .reports.dayClose.signoff({ date: '2026-07-11' })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        errorCode: 'DAY_CLOSE_SIGNOFF_INTEGRITY_FAILED',
      }),
    });
  });
});
