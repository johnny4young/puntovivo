/**
 * ENG-038 — `payments.*` tRPC router integration tests.
 *
 * Drives the read-only Operations Center payment rail surface against
 * an in-memory DB.
 */

import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  cashSessions,
  companies,
  paymentOutbox,
  salePayments,
  sales,
  sites,
  tenants,
  users,
  type PaymentRailId,
} from '../db/schema.js';
import { PAYMENT_RAIL_IDS } from '../services/payments/manifest.js';
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
  // ENG-177c — `sales` now enforces `cash_session_id IS NOT NULL OR
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

// ENG-177c — maps each seeded tenant to its fixture cash session so
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

describe('payments.getContract (ENG-038)', () => {
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

describe('payments.peekOutbox (ENG-038)', () => {
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

describe('payments.reconciliation (ENG-038)', () => {
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

describe('payment_outbox idempotency invariant (ENG-038)', () => {
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
