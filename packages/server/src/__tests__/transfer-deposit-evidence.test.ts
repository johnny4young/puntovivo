/**
 * Deposits received against a tender that is dead (S11).
 *
 * A transfer tender can be superseded (`rejected`) or cancelled before the
 * money shows up in the store account. The money is real, so it cannot be
 * rejected; the tender is dead, so it cannot be rewritten. The rule under test:
 * the deposit is recorded as evidence only — no `sale_payments` column, no
 * `sales.total`, no applied amount — and the recorded outcome says so, with the
 * reason, so the day close can put it in its own bucket.
 *
 * Everything is observed through the public service surface
 * (`registerManualDeposit`, `listPendingTransfers`, `accumulateSaleDeposits`)
 * and the persisted evidence (`sale_payments`, `sales`, `audit_logs`).
 */
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { auditLogs, salePayments, sales, sites, users } from '../db/schema.js';
import type { TransferConfirmationStatus } from '../db/schema/base.js';
import {
  accumulateSaleDeposits,
  listPendingTransfers,
  registerManualDeposit,
} from '../services/payments/transfer-reconciliation.js';

let server: PuntovivoServer;
let tenantId: string;
let siteId: string;
let userId: string;

/** A draft sale plus one transfer tender, already in the given lifecycle state. */
function saleWithTransfer(
  amount: number,
  confirmationStatus: TransferConfirmationStatus = 'pending'
): { saleId: string; salePaymentId: string } {
  const now = new Date().toISOString();
  const saleId = nanoid();
  const salePaymentId = nanoid();
  const db = getDatabase();
  db.insert(sales)
    .values({
      id: saleId,
      tenantId,
      saleNumber: `S-${nanoid(6)}`,
      status: 'draft',
      paymentStatus: 'pending',
      subtotal: amount,
      total: amount,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(salePayments)
    .values({
      id: salePaymentId,
      tenantId,
      saleId,
      method: 'transfer',
      amount,
      reference: null,
      confirmationStatus,
      createdAt: now,
    })
    .run();
  return { saleId, salePaymentId };
}

function deposit(
  saleId: string,
  salePaymentId: string,
  verifiedAmount: number,
  extra: { idempotencyKey?: string; note?: string; valueDate?: string } = {}
): { appliedAmount: number; surplusAmount: number; status: string } {
  return registerManualDeposit(getDatabase(), {
    tenantId,
    siteId,
    actorId: userId,
    saleId,
    salePaymentId,
    verifiedAmount,
    reference: 'REF-MOV',
    valueDate: extra.valueDate ?? null,
    note: extra.note ?? null,
    ...(extra.idempotencyKey !== undefined ? { idempotencyKey: extra.idempotencyKey } : {}),
  });
}

/** Every manual-deposit audit row of a sale, as the immutable chain holds them. */
function depositPayloads(saleId: string): Record<string, unknown>[] {
  return getDatabase()
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.tenantId, tenantId),
        eq(auditLogs.action, 'sale_payment.transfer_manual_confirmed'),
        eq(auditLogs.resourceId, saleId)
      )
    )
    .all()
    .map(row => row.after ?? {});
}

/** The whole tender row, so "the tender was not touched" is a byte-level claim. */
function tenderRow(salePaymentId: string) {
  return getDatabase()
    .select()
    .from(salePayments)
    .where(and(eq(salePayments.id, salePaymentId), eq(salePayments.tenantId, tenantId)))
    .get();
}

function saleTotal(saleId: string): number | undefined {
  return getDatabase()
    .select()
    .from(sales)
    .where(and(eq(sales.id, saleId), eq(sales.tenantId, tenantId)))
    .get()?.total;
}

function pendingRow(salePaymentId: string, status?: string) {
  return listPendingTransfers(getDatabase(), {
    tenantId,
    limit: 200,
    ...(status !== undefined ? { status } : {}),
  }).find(row => row.salePaymentId === salePaymentId);
}

describe('transfer deposit evidence on a dead tender', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const user = db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!user) throw new Error('Expected seeded administrator');
    tenantId = user.tenantId;
    userId = user.id;
    const site = db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!site) throw new Error('Expected active site');
    siteId = site.id;
  });

  afterAll(async () => {
    await server.close();
  });

  it.each([
    ['rejected', 'tender_rejected'],
    ['cancelled', 'tender_cancelled'],
  ] as const)(
    'records a deposit on a %s tender as evidence and applies nothing',
    (state, notAppliedReason) => {
      const { saleId, salePaymentId } = saleWithTransfer(100000, state);
      const before = tenderRow(salePaymentId);

      const result = deposit(saleId, salePaymentId, 50000, {
        idempotencyKey: `${state}-1`,
        note: 'Llegó después de cerrar el tender',
        valueDate: '2026-11-23',
      });

      // Same public shape as any other deposit: the caller is told the money
      // was recorded, not rejected.
      expect(result).toEqual({
        appliedAmount: 0,
        surplusAmount: 0,
        status: 'needs_reconciliation',
      });

      // The dead tender is untouched: no status, source, actor, timestamp or
      // reference rewrite.
      expect(tenderRow(salePaymentId)).toEqual(before);
      expect(saleTotal(saleId)).toBe(100000);

      // The money is not lost: it is one immutable audit row, with the reason
      // the day close buckets it by.
      const payloads = depositPayloads(saleId);
      expect(payloads).toHaveLength(1);
      expect(payloads[0]).toEqual({
        salePaymentId,
        verifiedAmount: 50000,
        appliedAmount: 0,
        surplusAmount: 0,
        status: 'needs_reconciliation',
        notAppliedReason,
        reference: 'REF-MOV',
        valueDate: '2026-11-23',
        note: 'Llegó después de cerrar el tender',
        idempotencyKey: `${state}-1`,
      });
    }
  );

  it.each(['rejected', 'cancelled'] as const)(
    'replays a deposit on a %s tender without a second audit row',
    state => {
      const { saleId, salePaymentId } = saleWithTransfer(100000, state);
      const before = tenderRow(salePaymentId);
      const key = `${state}-replay`;

      // A replay is the same movement sent again: same tender, same amount.
      // (A key naming a different tender or amount is refused — see
      // transfer-deposit-accumulation.test.ts.)
      const original = deposit(saleId, salePaymentId, 50000, { idempotencyKey: key });
      const replay = deposit(saleId, salePaymentId, 50000, { idempotencyKey: key });

      expect(original).toEqual({
        appliedAmount: 0,
        surplusAmount: 0,
        status: 'needs_reconciliation',
      });
      expect(replay).toEqual(original);
      expect(depositPayloads(saleId)).toHaveLength(1);
      expect(tenderRow(salePaymentId)).toEqual(before);
      expect(saleTotal(saleId)).toBe(100000);
    }
  );

  it('never reports not-applied money as applied on the read side', () => {
    const { saleId, salePaymentId } = saleWithTransfer(100000, 'rejected');
    deposit(saleId, salePaymentId, 50000);

    // The receipt/sale read path derives applied money from this map: a tender
    // whose only movement was not applied carries no applied amount at all.
    const accumulation = accumulateSaleDeposits(getDatabase(), {
      tenantId,
      saleId,
      tenders: [{ id: salePaymentId, amount: 100000 }],
    });
    expect(accumulation.get(salePaymentId)?.appliedAmount ?? 0).toBe(0);

    // The reconciliation row, when a caller explicitly asks for dead tenders,
    // still shows zero applied and zero surplus.
    const row = pendingRow(salePaymentId, 'rejected');
    expect(row).toBeDefined();
    expect(row?.appliedAmount).toBe(0);
    expect(row?.surplusAmount).toBe(0);

    // The default listing stays pending-only: dead tenders are not widened in.
    expect(pendingRow(salePaymentId)).toBeUndefined();
  });

  it('keeps counting a live tender after a dead one recorded money', () => {
    const dead = saleWithTransfer(100000, 'rejected');
    deposit(dead.saleId, dead.salePaymentId, 50000);

    const live = saleWithTransfer(100000);
    deposit(live.saleId, live.salePaymentId, 50000);
    const completing = deposit(live.saleId, live.salePaymentId, 50000);

    // The normal accumulation path is untouched by the new evidence rule.
    expect(completing).toEqual({
      appliedAmount: 100000,
      surplusAmount: 0,
      status: 'manual_confirmed',
    });
    expect(tenderRow(live.salePaymentId)?.confirmationStatus).toBe('manual_confirmed');
    expect(saleTotal(live.saleId)).toBe(100000);

    const livePayloads = depositPayloads(live.saleId);
    expect(livePayloads).toHaveLength(2);
    // `notAppliedReason` exists only on rows that were not applied.
    expect(livePayloads.every(payload => !('notAppliedReason' in payload))).toBe(true);
  });

  it('still refuses a deposit on a provider-confirmed tender', () => {
    const { saleId, salePaymentId } = saleWithTransfer(100000, 'provider_confirmed');

    expect(() => deposit(saleId, salePaymentId, 50000)).toThrow(/already confirmed/i);
    expect(tenderRow(salePaymentId)?.confirmationStatus).toBe('provider_confirmed');
    expect(depositPayloads(saleId)).toHaveLength(0);
  });
});
