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
import { planTransferAdjustment } from '../application/sales/transfer-adjustment.js';
import { writeAuditLog } from '../services/audit-logs.js';
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

describe('comprehensive day close — superseded tenders (S13)', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
  });

  afterAll(async () => {
    await server.close();
  });

  it('counts a tender the planner replaced exactly once', async () => {
    const db = getDatabase();
    const tenant = await seedTenant('s13');
    const at = '2026-07-14T14:00:00.000Z';

    // The real planner, not a hand-written fixture: a 100 tender verified at 40
    // is superseded and re-issued as a confirmed row plus a pending one.
    const plan = planTransferAdjustment({
      tenders: [{ method: 'transfer', amount: 100, reference: 'REF-SUP-ORIGINAL' }],
      targetIndex: 0,
      verifiedAmount: 40,
      reference: 'REF-SUP-VERIFIED',
      saleTotal: 100,
    });
    expect(plan.tenders.map(tender => [tender.confirmationStatus, tender.amount])).toEqual([
      ['manual_confirmed', 40],
      ['pending', 60],
    ]);
    expect(plan.activeTotal).toBe(100);
    expect(plan.matchesSaleTotal).toBe(true);

    await db.insert(sales).values({
      id: 's13-sale',
      tenantId: tenant.tenantId,
      saleNumber: 'S13-1',
      total: 100,
      paymentMethod: 'transfer',
      status: 'completed',
      createdBy: tenant.userId,
      cashSessionId: tenant.sessionId,
      createdAt: at,
      updatedAt: at,
    });
    await db.insert(salePayments).values([
      {
        id: 's13-pay-superseded',
        tenantId: tenant.tenantId,
        saleId: 's13-sale',
        method: 'transfer',
        amount: 100,
        reference: 'REF-SUP-ORIGINAL',
        confirmationStatus: 'rejected',
        destinationSnapshot: BANK,
        transferDestinationId: BANK.id,
        createdAt: at,
      },
      ...plan.tenders.map((tender, index) => ({
        id: `s13-pay-${index}`,
        tenantId: tenant.tenantId,
        saleId: 's13-sale',
        method: 'transfer' as const,
        amount: tender.amount,
        reference: tender.reference,
        confirmationStatus: tender.confirmationStatus ?? null,
        confirmationSource: tender.confirmationSource ?? null,
        destinationSnapshot: BANK,
        transferDestinationId: BANK.id,
        createdAt: at,
      })),
    ]);

    const report = await computeComprehensiveDayCloseReport(db, {
      tenantId: tenant.tenantId,
      date: DAY,
      now: new Date('2026-07-15T12:00:00.000Z'),
    });
    const transfers = report.transferConfirmations!;

    // The re-issued rows are the money that exists: 40 received, 60 still owed.
    expect(transfers.confirmed).toBe(40);
    expect(transfers.pending).toBe(60);
    // The superseded 100 is not money on either side any more. Counting it in
    // `rejected` (or in `reported`) would state 200 pesos of tender on a sale
    // that only ever asked for 100.
    expect(transfers.rejected).toBe(0);
    expect(transfers.reported).toBe(100);
    // Nothing is dropped either: the replaced amount is reported as evidence,
    // outside every money bucket.
    expect(transfers.superseded).toBe(100);
    expect(transfers.reported + transfers.superseded).toBe(200);
    expect(
      transfers.confirmed + transfers.pending + transfers.rejected + transfers.legacy
    ).toBe(transfers.reported);

    // One row per destino, counted once: the superseded row is not a tender of
    // this destination any more, and its reference is gone with it.
    const byDestination = new Map(transfers.destinations.map(row => [row.label, row]));
    expect(byDestination.get(BANK.label)).toMatchObject({
      confirmed: 40,
      pending: 60,
      count: 2,
      references: ['REF-SUP-VERIFIED'],
    });

    // The sale keeps its own numbers: no rewrite of revenue or cash.
    expect(report.sales.grossRevenue).toBe(100);
    expect(report.cash.expected).toBe(50);
    expect(report.cash.counted).toBe(50);
  });

  it('counts a replaced transfer once on a sale split with cash', async () => {
    const db = getDatabase();
    const tenant = await seedTenant('s13split');
    const at = '2026-07-14T14:00:00.000Z';

    // 100 sale: 50 in cash plus a 50 transfer verified at 20. The sale total is
    // already covered on the cash side, so a detector that only compares the
    // replaced row against the sale total would miss this one.
    const plan = planTransferAdjustment({
      tenders: [
        { method: 'cash', amount: 50, reference: null },
        { method: 'transfer', amount: 50, reference: 'REF-SPLIT-ORIGINAL' },
      ],
      targetIndex: 1,
      verifiedAmount: 20,
      reference: 'REF-SPLIT-VERIFIED',
      saleTotal: 100,
    });
    expect(plan.tenders.map(tender => [tender.method, tender.amount])).toEqual([
      ['cash', 50],
      ['transfer', 20],
      ['transfer', 30],
    ]);
    expect(plan.matchesSaleTotal).toBe(true);

    await db.insert(sales).values({
      id: 's13-split-sale',
      tenantId: tenant.tenantId,
      saleNumber: 'S13-2',
      total: 100,
      paymentMethod: 'transfer',
      status: 'completed',
      createdBy: tenant.userId,
      cashSessionId: tenant.sessionId,
      createdAt: at,
      updatedAt: at,
    });
    await db.insert(salePayments).values([
      {
        id: 's13-split-cash',
        tenantId: tenant.tenantId,
        saleId: 's13-split-sale',
        method: 'cash',
        amount: 50,
        createdAt: at,
      },
      {
        id: 's13-split-superseded',
        tenantId: tenant.tenantId,
        saleId: 's13-split-sale',
        method: 'transfer',
        amount: 50,
        reference: 'REF-SPLIT-ORIGINAL',
        confirmationStatus: 'rejected',
        destinationSnapshot: WALLET,
        transferDestinationId: WALLET.id,
        createdAt: at,
      },
      {
        id: 's13-split-confirmed',
        tenantId: tenant.tenantId,
        saleId: 's13-split-sale',
        method: 'transfer',
        amount: 20,
        reference: 'REF-SPLIT-VERIFIED',
        confirmationStatus: 'manual_confirmed',
        confirmationSource: 'operator',
        destinationSnapshot: WALLET,
        transferDestinationId: WALLET.id,
        createdAt: at,
      },
      {
        id: 's13-split-pending',
        tenantId: tenant.tenantId,
        saleId: 's13-split-sale',
        method: 'transfer',
        amount: 30,
        confirmationStatus: 'pending',
        destinationSnapshot: WALLET,
        transferDestinationId: WALLET.id,
        createdAt: at,
      },
    ]);

    const report = await computeComprehensiveDayCloseReport(db, {
      tenantId: tenant.tenantId,
      date: DAY,
      now: new Date('2026-07-15T12:00:00.000Z'),
    });
    const transfers = report.transferConfirmations!;

    expect(transfers.confirmed).toBe(20);
    expect(transfers.pending).toBe(30);
    expect(transfers.reported).toBe(50);
    expect(transfers.rejected).toBe(0);
    expect(transfers.superseded).toBe(50);
    expect(
      transfers.confirmed + transfers.pending + transfers.rejected + transfers.legacy
    ).toBe(transfers.reported);
    expect(new Map(transfers.destinations.map(row => [row.label, row])).get(WALLET.label)).toMatchObject(
      { confirmed: 20, pending: 30, count: 2 }
    );
    // The historical settlement block still reports every tender row of the day.
    expect(report.payments).toEqual([
      { method: 'cash', amount: 50, transactionCount: 1 },
      { method: 'transfer', amount: 100, transactionCount: 3 },
    ]);
  });
  it('does not count the same pesos twice when a late verdict reopens a superseded tender', async () => {
    const db = getDatabase();
    const tenant = await seedTenant('s13reopen');
    const at = '2026-07-14T14:00:00.000Z';
    const notAppliedAt = '2026-07-14T15:00:00.000Z';
    const reappliedAt = '2026-07-14T17:00:00.000Z';

    // The domain rule (`transfer-confirmation.ts` ALLOWED_TRANSITIONS) lets a late
    // authentic provider verdict reopen a rejected tender, but only into
    // `needs_reconciliation`. The original is therefore ACTIVE again while the
    // rows that replaced it are still there: 200 pesos of active tender on a
    // sale that only ever asked for 100.
    await db.insert(sales).values({
      id: 's13-reopen-sale',
      tenantId: tenant.tenantId,
      saleNumber: 'S13-3',
      total: 100,
      paymentMethod: 'transfer',
      status: 'completed',
      createdBy: tenant.userId,
      cashSessionId: tenant.sessionId,
      createdAt: at,
      updatedAt: at,
    });
    await db.insert(salePayments).values([
      {
        id: 's13-reopen-original',
        tenantId: tenant.tenantId,
        saleId: 's13-reopen-sale',
        method: 'transfer',
        amount: 100,
        reference: 'REF-REOPEN-ORIGINAL',
        confirmationStatus: 'needs_reconciliation',
        destinationSnapshot: BANK,
        transferDestinationId: BANK.id,
        createdAt: at,
      },
      {
        id: 's13-reopen-confirmed',
        tenantId: tenant.tenantId,
        saleId: 's13-reopen-sale',
        method: 'transfer',
        amount: 40,
        reference: 'REF-REOPEN-VERIFIED',
        confirmationStatus: 'manual_confirmed',
        confirmationSource: 'operator',
        destinationSnapshot: BANK,
        transferDestinationId: BANK.id,
        createdAt: at,
      },
      {
        id: 's13-reopen-pending',
        tenantId: tenant.tenantId,
        saleId: 's13-reopen-sale',
        method: 'transfer',
        amount: 60,
        confirmationStatus: 'pending',
        destinationSnapshot: BANK,
        transferDestinationId: BANK.id,
        createdAt: at,
      },
    ]);
    // Evidence that the original was dead when money was first recorded on it,
    // and that the same money was applied to it after the reopen.
    db.transaction(tx =>
      writeAuditLog({
        tx,
        tenantId: tenant.tenantId,
        actorId: tenant.managerId,
        action: 'sale_payment.transfer_manual_confirmed',
        resourceType: 'sale',
        resourceId: 's13-reopen-sale',
        after: {
          salePaymentId: 's13-reopen-original',
          verifiedAmount: 100,
          appliedAmount: 0,
          surplusAmount: 0,
          status: 'needs_reconciliation',
          notAppliedReason: 'tender_rejected',
          reference: 'REF-REOPEN-ORIGINAL',
          valueDate: notAppliedAt,
          note: null,
          idempotencyKey: null,
        },
        createdAt: notAppliedAt,
      })
    );
    db.transaction(tx =>
      writeAuditLog({
        tx,
        tenantId: tenant.tenantId,
        actorId: tenant.managerId,
        action: 'sale_payment.transfer_manual_confirmed',
        resourceType: 'sale',
        resourceId: 's13-reopen-sale',
        after: {
          salePaymentId: 's13-reopen-original',
          verifiedAmount: 100,
          appliedAmount: 100,
          surplusAmount: 0,
          status: 'manual_confirmed',
          reference: 'REF-REOPEN-ORIGINAL',
          valueDate: reappliedAt,
          note: null,
          idempotencyKey: 'reopen-key',
        },
        createdAt: reappliedAt,
      })
    );

    const report = await computeComprehensiveDayCloseReport(db, {
      tenantId: tenant.tenantId,
      date: DAY,
      now: new Date('2026-07-15T12:00:00.000Z'),
    });
    const transfers = report.transferConfirmations!;

    // The sale carries the distribution that replaced the original: 40 received
    // and 60 still owed. The reopened original is the same 100 pesos re-stated,
    // so it is evidence, not a second copy.
    expect(transfers.confirmed).toBe(40);
    expect(transfers.pending).toBe(60);
    expect(transfers.rejected).toBe(0);
    expect(transfers.reported).toBe(100);
    expect(transfers.superseded).toBe(100);
    expect(
      transfers.confirmed + transfers.pending + transfers.rejected + transfers.legacy
    ).toBe(transfers.reported);
    // Nothing is dropped: every transfer row of the day is in exactly one figure.
    expect(transfers.reported + transfers.superseded).toBe(200);

    // The movement was recorded twice (once while the tender was dead, once
    // after the reopen applied it) and it is money the tender DID absorb.
    // Counting it as not applied would state the same pesos a third time.
    expect(transfers.notApplied).toEqual({
      count: 0,
      amount: 0,
      byReason: {
        tender_rejected: { count: 0, amount: 0 },
        tender_cancelled: { count: 0, amount: 0 },
        other: { count: 0, amount: 0 },
      },
    });
    expect(transfers.unapplied).toBe(0);

    // The destination counts the money once as well.
    expect(new Map(transfers.destinations.map(row => [row.label, row])).get(BANK.label)).toMatchObject(
      { confirmed: 40, pending: 60, count: 2 }
    );
    expect(report.sales.grossRevenue).toBe(100);
  });

  it('supersedes a reopened tender from the money distribution alone', async () => {
    const db = getDatabase();
    const tenant = await seedTenant('s13dist');
    const at = '2026-07-14T14:00:00.000Z';

    // The reproduction an independent review reported: a late provider verdict
    // reopened the original into `needs_reconciliation`, and the close has NO
    // audit row that ever recorded money on it while it was dead. The audit
    // chain therefore proves nothing here, and only the sale's own money
    // distribution can tell that 40 + 60 already cover the 100 it asked for.
    await db.insert(sales).values({
      id: 's13-dist-sale',
      tenantId: tenant.tenantId,
      saleNumber: 'S13-4',
      total: 100,
      paymentMethod: 'transfer',
      status: 'completed',
      createdBy: tenant.userId,
      cashSessionId: tenant.sessionId,
      createdAt: at,
      updatedAt: at,
    });
    await db.insert(salePayments).values([
      {
        id: 's13-dist-original',
        tenantId: tenant.tenantId,
        saleId: 's13-dist-sale',
        method: 'transfer',
        amount: 100,
        reference: 'REF-DIST-ORIGINAL',
        confirmationStatus: 'needs_reconciliation',
        destinationSnapshot: BANK,
        transferDestinationId: BANK.id,
        createdAt: at,
      },
      {
        id: 's13-dist-confirmed',
        tenantId: tenant.tenantId,
        saleId: 's13-dist-sale',
        method: 'transfer',
        amount: 40,
        reference: 'REF-DIST-VERIFIED',
        confirmationStatus: 'manual_confirmed',
        confirmationSource: 'operator',
        destinationSnapshot: BANK,
        transferDestinationId: BANK.id,
        createdAt: at,
      },
      {
        id: 's13-dist-pending',
        tenantId: tenant.tenantId,
        saleId: 's13-dist-sale',
        method: 'transfer',
        amount: 60,
        confirmationStatus: 'pending',
        destinationSnapshot: BANK,
        transferDestinationId: BANK.id,
        createdAt: at,
      },
    ]);

    const report = await computeComprehensiveDayCloseReport(db, {
      tenantId: tenant.tenantId,
      date: DAY,
      now: new Date('2026-07-15T12:00:00.000Z'),
    });
    const transfers = report.transferConfirmations!;

    // The rows that replaced the original are the money that exists.
    expect(transfers.confirmed).toBe(40);
    expect(transfers.pending).toBe(60);
    expect(transfers.rejected).toBe(0);
    expect(transfers.legacy).toBe(0);
    // Before the distribution proof this close reported 200 on a 100 sale.
    expect(transfers.reported).toBe(100);
    expect(transfers.superseded).toBe(100);
    expect(transfers.saleTotal).toBe(100);
    // The ceiling: the buckets can never state more money than the sale asked
    // for, in either form of the same comparison.
    expect(
      transfers.confirmed + transfers.pending + transfers.rejected + transfers.legacy
    ).toBe(100);
    expect(transfers.reported).toBeLessThanOrEqual(transfers.saleTotal);
    // Nothing is hidden: every transfer row of the day is in exactly one figure.
    expect(transfers.reported + transfers.superseded).toBe(200);

    // The reopened row is evidence, not money: no bucket and no destination
    // counts it, and it never becomes unapplied money either.
    expect(transfers.unapplied).toBe(0);
    expect(transfers.notApplied).toEqual({
      count: 0,
      amount: 0,
      byReason: {
        tender_rejected: { count: 0, amount: 0 },
        tender_cancelled: { count: 0, amount: 0 },
        other: { count: 0, amount: 0 },
      },
    });
    expect(new Map(transfers.destinations.map(row => [row.label, row])).get(BANK.label)).toMatchObject(
      { confirmed: 40, pending: 60, count: 2 }
    );

    // Read-only blocks keep their historical meaning.
    expect(report.sales.grossRevenue).toBe(100);
    expect(report.cash.expected).toBe(50);
    expect(report.cash.counted).toBe(50);
    expect(report.payments).toEqual([{ method: 'transfer', amount: 200, transactionCount: 3 }]);
  });

  it('keeps a rejected or parked transfer the sale still needs', async () => {
    const db = getDatabase();
    const tenant = await seedTenant('s13keep');
    const at = '2026-07-14T14:00:00.000Z';

    // The other proof has to hold too: these rows are candidates by state, but
    // the sale's remaining tenders do NOT cover its total, so nothing replaced
    // them and their money is still missing.
    await db.insert(sales).values([
      {
        id: 's13-keep-sale-rejected',
        tenantId: tenant.tenantId,
        saleNumber: 'S13-5',
        total: 100,
        paymentMethod: 'transfer',
        status: 'completed',
        createdBy: tenant.userId,
        cashSessionId: tenant.sessionId,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: 's13-keep-sale-parked',
        tenantId: tenant.tenantId,
        saleNumber: 'S13-6',
        total: 100,
        paymentMethod: 'transfer',
        status: 'completed',
        createdBy: tenant.userId,
        cashSessionId: tenant.sessionId,
        createdAt: at,
        updatedAt: at,
      },
    ]);
    await db.insert(salePayments).values([
      // 60 transfer rejected and 40 in cash: the cash does not cover the sale,
      // so the rejected 60 is money the store never received.
      {
        id: 's13-keep-rejected',
        tenantId: tenant.tenantId,
        saleId: 's13-keep-sale-rejected',
        method: 'transfer',
        amount: 60,
        reference: 'REF-KEEP-REJECTED',
        confirmationStatus: 'rejected',
        destinationSnapshot: BANK,
        transferDestinationId: BANK.id,
        createdAt: at,
      },
      {
        id: 's13-keep-cash',
        tenantId: tenant.tenantId,
        saleId: 's13-keep-sale-rejected',
        method: 'cash',
        amount: 40,
        createdAt: at,
      },
      // A shortfall parked for a human, plus the rest still pending: the parked
      // claim is the money of this sale, not a leftover copy of it.
      {
        id: 's13-keep-parked',
        tenantId: tenant.tenantId,
        saleId: 's13-keep-sale-parked',
        method: 'transfer',
        amount: 60,
        reference: 'REF-KEEP-PARKED',
        confirmationStatus: 'needs_reconciliation',
        destinationSnapshot: WALLET,
        transferDestinationId: WALLET.id,
        createdAt: at,
      },
      {
        id: 's13-keep-pending',
        tenantId: tenant.tenantId,
        saleId: 's13-keep-sale-parked',
        method: 'transfer',
        amount: 40,
        confirmationStatus: 'pending',
        destinationSnapshot: WALLET,
        transferDestinationId: WALLET.id,
        createdAt: at,
      },
    ]);

    const report = await computeComprehensiveDayCloseReport(db, {
      tenantId: tenant.tenantId,
      date: DAY,
      now: new Date('2026-07-15T12:00:00.000Z'),
    });
    const transfers = report.transferConfirmations!;

    expect(transfers.confirmed).toBe(0);
    // 60 parked + 40 pending on one sale, and the rejected 60 on the other.
    expect(transfers.pending).toBe(100);
    expect(transfers.rejected).toBe(60);
    expect(transfers.legacy).toBe(0);
    expect(transfers.reported).toBe(160);
    expect(transfers.superseded).toBe(0);
    expect(transfers.saleTotal).toBe(200);
    expect(transfers.reported + transfers.superseded).toBe(160);
    expect(
      transfers.confirmed + transfers.pending + transfers.rejected + transfers.legacy
    ).toBe(160);
    // The rejected money stays visible per status too, so the operator can find
    // the tender that still needs a decision.
    expect(transfers.byStatus.rejected).toBe(1);
    expect(transfers.byStatus.needs_reconciliation).toBe(1);
    expect(report.sales.grossRevenue).toBe(200);
    expect(report.payments).toEqual([
      { method: 'cash', amount: 40, transactionCount: 1 },
      { method: 'transfer', amount: 160, transactionCount: 3 },
    ]);
  });

  it('supersedes the second of two dead rows that state the whole sale', async () => {
    const db = getDatabase();
    const tenant = await seedTenant('s13double');
    const at = '2026-07-14T14:00:00.000Z';

    // A 100 sale with two rejected 100 rows: the sale can only have owed 100, so
    // one of the two is a copy. Counting both would state 200 of a 100 sale.
    await db.insert(sales).values({
      id: 's13-double-sale',
      tenantId: tenant.tenantId,
      saleNumber: 'S13-7',
      total: 100,
      paymentMethod: 'transfer',
      status: 'completed',
      createdBy: tenant.userId,
      cashSessionId: tenant.sessionId,
      createdAt: at,
      updatedAt: at,
    });
    await db.insert(salePayments).values([
      {
        id: 's13-double-first',
        tenantId: tenant.tenantId,
        saleId: 's13-double-sale',
        method: 'transfer',
        amount: 100,
        reference: 'REF-DOUBLE-FIRST',
        confirmationStatus: 'rejected',
        destinationSnapshot: BANK,
        transferDestinationId: BANK.id,
        createdAt: at,
      },
      {
        id: 's13-double-second',
        tenantId: tenant.tenantId,
        saleId: 's13-double-sale',
        method: 'transfer',
        amount: 100,
        reference: 'REF-DOUBLE-SECOND',
        confirmationStatus: 'cancelled',
        destinationSnapshot: BANK,
        transferDestinationId: BANK.id,
        createdAt: at,
      },
    ]);

    const report = await computeComprehensiveDayCloseReport(db, {
      tenantId: tenant.tenantId,
      date: DAY,
      now: new Date('2026-07-15T12:00:00.000Z'),
    });
    const transfers = report.transferConfirmations!;

    expect(transfers.rejected).toBe(100);
    expect(transfers.superseded).toBe(100);
    expect(transfers.reported).toBe(100);
    expect(transfers.reported).toBeLessThanOrEqual(transfers.saleTotal);
    expect(
      transfers.confirmed + transfers.pending + transfers.rejected + transfers.legacy
    ).toBe(100);
    expect(transfers.reported + transfers.superseded).toBe(200);
    expect(transfers.unapplied).toBe(0);
    expect(report.sales.grossRevenue).toBe(100);
  });

  it('never states more transfer money than the sale when dead rows over-subscribe it', async () => {
    const db = getDatabase();
    const tenant = await seedTenant('s13over');
    const at = '2026-07-14T14:00:00.000Z';

    // Two independent rejected attempts of 60 on a 100 sale: neither one alone
    // covers the sale, and together they ask for more than it ever did. The
    // buckets keep the money the sale still needs and stop at its total; the
    // row that has no room is evidence, so 120 of dead rows reads as 60 owed.
    await db.insert(sales).values({
      id: 's13-over-sale',
      tenantId: tenant.tenantId,
      saleNumber: 'S13-8',
      total: 100,
      paymentMethod: 'transfer',
      status: 'completed',
      createdBy: tenant.userId,
      cashSessionId: tenant.sessionId,
      createdAt: at,
      updatedAt: at,
    });
    await db.insert(salePayments).values([
      {
        id: 's13-over-first',
        tenantId: tenant.tenantId,
        saleId: 's13-over-sale',
        method: 'transfer',
        amount: 60,
        reference: 'REF-OVER-FIRST',
        confirmationStatus: 'rejected',
        destinationSnapshot: BANK,
        transferDestinationId: BANK.id,
        createdAt: at,
      },
      {
        id: 's13-over-second',
        tenantId: tenant.tenantId,
        saleId: 's13-over-sale',
        method: 'transfer',
        amount: 60,
        reference: 'REF-OVER-SECOND',
        confirmationStatus: 'cancelled',
        destinationSnapshot: BANK,
        transferDestinationId: BANK.id,
        createdAt: at,
      },
    ]);

    const report = await computeComprehensiveDayCloseReport(db, {
      tenantId: tenant.tenantId,
      date: DAY,
      now: new Date('2026-07-15T12:00:00.000Z'),
    });
    const transfers = report.transferConfirmations!;

    expect(transfers.rejected).toBe(60);
    expect(transfers.superseded).toBe(60);
    expect(transfers.reported).toBe(60);
    expect(transfers.pending).toBe(0);
    expect(transfers.confirmed).toBe(0);
    expect(transfers.legacy).toBe(0);
    expect(transfers.reported).toBeLessThanOrEqual(transfers.saleTotal);
    expect(
      transfers.confirmed + transfers.pending + transfers.rejected + transfers.legacy
    ).toBe(60);
    expect(transfers.reported + transfers.superseded).toBe(120);
    expect(report.sales.grossRevenue).toBe(100);
    expect(report.payments).toEqual([{ method: 'transfer', amount: 120, transactionCount: 2 }]);
  });
});

describe('comprehensive day close — deposits no tender absorbed (S11)', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
  });

  afterAll(async () => {
    await server.close();
  });

  it('reports money received against a rejected or cancelled tender as its own bucket', async () => {
    const db = getDatabase();
    const tenant = await seedTenant('s11');
    const foreign = await seedTenant('s11foreign');
    const at = '2026-07-14T14:00:00.000Z';

    await db.insert(sales).values([
      {
        id: 's11-sale-rejected',
        tenantId: tenant.tenantId,
        saleNumber: 'S11-1',
        total: 30,
        paymentMethod: 'transfer',
        status: 'completed',
        createdBy: tenant.userId,
        cashSessionId: tenant.sessionId,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: 's11-sale-cancelled',
        tenantId: tenant.tenantId,
        saleNumber: 'S11-2',
        total: 20,
        paymentMethod: 'transfer',
        status: 'completed',
        createdBy: tenant.userId,
        cashSessionId: tenant.sessionId,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: 's11-sale-confirmed',
        tenantId: tenant.tenantId,
        saleNumber: 'S11-3',
        total: 100,
        paymentMethod: 'transfer',
        status: 'completed',
        createdBy: tenant.userId,
        cashSessionId: tenant.sessionId,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: 's11-sale-foreign',
        tenantId: foreign.tenantId,
        saleNumber: 'S11-F',
        total: 500,
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
        id: 's11-pay-rejected',
        tenantId: tenant.tenantId,
        saleId: 's11-sale-rejected',
        method: 'transfer',
        amount: 30,
        reference: 'REF-REJECTED',
        confirmationStatus: 'rejected',
        destinationSnapshot: BANK,
        transferDestinationId: BANK.id,
        createdAt: at,
      },
      {
        id: 's11-pay-cancelled',
        tenantId: tenant.tenantId,
        saleId: 's11-sale-cancelled',
        method: 'transfer',
        amount: 20,
        reference: 'REF-CANCELLED',
        confirmationStatus: 'cancelled',
        destinationSnapshot: BANK,
        transferDestinationId: BANK.id,
        createdAt: at,
      },
      {
        id: 's11-pay-confirmed',
        tenantId: tenant.tenantId,
        saleId: 's11-sale-confirmed',
        method: 'transfer',
        amount: 100,
        reference: 'REF-CONFIRMED',
        confirmationStatus: 'manual_confirmed',
        confirmationSource: 'operator',
        destinationSnapshot: WALLET,
        transferDestinationId: WALLET.id,
        createdAt: at,
      },
      {
        id: 's11-pay-foreign',
        tenantId: foreign.tenantId,
        saleId: 's11-sale-foreign',
        method: 'transfer',
        amount: 500,
        reference: 'REF-FOREIGN',
        confirmationStatus: 'rejected',
        createdAt: at,
      },
    ]);

    // The deposit write path that records a not-applied movement is not in this
    // working tree yet, so the evidence is written the way the domain contract
    // (K6) prescribes: through the audit service, inside a transaction.
    const deposit = (args: {
      tenantId: string;
      actorId: string;
      saleId: string;
      salePaymentId: string;
      verifiedAmount: number;
      appliedAmount: number;
      surplusAmount: number;
      notAppliedReason?: string;
      createdAt?: string;
    }) =>
      db.transaction(tx =>
        writeAuditLog({
          tx,
          tenantId: args.tenantId,
          actorId: args.actorId,
          action: 'sale_payment.transfer_manual_confirmed',
          resourceType: 'sale',
          resourceId: args.saleId,
          after: {
            salePaymentId: args.salePaymentId,
            verifiedAmount: args.verifiedAmount,
            appliedAmount: args.appliedAmount,
            surplusAmount: args.surplusAmount,
            status: 'needs_reconciliation',
            ...(args.notAppliedReason ? { notAppliedReason: args.notAppliedReason } : {}),
            reference: 'REF-DEPOSIT',
            valueDate: at,
            note: null,
            idempotencyKey: null,
          },
          createdAt: args.createdAt ?? at,
        })
      );

    // Two movements against a rejected tender and one against a cancelled one:
    // the money arrived and no tender absorbed it.
    deposit({
      tenantId: tenant.tenantId,
      actorId: tenant.managerId,
      saleId: 's11-sale-rejected',
      salePaymentId: 's11-pay-rejected',
      verifiedAmount: 30,
      appliedAmount: 0,
      surplusAmount: 0,
      notAppliedReason: 'tender_rejected',
    });
    deposit({
      tenantId: tenant.tenantId,
      actorId: tenant.managerId,
      saleId: 's11-sale-rejected',
      salePaymentId: 's11-pay-rejected',
      verifiedAmount: 10,
      appliedAmount: 0,
      surplusAmount: 0,
      notAppliedReason: 'tender_rejected',
    });
    deposit({
      tenantId: tenant.tenantId,
      actorId: tenant.managerId,
      saleId: 's11-sale-cancelled',
      salePaymentId: 's11-pay-cancelled',
      verifiedAmount: 20,
      appliedAmount: 0,
      surplusAmount: 0,
      notAppliedReason: 'tender_cancelled',
    });
    // A normal movement with a real surplus: it belongs to `unapplied`, not here.
    deposit({
      tenantId: tenant.tenantId,
      actorId: tenant.managerId,
      saleId: 's11-sale-confirmed',
      salePaymentId: 's11-pay-confirmed',
      verifiedAmount: 120,
      appliedAmount: 100,
      surplusAmount: 20,
    });
    // Evidence outside the day window, and evidence from another tenant.
    deposit({
      tenantId: tenant.tenantId,
      actorId: tenant.managerId,
      saleId: 's11-sale-rejected',
      salePaymentId: 's11-pay-rejected',
      verifiedAmount: 5,
      appliedAmount: 0,
      surplusAmount: 0,
      notAppliedReason: 'tender_rejected',
      createdAt: '2026-07-13T14:00:00.000Z',
    });
    deposit({
      tenantId: foreign.tenantId,
      actorId: foreign.managerId,
      saleId: 's11-sale-foreign',
      salePaymentId: 's11-pay-foreign',
      verifiedAmount: 500,
      appliedAmount: 0,
      surplusAmount: 0,
      notAppliedReason: 'tender_rejected',
    });
    // A reason this build does not know still means "recorded, never applied":
    // the money is counted, and the split keeps a catch-all instead of losing it.
    deposit({
      tenantId: tenant.tenantId,
      actorId: tenant.managerId,
      saleId: 's11-sale-rejected',
      salePaymentId: 's11-pay-rejected',
      verifiedAmount: 7,
      appliedAmount: 0,
      surplusAmount: 0,
      notAppliedReason: 'operator_typo',
    });

    const report = await computeComprehensiveDayCloseReport(db, {
      tenantId: tenant.tenantId,
      date: DAY,
      now: new Date('2026-07-15T12:00:00.000Z'),
    });
    const transfers = report.transferConfirmations!;

    // Money that arrived and was not applied to any tender: its own bucket,
    // split by why, and never inside another figure.
    expect(transfers.notApplied).toEqual({
      count: 4,
      amount: 67,
      byReason: {
        tender_rejected: { count: 2, amount: 40 },
        tender_cancelled: { count: 1, amount: 20 },
        other: { count: 1, amount: 7 },
      },
    });
    // The surplus bucket keeps its own meaning: money above a tender that WAS
    // applied to its sale.
    expect(transfers.unapplied).toBe(20);

    // The tender buckets are untouched by the not-applied deposits: the tender
    // rows themselves were never modified.
    expect(transfers.confirmed).toBe(100);
    expect(transfers.pending).toBe(0);
    expect(transfers.legacy).toBe(0);
    expect(transfers.rejected).toBe(50);
    expect(transfers.reported).toBe(150);
    expect(
      transfers.confirmed + transfers.pending + transfers.rejected + transfers.legacy
    ).toBe(transfers.reported);
    // Not-applied money is disjoint from every tender bucket and from surplus.
    expect(transfers.notApplied.amount).not.toBe(transfers.unapplied);
    expect(transfers.reported + transfers.notApplied.amount).toBe(217);

    // Neither gross revenue nor physical cash moves because of the bucket.
    expect(report.sales.grossRevenue).toBe(150);
    expect(report.cash.expected).toBe(50);
    expect(report.cash.counted).toBe(50);
    expect(report.cash.overShort).toBe(0);
    // ...and the sale rows keep the totals the register wrote.
    const storedTotals = db
      .select({ id: sales.id, total: sales.total })
      .from(sales)
      .where(eq(sales.tenantId, tenant.tenantId))
      .all()
      .sort((left, right) => left.id.localeCompare(right.id));
    expect(storedTotals.map(row => [row.id, row.total])).toEqual([
      ['s11-sale-cancelled', 20],
      ['s11-sale-confirmed', 100],
      ['s11-sale-rejected', 30],
    ]);
  });

  it('keeps a not-applied movement that arrived after the money was applied', async () => {
    const db = getDatabase();
    const tenant = await seedTenant('s11order');
    const at = '2026-07-14T14:00:00.000Z';
    const appliedAt = '2026-07-14T15:00:00.000Z';
    const lateAt = '2026-07-14T16:00:00.000Z';

    // The ordering is the whole point: only a movement recorded LATER than the
    // applied one proves the not-applied money was re-applied. Here the applied
    // movement comes first, so the late arrival is genuinely new money that no
    // tender absorbed and must stay in the bucket.
    await db.insert(sales).values({
      id: 's11-order-sale',
      tenantId: tenant.tenantId,
      saleNumber: 'S11-4',
      total: 100,
      paymentMethod: 'transfer',
      status: 'completed',
      createdBy: tenant.userId,
      cashSessionId: tenant.sessionId,
      createdAt: at,
      updatedAt: at,
    });
    await db.insert(salePayments).values({
      id: 's11-order-pay',
      tenantId: tenant.tenantId,
      saleId: 's11-order-sale',
      method: 'transfer',
      amount: 100,
      reference: 'REF-ORDER',
      confirmationStatus: 'rejected',
      destinationSnapshot: BANK,
      transferDestinationId: BANK.id,
      createdAt: at,
    });
    for (const [createdAt, payload] of [
      [appliedAt, { verifiedAmount: 30, appliedAmount: 30, surplusAmount: 0 }],
      [
        lateAt,
        {
          verifiedAmount: 50,
          appliedAmount: 0,
          surplusAmount: 0,
          notAppliedReason: 'tender_rejected',
        },
      ],
    ] as const) {
      db.transaction(tx =>
        writeAuditLog({
          tx,
          tenantId: tenant.tenantId,
          actorId: tenant.managerId,
          action: 'sale_payment.transfer_manual_confirmed',
          resourceType: 'sale',
          resourceId: 's11-order-sale',
          after: {
            salePaymentId: 's11-order-pay',
            status: 'needs_reconciliation',
            reference: 'REF-ORDER',
            valueDate: createdAt,
            note: null,
            idempotencyKey: null,
            ...payload,
          },
          createdAt,
        })
      );
    }

    const report = await computeComprehensiveDayCloseReport(db, {
      tenantId: tenant.tenantId,
      date: DAY,
      now: new Date('2026-07-15T12:00:00.000Z'),
    });
    const transfers = report.transferConfirmations!;

    expect(transfers.notApplied).toEqual({
      count: 1,
      amount: 50,
      byReason: {
        tender_rejected: { count: 1, amount: 50 },
        tender_cancelled: { count: 0, amount: 0 },
        other: { count: 0, amount: 0 },
      },
    });
    // The tender itself was never replaced, so its 100 is still owed evidence.
    expect(transfers.rejected).toBe(100);
    expect(transfers.reported).toBe(100);
    expect(transfers.superseded).toBe(0);
  });
});

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

  it('still parses a signed snapshot from before the not-applied bucket', () => {
    // A close signed after the transfer section existed but before this change
    // carries the section without the newer fields. Requiring them would turn
    // historical evidence into an integrity failure.
    const section = {
      saleTotal: 100,
      reported: 100,
      confirmed: 40,
      pending: 60,
      rejected: 0,
      legacy: 0,
      unapplied: 0,
      byStatus: {
        pending: 1,
        customer_reported: 0,
        manual_confirmed: 1,
        provider_confirmed: 0,
        rejected: 0,
        needs_reconciliation: 0,
        cancelled: 0,
        legacy: 0,
      },
      destinations: [],
    };
    const parsed = comprehensiveDayCloseReportOutput.safeParse({
      date: DAY,
      timeZone: 'America/Bogota',
      currencyCode: 'COP',
      generatedAt: '2026-07-15T12:00:00.000Z',
      window: { start: '2026-07-14T05:00:00.000Z', endExclusive: '2026-07-15T05:00:00.000Z' },
      sales: {
        count: 1,
        subtotal: 100,
        discounts: 0,
        taxes: 0,
        tips: 0,
        serviceCharges: 0,
        grossRevenue: 100,
        refundAmount: 0,
        netRevenue: 100,
      },
      payments: [{ method: 'transfer', amount: 100, transactionCount: 1 }],
      transferConfirmations: section,
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
        byKind: { ticketsPerHourSpike: 0, voidRate: 0, refundAmount: 0, noSaleSessions: 0 },
      },
      capabilities: { commissions: 'not_tracked', waste: 'not_tracked' },
      readiness: {
        readyToSign: true,
        blockers: [],
        warnings: ['commissions_not_tracked', 'waste_not_tracked'],
      },
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.transferConfirmations?.superseded).toBeUndefined();
      expect(parsed.data.transferConfirmations?.notApplied).toBeUndefined();
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
