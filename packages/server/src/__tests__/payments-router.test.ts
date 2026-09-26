/**
 * `payments.*` tRPC router integration tests.
 *
 * Drives the read-only Operations Center payment rail surface against
 * an in-memory DB.
 */

import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  cashSessions,
  companies,
  paymentOutbox,
  paymentReconciliationProposals,
  salePayments,
  sales,
  sites,
  tenants,
  users,
  type PaymentRailId,
} from '../db/schema.js';
import { PAYMENT_RAIL_IDS } from '../services/payments/manifest.js';
import { savePaymentProposal } from '../services/payments/reconciliation/proposals.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;

interface RouterHarness {
  tenantId: string;
  adminId: string;
  managerId: string;
  cashierId: string;
}

async function seedHarness(suffix: string): Promise<RouterHarness> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `payments-rtr-tenant-${suffix}`;
  const adminId = `payments-rtr-admin-${suffix}`;
  const managerId = `payments-rtr-mgr-${suffix}`;
  const cashierId = `payments-rtr-csh-${suffix}`;

  await db.insert(tenants).values({
    id: tenantId,
    name: `PaymentsRtr Tenant ${suffix}`,
    slug: `payments-rtr-${suffix}`,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values([
    {
      id: adminId,
      tenantId,
      email: `admin-${suffix}@paymentsrtr.test`,
      name: `Admin ${suffix}`,
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: managerId,
      tenantId,
      email: `mgr-${suffix}@paymentsrtr.test`,
      name: `Manager ${suffix}`,
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'manager',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: cashierId,
      tenantId,
      email: `csh-${suffix}@paymentsrtr.test`,
      name: `Cashier ${suffix}`,
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  // `sales` now enforces `cash_session_id IS NOT NULL OR
  // status = 'draft'`. The reconciliation fixtures insert completed
  // sales directly, so seed a company + site + closed session and stamp
  // it on every fixture sale (the reconciler matches by sale_payment ↔
  // payment_outbox, so the specific session is irrelevant here).
  const companyId = `payments-rtr-co-${suffix}`;
  const siteId = `payments-rtr-site-${suffix}`;
  const cashSessionId = `payments-rtr-cs-${suffix}`;
  await db.insert(companies).values({
    id: companyId,
    tenantId,
    name: `PaymentsRtr Co ${suffix}`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(sites).values({
    id: siteId,
    tenantId,
    companyId,
    name: `PaymentsRtr Site ${suffix}`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(cashSessions).values({
    id: cashSessionId,
    tenantId,
    siteId,
    cashierId,
    registerName: `reg-${suffix}`,
    openingFloat: 0,
    openingCountDenominations: [],
    expectedBalance: 0,
    status: 'closed',
    openedAt: now,
    closedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  cashSessionByTenant.set(tenantId, cashSessionId);
  return { tenantId, adminId, managerId, cashierId };
}

// maps each seeded tenant to its fixture cash session so
// `insertSalePayment` can satisfy the committed-sale CHECK constraint.
const cashSessionByTenant = new Map<string, string>();

async function insertSalePayment(args: {
  tenantId: string;
  adminId: string;
  saleId: string;
  salePaymentId: string;
  method: 'cash' | 'card' | 'transfer' | 'credit' | 'other';
  amount: number;
  reference?: string | null;
  createdAt?: string;
}): Promise<void> {
  const db = getDatabase();
  const createdAt = args.createdAt ?? new Date().toISOString();
  await db.insert(sales).values({
    id: args.saleId,
    tenantId: args.tenantId,
    saleNumber: `${args.saleId.toUpperCase()}-001`,
    subtotal: args.amount,
    taxAmount: 0,
    discountAmount: 0,
    total: args.amount,
    paymentMethod: args.method,
    paymentStatus: 'paid',
    status: 'completed',
    cashSessionId: cashSessionByTenant.get(args.tenantId) ?? null,
    createdBy: args.adminId,
    createdAt,
    updatedAt: createdAt,
  });
  await db.insert(salePayments).values({
    id: args.salePaymentId,
    tenantId: args.tenantId,
    saleId: args.saleId,
    method: args.method,
    amount: args.amount,
    reference: args.reference ?? null,
    createdAt,
  });
}

async function insertPaymentOutboxRow(args: {
  tenantId: string;
  id: string;
  railId: PaymentRailId;
  salePaymentId?: string | null;
  status?: 'queued' | 'approved' | 'declined' | 'timeout' | 'retrying' | 'dead_letter';
  amount?: number;
  reference?: string;
  priority?: number;
  providerTransactionId?: string | null;
  createdAt?: string;
}): Promise<void> {
  const db = getDatabase();
  const now = args.createdAt ?? new Date().toISOString();
  await db.insert(paymentOutbox).values({
    id: args.id,
    tenantId: args.tenantId,
    salePaymentId: args.salePaymentId ?? null,
    railId: args.railId,
    kind: 'charge',
    status: args.status ?? 'queued',
    amount: args.amount ?? 100_000,
    currencyCode: 'COP',
    reference: args.reference ?? args.id,
    providerTransactionId: args.providerTransactionId ?? null,
    payload: { fixture: true },
    payloadVersion: 1,
    attempts: 0,
    nextRetryAt: null,
    lastError: null,
    priority: args.priority ?? 0,
    claimToken: null,
    lockedAt: null,
    idempotencyKey: null,
    createdAt: now,
    updatedAt: now,
  });
}

function buildCtx(
  tenantId: string,
  userId: string,
  role: 'admin' | 'manager' | 'cashier' | 'viewer'
): Context {
  const db = getDatabase();
  const mockReq = {
    server: server.app,
    headers: {},
    user: { userId, email: `${userId}@paymentsrtr.test`, role, tenantId },
    jwtVerify: async () => {},
  } as unknown as Context['req'];
  return {
    req: mockReq,
    res: {} as unknown as Context['res'],
    db,
    user: {
      id: userId,
      email: `${userId}@paymentsrtr.test`,
      role,
      tenantId,
    },
    tenantId,
    siteId: null,
  };
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});

afterAll(async () => {
  await server.close();
});

describe('payments.getContract', () => {
  it('returns the manifest version + every rail id', async () => {
    const h = await seedHarness('contract');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const result = await caller.payments.getContract();
    expect(result.version).toBe(1);
    expect([...result.railIds].sort()).toEqual([...PAYMENT_RAIL_IDS].sort());
  });

  it('manager can call and cashier is forbidden', async () => {
    const h = await seedHarness('contract-gate');
    const manager = appRouter.createCaller(buildCtx(h.tenantId, h.managerId, 'manager'));
    const cashier = appRouter.createCaller(buildCtx(h.tenantId, h.cashierId, 'cashier'));
    await expect(manager.payments.getContract()).resolves.toBeDefined();
    await expect(cashier.payments.getContract()).rejects.toBeInstanceOf(TRPCError);
  });
});

describe('payments.peekOutbox', () => {
  it('returns inserted rows ordered by priority desc, createdAt asc', async () => {
    const h = await seedHarness('peek-ordered');
    await insertPaymentOutboxRow({
      tenantId: h.tenantId,
      id: 'payment-low',
      railId: 'wompi',
      priority: 1,
      createdAt: '2026-05-10T10:00:00.000Z',
    });
    await insertPaymentOutboxRow({
      tenantId: h.tenantId,
      id: 'payment-high-old',
      railId: 'bold',
      priority: 5,
      createdAt: '2026-05-10T09:00:00.000Z',
    });
    await insertPaymentOutboxRow({
      tenantId: h.tenantId,
      id: 'payment-high-new',
      railId: 'epayco',
      priority: 5,
      createdAt: '2026-05-10T10:30:00.000Z',
    });

    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const rows = await caller.payments.peekOutbox({ limit: 50 });
    expect(rows.map(row => row.id)).toEqual([
      'payment-high-old',
      'payment-high-new',
      'payment-low',
    ]);
  });

  it('isolates tenants', async () => {
    const a = await seedHarness('iso-a');
    const b = await seedHarness('iso-b');
    await insertPaymentOutboxRow({
      tenantId: a.tenantId,
      id: 'payment-a',
      railId: 'wompi',
    });
    await insertPaymentOutboxRow({
      tenantId: b.tenantId,
      id: 'payment-b',
      railId: 'bold',
    });

    const caller = appRouter.createCaller(buildCtx(a.tenantId, a.adminId, 'admin'));
    const rows = await caller.payments.peekOutbox({ limit: 50 });
    expect(rows.map(row => row.id)).toEqual(['payment-a']);
  });
});

describe('payments.reconciliation', () => {
  it('flags non-cash tenders without provider rows and ignores cash', async () => {
    const h = await seedHarness('recon-missing');
    await insertSalePayment({
      tenantId: h.tenantId,
      adminId: h.adminId,
      saleId: 'sale-missing-card',
      salePaymentId: 'sale-payment-missing-card',
      method: 'card',
      amount: 80_000,
      reference: 'AUTH-MISSING',
    });
    await insertSalePayment({
      tenantId: h.tenantId,
      adminId: h.adminId,
      saleId: 'sale-cash',
      salePaymentId: 'sale-payment-cash',
      method: 'cash',
      amount: 20_000,
      reference: null,
    });

    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const result = await caller.payments.reconciliation({ limit: 50 });
    expect(result.summary.tendersScanned).toBe(1);
    expect(result.summary.missingProviderReferences).toBe(1);
    expect(result.mismatches).toEqual([
      expect.objectContaining({
        type: 'missing_provider_reference',
        salePaymentId: 'sale-payment-missing-card',
        suggestedAction: 'queue_charge',
      }),
    ]);
  });

  it('flags provider issues, amount mismatches and orphan provider rows', async () => {
    const h = await seedHarness('recon-issues');
    await insertSalePayment({
      tenantId: h.tenantId,
      adminId: h.adminId,
      saleId: 'sale-declined-card',
      salePaymentId: 'sale-payment-declined-card',
      method: 'card',
      amount: 100_000,
      reference: 'AUTH-DECLINED',
    });
    await insertPaymentOutboxRow({
      tenantId: h.tenantId,
      id: 'payment-declined-mismatch',
      railId: 'wompi',
      salePaymentId: 'sale-payment-declined-card',
      status: 'declined',
      amount: 95_000,
      reference: 'AUTH-DECLINED',
      providerTransactionId: 'wompi-declined-1',
    });
    await insertPaymentOutboxRow({
      tenantId: h.tenantId,
      id: 'payment-orphan',
      railId: 'bold',
      salePaymentId: null,
      status: 'approved',
      amount: 10_000,
      reference: 'UNLINKED',
      providerTransactionId: 'bold-approved-1',
    });

    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const result = await caller.payments.reconciliation({ limit: 50 });
    expect(result.summary.matched).toBe(1);
    expect(result.summary.providerIssues).toBe(1);
    expect(result.summary.mismatches).toBe(3);
    expect(result.byRail.find(row => row.railId === 'wompi')).toMatchObject({
      outboxRows: 1,
      issues: 1,
    });
    expect(result.mismatches.map(row => row.type).sort()).toEqual([
      'amount_mismatch',
      'orphan_provider_row',
      'provider_issue',
    ]);
  });
});

describe('payment_outbox idempotency invariant', () => {
  it('rejects a duplicate (tenant_id, rail_id, kind, idempotency_key) insert via the partial unique index', async () => {
    const h = await seedHarness('idem');
    const db = getDatabase();
    const now = new Date().toISOString();
    await db.insert(paymentOutbox).values({
      id: 'payment-idem-1',
      tenantId: h.tenantId,
      salePaymentId: null,
      railId: 'wompi',
      kind: 'charge',
      status: 'queued',
      amount: 50_000,
      currencyCode: 'COP',
      reference: 'IDEM-1',
      providerTransactionId: null,
      payload: { fixture: true },
      payloadVersion: 1,
      attempts: 0,
      nextRetryAt: null,
      lastError: null,
      priority: 0,
      claimToken: null,
      lockedAt: null,
      idempotencyKey: 'envelope-1',
      createdAt: now,
      updatedAt: now,
    });
    await expect(
      db.insert(paymentOutbox).values({
        id: 'payment-idem-2',
        tenantId: h.tenantId,
        salePaymentId: null,
        railId: 'wompi',
        kind: 'charge',
        status: 'queued',
        amount: 50_000,
        currencyCode: 'COP',
        reference: 'IDEM-2',
        providerTransactionId: null,
        payload: { fixture: true },
        payloadVersion: 1,
        attempts: 0,
        nextRetryAt: null,
        lastError: null,
        priority: 0,
        claimToken: null,
        lockedAt: null,
        idempotencyKey: 'envelope-1',
        createdAt: now,
        updatedAt: now,
      })
    ).rejects.toThrow(/UNIQUE constraint failed/i);
  });

  it('allows duplicate inserts when idempotency_key is null (partial index does not apply)', async () => {
    const h = await seedHarness('idem-null');
    await insertPaymentOutboxRow({
      tenantId: h.tenantId,
      id: 'payment-null-1',
      railId: 'bold',
    });
    await expect(
      insertPaymentOutboxRow({
        tenantId: h.tenantId,
        id: 'payment-null-2',
        railId: 'bold',
      })
    ).resolves.toBeUndefined();
  });
});

describe('payments AI proposal review', () => {
  async function seedProposal(suffix: string) {
    const h = await seedHarness(suffix);
    const outboxId = `proposal-outbox-${suffix}`;
    const statementAt = new Date().toISOString();
    const saleId = `proposal-sale-${suffix}`;
    const salePaymentId = `proposal-tender-${suffix}`;
    await insertSalePayment({
      tenantId: h.tenantId,
      adminId: h.adminId,
      saleId,
      salePaymentId,
      method: 'card',
      amount: 100_000,
      reference: `POS-${suffix}`,
      createdAt: statementAt,
    });
    await insertPaymentOutboxRow({
      tenantId: h.tenantId,
      id: outboxId,
      railId: 'wompi',
      salePaymentId,
      status: 'approved',
      amount: 100_000,
      reference: `POS-${suffix}`,
      createdAt: statementAt,
    });
    const db = getDatabase();
    const outbox = (await db
      .select()
      .from(paymentOutbox)
      .where(eq(paymentOutbox.id, outboxId))
      .get())!;
    const statement = {
      railId: 'wompi' as const,
      reference: `PROVIDER-${suffix}`,
      providerTransactionId: `provider-tx-${suffix}`,
      amount: 100_000,
      currencyCode: 'COP',
      status: 'settled' as const,
      settledAt: statementAt,
      fee: 0,
    };
    const proposal = await savePaymentProposal(db, h.tenantId, statement, [outbox], outbox, {
      ok: true,
      salePaymentId: outboxId,
      confidence: 'medium',
      explanation: 'Candidate amount and settlement time match.',
      costUsd: 0,
      auditLogId: `audit-${suffix}`,
    });
    expect(proposal).not.toBeNull();
    return { h, outboxId, saleId, salePaymentId, proposalId: proposal!.id, statement };
  }

  it('lists immutable evidence to managers but only admins can confirm it once', async () => {
    const { h, outboxId, saleId, salePaymentId, proposalId, statement } =
      await seedProposal('approve');
    const manager = appRouter.createCaller(buildCtx(h.tenantId, h.managerId, 'manager'));
    const cashier = appRouter.createCaller(buildCtx(h.tenantId, h.cashierId, 'cashier'));
    const admin = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const other = await seedHarness('proposal-other-tenant');
    const otherAdmin = appRouter.createCaller(buildCtx(other.tenantId, other.adminId, 'admin'));

    const visible = await manager.payments.listProposals({ status: 'pending' });
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({
      id: proposalId,
      selectedOutboxId: outboxId,
      evidence: { statement, recommendedOutboxId: outboxId },
    });
    await expect(cashier.payments.listProposals({})).rejects.toBeInstanceOf(TRPCError);
    await expect(
      manager.payments.reviewProposal({ proposalId, decision: 'approve' })
    ).rejects.toBeInstanceOf(TRPCError);
    await expect(otherAdmin.payments.listProposals({})).resolves.toEqual([]);
    await expect(
      otherAdmin.payments.reviewProposal({ proposalId, decision: 'approve' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(
      admin.payments.reviewProposal({ proposalId, decision: 'approve' })
    ).resolves.toEqual({
      proposalId,
      status: 'approved',
    });
    const db = getDatabase();
    const settled = await db
      .select()
      .from(paymentOutbox)
      .where(eq(paymentOutbox.id, outboxId))
      .get();
    expect(settled).toMatchObject({
      status: 'settled',
      providerTransactionId: statement.providerTransactionId,
    });
    expect(
      await db.select().from(salePayments).where(eq(salePayments.id, salePaymentId)).get()
    ).toMatchObject({
      amount: 100_000,
      saleId,
    });
    expect(await db.select().from(sales).where(eq(sales.id, saleId)).get()).toMatchObject({
      total: 100_000,
      paymentStatus: 'paid',
    });
    const reviewAudit = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, h.tenantId), eq(auditLogs.resourceId, proposalId)))
      .all();
    expect(reviewAudit).toHaveLength(1);
    expect(reviewAudit[0]?.action).toBe('payment.proposal_approved');
    await expect(
      admin.payments.reviewProposal({ proposalId, decision: 'approve' })
    ).resolves.toEqual({ proposalId, status: 'approved' });
    const repeatAudit = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, h.tenantId), eq(auditLogs.resourceId, proposalId)))
      .all();
    expect(repeatAudit).toHaveLength(1);
    await expect(
      admin.payments.reviewProposal({ proposalId, decision: 'reject' })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects stale evidence without settlement, then permits an audited rejection', async () => {
    const { h, outboxId, proposalId } = await seedProposal('stale');
    const db = getDatabase();
    await db
      .update(paymentOutbox)
      .set({ amount: 99_000 })
      .where(eq(paymentOutbox.id, outboxId))
      .run();
    const admin = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    await expect(
      admin.payments.reviewProposal({ proposalId, decision: 'approve' })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(
      await db.select().from(paymentOutbox).where(eq(paymentOutbox.id, outboxId)).get()
    ).toMatchObject({ status: 'approved', providerTransactionId: null });
    await expect(
      admin.payments.reviewProposal({ proposalId, decision: 'reject' })
    ).resolves.toEqual({ proposalId, status: 'rejected' });
    const row = await db
      .select()
      .from(paymentReconciliationProposals)
      .where(eq(paymentReconciliationProposals.id, proposalId))
      .get();
    expect(row).toMatchObject({ status: 'rejected', reviewedBy: h.adminId });
    await expect(
      admin.payments.reviewProposal({ proposalId, decision: 'reject' })
    ).resolves.toEqual({ proposalId, status: 'rejected' });
  });
});

describe('payment proposal claimed-row safety', () => {
  it('refuses settlement after a worker claims the suggested outbox row', async () => {
    const h = await seedHarness('claim-race');
    const outboxId = 'proposal-claim-race-outbox';
    const now = new Date().toISOString();
    await insertPaymentOutboxRow({
      tenantId: h.tenantId,
      id: outboxId,
      railId: 'bold',
      status: 'approved',
      amount: 500,
    });
    const db = getDatabase();
    const row = (await db
      .select()
      .from(paymentOutbox)
      .where(eq(paymentOutbox.id, outboxId))
      .get())!;
    const proposal = await savePaymentProposal(
      db,
      h.tenantId,
      {
        railId: 'bold',
        reference: 'provider-claim-race',
        providerTransactionId: 'tx-claim-race',
        amount: 500,
        currencyCode: 'COP',
        status: 'settled',
        settledAt: now,
        fee: 0,
      },
      [row],
      row,
      {
        ok: true,
        salePaymentId: outboxId,
        confidence: 'high',
        explanation: 'Test',
        costUsd: 0,
        auditLogId: 'audit-claim-race',
      }
    );
    expect(proposal).not.toBeNull();
    await db
      .update(paymentOutbox)
      .set({ status: 'submitting', claimToken: 'worker-token', lockedAt: now })
      .where(eq(paymentOutbox.id, outboxId))
      .run();
    const admin = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    await expect(
      admin.payments.reviewProposal({ proposalId: proposal!.id, decision: 'approve' })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(
      await db
        .select()
        .from(paymentReconciliationProposals)
        .where(eq(paymentReconciliationProposals.id, proposal!.id))
        .get()
    ).toMatchObject({ status: 'pending' });
    expect(
      await db.select().from(paymentOutbox).where(eq(paymentOutbox.id, outboxId)).get()
    ).toMatchObject({ status: 'submitting', claimToken: 'worker-token' });
  });
});
