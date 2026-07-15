/** ENG-141a — comprehensive tenant-local day-close report integration. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  cashSessions,
  companies,
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
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

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

describe('reports.dayClose.preview (ENG-141a)', () => {
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
});
