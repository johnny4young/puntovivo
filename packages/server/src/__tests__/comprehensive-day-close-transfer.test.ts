/**
 * Comprehensive day-close report — transfer confirmation section (Fase 5.7 / T4).
 *
 * The managerial close reports confirmed and pending transfers as two separate
 * figures: summing them would tell a manager that unreceived money is cash in
 * the drawer. Physical cash and historical revenue stay exactly as they are —
 * the transfer section is additive evidence, never a rewrite of a total.
 */

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  cashSessions,
  companies,
  salePayments,
  sales,
  sites,
  tenantLocaleSettings,
  tenants,
  users,
} from '../db/schema.js';
import { computeComprehensiveDayCloseReport } from '../services/reports/comprehensive-day-close.js';
import { comprehensiveDayCloseReportOutput } from '../trpc/schemas/reports.js';

let server: PuntovivoServer;

const DAY = '2026-07-14';

const BANK = { id: 'dest_bank', label: 'Bancolombia 4821', kind: 'bank_account' };
const WALLET = { id: 'dest_wallet', label: 'Nequi 3001234567', kind: 'wallet' };

async function seedTenant(suffix: string) {
  const db = getDatabase();
  const now = '2026-07-01T12:00:00.000Z';
  const tenantId = `tfr-tenant-${suffix}`;
  const userId = `tfr-user-${suffix}`;
  const managerId = `tfr-manager-${suffix}`;

  await db.insert(tenants).values({
    id: tenantId,
    name: `Transfers ${suffix}`,
    slug: `transfers-${suffix}`,
    settings: {},
    defaultCurrencyCode: 'COP',
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(tenantLocaleSettings).values({ tenantId, countryCode: 'CO' });
  await db.insert(companies).values({
    id: `tfr-company-${suffix}`,
    tenantId,
    name: `Company ${suffix}`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(sites).values({
    id: `tfr-site-${suffix}`,
    tenantId,
    companyId: `tfr-company-${suffix}`,
    name: `Site ${suffix}`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values([
    {
      id: userId,
      tenantId,
      email: `${userId}@example.com`,
      name: `Cashier ${suffix}`,
      passwordHash: 'x',
      role: 'cashier',
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
  ]);

  await db.insert(cashSessions).values({
    id: `tfr-session-${suffix}`,
    tenantId,
    siteId: `tfr-site-${suffix}`,
    cashierId: userId,
    registerName: 'Caja 1',
    openingFloat: 50,
    openingCountDenominations: [],
    expectedBalance: 50,
    actualCount: 50,
    overShort: 0,
    status: 'closed',
    openedAt: '2026-07-14T12:00:00.000Z',
    closedAt: '2026-07-14T22:00:00.000Z',
  });

  return {
    tenantId,
    userId,
    managerId,
    siteId: `tfr-site-${suffix}`,
    sessionId: `tfr-session-${suffix}`,
  };
}

describe('comprehensive day close — transfer confirmations', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
  });

  afterAll(async () => {
    await server.close();
  });

  it('reports confirmed and pending transfers as separate figures for the tenant day', async () => {
    const db = getDatabase();
    const a = await seedTenant('a');
    const foreign = await seedTenant('foreign');

    // Bogota day 2026-07-14 => 05:00Z .. 2026-07-15T05:00Z.
    const at = '2026-07-14T14:00:00.000Z';

    await db.insert(sales).values([
      {
        id: 'tfr-sale-confirmed',
        tenantId: a.tenantId,
        saleNumber: 'TFR-1',
        total: 100,
        paymentMethod: 'transfer',
        status: 'completed',
        createdBy: a.userId,
        cashSessionId: a.sessionId,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: 'tfr-sale-pending',
        tenantId: a.tenantId,
        saleNumber: 'TFR-2',
        total: 80,
        paymentMethod: 'transfer',
        status: 'completed',
        createdBy: a.userId,
        cashSessionId: a.sessionId,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: 'tfr-sale-manual',
        tenantId: a.tenantId,
        saleNumber: 'TFR-3',
        total: 50,
        paymentMethod: 'transfer',
        status: 'completed',
        createdBy: a.userId,
        cashSessionId: a.sessionId,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: 'tfr-sale-cash',
        tenantId: a.tenantId,
        saleNumber: 'TFR-4',
        total: 30,
        paymentMethod: 'cash',
        status: 'completed',
        createdBy: a.userId,
        cashSessionId: a.sessionId,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: 'tfr-sale-legacy',
        tenantId: a.tenantId,
        saleNumber: 'TFR-5',
        total: 20,
        paymentMethod: 'transfer',
        status: 'completed',
        createdBy: a.userId,
        cashSessionId: a.sessionId,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: 'tfr-sale-rejected',
        tenantId: a.tenantId,
        saleNumber: 'TFR-6',
        total: 40,
        paymentMethod: 'transfer',
        status: 'completed',
        createdBy: a.userId,
        cashSessionId: a.sessionId,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: 'tfr-sale-foreign',
        tenantId: foreign.tenantId,
        saleNumber: 'TFR-F',
        total: 999,
        paymentMethod: 'transfer',
        status: 'completed',
        createdBy: foreign.userId,
        cashSessionId: foreign.sessionId,
        createdAt: at,
        updatedAt: at,
      },
    ]);

    await db.insert(salePayments).values([
      {
        id: 'tfr-pay-provider',
        tenantId: a.tenantId,
        saleId: 'tfr-sale-confirmed',
        method: 'transfer',
        amount: 100,
        reference: 'REF-PROVIDER',
        confirmationStatus: 'provider_confirmed',
        confirmationSource: 'provider_webhook',
        confirmedAt: at,
        destinationSnapshot: BANK,
        transferDestinationId: BANK.id,
        createdAt: at,
      },
      {
        id: 'tfr-pay-pending',
        tenantId: a.tenantId,
        saleId: 'tfr-sale-pending',
        method: 'transfer',
        amount: 80,
        reference: 'REF-PENDING',
        confirmationStatus: 'pending',
        destinationSnapshot: BANK,
        transferDestinationId: BANK.id,
        createdAt: at,
      },
      {
        id: 'tfr-pay-manual',
        tenantId: a.tenantId,
        saleId: 'tfr-sale-manual',
        method: 'transfer',
        amount: 50,
        reference: 'REF-MANUAL',
        confirmationStatus: 'manual_confirmed',
        confirmationSource: 'operator',
        confirmedAt: at,
        destinationSnapshot: WALLET,
        transferDestinationId: WALLET.id,
        createdAt: at,
      },
      {
        id: 'tfr-pay-cash',
        tenantId: a.tenantId,
        saleId: 'tfr-sale-cash',
        method: 'cash',
        amount: 30,
        createdAt: at,
      },
      {
        id: 'tfr-pay-legacy',
        tenantId: a.tenantId,
        saleId: 'tfr-sale-legacy',
        method: 'transfer',
        amount: 20,
        reference: 'REF-LEGACY',
        createdAt: at,
      },
      {
        id: 'tfr-pay-rejected',
        tenantId: a.tenantId,
        saleId: 'tfr-sale-rejected',
        method: 'transfer',
        amount: 40,
        reference: 'REF-REJECTED',
        confirmationStatus: 'rejected',
        destinationSnapshot: BANK,
        transferDestinationId: BANK.id,
        createdAt: at,
      },
      {
        id: 'tfr-pay-foreign',
        tenantId: foreign.tenantId,
        saleId: 'tfr-sale-foreign',
        method: 'transfer',
        amount: 999,
        reference: 'REF-FOREIGN',
        confirmationStatus: 'provider_confirmed',
        destinationSnapshot: BANK,
        transferDestinationId: BANK.id,
        createdAt: at,
      },
    ]);

    await db.insert(auditLogs).values([
      {
        id: 'tfr-audit-surplus',
        tenantId: a.tenantId,
        actorId: a.managerId,
        action: 'sale_payment.transfer_manual_confirmed',
        resourceType: 'sale',
        resourceId: 'tfr-sale-manual',
        after: { salePaymentId: 'tfr-pay-manual', verifiedAmount: 56, surplusAmount: 6 },
        createdAt: at,
      },
      {
        id: 'tfr-audit-before-window',
        tenantId: a.tenantId,
        actorId: a.managerId,
        action: 'sale_payment.transfer_manual_confirmed',
        resourceType: 'sale',
        resourceId: 'tfr-sale-manual',
        after: { salePaymentId: 'tfr-pay-manual', verifiedAmount: 60, surplusAmount: 10 },
        createdAt: '2026-07-13T14:00:00.000Z',
      },
      {
        id: 'tfr-audit-foreign',
        tenantId: foreign.tenantId,
        actorId: foreign.managerId,
        action: 'sale_payment.transfer_manual_confirmed',
        resourceType: 'sale',
        resourceId: 'tfr-sale-foreign',
        after: { salePaymentId: 'tfr-pay-foreign', verifiedAmount: 1000, surplusAmount: 1 },
        createdAt: at,
      },
    ]);

    const report = await computeComprehensiveDayCloseReport(db, {
      tenantId: a.tenantId,
      date: DAY,
      now: new Date('2026-07-15T12:00:00.000Z'),
    });

    const transfers = report.transferConfirmations;
    expect(transfers).toBeDefined();

    // Confirmed and pending are never summed into one figure.
    expect(transfers!.confirmed).toBe(150);
    expect(transfers!.pending).toBe(80);
    expect(transfers!.rejected).toBe(40);
    // Pre-lifecycle tenders stay visible as their own bucket instead of being
    // reported as confirmed money.
    expect(transfers!.legacy).toBe(20);
    expect(transfers!.reported).toBe(290);
    expect(
      transfers!.confirmed + transfers!.pending + transfers!.rejected + transfers!.legacy
    ).toBe(transfers!.reported);
    // Every bucket is traceable to its lifecycle status.
    expect(transfers!.byStatus).toMatchObject({
      provider_confirmed: 1,
      manual_confirmed: 1,
      pending: 1,
      rejected: 1,
      legacy: 1,
      customer_reported: 0,
      needs_reconciliation: 0,
      cancelled: 0,
    });
    // Money received above the sale and never applied, from the audit evidence.
    expect(transfers!.unapplied).toBe(6);

    // Frozen destinations keep their own split and the operator's references.
    const byDestination = new Map(transfers!.destinations.map(row => [row.label, row]));
    expect(byDestination.get(BANK.label)).toMatchObject({
      destinationId: BANK.id,
      kind: 'bank_account',
      confirmed: 100,
      pending: 80,
      count: 3,
      references: ['REF-PENDING', 'REF-PROVIDER', 'REF-REJECTED'],
    });
    expect(byDestination.get(WALLET.label)).toMatchObject({
      destinationId: WALLET.id,
      kind: 'wallet',
      confirmed: 50,
      pending: 0,
      count: 1,
      references: ['REF-MANUAL'],
    });
    expect(byDestination.get('999')).toBeUndefined();

    // Gross revenue and physical cash are untouched by the new section.
    expect(report.sales.grossRevenue).toBe(320);
    expect(report.cash.expected).toBe(50);
    expect(report.cash.counted).toBe(50);
    expect(report.cash.overShort).toBe(0);
    // The historical per-method settlement block is unchanged: every transfer
    // tender of the day still lands under `transfer`, whatever its state.
    expect(report.payments).toEqual([
      { method: 'cash', amount: 30, transactionCount: 1 },
      { method: 'transfer', amount: 290, transactionCount: 5 },
    ]);
  });

  it('keeps a day with no transfers calm and valid', async () => {
    const db = getDatabase();
    const c = await seedTenant('c');
    const at = '2026-07-14T14:00:00.000Z';
    await db.insert(sales).values({
      id: 'tfr-sale-c-cash',
      tenantId: c.tenantId,
      saleNumber: 'TFR-C1',
      total: 45,
      paymentMethod: 'cash',
      status: 'completed',
      createdBy: c.userId,
      cashSessionId: c.sessionId,
      createdAt: at,
      updatedAt: at,
    });
    await db.insert(salePayments).values({
      id: 'tfr-pay-c-cash',
      tenantId: c.tenantId,
      saleId: 'tfr-sale-c-cash',
      method: 'cash',
      amount: 45,
      createdAt: at,
    });

    const report = await computeComprehensiveDayCloseReport(db, {
      tenantId: c.tenantId,
      date: DAY,
      now: new Date('2026-07-15T12:00:00.000Z'),
    });

    expect(report.transferConfirmations).toMatchObject({
      reported: 0,
      confirmed: 0,
      pending: 0,
      rejected: 0,
      legacy: 0,
      unapplied: 0,
      destinations: [],
    });
    expect(report.sales.grossRevenue).toBe(45);
  });

  it('still parses a day-close snapshot signed before this section existed', () => {
    const legacySignedSnapshot = {
      date: DAY,
      timeZone: 'America/Bogota',
      currencyCode: 'COP',
      generatedAt: '2026-07-15T12:00:00.000Z',
      window: { start: '2026-07-14T05:00:00.000Z', endExclusive: '2026-07-15T05:00:00.000Z' },
      sales: {
        count: 1,
        subtotal: 80,
        discounts: 0,
        taxes: 0,
        tips: 0,
        serviceCharges: 0,
        grossRevenue: 100,
        refundAmount: 0,
        netRevenue: 100,
      },
      payments: [{ method: 'transfer', amount: 100, transactionCount: 1 }],
      cash: {
        closedSessions: 0,
        openSessions: 0,
        expected: 0,
        counted: 0,
        overShort: 0,
        balancedSessions: 0,
        discrepancySessions: 0,
      },
      fiscal: {
        total: 0,
        totalAmount: 0,
        byStatus: {
          pending: 0,
          sent: 0,
          accepted: 0,
          rejected: 0,
          contingency: 0,
          voided: 0,
          notified_correction: 0,
          partial_send: 0,
        },
      },
      adjustments: { voids: { count: 0, amount: 0 }, refunds: { count: 0, amount: 0 } },
      anomalies: {
        total: 0,
        high: 0,
        medium: 0,
        byKind: {
          ticketsPerHourSpike: 0,
          voidRate: 0,
          refundAmount: 0,
          noSaleSessions: 0,
        },
      },
      capabilities: { commissions: 'not_tracked', waste: 'not_tracked' },
      readiness: {
        readyToSign: true,
        blockers: [],
        warnings: ['commissions_not_tracked', 'waste_not_tracked'],
      },
    };

    const parsed = comprehensiveDayCloseReportOutput.safeParse(legacySignedSnapshot);
    // A signed snapshot that predates the section must keep verifying, or the
    // sign-off read path would report integrity failure on historical evidence.
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.transferConfirmations).toBeUndefined();
    }
  });

  it('keeps transfer evidence inside the tenant that owns it', async () => {
    const db = getDatabase();
    const d = await seedTenant('d');
    const e = await seedTenant('e');
    const at = '2026-07-14T14:00:00.000Z';
    await db.insert(sales).values({
      id: 'tfr-sale-e',
      tenantId: e.tenantId,
      saleNumber: 'TFR-E1',
      total: 70,
      paymentMethod: 'transfer',
      status: 'completed',
      createdBy: e.userId,
      cashSessionId: e.sessionId,
      createdAt: at,
      updatedAt: at,
    });
    await db.insert(salePayments).values({
      id: 'tfr-pay-e',
      tenantId: e.tenantId,
      saleId: 'tfr-sale-e',
      method: 'transfer',
      amount: 70,
      reference: 'REF-E',
      confirmationStatus: 'provider_confirmed',
      destinationSnapshot: BANK,
      transferDestinationId: BANK.id,
      createdAt: at,
    });

    const report = await computeComprehensiveDayCloseReport(db, {
      tenantId: d.tenantId,
      date: DAY,
      now: new Date('2026-07-15T12:00:00.000Z'),
    });

    expect(report.transferConfirmations).toMatchObject({
      reported: 0,
      confirmed: 0,
      pending: 0,
      destinations: [],
    });
    const storedE = db
      .select({ id: salePayments.id })
      .from(salePayments)
      .where(and(eq(salePayments.tenantId, e.tenantId), eq(salePayments.id, 'tfr-pay-e')))
      .get();
    expect(storedE?.id).toBe('tfr-pay-e');
  });
});
