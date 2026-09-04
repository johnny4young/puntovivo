import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  cashMovements,
  cashSessions,
  providerPayableAllocations,
  providerPayableCredits,
  providerPayableInvoices,
  providerPayablePayments,
  providers,
  purchases,
  sites,
  syncOutbox,
  tenantLocaleSettings,
  users,
} from '../db/schema.js';
import { getProviderPayableOverview } from '../application/provider-payables/index.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { calendarDayInTimeZone } from '../services/reports/day-window.js';
import { resolveTenantLocale } from '../services/tenant-locale.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { freshCriticalContext, makeEnvelopeHeadersProxy } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let deviceId: string;
let tenantTimeZone = 'UTC';

function context(overrides?: {
  tenantId?: string;
  role?: 'admin' | 'manager' | 'viewer';
  siteId?: string | null;
}): Context {
  const effectiveTenantId = overrides?.tenantId ?? tenantId;
  const role = overrides?.role ?? 'admin';
  const effectiveSiteId = overrides?.siteId === undefined ? siteId : overrides.siteId;
  return {
    req: {
      server: server.app,
      headers: makeEnvelopeHeadersProxy({
        getDeviceId: () => deviceId,
        getSiteId: () => effectiveSiteId,
      }),
      user: {
        userId,
        email: 'admin@localhost',
        role,
        tenantId: effectiveTenantId,
      },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db: getDatabase(),
    user: { id: userId, email: 'admin@localhost', role, tenantId: effectiveTenantId },
    tenantId: effectiveTenantId,
    siteId: effectiveSiteId,
  };
}

function businessDayFromNow(days: number): string {
  return calendarDayInTimeZone(new Date(Date.now() + days * 86_400_000), tenantTimeZone);
}

async function createProvider(name: string): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await getDatabase().insert(providers).values({
    id,
    tenantId,
    name,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function createCompletedPurchase(providerId: string): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await getDatabase()
    .insert(purchases)
    .values({
      id,
      tenantId,
      purchaseNumber: `COMP-${nanoid(6)}`,
      providerId,
      siteId,
      status: 'completed',
      subtotal: 100,
      total: 100,
      createdBy: userId,
      syncVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
  return id;
}

describe('provider payables', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const user = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!user) throw new Error('Expected seeded administrator');
    tenantId = user.tenantId;
    userId = user.id;
    const site = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!site) throw new Error('Expected active site');
    siteId = site.id;
    tenantTimeZone = (await resolveTenantLocale(db, tenantId)).timezone;
    deviceId = (
      await registerDeviceService(db, {
        tenantId,
        userId,
        kind: 'web',
        name: 'provider-payables.test',
      })
    ).deviceId;
  });

  afterAll(async () => {
    await server.close();
  });

  it('does not infer historical debt and links a purchase only through an explicit invoice', async () => {
    const db = getDatabase();
    const providerId = await createProvider(`AP purchase ${nanoid(5)}`);
    const purchaseId = nanoid();
    const now = new Date().toISOString();
    await db.insert(purchases).values({
      id: purchaseId,
      tenantId,
      purchaseNumber: `COM-AP-${nanoid(5)}`,
      providerId,
      siteId,
      status: 'completed',
      subtotal: 75,
      total: 75,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    const caller = appRouter.createCaller(context());
    const before = await caller.providerPayables.overview({ providerId });
    expect(before.totals).toEqual({ invoices: 0, payments: 0, credits: 0, balance: 0 });
    expect(before.availablePurchases).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: purchaseId, total: 75 })])
    );

    const invoice = await caller.providerPayables.createInvoice({
      providerId,
      purchaseId,
      documentNumber: `FAC-${nanoid(6)}`,
      issuedAt: businessDayFromNow(-5),
      dueAt: businessDayFromNow(25),
      amount: 75,
    });
    const after = await caller.providerPayables.overview({ providerId });
    expect(after.totals).toEqual({ invoices: 75, payments: 0, credits: 0, balance: 75 });
    expect(after.availablePurchases.some(purchase => purchase.id === purchaseId)).toBe(false);
    expect(after.invoices[0]).toMatchObject({ id: invoice.id, purchaseId, outstanding: 75 });

    await expect(
      caller.providerPayables.createInvoice({
        providerId,
        purchaseId,
        documentNumber: `FAC-${nanoid(6)}`,
        issuedAt: businessDayFromNow(-5),
        dueAt: businessDayFromNow(25),
        amount: 75,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PROVIDER_PAYABLE_PURCHASE_ALREADY_INVOICED' },
    });
  });

  it('rejects non-completed purchases and non-cent amounts before persistence', async () => {
    const db = getDatabase();
    const providerId = await createProvider(`AP validation ${nanoid(5)}`);
    const purchaseId = nanoid();
    const now = new Date().toISOString();
    await db.insert(purchases).values({
      id: purchaseId,
      tenantId,
      purchaseNumber: `COM-AP-VOID-${nanoid(5)}`,
      providerId,
      siteId,
      status: 'voided',
      subtotal: 10,
      total: 10,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    const caller = appRouter.createCaller(context());
    await expect(
      caller.providerPayables.createInvoice({
        providerId,
        purchaseId,
        documentNumber: `FAC-VOID-${nanoid(5)}`,
        issuedAt: businessDayFromNow(-1),
        dueAt: businessDayFromNow(1),
        amount: 10,
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PROVIDER_PAYABLE_PURCHASE_NOT_COMPLETED' },
    });
    await expect(
      caller.providerPayables.createInvoice({
        providerId,
        documentNumber: `FAC-FRACTION-${nanoid(5)}`,
        issuedAt: businessDayFromNow(-1),
        dueAt: businessDayFromNow(1),
        amount: 0.001,
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.providerPayables.createInvoice({
        providerId,
        documentNumber: `FAC-DATE-${nanoid(5)}`,
        issuedAt: '2026-09-02',
        dueAt: '2026-09-01',
        amount: 10,
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.providerPayables.createInvoice({
        providerId,
        documentNumber: `FAC-TIMESTAMP-${nanoid(5)}`,
        issuedAt: '2026-09-01T00:00:00.000Z',
        dueAt: '2026-09-02T00:00:00.000Z',
        amount: 10,
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(
      await db
        .select()
        .from(providerPayableInvoices)
        .where(eq(providerPayableInvoices.providerId, providerId))
    ).toHaveLength(0);
  });

  it('a provider with payable history is refused with a stable code, not a raw FK error', async () => {
    // The payable tables reference providers restrictively. Without a
    // precheck the delete reached SQLite and came back as a generic internal
    // error, which tells the operator nothing.
    const providerId = await createProvider(`AP undeletable ${nanoid(5)}`);
    const caller = appRouter.createCaller(context());
    await caller.providerPayables.createInvoice({
      providerId,
      documentNumber: `FAC-KEEP-${nanoid(5)}`,
      issuedAt: businessDayFromNow(0),
      dueAt: businessDayFromNow(15),
      amount: 25,
    });

    await expect(caller.providers.delete({ id: providerId })).rejects.toMatchObject({
      cause: { errorCode: 'PROVIDER_HAS_PAYABLE_HISTORY' },
    });
  });

  it('a purchase-linked invoice inherits the purchase site when no site is active', async () => {
    // requireSiteId used to run before the purchase was read, so a linked
    // invoice was rejected even though purchase.siteId was sitting right
    // there waiting to be adopted.
    const providerId = await createProvider(`AP linked ${nanoid(5)}`);
    const purchaseId = await createCompletedPurchase(providerId);
    const caller = appRouter.createCaller(context({ siteId: null }));

    const invoice = await caller.providerPayables.createInvoice({
      providerId,
      purchaseId,
      documentNumber: `FAC-LINK-${nanoid(5)}`,
      issuedAt: businessDayFromNow(0),
      dueAt: businessDayFromNow(15),
      amount: 100,
    });

    const stored = await getDatabase()
      .select({ siteId: providerPayableInvoices.siteId })
      .from(providerPayableInvoices)
      .where(eq(providerPayableInvoices.id, invoice.id))
      .get();
    expect(stored?.siteId).toBe(siteId);
  });

  it('an unlinked invoice still requires an active site', async () => {
    const providerId = await createProvider(`AP unlinked ${nanoid(5)}`);
    const caller = appRouter.createCaller(context({ siteId: null }));

    await expect(
      caller.providerPayables.createInvoice({
        providerId,
        documentNumber: `FAC-NOSITE-${nanoid(5)}`,
        issuedAt: businessDayFromNow(0),
        dueAt: businessDayFromNow(15),
        amount: 50,
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'PROVIDER_PAYABLE_SITE_REQUIRED' } });
  });

  it('treats the due date as a full business day and orders same-day charges before settlement', async () => {
    const providerId = await createProvider(`AP calendar ${nanoid(5)}`);
    const caller = appRouter.createCaller(context());
    const today = businessDayFromNow(0);
    const invoice = await caller.providerPayables.createInvoice({
      providerId,
      documentNumber: `FAC-TODAY-${nanoid(5)}`,
      issuedAt: today,
      dueAt: today,
      amount: 10,
    });

    const beforePayment = await caller.providerPayables.overview({ providerId });
    expect(beforePayment.aging.current).toBe(10);
    expect(beforePayment.aging.days1To30).toBe(0);

    await caller.providerPayables.recordPayment({
      providerId,
      amount: 10,
      method: 'transfer',
      paidAt: today,
      allocations: [{ invoiceId: invoice.id, amount: 10 }],
    });
    const afterPayment = await caller.providerPayables.overview({ providerId });
    expect(afterPayment.statement.map(entry => entry.kind)).toEqual(['payment', 'invoice']);
    expect(afterPayment.statement.map(entry => entry.balanceAfter)).toEqual([0, 10]);
  });

  it('ages invoices against the tenant calendar day instead of the UTC day', async () => {
    const db = getDatabase();
    const previousLocale = await db
      .select({ timezoneOverride: tenantLocaleSettings.timezoneOverride })
      .from(tenantLocaleSettings)
      .where(eq(tenantLocaleSettings.tenantId, tenantId))
      .get();
    if (previousLocale) {
      await db
        .update(tenantLocaleSettings)
        .set({ timezoneOverride: 'America/Bogota' })
        .where(eq(tenantLocaleSettings.tenantId, tenantId));
    } else {
      await db.insert(tenantLocaleSettings).values({
        tenantId,
        countryCode: 'CO',
        timezoneOverride: 'America/Bogota',
      });
    }
    try {
      const providerId = await createProvider(`AP timezone ${nanoid(5)}`);
      await appRouter.createCaller(context()).providerPayables.createInvoice({
        providerId,
        documentNumber: `FAC-TZ-${nanoid(5)}`,
        issuedAt: '2026-08-30',
        dueAt: '2026-08-30',
        amount: 10,
      });

      const overview = await getProviderPayableOverview(
        db,
        tenantId,
        providerId,
        new Date('2026-08-31T02:30:00.000Z')
      );
      expect(overview.aging.current).toBe(10);
      expect(overview.aging.days1To30).toBe(0);
    } finally {
      if (previousLocale) {
        await db
          .update(tenantLocaleSettings)
          .set({ timezoneOverride: previousLocale.timezoneOverride })
          .where(eq(tenantLocaleSettings.tenantId, tenantId));
      } else {
        await db.delete(tenantLocaleSettings).where(eq(tenantLocaleSettings.tenantId, tenantId));
      }
    }
  });

  it('reconciles invoices, explicit opening balance, payment, credit, statement and aging', async () => {
    const providerId = await createProvider(`AP ledger ${nanoid(5)}`);
    const caller = appRouter.createCaller(context());
    const oldInvoice = await caller.providerPayables.createInvoice({
      providerId,
      documentNumber: `FAC-OLD-${nanoid(5)}`,
      issuedAt: businessDayFromNow(-125),
      dueAt: businessDayFromNow(-95),
      amount: 100,
    });
    const partialInvoice = await caller.providerPayables.createInvoice({
      providerId,
      documentNumber: `FAC-PART-${nanoid(5)}`,
      issuedAt: businessDayFromNow(-75),
      dueAt: businessDayFromNow(-45),
      amount: 200,
    });
    const opening = await caller.providerPayables.createOpeningBalance({
      providerId,
      asOf: businessDayFromNow(-1),
      dueAt: businessDayFromNow(20),
      amount: 50,
      note: 'Saldo certificado por el proveedor',
    });
    const payment = await caller.providerPayables.recordPayment({
      providerId,
      amount: 120,
      method: 'transfer',
      reference: `TR-${nanoid(5)}`,
      paidAt: businessDayFromNow(0),
      allocations: [
        { invoiceId: oldInvoice.id, amount: 100 },
        { invoiceId: partialInvoice.id, amount: 20 },
      ],
    });
    const credit = await caller.providerPayables.recordCredit({
      providerId,
      amount: 30,
      documentNumber: `NC-${nanoid(5)}`,
      creditedAt: businessDayFromNow(0),
      reason: 'Bonificación comercial',
      allocations: [{ invoiceId: partialInvoice.id, amount: 30 }],
    });

    const overview = await caller.providerPayables.overview({ providerId });
    expect(overview.totals).toEqual({ invoices: 350, payments: 120, credits: 30, balance: 200 });
    expect(overview.aging).toEqual({
      current: 50,
      days1To30: 0,
      days31To60: 150,
      days61To90: 0,
      daysOver90: 0,
    });
    expect(overview.invoices.find(invoice => invoice.id === oldInvoice.id)?.status).toBe('paid');
    expect(overview.invoices.find(invoice => invoice.id === partialInvoice.id)).toMatchObject({
      status: 'partial',
      allocated: 50,
      outstanding: 150,
    });
    expect(overview.invoices.find(invoice => invoice.id === opening.id)).toMatchObject({
      kind: 'opening_balance',
      outstanding: 50,
    });
    expect(overview.statement[0]?.balanceAfter).toBe(200);

    const db = getDatabase();
    expect(
      await db
        .select()
        .from(providerPayableAllocations)
        .where(eq(providerPayableAllocations.providerId, providerId))
    ).toHaveLength(3);
    expect(
      await db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.resourceType, 'provider_payable'))
        )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: payment.id,
          action: 'provider_payable.payment.create',
        }),
        expect.objectContaining({
          resourceId: credit.id,
          action: 'provider_payable.credit.create',
        }),
      ])
    );
  });

  it('records a cash supplier payment as an atomic drawer outflow', async () => {
    const db = getDatabase();
    const providerId = await createProvider(`AP cash ${nanoid(5)}`);
    const caller = appRouter.createCaller(context());
    const invoice = await caller.providerPayables.createInvoice({
      providerId,
      documentNumber: `FAC-CASH-${nanoid(5)}`,
      issuedAt: businessDayFromNow(-1),
      dueAt: businessDayFromNow(10),
      amount: 20,
    });
    const session = await caller.cashSessions.open({
      registerName: `AP cash ${nanoid(5)}`,
      openingFloat: 100,
      denominations: [{ value: 20, count: 5 }],
    });

    const payment = await caller.providerPayables.recordPayment({
      providerId,
      amount: 20,
      method: 'cash',
      reference: 'PETTY-CASH-1',
      paidAt: businessDayFromNow(0),
      allocations: [{ invoiceId: invoice.id, amount: 20 }],
    });

    expect(payment.cashMovementId).toEqual(expect.any(String));
    expect(
      await db.select().from(cashMovements).where(eq(cashMovements.referenceId, payment.id)).get()
    ).toMatchObject({
      id: payment.cashMovementId,
      sessionId: session.id,
      type: 'paid_out',
      amount: 20,
    });
    expect(
      await db
        .select({ expectedBalance: cashSessions.expectedBalance })
        .from(cashSessions)
        .where(eq(cashSessions.id, session.id))
        .get()
    ).toEqual({ expectedBalance: 80 });
    expect((await caller.providerPayables.overview({ providerId })).totals.balance).toBe(0);

    await caller.cashSessions.close({
      actualCount: 80,
      denominations: [{ value: 20, count: 4 }],
    });
  });

  it('drains payment and credit parents before their allocation children', async () => {
    const db = getDatabase();
    const providerId = await createProvider(`AP sync topology ${nanoid(5)}`);
    const caller = appRouter.createCaller(context());
    const paymentInvoice = await caller.providerPayables.createInvoice({
      providerId,
      documentNumber: `FAC-SYNC-P-${nanoid(5)}`,
      issuedAt: businessDayFromNow(-1),
      dueAt: businessDayFromNow(10),
      amount: 20,
    });
    const creditInvoice = await caller.providerPayables.createInvoice({
      providerId,
      documentNumber: `FAC-SYNC-C-${nanoid(5)}`,
      issuedAt: businessDayFromNow(-1),
      dueAt: businessDayFromNow(10),
      amount: 15,
    });
    const payment = await caller.providerPayables.recordPayment({
      providerId,
      amount: 20,
      method: 'transfer',
      paidAt: businessDayFromNow(0),
      allocations: [{ invoiceId: paymentInvoice.id, amount: 20 }],
    });
    const credit = await caller.providerPayables.recordCredit({
      providerId,
      amount: 15,
      documentNumber: `NC-SYNC-${nanoid(5)}`,
      creditedAt: businessDayFromNow(0),
      reason: 'Sync ordering regression',
      allocations: [{ invoiceId: creditInvoice.id, amount: 15 }],
    });

    const rows = await db
      .select({ entityType: syncOutbox.entityType, entityId: syncOutbox.entityId })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          inArray(syncOutbox.entityId, [
            payment.id,
            ...payment.allocationIds,
            credit.id,
            ...credit.allocationIds,
          ])
        )
      )
      .orderBy(desc(syncOutbox.priority), syncOutbox.createdAt)
      .all();

    expect(new Set(rows.slice(0, 2).map(row => row.entityType))).toEqual(
      new Set(['provider_payable_payments', 'provider_payable_credits'])
    );
    expect(rows.slice(2).map(row => row.entityType)).toEqual([
      'provider_payable_allocations',
      'provider_payable_allocations',
    ]);
  });

  it('drains every supplier-payable outbox entity without unsupported-type retries', async () => {
    const db = getDatabase();
    const caller = appRouter.createCaller(context());

    const pushed = await caller.sync.push({ limit: 100 });

    expect(pushed.errors.filter(message => message.includes('provider_payable'))).toEqual([]);
    for (const entityType of [
      'provider_payable_invoices',
      'provider_payable_payments',
      'provider_payable_credits',
      'provider_payable_allocations',
    ]) {
      expect(
        await db
          .select({ status: syncOutbox.status })
          .from(syncOutbox)
          .where(and(eq(syncOutbox.tenantId, tenantId), eq(syncOutbox.entityType, entityType)))
      ).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'synced' })]));
    }
  });

  it('rejects a cash supplier payment when the operator has no open drawer', async () => {
    const db = getDatabase();
    const providerId = await createProvider(`AP cash guard ${nanoid(5)}`);
    const caller = appRouter.createCaller(context());
    const invoice = await caller.providerPayables.createInvoice({
      providerId,
      documentNumber: `FAC-CASH-GUARD-${nanoid(5)}`,
      issuedAt: businessDayFromNow(-1),
      dueAt: businessDayFromNow(10),
      amount: 20,
    });

    await expect(
      caller.providerPayables.recordPayment({
        providerId,
        amount: 20,
        method: 'cash',
        paidAt: businessDayFromNow(0),
        allocations: [{ invoiceId: invoice.id, amount: 20 }],
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'CASH_SESSION_REQUIRED' } });
    expect(
      await db
        .select()
        .from(providerPayablePayments)
        .where(eq(providerPayablePayments.providerId, providerId))
    ).toHaveLength(0);
  });

  it('rolls back an over-allocation without leaving payment, audit or outbox effects', async () => {
    const db = getDatabase();
    const providerId = await createProvider(`AP rollback ${nanoid(5)}`);
    const caller = appRouter.createCaller(context());
    const invoice = await caller.providerPayables.createInvoice({
      providerId,
      documentNumber: `FAC-RB-${nanoid(5)}`,
      issuedAt: businessDayFromNow(-1),
      dueAt: businessDayFromNow(20),
      amount: 100,
    });
    const paymentOutboxBefore = await db
      .select({ id: syncOutbox.id })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          eq(syncOutbox.entityType, 'provider_payable_payments')
        )
      );

    await expect(
      caller.providerPayables.recordPayment({
        providerId,
        amount: 101,
        method: 'transfer',
        paidAt: businessDayFromNow(0),
        allocations: [{ invoiceId: invoice.id, amount: 101 }],
      })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PROVIDER_PAYABLE_ALLOCATION_EXCEEDS_OUTSTANDING' },
    });

    expect(
      await db
        .select()
        .from(providerPayablePayments)
        .where(eq(providerPayablePayments.providerId, providerId))
    ).toHaveLength(0);
    const paymentAudits = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.resourceType, 'provider_payable'),
          eq(auditLogs.action, 'provider_payable.payment.create')
        )
      );
    expect(
      paymentAudits.filter(
        row => (row.after as { providerId?: string } | null)?.providerId === providerId
      )
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: syncOutbox.id })
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, tenantId),
            eq(syncOutbox.entityType, 'provider_payable_payments')
          )
        )
    ).toHaveLength(paymentOutboxBefore.length);
  });

  it('replays an identical Command Envelope exactly once', async () => {
    const db = getDatabase();
    const providerId = await createProvider(`AP replay ${nanoid(5)}`);
    const envelope = {
      operationId: randomUUID(),
      idempotencyKey: randomUUID(),
      clientCreatedAt: new Date().toISOString(),
    };
    const replayContext = () =>
      freshCriticalContext({
        db,
        serverApp: server.app,
        tenantId,
        userId,
        email: 'admin@localhost',
        role: 'admin',
        siteId,
        deviceId,
        envelope,
      });
    const input = {
      providerId,
      documentNumber: `FAC-REPLAY-${nanoid(5)}`,
      issuedAt: businessDayFromNow(-1),
      dueAt: businessDayFromNow(20),
      amount: 42,
    };

    const created = await appRouter
      .createCaller(replayContext())
      .providerPayables.createInvoice(input);
    const replayed = await appRouter
      .createCaller(replayContext())
      .providerPayables.createInvoice(input);

    expect(replayed).toEqual(created);
    expect(
      await db
        .select()
        .from(providerPayableInvoices)
        .where(eq(providerPayableInvoices.providerId, providerId))
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.entityType, 'provider_payable_invoices'),
            eq(syncOutbox.entityId, created.id)
          )
        )
    ).toHaveLength(1);
  });

  it('enforces role and tenant boundaries', async () => {
    const providerId = await createProvider(`AP scope ${nanoid(5)}`);
    await expect(
      appRouter.createCaller(context({ role: 'viewer' })).providerPayables.overview({ providerId })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      appRouter
        .createCaller(context({ tenantId: `foreign-${nanoid(5)}` }))
        .providerPayables.overview({ providerId })
    ).rejects.toMatchObject({
      cause: { errorCode: 'PROVIDER_PAYABLE_PROVIDER_NOT_FOUND' },
    });
  });

  it('keeps credit and allocation records tenant scoped', async () => {
    const db = getDatabase();
    const providerId = await createProvider(`AP credit scope ${nanoid(5)}`);
    const caller = appRouter.createCaller(context());
    const invoice = await caller.providerPayables.createInvoice({
      providerId,
      documentNumber: `FAC-CS-${nanoid(5)}`,
      issuedAt: businessDayFromNow(-2),
      dueAt: businessDayFromNow(10),
      amount: 20,
    });
    await caller.providerPayables.recordCredit({
      providerId,
      amount: 20,
      documentNumber: `NC-CS-${nanoid(5)}`,
      creditedAt: businessDayFromNow(0),
      reason: 'Ajuste autorizado',
      allocations: [{ invoiceId: invoice.id, amount: 20 }],
    });
    expect(
      await db
        .select()
        .from(providerPayableCredits)
        .where(
          and(
            eq(providerPayableCredits.tenantId, tenantId),
            eq(providerPayableCredits.providerId, providerId)
          )
        )
    ).toHaveLength(1);
  });
});
