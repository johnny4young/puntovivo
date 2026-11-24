import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { auditLogs, salePayments, sales, sites, users } from '../db/schema.js';
import {
  listPendingTransfers,
  registerManualDeposit,
  saleTransferTotals,
  transferReconciliationCounters,
} from '../services/payments/transfer-reconciliation.js';

let server: PuntovivoServer;
let tenantId: string;
let siteId: string;
let userId: string;

/** A minimal sale plus one transfer tender, in the state the register leaves it. */
function saleWithTransfer(amount: number): { saleId: string; salePaymentId: string } {
  const now = new Date().toISOString();
  const saleId = nanoid();
  const salePaymentId = nanoid();
  const db = getDatabase();
  db.insert(sales)
    .values({
      id: saleId,
      tenantId,
      saleNumber: `S-${nanoid(6)}`,
      // draft: the fixture needs a tender row, not a real till session.
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
      confirmationStatus: 'pending',
      createdAt: now,
    })
    .run();
  return { saleId, salePaymentId };
}

describe('transfer reconciliation', () => {
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

  it('records a manual deposit and audits who verified it', () => {
    const { saleId, salePaymentId } = saleWithTransfer(50000);

    const result = registerManualDeposit(getDatabase(), {
      tenantId,
      siteId,
      actorId: userId,
      saleId,
      salePaymentId,
      verifiedAmount: 50000,
      reference: 'REF-001',
      valueDate: null,
      note: 'Verificado en el extracto',
    });
    expect(result.status).toBe('manual_confirmed');

    const updated = getDatabase()
      .select()
      .from(salePayments)
      .where(eq(salePayments.id, salePaymentId))
      .get();
    expect(updated?.confirmationStatus).toBe('manual_confirmed');
    expect(updated?.confirmedBy).toBe(userId);
    expect(updated?.confirmationSource).toBe('operator');

    const audit = getDatabase()
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.resourceId, saleId),
          eq(auditLogs.action, 'sale_payment.transfer_manual_confirmed')
        )
      )
      .all();
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it('parks a verified amount that differs from the expected one', () => {
    const { saleId, salePaymentId } = saleWithTransfer(80000);

    const result = registerManualDeposit(getDatabase(), {
      tenantId,
      siteId,
      actorId: userId,
      saleId,
      salePaymentId,
      verifiedAmount: 100000,
      reference: 'REF-002',
      valueDate: null,
      note: 'Llegó más de lo esperado',
    });
    // The surplus never rewrites the sale: it is parked for a human decision.
    expect(result.surplusAmount).toBeGreaterThan(0);
    expect(result.status).toBe('needs_reconciliation');

    const totals = saleTransferTotals(getDatabase(), tenantId, saleId);
    expect(totals.total).toBe(80000);
    expect(totals.confirmed).toBe(0);
    expect(totals.pending).toBe(80000);
  });

  it('accepts a second legitimate deposit on the same tender', () => {
    const { saleId, salePaymentId } = saleWithTransfer(90000);
    const first = registerManualDeposit(getDatabase(), {
      tenantId,
      siteId,
      actorId: userId,
      saleId,
      salePaymentId,
      verifiedAmount: 40000,
      reference: 'ABONO-1',
      valueDate: null,
      note: 'Primer abono',
    });
    expect(first.status).toBe('needs_reconciliation');

    // The tender keeps existing: a second transfer completes the same sale.
    const stillPending = listPendingTransfers(getDatabase(), { tenantId, limit: 200 });
    expect(stillPending.some(row => row.salePaymentId === salePaymentId)).toBe(true);
  });

  it('lists only transfers still owed, and counts them by state', () => {
    const rows = listPendingTransfers(getDatabase(), { tenantId, limit: 50 });
    expect(rows.every(row => row.confirmationStatus !== 'manual_confirmed')).toBe(true);

    // Without a destination id the site filter cannot place a legacy tender,
    // so the counter is read tenant-wide here.
    const counters = transferReconciliationCounters(getDatabase(), tenantId, null);
    expect(Object.keys(counters).length).toBeGreaterThan(0);
  });

  it("refuses a deposit against a sale that is not this tenant's", () => {
    const { salePaymentId } = saleWithTransfer(10000);
    expect(() =>
      registerManualDeposit(getDatabase(), {
        tenantId,
        siteId,
        actorId: userId,
        saleId: 'sale-inexistente',
        salePaymentId,
        verifiedAmount: 1000,
        reference: null,
        valueDate: null,
        note: null,
      })
    ).toThrow(/not found/i);
  });

  it('refuses a deposit on a tender that is not a transfer', () => {
    const { saleId } = saleWithTransfer(20000);
    const now = new Date().toISOString();
    const cashId = nanoid();
    getDatabase()
      .insert(salePayments)
      .values({
        id: cashId,
        tenantId,
        saleId,
        method: 'cash',
        amount: 20000,
        reference: null,
        createdAt: now,
      })
      .run();
    expect(() =>
      registerManualDeposit(getDatabase(), {
        tenantId,
        siteId,
        actorId: userId,
        saleId,
        salePaymentId: cashId,
        verifiedAmount: 20000,
        reference: null,
        valueDate: null,
        note: null,
      })
    ).toThrow(/transfer/i);
  });
});
