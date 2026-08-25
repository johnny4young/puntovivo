/**
 * `reports.accounting.vouchers` integration tests.
 *
 * The accountant hand-off surface: completed sales of a range with
 * lines (frozen tax kind), tenders and fiscal references. Coverage:
 *
 * - range filter + orderBy; voided/draft excluded.
 * - IVA/INC split from frozen line kinds.
 * - payments grouped per sale; fiscal document reference joined.
 * - site filter via the sale's cash session.
 * - cross-tenant isolation; admin-only gate.
 * - truncated flag past the limit.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  cashSessions,
  companies,
  fiscalDocuments,
  fiscalNumberingResolutions,
  products,
  saleReturns,
  salePayments,
  saleItems,
  sales,
  sites,
  tenantLocaleSettings,
  tenants,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;

function buildCtx(tenantId: string, userId: string, role: 'admin' | 'cashier'): Context {
  const db = getDatabase();
  const mockReq = {
    server: server.app,
    headers: {},
    user: { userId, email: `${userId}@example.com`, role, tenantId },
    jwtVerify: async () => {},
  } as unknown as Context['req'];
  return {
    req: mockReq,
    res: {} as unknown as Context['res'],
    db,
    user: { id: userId, email: `${userId}@example.com`, role, tenantId },
    tenantId,
    siteId: null,
  };
}

interface Harness {
  tenantId: string;
  adminId: string;
  cashierId: string;
  siteAId: string;
  siteBId: string;
  sessionAId: string;
  sessionBId: string;
  resolutionId: string;
}

async function seedHarness(suffix: string): Promise<Harness> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `racc-tenant-${suffix}`;
  const companyId = `racc-co-${suffix}`;
  const adminId = `racc-admin-${suffix}`;
  const cashierId = `racc-csh-${suffix}`;
  const siteAId = `racc-site-a-${suffix}`;
  const siteBId = `racc-site-b-${suffix}`;
  const sessionAId = `racc-cs-a-${suffix}`;
  const sessionBId = `racc-cs-b-${suffix}`;

  await db.insert(tenants).values({
    id: tenantId,
    name: `Acc Tenant ${suffix}`,
    slug: `racc-${suffix}`,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  // Colombia: the accounting export resolves its range in the tenant
  // timezone (America/Bogota, UTC-5), not in UTC.
  await db.insert(tenantLocaleSettings).values({ tenantId, countryCode: 'CO' });
  await db
    .insert(companies)
    .values({ id: companyId, tenantId, name: `Co ${suffix}`, createdAt: now, updatedAt: now });
  await db.insert(sites).values([
    {
      id: siteAId,
      tenantId,
      companyId,
      name: `Sede A ${suffix}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: siteBId,
      tenantId,
      companyId,
      name: `Sede B ${suffix}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(users).values([
    {
      id: adminId,
      tenantId,
      email: `racc-admin-${suffix}@example.com`,
      name: `Admin ${suffix}`,
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
      email: `racc-csh-${suffix}@example.com`,
      name: `Cashier ${suffix}`,
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  for (const [sessionId, siteId] of [
    [sessionAId, siteAId],
    [sessionBId, siteBId],
  ] as const) {
    await db.insert(cashSessions).values({
      id: sessionId,
      tenantId,
      siteId,
      cashierId,
      registerName: 'Caja 1',
      openingCountDenominations: [],
      openingBalance: 0,
      expectedBalance: 0,
      status: 'open',
      openedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }
  await db.insert(products).values({
    id: `racc-prod-${suffix}`,
    tenantId,
    name: 'Producto',
    sku: `RACC-${suffix}`,
    createdAt: now,
    updatedAt: now,
  });
  const resolutionId = `racc-res-${suffix}`;
  await db.insert(fiscalNumberingResolutions).values({
    id: resolutionId,
    tenantId,
    siteId: siteAId,
    kind: 'DEE',
    resolutionNumber: '18760000001',
    prefix: `RA${suffix.slice(0, 3).toUpperCase()}`,
    fromNumber: 1,
    toNumber: 1000,
    currentNumber: 0,
    technicalKey: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
    validFrom: now,
    validUntil: now,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return {
    tenantId,
    adminId,
    cashierId,
    siteAId,
    siteBId,
    sessionAId,
    sessionBId,
    resolutionId,
  };
}

interface SaleSeed {
  id: string;
  saleNumber: string;
  createdAt: string;
  checkoutCompletedAt?: string;
  cashSessionId: string;
  status?: 'completed' | 'voided' | 'draft';
  subtotal: number;
  taxAmount: number;
  total: number;
  lines: Array<{
    id: string;
    taxKind: 'iva' | 'inc';
    taxRate: number;
    taxAmount: number;
    total: number;
  }>;
  payments?: Array<{ id: string; method: string; amount: number }>;
}

async function insertSale(harness: Harness, seed: SaleSeed): Promise<void> {
  const db = getDatabase();
  await db.insert(sales).values({
    id: seed.id,
    tenantId: harness.tenantId,
    saleNumber: seed.saleNumber,
    customerNameSnapshot: 'Cliente Prueba',
    customerTaxIdSnapshot: '900123456',
    siteNameSnapshot: 'Sede A',
    subtotal: seed.subtotal,
    taxAmount: seed.taxAmount,
    discountAmount: 0,
    total: seed.total,
    status: seed.status ?? 'completed',
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    cashSessionId: seed.cashSessionId,
    createdBy: harness.cashierId,
    createdAt: seed.createdAt,
    ...(seed.checkoutCompletedAt !== undefined
      ? { checkoutCompletedAt: seed.checkoutCompletedAt }
      : {}),
    updatedAt: seed.createdAt,
  });
  for (const line of seed.lines) {
    await db.insert(saleItems).values({
      id: line.id,
      saleId: seed.id,
      productId: `racc-prod-${harness.tenantId.replace('racc-tenant-', '')}`,
      productNameSnapshot: 'Producto',
      productSkuSnapshot: 'SKU-1',
      quantity: 1,
      unitPrice: line.total - line.taxAmount,
      discount: 0,
      taxRate: line.taxRate,
      taxKind: line.taxKind,
      taxAmount: line.taxAmount,
      total: line.total,
      createdAt: seed.createdAt,
    });
  }
  for (const payment of seed.payments ?? []) {
    await db.insert(salePayments).values({
      id: payment.id,
      tenantId: harness.tenantId,
      saleId: seed.id,
      method: payment.method as 'cash',
      amount: payment.amount,
      createdAt: seed.createdAt,
    });
  }
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});

afterAll(async () => {
  await server.close();
});

describe('reports.accounting.vouchers', () => {
  it('returns completed sales with tax split, payments and fiscal refs', async () => {
    const harness = await seedHarness('main');
    await insertSale(harness, {
      id: 'racc-sale-1',
      saleNumber: 'VTA-000001',
      createdAt: '2026-07-10T14:00:00.000Z',
      cashSessionId: harness.sessionAId,
      subtotal: 100,
      taxAmount: 27,
      total: 127,
      lines: [
        { id: 'racc-li-1a', taxKind: 'iva', taxRate: 19, taxAmount: 19, total: 119 },
        { id: 'racc-li-1b', taxKind: 'inc', taxRate: 8, taxAmount: 8, total: 108 },
      ],
      payments: [
        { id: 'racc-pay-1a', method: 'cash', amount: 100 },
        { id: 'racc-pay-1b', method: 'card', amount: 27 },
      ],
    });
    await insertSale(harness, {
      id: 'racc-sale-void',
      saleNumber: 'VTA-000002',
      createdAt: '2026-07-11T14:00:00.000Z',
      cashSessionId: harness.sessionAId,
      status: 'voided',
      subtotal: 50,
      taxAmount: 0,
      total: 50,
      lines: [{ id: 'racc-li-v', taxKind: 'iva', taxRate: 0, taxAmount: 0, total: 50 }],
    });
    const db = getDatabase();
    await db.insert(fiscalDocuments).values({
      id: 'racc-fd-1',
      tenantId: harness.tenantId,
      source: 'sale',
      sourceId: 'racc-sale-1',
      kind: 'DEE',
      resolutionId: harness.resolutionId,
      consecutive: 1,
      documentNumber: 'POS-1',
      cufe: `racc-cufe-main`,
      status: 'accepted',
      buyerTaxId: '900123456',
      buyerTaxIdTypeCode: '31',
      buyerCountryCode: 'CO',
      buyerName: 'Cliente Prueba',
      subtotal: 100,
      taxAmount: 27,
      discountAmount: 0,
      totalAmount: 127,
      currencyCode: 'COP',
      localeCode: 'es-CO',
      providerId: 'mock',
      emittedByUserId: harness.adminId,
      createdAt: '2026-07-10T14:00:05.000Z',
      updatedAt: '2026-07-10T14:00:05.000Z',
    });

    const caller = appRouter.createCaller(buildCtx(harness.tenantId, harness.adminId, 'admin'));
    const result = await caller.reports.accounting.vouchers({
      from: '2026-07-01',
      to: '2026-07-31',
    });

    expect(result.truncated).toBe(false);
    expect(result.vouchers).toHaveLength(1);
    const voucher = result.vouchers[0]!;
    expect(voucher.kind).toBe('sale');
    expect(voucher.saleNumber).toBe('VTA-000001');
    expect(voucher.ivaAmount).toBe(19);
    expect(voucher.incAmount).toBe(8);
    expect(voucher.lines).toHaveLength(2);
    expect(voucher.payments).toEqual([
      { method: 'cash', amount: 100 },
      { method: 'card', amount: 27 },
    ]);
    expect(voucher.fiscalDocumentNumber).toBe('POS-1');
    expect(voucher.fiscalCufe).toBe('racc-cufe-main');
    expect(voucher.fiscalStatus).toBe('accepted');
    // Dated in the tenant timezone (Bogota), not UTC: 14:00Z is 09:00
    // local on the same day here, but the field must come from the
    // server so a foreign-timezone workstation cannot shift it.
    expect(voucher.localDate).toBe('2026-07-10');
  });

  it('withholds the placeholder CUFE of an unconfirmed document', async () => {
    const harness = await seedHarness('pend');
    await insertSale(harness, {
      id: 'racc-sale-pend',
      saleNumber: 'VTA-400001',
      createdAt: '2026-07-12T10:00:00.000Z',
      cashSessionId: harness.sessionAId,
      subtotal: 10,
      taxAmount: 0,
      total: 10,
      lines: [{ id: 'racc-li-pend', taxKind: 'iva', taxRate: 0, taxAmount: 0, total: 10 }],
    });
    const db = getDatabase();
    await db.insert(fiscalDocuments).values({
      id: 'racc-fd-pend',
      tenantId: harness.tenantId,
      source: 'sale',
      sourceId: 'racc-sale-pend',
      kind: 'DEE',
      resolutionId: harness.resolutionId,
      consecutive: 2,
      documentNumber: 'POS-2',
      // The orchestrator reserves the consecutive with this shape
      // BEFORE emission; it is not a real CUFE.
      cufe: 'pending-racc-placeholder-0000000000',
      status: 'pending',
      buyerTaxId: '900123456',
      buyerTaxIdTypeCode: '31',
      buyerCountryCode: 'CO',
      buyerName: 'Cliente Prueba',
      subtotal: 10,
      taxAmount: 0,
      discountAmount: 0,
      totalAmount: 10,
      currencyCode: 'COP',
      localeCode: 'es-CO',
      providerId: 'mock',
      emittedByUserId: harness.adminId,
      createdAt: '2026-07-12T10:00:05.000Z',
      updatedAt: '2026-07-12T10:00:05.000Z',
    });

    const caller = appRouter.createCaller(buildCtx(harness.tenantId, harness.adminId, 'admin'));
    const result = await caller.reports.accounting.vouchers({
      from: '2026-07-01',
      to: '2026-07-31',
    });
    const voucher = result.vouchers.find(v => v.saleNumber === 'VTA-400001')!;
    expect(voucher.fiscalDocumentNumber).toBe('POS-2');
    expect(voucher.fiscalCufe).toBeNull();
    expect(voucher.fiscalStatus).toBe('pending');
  });

  it('filters by site through the cash session', async () => {
    const harness = await seedHarness('site');
    await insertSale(harness, {
      id: 'racc-sale-sa',
      saleNumber: 'VTA-100001',
      createdAt: '2026-07-10T10:00:00.000Z',
      cashSessionId: harness.sessionAId,
      subtotal: 10,
      taxAmount: 0,
      total: 10,
      lines: [{ id: 'racc-li-sa', taxKind: 'iva', taxRate: 0, taxAmount: 0, total: 10 }],
    });
    await insertSale(harness, {
      id: 'racc-sale-sb',
      saleNumber: 'VTA-100002',
      createdAt: '2026-07-10T11:00:00.000Z',
      cashSessionId: harness.sessionBId,
      subtotal: 20,
      taxAmount: 0,
      total: 20,
      lines: [{ id: 'racc-li-sb', taxKind: 'iva', taxRate: 0, taxAmount: 0, total: 20 }],
    });

    const caller = appRouter.createCaller(buildCtx(harness.tenantId, harness.adminId, 'admin'));
    const result = await caller.reports.accounting.vouchers({
      from: '2026-07-01',
      to: '2026-07-31',
      siteId: harness.siteBId,
    });
    expect(result.vouchers.map(v => v.saleNumber)).toEqual(['VTA-100002']);
  });

  it('rejects a site from another tenant', async () => {
    const harness = await seedHarness('xsite');
    const other = await seedHarness('xsite2');
    const caller = appRouter.createCaller(buildCtx(harness.tenantId, harness.adminId, 'admin'));
    await expect(
      caller.reports.accounting.vouchers({
        from: '2026-07-01',
        to: '2026-07-31',
        siteId: other.siteAId,
      })
    ).rejects.toThrow();
  });

  it('never leaks another tenant and gates on admin', async () => {
    const harnessA = await seedHarness('isoA');
    const harnessB = await seedHarness('isoB');
    await insertSale(harnessB, {
      id: 'racc-sale-b',
      saleNumber: 'VTA-200001',
      createdAt: '2026-07-10T10:00:00.000Z',
      cashSessionId: harnessB.sessionAId,
      subtotal: 99,
      taxAmount: 0,
      total: 99,
      lines: [{ id: 'racc-li-b', taxKind: 'iva', taxRate: 0, taxAmount: 0, total: 99 }],
    });

    const callerA = appRouter.createCaller(buildCtx(harnessA.tenantId, harnessA.adminId, 'admin'));
    const resultA = await callerA.reports.accounting.vouchers({
      from: '2026-07-01',
      to: '2026-07-31',
    });
    expect(resultA.vouchers).toHaveLength(0);

    const cashierCaller = appRouter.createCaller(
      buildCtx(harnessA.tenantId, harnessA.cashierId, 'cashier')
    );
    await expect(
      cashierCaller.reports.accounting.vouchers({
        from: '2026-07-01',
        to: '2026-07-31',
      })
    ).rejects.toThrow();
  });

  it('resolves the range in the tenant timezone, not UTC', async () => {
    const harness = await seedHarness('tz');
    // 2026-07-31 23:30 in Bogota (UTC-5) is 2026-08-01T04:30Z. A
    // UTC-built window would push this dinner sale out of July.
    await insertSale(harness, {
      id: 'racc-sale-tz-late',
      saleNumber: 'VTA-500001',
      createdAt: '2026-08-01T04:30:00.000Z',
      cashSessionId: harness.sessionAId,
      subtotal: 100,
      taxAmount: 0,
      total: 100,
      lines: [{ id: 'racc-li-tz1', taxKind: 'iva', taxRate: 0, taxAmount: 0, total: 100 }],
    });
    // 2026-06-30 20:00 Bogota is 2026-07-01T01:00Z — a UTC window
    // would wrongly pull this June sale into July.
    await insertSale(harness, {
      id: 'racc-sale-tz-june',
      saleNumber: 'VTA-500002',
      createdAt: '2026-07-01T01:00:00.000Z',
      cashSessionId: harness.sessionAId,
      subtotal: 200,
      taxAmount: 0,
      total: 200,
      lines: [{ id: 'racc-li-tz2', taxKind: 'iva', taxRate: 0, taxAmount: 0, total: 200 }],
    });

    const caller = appRouter.createCaller(buildCtx(harness.tenantId, harness.adminId, 'admin'));
    const july = await caller.reports.accounting.vouchers({ from: '2026-07-01', to: '2026-07-31' });
    const numbers = july.vouchers.map(v => v.saleNumber);
    expect(numbers).toContain('VTA-500001');
    expect(numbers).not.toContain('VTA-500002');
  });

  it('dates parked drafts by completion instead of when they were opened', async () => {
    const harness = await seedHarness('completion');
    await insertSale(harness, {
      id: 'racc-sale-completed-july',
      saleNumber: 'VTA-510001',
      createdAt: '2026-06-30T14:00:00.000Z',
      checkoutCompletedAt: '2026-07-15T15:30:00.000Z',
      cashSessionId: harness.sessionAId,
      subtotal: 40,
      taxAmount: 0,
      total: 40,
      lines: [{ id: 'racc-li-completion-1', taxKind: 'iva', taxRate: 0, taxAmount: 0, total: 40 }],
    });
    await insertSale(harness, {
      id: 'racc-sale-completed-august',
      saleNumber: 'VTA-510002',
      createdAt: '2026-07-15T14:00:00.000Z',
      checkoutCompletedAt: '2026-08-01T15:30:00.000Z',
      cashSessionId: harness.sessionAId,
      subtotal: 50,
      taxAmount: 0,
      total: 50,
      lines: [{ id: 'racc-li-completion-2', taxKind: 'iva', taxRate: 0, taxAmount: 0, total: 50 }],
    });

    const caller = appRouter.createCaller(buildCtx(harness.tenantId, harness.adminId, 'admin'));
    const july = await caller.reports.accounting.vouchers({ from: '2026-07-01', to: '2026-07-31' });
    expect(july.vouchers.map(voucher => voucher.saleNumber)).toEqual(['VTA-510001']);
    expect(july.vouchers[0]?.createdAt).toBe('2026-07-15T15:30:00.000Z');
    expect(july.vouchers[0]?.localDate).toBe('2026-07-15');
  });

  it('reports a refund as a separate event dated in its own period', async () => {
    const harness = await seedHarness('refund');
    await insertSale(harness, {
      id: 'racc-sale-ref',
      saleNumber: 'VTA-600001',
      createdAt: '2026-07-15T15:00:00.000Z',
      cashSessionId: harness.sessionAId,
      subtotal: 100,
      taxAmount: 19,
      total: 119,
      lines: [{ id: 'racc-li-ref', taxKind: 'iva', taxRate: 19, taxAmount: 19, total: 119 }],
    });
    const db = getDatabase();
    await db.insert(saleReturns).values({
      id: 'racc-ret-1',
      tenantId: harness.tenantId,
      saleId: 'racc-sale-ref',
      refundAmount: 119,
      createdBy: harness.adminId,
      createdAt: '2026-07-16T10:00:00.000Z',
      updatedAt: '2026-07-16T10:00:00.000Z',
    });

    const caller = appRouter.createCaller(buildCtx(harness.tenantId, harness.adminId, 'admin'));
    const result = await caller.reports.accounting.vouchers({
      from: '2026-07-01',
      to: '2026-07-31',
    });
    const saleVoucher = result.vouchers.find(v => v.kind === 'sale')!;
    const refundVoucher = result.vouchers.find(v => v.kind === 'refund')!;
    expect(saleVoucher.refundAmount).toBe(0);
    expect(refundVoucher).toMatchObject({
      eventId: 'racc-ret-1',
      saleNumber: 'VTA-600001',
      refundAmount: 119,
      createdAt: '2026-07-16T10:00:00.000Z',
      localDate: '2026-07-16',
      taxReconciled: true,
    });
  });

  it('includes a current-period refund for a sale completed in a previous period', async () => {
    const harness = await seedHarness('refund-cutoff');
    await insertSale(harness, {
      id: 'racc-sale-ref-old',
      saleNumber: 'VTA-610001',
      createdAt: '2026-06-15T15:00:00.000Z',
      cashSessionId: harness.sessionAId,
      subtotal: 100,
      taxAmount: 19,
      total: 119,
      lines: [{ id: 'racc-li-ref-old', taxKind: 'iva', taxRate: 19, taxAmount: 19, total: 119 }],
      payments: [{ id: 'racc-pay-ref-old', method: 'cash', amount: 119 }],
    });
    const db = getDatabase();
    await db.insert(saleReturns).values({
      id: 'racc-ret-current',
      tenantId: harness.tenantId,
      saleId: 'racc-sale-ref-old',
      refundAmount: 119,
      createdBy: harness.adminId,
      createdAt: '2026-07-20T10:00:00.000Z',
      updatedAt: '2026-07-20T10:00:00.000Z',
    });

    const caller = appRouter.createCaller(buildCtx(harness.tenantId, harness.adminId, 'admin'));
    const june = await caller.reports.accounting.vouchers({
      from: '2026-06-01',
      to: '2026-06-30',
    });
    expect(june.vouchers.map(voucher => voucher.kind)).toEqual(['sale']);

    const july = await caller.reports.accounting.vouchers({
      from: '2026-07-01',
      to: '2026-07-31',
    });
    expect(july.vouchers).toHaveLength(1);
    expect(july.vouchers[0]).toMatchObject({
      kind: 'refund',
      eventId: 'racc-ret-current',
      saleNumber: 'VTA-610001',
      refundAmount: 119,
      localDate: '2026-07-20',
      payments: [{ method: 'cash', amount: 119 }],
    });
  });

  it('flags a header whose tax does not match its lines', async () => {
    const harness = await seedHarness('drift');
    await insertSale(harness, {
      id: 'racc-sale-drift',
      saleNumber: 'VTA-700001',
      createdAt: '2026-07-15T15:00:00.000Z',
      cashSessionId: harness.sessionAId,
      subtotal: 100,
      // Header claims 19 of tax while the single line carries none —
      // the sync-arrival / data-repair shape.
      taxAmount: 19,
      total: 119,
      lines: [{ id: 'racc-li-drift', taxKind: 'iva', taxRate: 0, taxAmount: 0, total: 119 }],
    });

    const caller = appRouter.createCaller(buildCtx(harness.tenantId, harness.adminId, 'admin'));
    const result = await caller.reports.accounting.vouchers({
      from: '2026-07-01',
      to: '2026-07-31',
    });
    const voucher = result.vouchers.find(v => v.saleNumber === 'VTA-700001')!;
    expect(voucher.taxReconciled).toBe(false);
  });

  it('flags truncation past the limit without failing', async () => {
    const harness = await seedHarness('trunc');
    for (let index = 0; index < 3; index += 1) {
      await insertSale(harness, {
        id: `racc-sale-t${index}`,
        saleNumber: `VTA-30000${index}`,
        createdAt: `2026-07-1${index}T10:00:00.000Z`,
        cashSessionId: harness.sessionAId,
        subtotal: 10,
        taxAmount: 0,
        total: 10,
        lines: [{ id: `racc-li-t${index}`, taxKind: 'iva', taxRate: 0, taxAmount: 0, total: 10 }],
      });
    }
    const caller = appRouter.createCaller(buildCtx(harness.tenantId, harness.adminId, 'admin'));
    const result = await caller.reports.accounting.vouchers({
      from: '2026-07-01',
      to: '2026-07-31',
      limit: 2,
    });
    expect(result.truncated).toBe(true);
    expect(result.vouchers).toHaveLength(2);
  });
});
