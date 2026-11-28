import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  cashSessions,
  categories,
  companies,
  customerLedgerEntries,
  customers,
  orders,
  providerPayableInvoicePurchases,
  providerPayableInvoices,
  providers,
  purchases,
  saleReturns,
  sales,
  sequentials,
  sites,
  syncOutbox,
  tenants,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';
import { computeComprehensiveDayCloseReport } from '../services/reports/comprehensive-day-close.js';
import { computeDayCloseSummary } from '../services/reports/day-close.js';
import { closeCashSession } from '../application/cash-sessions/closeCashSession.js';
import {
  PRESET_SCOPED_MODULES,
  VERTICAL_PRESET_IDS,
  resolvePresetPatch,
} from '../services/modules/presets.js';

describe('pre-release QA audit regressions', () => {
  let server: PuntovivoServer;
  let db: ReturnType<typeof getDatabase>;
  let tenantId: string;
  let companyId: string;
  let siteAId: string;
  let siteBId: string;
  let otherTenantId: string;
  let otherSiteId: string;
  let adminUserId: string;
  let cashierAId: string;
  let cashierBId: string;
  let viewerId: string;
  let unitId: string;
  let categoryId: string;
  let productId: string;
  let providerId: string;
  let customerId: string;
  let adminFresh: ReturnType<typeof makeFreshContextFactory>;
  let cashierAFresh: ReturnType<typeof makeFreshContextFactory>;
  let cashierBFresh: ReturnType<typeof makeFreshContextFactory>;
  let viewerFresh: ReturnType<typeof makeFreshContextFactory>;

  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    db = getDatabase();

    const admin = db.select().from(users).where(eq(users.email, 'admin@localhost')).get()!;
    tenantId = admin.tenantId;
    adminUserId = admin.id;

    const company = db.select().from(companies).where(eq(companies.tenantId, tenantId)).get()!;
    companyId = company.id;

    const primarySite = db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get()!;
    siteAId = primarySite.id;

    siteBId = nanoid();
    db.insert(sites)
      .values({
        id: siteBId,
        tenantId,
        companyId,
        name: 'Branch B',
        isActive: true,
      })
      .run();

    otherTenantId = nanoid();
    otherSiteId = nanoid();
    const otherCompanyId = nanoid();
    db.insert(tenants)
      .values({ id: otherTenantId, name: 'Foreign Tenant', slug: `foreign-${nanoid(6)}` })
      .run();
    db.insert(companies)
      .values({ id: otherCompanyId, tenantId: otherTenantId, name: 'Foreign Co' })
      .run();
    db.insert(sites)
      .values({
        id: otherSiteId,
        tenantId: otherTenantId,
        companyId: otherCompanyId,
        name: 'Foreign Site',
        isActive: true,
      })
      .run();

    cashierAId = nanoid();
    cashierBId = nanoid();
    viewerId = nanoid();
    db.insert(users)
      .values([
        {
          id: cashierAId,
          tenantId,
          email: `cashier-a-${nanoid(4)}@test.local`,
          passwordHash: admin.passwordHash,
          name: 'Cashier A',
          role: 'cashier',
          isActive: true,
        },
        {
          id: cashierBId,
          tenantId,
          email: `cashier-b-${nanoid(4)}@test.local`,
          passwordHash: admin.passwordHash,
          name: 'Cashier B',
          role: 'cashier',
          isActive: true,
        },
        {
          id: viewerId,
          tenantId,
          email: `viewer-${nanoid(4)}@test.local`,
          passwordHash: admin.passwordHash,
          name: 'Viewer User',
          role: 'viewer',
          isActive: true,
        },
      ])
      .run();

    const adminDev = await registerDeviceService(db, {
      tenantId,
      userId: adminUserId,
      kind: 'web',
      name: 'admin-qa-dev',
    });
    const cashierADev = await registerDeviceService(db, {
      tenantId,
      userId: cashierAId,
      kind: 'web',
      name: 'cashier-a-dev',
    });
    const cashierBDev = await registerDeviceService(db, {
      tenantId,
      userId: cashierBId,
      kind: 'web',
      name: 'cashier-b-dev',
    });
    const viewerDev = await registerDeviceService(db, {
      tenantId,
      userId: viewerId,
      kind: 'web',
      name: 'viewer-dev',
    });

    adminFresh = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      userId: adminUserId,
      email: admin.email,
      siteId: siteAId,
      deviceId: adminDev.deviceId,
      defaultRole: 'admin',
    });
    cashierAFresh = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      userId: cashierAId,
      email: 'cashier-a@test.local',
      siteId: siteAId,
      deviceId: cashierADev.deviceId,
      defaultRole: 'cashier',
    });
    cashierBFresh = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      userId: cashierBId,
      email: 'cashier-b@test.local',
      siteId: siteAId,
      deviceId: cashierBDev.deviceId,
      defaultRole: 'cashier',
    });
    viewerFresh = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      userId: viewerId,
      email: 'viewer@test.local',
      siteId: siteAId,
      deviceId: viewerDev.deviceId,
      defaultRole: 'viewer',
    });

    const seededUnit = db.select().from(units).where(eq(units.tenantId, tenantId)).get()!;
    unitId = seededUnit.id;
    const seededCategory = db
      .select()
      .from(categories)
      .where(eq(categories.tenantId, tenantId))
      .get();
    categoryId = seededCategory?.id ?? nanoid();
    if (!seededCategory) {
      db.insert(categories).values({ id: categoryId, tenantId, name: 'QA Cat' }).run();
    }

    const createdProduct = await appRouter.createCaller(adminFresh()).products.create({
      sku: `QA-REG-${nanoid(6)}`,
      name: 'QA Regression Item',
      categoryId,
      price: 100,
      cost: 40,
      stock: 100,
      isActive: true,
    });
    productId = createdProduct.id;

    providerId = nanoid();
    db.insert(providers)
      .values({ id: providerId, tenantId, name: 'QA Supplier', isActive: true })
      .run();

    customerId = nanoid();
    db.insert(customers)
      .values({
        id: customerId,
        tenantId,
        name: 'QA Credit Customer',
        creditLimit: 10_000,
        isActive: true,
      })
      .run();

    // Ensure sequentials for sales, purchases, and orders exist on site A.
    for (const docType of ['sale', 'purchase', 'order'] as const) {
      const existingSeq = db
        .select()
        .from(sequentials)
        .where(
          and(
            eq(sequentials.tenantId, tenantId),
            eq(sequentials.siteId, siteAId),
            eq(sequentials.documentType, docType)
          )
        )
        .get();
      if (!existingSeq) {
        db.insert(sequentials)
          .values({
            id: nanoid(),
            tenantId,
            siteId: siteAId,
            documentType: docType,
            prefix: docType === 'sale' ? 'QAS-' : docType === 'purchase' ? 'QAP-' : 'QAO-',
            currentValue: 0,
          })
          .run();
      }
    }
  });

  afterAll(async () => {
    await server.close();
  });

  it('reverses customer_ledger_entries receivable when voiding a credit sale', async () => {
    await appRouter.createCaller(adminFresh()).cashSessions.open({
      registerName: 'QA Credit Register',
      openingFloat: 0,
      denominations: [],
    });

    const created = await appRouter.createCaller(adminFresh()).sales.create({
      customerId,
      paymentMethod: 'credit',
      items: [{ productId, unitId, quantity: 2, unitPrice: 100 }],
    });

    const balanceBeforeVoid = db
      .select({ total: sql<number>`coalesce(sum(${customerLedgerEntries.amount}), 0)` })
      .from(customerLedgerEntries)
      .where(
        and(
          eq(customerLedgerEntries.tenantId, tenantId),
          eq(customerLedgerEntries.customerId, customerId)
        )
      )
      .get()!.total;
    expect(balanceBeforeVoid).toBe(created.total);

    await appRouter.createCaller(adminFresh()).sales.void({
      id: created.id,
      reason: 'Customer cancelled credit order',
    });

    const balanceAfterVoid = db
      .select({ total: sql<number>`coalesce(sum(${customerLedgerEntries.amount}), 0)` })
      .from(customerLedgerEntries)
      .where(
        and(
          eq(customerLedgerEntries.tenantId, tenantId),
          eq(customerLedgerEntries.customerId, customerId)
        )
      )
      .get()!.total;
    expect(balanceAfterVoid).toBe(0);

    const ledgerRows = db
      .select()
      .from(customerLedgerEntries)
      .where(
        and(
          eq(customerLedgerEntries.tenantId, tenantId),
          eq(customerLedgerEntries.referenceSaleId, created.id)
        )
      )
      .all();
    expect(ledgerRows).toHaveLength(2);
    expect(ledgerRows.find(r => r.kind === 'adjustment')?.amount).toBe(-created.total);

    await appRouter.createCaller(adminFresh()).cashSessions.close({
      actualCount: 0,
      denominations: [],
    });
  });

  it('blocks voiding a purchase linked to a supplier payable invoice (bridge or direct)', async () => {
    const purchase = await appRouter.createCaller(adminFresh()).purchases.create({
      providerId,
      items: [{ productId, unitId, quantity: 5, costPerUnit: 40 }],
    });

    const invoiceId = nanoid();
    const now = new Date().toISOString();
    db.insert(providerPayableInvoices)
      .values({
        id: invoiceId,
        tenantId,
        providerId,
        siteId: siteAId,
        purchaseId: null,
        kind: 'invoice',
        documentNumber: `INV-${nanoid(6)}`,
        issuedAt: now,
        dueAt: now,
        amount: 200,
        taxAmount: 0,
        createdBy: adminUserId,
      })
      .run();
    db.insert(providerPayableInvoicePurchases)
      .values({
        id: nanoid(),
        tenantId,
        invoiceId,
        purchaseId: purchase.id,
      })
      .run();

    await expect(
      appRouter.createCaller(adminFresh()).purchases.void({ id: purchase.id, reason: 'Duplicate' })
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      cause: { errorCode: 'PURCHASE_VOID_PAYABLE_LINKED' },
    });

    // Purchase remains completed.
    const stillActive = db
      .select({ status: purchases.status })
      .from(purchases)
      .where(eq(purchases.id, purchase.id))
      .get();
    expect(stillActive?.status).toBe('completed');
  });

  it('reverts linked purchase order status and enqueues sync when voiding received purchases', async () => {
    const order = await appRouter.createCaller(adminFresh()).orders.create({
      providerId,
      items: [{ productId, unitId, quantity: 10, costPerUnit: 40 }],
    });

    const orderDetail = await appRouter.createCaller(adminFresh()).orders.getById({ id: order.id });
    const orderItemId = orderDetail.items[0]!.id;

    // Receive 4, then 6 -> order becomes received.
    const receipt1 = await appRouter.createCaller(adminFresh()).purchases.createFromOrder({
      orderId: order.id,
      items: [{ orderItemId, quantity: 4 }],
    });
    const receipt2 = await appRouter.createCaller(adminFresh()).purchases.createFromOrder({
      orderId: order.id,
      items: [{ orderItemId, quantity: 6 }],
    });
    expect(
      db.select({ status: orders.status }).from(orders).where(eq(orders.id, order.id)).get()?.status
    ).toBe('received');

    // Void second receipt -> reverts to partial_received.
    await appRouter.createCaller(adminFresh()).purchases.void({
      id: receipt2.id,
      reason: 'Wrong batch',
    });
    expect(
      db.select({ status: orders.status }).from(orders).where(eq(orders.id, order.id)).get()?.status
    ).toBe('partial_received');

    // Void first receipt -> reverts to submitted and enqueues sync outbox row.
    await appRouter.createCaller(adminFresh()).purchases.void({
      id: receipt1.id,
      reason: 'Returned all',
    });
    expect(
      db.select({ status: orders.status }).from(orders).where(eq(orders.id, order.id)).get()?.status
    ).toBe('submitted');

    const orderSyncRows = db
      .select()
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          eq(syncOutbox.entityType, 'orders'),
          eq(syncOutbox.entityId, order.id)
        )
      )
      .all();
    expect(
      orderSyncRows.some(row => JSON.stringify(row.payload).includes('"status":"submitted"'))
    ).toBe(true);
  });

  it('attributes carried-over drafts completed on Day 2 to Day 2 in comprehensive day close', async () => {
    const historicalSessionId = nanoid();
    db.insert(cashSessions)
      .values({
        id: historicalSessionId,
        tenantId,
        siteId: siteAId,
        cashierId: adminUserId,
        registerName: 'QA Historical',
        status: 'closed',
        openingFloat: 0,
        openingCountDenominations: [],
        expectedBalance: 500,
        actualCount: 500,
        actualCountDenominations: [],
        overShort: 0,
        openedAt: '2026-08-11T14:00:00.000Z',
        closedAt: '2026-08-11T22:00:00.000Z',
      })
      .run();

    const carriedSaleId = nanoid();
    db.insert(sales)
      .values({
        id: carriedSaleId,
        tenantId,
        cashSessionId: historicalSessionId,
        saleNumber: `CARRY-${nanoid(6)}`,
        subtotal: 500,
        taxAmount: 0,
        discountAmount: 0,
        total: 500,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        createdBy: adminUserId,
        createdAt: '2026-08-10T18:00:00.000Z',
        checkoutCompletedAt: '2026-08-11T15:00:00.000Z',
        updatedAt: '2026-08-11T15:00:00.000Z',
      })
      .run();

    const day1 = await computeComprehensiveDayCloseReport(db, {
      tenantId,
      date: '2026-08-10',
      now: new Date('2026-08-12T12:00:00.000Z'),
    });
    const day2 = await computeComprehensiveDayCloseReport(db, {
      tenantId,
      date: '2026-08-11',
      now: new Date('2026-08-12T12:00:00.000Z'),
    });

    expect(day1.sales.grossRevenue).toBe(0);
    expect(day2.sales.grossRevenue).toBe(500);
    expect(day2.sales.count).toBe(1);
  });

  it('includes refunds at 23:59:59.999Z in day-close owner pulse previous-week comparison', async () => {
    const pulseSessionId = nanoid();
    db.insert(cashSessions)
      .values({
        id: pulseSessionId,
        tenantId,
        siteId: siteAId,
        cashierId: adminUserId,
        registerName: 'QA Pulse',
        status: 'closed',
        openingFloat: 0,
        openingCountDenominations: [],
        expectedBalance: 200,
        actualCount: 200,
        actualCountDenominations: [],
        overShort: 0,
        openedAt: '2026-07-01T08:00:00.000Z',
        closedAt: '2026-07-01T20:00:00.000Z',
      })
      .run();

    const prevSaleId = nanoid();
    db.insert(sales)
      .values({
        id: prevSaleId,
        tenantId,
        cashSessionId: pulseSessionId,
        saleNumber: `PULSE-${nanoid(6)}`,
        subtotal: 200,
        taxAmount: 0,
        discountAmount: 0,
        total: 200,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        createdBy: adminUserId,
        createdAt: '2026-07-01T12:00:00.000Z',
        checkoutCompletedAt: '2026-07-01T12:00:00.000Z',
        updatedAt: '2026-07-01T12:00:00.000Z',
      })
      .run();
    db.insert(saleReturns)
      .values({
        id: nanoid(),
        tenantId,
        saleId: prevSaleId,
        refundAmount: 50,
        subtotal: 50,
        taxAmount: 0,
        reason: 'Final millisecond refund',
        createdBy: adminUserId,
        createdAt: '2026-07-01T23:59:59.999Z',
      })
      .run();

    const targetDaySessionId = nanoid();
    db.insert(cashSessions)
      .values({
        id: targetDaySessionId,
        tenantId,
        siteId: siteAId,
        cashierId: adminUserId,
        registerName: 'QA Pulse Target Day',
        status: 'closed',
        openingFloat: 0,
        openingCountDenominations: [],
        expectedBalance: 0,
        actualCount: 0,
        actualCountDenominations: [],
        overShort: 0,
        openedAt: '2026-07-08T08:00:00.000Z',
        closedAt: '2026-07-08T20:00:00.000Z',
      })
      .run();

    const summary = computeDayCloseSummary(db, {
      tenantId,
      sessionId: targetDaySessionId,
      viewerUserId: adminUserId,
      canViewAnyCashierSession: true,
      includeProfit: true,
    });
    expect(summary.pulse?.previousWeekRevenue).toBe(150);
  });

  it('computes overShort from the authoritative in-transaction expectedBalance on closeCashSession', async () => {
    const session = await appRouter.createCaller(adminFresh()).cashSessions.open({
      registerName: 'QA Authoritative Close',
      openingFloat: 100,
      denominations: [{ value: 100, count: 1 }],
    });

    // Mutate expectedBalance right before close to verify the immediate tx re-reads it.
    db.update(cashSessions)
      .set({ expectedBalance: 175 })
      .where(eq(cashSessions.id, session.id))
      .run();

    const closed = await closeCashSession(
      {
        db,
        tenantId,
        siteId: siteAId,
        user: { id: adminUserId, role: 'admin' },
      },
      {
        actualCount: 170,
        denominations: [
          { value: 100, count: 1 },
          { value: 50, count: 1 },
          { value: 20, count: 1 },
        ],
      }
    );

    expect(closed.session.expectedBalance).toBe(175);
    expect(closed.session.overShort).toBe(-5);
  });

  it('enforces draft privacy across sales.list, sales.getById, and peripherals receipt renderers, and blocks cashier on sales.summary', async () => {
    // Role check on sales.summary
    await expect(appRouter.createCaller(cashierAFresh()).sales.summary()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(appRouter.createCaller(viewerFresh()).sales.summary()).resolves.toMatchObject({
      todaySalesTotal: expect.any(Number),
    });

    // Create a parked draft owned by cashierA.
    const draftId = nanoid();
    db.insert(sales)
      .values({
        id: draftId,
        tenantId,
        saleNumber: `DRF-${nanoid(6)}`,
        subtotal: 100,
        taxAmount: 0,
        discountAmount: 0,
        total: 100,
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        status: 'draft',
        suspendedAt: new Date().toISOString(),
        suspendedBy: cashierAId,
        suspendedLabel: 'Private retail cart',
        createdBy: cashierAId,
      })
      .run();

    // Default sales.list omits drafts.
    const defaultList = await appRouter.createCaller(adminFresh()).sales.list({
      page: 1,
      perPage: 50,
    });
    expect(defaultList.items.some(item => item.id === draftId)).toBe(false);

    // Filtered status='draft' hides foreign drafts from cashierB and all drafts from viewer.
    const cashierBDrafts = await appRouter.createCaller(cashierBFresh()).sales.list({
      page: 1,
      perPage: 50,
      status: 'draft',
    });
    expect(cashierBDrafts.items.some(item => item.id === draftId)).toBe(false);

    const viewerDrafts = await appRouter.createCaller(viewerFresh()).sales.list({
      page: 1,
      perPage: 50,
      status: 'draft',
    });
    expect(viewerDrafts.items).toHaveLength(0);

    // Own cashier sees their draft via list, getById, and receipt renderers.
    const cashierADrafts = await appRouter.createCaller(cashierAFresh()).sales.list({
      page: 1,
      perPage: 50,
      status: 'draft',
    });
    expect(cashierADrafts.items.some(item => item.id === draftId)).toBe(true);
    await expect(
      appRouter.createCaller(cashierAFresh()).sales.getById({ id: draftId })
    ).resolves.toMatchObject({ id: draftId });

    // Foreign cashier and viewer are blocked on getById and receipt renderers.
    for (const caller of [
      appRouter.createCaller(cashierBFresh()),
      appRouter.createCaller(viewerFresh()),
    ]) {
      await expect(caller.sales.getById({ id: draftId })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        caller.peripherals.renderReceiptHtml({ saleId: draftId, siteId: siteAId })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        caller.peripherals.renderReceiptShare({ saleId: draftId, siteId: siteAId })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        caller.peripherals.buildReceiptBytes({ saleId: draftId, siteId: siteAId })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        caller.peripherals.printReceipt({ saleId: draftId, siteId: siteAId })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('honors input.siteId in cashSessions.getActive/myPace/myShiftSummary and rejects foreign-tenant siteId', async () => {
    const sessionA = await appRouter.createCaller(cashierAFresh()).cashSessions.open({
      registerName: 'Site A Drawer',
      openingFloat: 50,
      denominations: [{ value: 50, count: 1 }],
    });

    // Context is Site A, but requesting Site B must return null (not Site A's open drawer).
    const activeOnA = await appRouter
      .createCaller(cashierAFresh())
      .cashSessions.getActive({ siteId: siteAId });
    expect(activeOnA?.id).toBe(sessionA.id);

    const activeOnB = await appRouter
      .createCaller(cashierAFresh())
      .cashSessions.getActive({ siteId: siteBId });
    expect(activeOnB).toBeNull();

    const paceOnB = await appRouter
      .createCaller(cashierAFresh())
      .cashSessions.myPace({ siteId: siteBId });
    expect(paceOnB).toBeNull();

    const summaryOnB = await appRouter
      .createCaller(cashierAFresh())
      .cashSessions.myShiftSummary({ siteId: siteBId });
    expect(summaryOnB).toBeNull();

    // Cross-tenant siteId must be rejected cleanly.
    await expect(
      appRouter.createCaller(cashierAFresh()).cashSessions.getActive({ siteId: otherSiteId })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await appRouter.createCaller(cashierAFresh()).cashSessions.close({
      actualCount: 50,
      denominations: [{ value: 50, count: 1 }],
    });
  });

  it('returns typed CONFLICT VAT_RATE_NAME_DUPLICATE on duplicate vatRates create/update', async () => {
    const name1 = `QA IVA ${nanoid(5)}`;
    const name2 = `QA IVA ${nanoid(5)}`;
    const rate1 = await appRouter
      .createCaller(adminFresh())
      .vatRates.create({ name: name1, rate: 19, kind: 'iva', isActive: true });
    const rate2 = await appRouter
      .createCaller(adminFresh())
      .vatRates.create({ name: name2, rate: 5, kind: 'iva', isActive: true });

    await expect(
      appRouter
        .createCaller(adminFresh())
        .vatRates.create({ name: name1, rate: 19, kind: 'iva', isActive: true })
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      cause: { errorCode: 'VAT_RATE_NAME_DUPLICATE' },
    });

    await expect(
      appRouter.createCaller(adminFresh()).vatRates.update({ id: rate2.id, name: rate1.name })
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      cause: { errorCode: 'VAT_RATE_NAME_DUPLICATE' },
    });
  });

  it('defines every PRESET_SCOPED_MODULES key explicitly on every vertical preset', () => {
    for (const presetId of VERTICAL_PRESET_IDS) {
      const patch = resolvePresetPatch(presetId);
      for (const moduleId of PRESET_SCOPED_MODULES) {
        expect(typeof patch[moduleId]).toBe('boolean');
      }
    }
  });
});
