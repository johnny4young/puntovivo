/**
 * Deposit accumulation on one transfer tender (S10 / T10).
 *
 * The confirmed amount of a transfer tender is the SUM of the deposits applied
 * to it, never the last reported instalment: 100.000 expected with two 50.000
 * deposits is a confirmed transfer, while a shortfall or an excess keeps the
 * tender in `needs_reconciliation`. The excess is reported as surplus and is
 * never added to `sales.total`.
 *
 * Everything here is observed through the public service surface
 * (`registerManualDeposit`, `listPendingTransfers`) and the persisted evidence
 * (`sale_payments`, `sales`, `audit_logs`), never through internal helpers.
 */
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { auditLogs, salePayments, sales, sites, tenants, users } from '../db/schema.js';
import { writeAuditLog } from '../services/audit-logs.js';
import { getSaleRecord } from '../application/sales/sale-read.js';
import {
  listPendingTransfers,
  registerManualDeposit,
} from '../services/payments/transfer-reconciliation.js';
import { pendingTransferRowOutput } from '../trpc/schemas/payments.js';

let server: PuntovivoServer;
let tenantId: string;
let siteId: string;
let userId: string;

/** A draft sale plus one transfer tender, in the state the register leaves it. */
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

/** A second transfer tender on an existing sale (split transfer payment). */
function addTransferTender(saleId: string, amount: number): string {
  const salePaymentId = nanoid();
  getDatabase()
    .insert(salePayments)
    .values({
      id: salePaymentId,
      tenantId,
      saleId,
      method: 'transfer',
      amount,
      reference: null,
      confirmationStatus: 'pending',
      createdAt: new Date().toISOString(),
    })
    .run();
  return salePaymentId;
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

/**
 * Write a deposit audit row straight into the chain, bypassing the service.
 * Used to prove which rows the accumulation trusts (tenant scoping, per-tender
 * scoping and numeric safety) without depending on how the write path builds
 * them.
 */
function rawDepositRow(args: {
  tenantId: string;
  actorId: string;
  saleId: string;
  salePaymentId: string;
  after: Record<string, unknown>;
}): void {
  getDatabase().transaction(tx => {
    writeAuditLog({
      tx,
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: 'sale_payment.transfer_manual_confirmed',
      resourceType: 'sale',
      resourceId: args.saleId,
      before: null,
      after: args.after,
    });
  });
}

function tenderStatus(salePaymentId: string): string | null | undefined {
  return getDatabase()
    .select()
    .from(salePayments)
    .where(and(eq(salePayments.id, salePaymentId), eq(salePayments.tenantId, tenantId)))
    .get()?.confirmationStatus;
}

function saleTotal(saleId: string): number | undefined {
  return getDatabase()
    .select()
    .from(sales)
    .where(and(eq(sales.id, saleId), eq(sales.tenantId, tenantId)))
    .get()?.total;
}

function pendingRow(salePaymentId: string) {
  return listPendingTransfers(getDatabase(), { tenantId, limit: 200 }).find(
    row => row.salePaymentId === salePaymentId
  );
}

describe('transfer deposit accumulation', () => {
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

  it('confirms the tender only when two partial deposits add up to it', () => {
    const { saleId, salePaymentId } = saleWithTransfer(100000);

    const first = deposit(saleId, salePaymentId, 50000, { idempotencyKey: 'mv-1' });
    // A partial deposit never reports the whole tender as received.
    expect(first.appliedAmount).toBe(50000);
    expect(first.surplusAmount).toBe(0);
    expect(first.status).toBe('needs_reconciliation');

    const second = deposit(saleId, salePaymentId, 50000, { idempotencyKey: 'mv-2' });
    // The confirmed amount is the SUM, not the last instalment.
    expect(second.appliedAmount).toBe(100000);
    expect(second.surplusAmount).toBe(0);
    expect(second.status).toBe('manual_confirmed');

    expect(tenderStatus(salePaymentId)).toBe('manual_confirmed');
    expect(saleTotal(saleId)).toBe(100000);

    // One immutable audit row per movement, each carrying its own evidence.
    const payloads = depositPayloads(saleId);
    expect(payloads).toHaveLength(2);
    const numeric = (values: unknown[]) => values.map(Number).sort((a, b) => a - b);
    expect(numeric(payloads.map(payload => payload['verifiedAmount']))).toEqual([50000, 50000]);
    expect(numeric(payloads.map(payload => payload['appliedAmount']))).toEqual([50000, 100000]);
    expect(payloads.map(payload => payload['status']).sort()).toEqual([
      'manual_confirmed',
      'needs_reconciliation',
    ]);
    expect(payloads.map(payload => payload['idempotencyKey']).sort()).toEqual(['mv-1', 'mv-2']);
    expect(payloads.every(payload => payload['valueDate'] === null)).toBe(true);
  });

  it('parks a sum that exceeds the tender and exposes the excess as surplus', () => {
    const { saleId, salePaymentId } = saleWithTransfer(100000);

    deposit(saleId, salePaymentId, 50000);
    const second = deposit(saleId, salePaymentId, 60000);

    expect(second.appliedAmount).toBe(100000);
    expect(second.surplusAmount).toBe(10000);
    expect(second.status).toBe('needs_reconciliation');
    // The excess stays out of the sale.
    expect(saleTotal(saleId)).toBe(100000);
    expect(tenderStatus(salePaymentId)).toBe('needs_reconciliation');
  });

  it('keeps a single deposit that matches the tender confirmed, as before', () => {
    const { saleId, salePaymentId } = saleWithTransfer(75000);

    const result = deposit(saleId, salePaymentId, 75000, { idempotencyKey: 'mv-only' });

    expect(result).toEqual({
      appliedAmount: 75000,
      surplusAmount: 0,
      status: 'manual_confirmed',
    });
    expect(tenderStatus(salePaymentId)).toBe('manual_confirmed');
    expect(saleTotal(saleId)).toBe(75000);
    expect(depositPayloads(saleId)).toHaveLength(1);
  });

  it('does not confirm a one-cent shortfall', () => {
    const { saleId, salePaymentId } = saleWithTransfer(100.01);

    // The tolerance may absorb IEEE-754 drift; it may never absorb a real cent.
    expect(deposit(saleId, salePaymentId, 100)).toEqual({
      appliedAmount: 100,
      surplusAmount: 0,
      status: 'needs_reconciliation',
    });
    expect(tenderStatus(salePaymentId)).toBe('needs_reconciliation');
    expect(saleTotal(saleId)).toBe(100.01);
    // The reconciliation surface sees the same shortfall the write path saw.
    expect(pendingRow(salePaymentId)?.appliedAmount).toBe(100);
  });

  it('confirms once the missing cent actually arrives', () => {
    const { saleId, salePaymentId } = saleWithTransfer(100.01);

    deposit(saleId, salePaymentId, 100, { idempotencyKey: 'cent-1' });
    const completing = deposit(saleId, salePaymentId, 0.01, { idempotencyKey: 'cent-2' });

    expect(completing).toEqual({
      appliedAmount: 100.01,
      surplusAmount: 0,
      status: 'manual_confirmed',
    });
    expect(tenderStatus(salePaymentId)).toBe('manual_confirmed');
    expect(saleTotal(saleId)).toBe(100.01);
  });

  it('keeps an exact cent-for-cent match confirmed', () => {
    const { saleId, salePaymentId } = saleWithTransfer(100.01);

    expect(deposit(saleId, salePaymentId, 100.01)).toEqual({
      appliedAmount: 100.01,
      surplusAmount: 0,
      status: 'manual_confirmed',
    });
    expect(tenderStatus(salePaymentId)).toBe('manual_confirmed');
  });

  it('reports a one-cent excess as surplus instead of confirming', () => {
    const { saleId, salePaymentId } = saleWithTransfer(100);

    expect(deposit(saleId, salePaymentId, 100.01)).toEqual({
      appliedAmount: 100,
      surplusAmount: 0.01,
      status: 'needs_reconciliation',
    });
    expect(tenderStatus(salePaymentId)).toBe('needs_reconciliation');
    expect(saleTotal(saleId)).toBe(100);
  });

  it('keeps confirming when the sum only drifts in floating point', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754: drift, not a shortfall.
    const drift = saleWithTransfer(0.3);
    deposit(drift.saleId, drift.salePaymentId, 0.1, { idempotencyKey: 'drift-1' });
    const drifted = deposit(drift.saleId, drift.salePaymentId, 0.2, {
      idempotencyKey: 'drift-2',
    });
    expect(drifted).toEqual({
      appliedAmount: 0.3,
      surplusAmount: 0,
      status: 'manual_confirmed',
    });
    expect(tenderStatus(drift.salePaymentId)).toBe('manual_confirmed');

    // The same rule across three cent-granular instalments (33.33 × 3).
    const thirds = saleWithTransfer(99.99);
    deposit(thirds.saleId, thirds.salePaymentId, 33.33, { idempotencyKey: 'drift-3' });
    deposit(thirds.saleId, thirds.salePaymentId, 33.33, { idempotencyKey: 'drift-4' });
    const third = deposit(thirds.saleId, thirds.salePaymentId, 33.33, {
      idempotencyKey: 'drift-5',
    });
    expect(third).toEqual({
      appliedAmount: 99.99,
      surplusAmount: 0,
      status: 'manual_confirmed',
    });
    expect(tenderStatus(thirds.salePaymentId)).toBe('manual_confirmed');
  });

  it('rejects the same key sent against a second tender without writing money', () => {
    const { saleId, salePaymentId } = saleWithTransfer(100000);
    const siblingTenderId = addTransferTender(saleId, 50000);
    const key = 'mv-cross-tender';

    const recorded = deposit(saleId, salePaymentId, 50000, { idempotencyKey: key });
    expect(recorded.appliedAmount).toBe(50000);

    // A key names ONE movement. Naming a different tender with it is a caller
    // mistake or a retry aimed at the wrong row: it is refused, and nothing
    // moves — no second audit row, no applied money on the other tender.
    expect(() => deposit(saleId, siblingTenderId, 50000, { idempotencyKey: key })).toThrow(
      /already recorded/i
    );

    expect(depositPayloads(saleId)).toHaveLength(1);
    expect(tenderStatus(salePaymentId)).toBe('needs_reconciliation');
    expect(tenderStatus(siblingTenderId)).toBe('pending');
    expect(pendingRow(siblingTenderId)?.appliedAmount).toBe(0);
    expect(saleTotal(saleId)).toBe(100000);
  });

  it('rejects a replay whose amount differs from the recorded movement', () => {
    const { saleId, salePaymentId } = saleWithTransfer(100000);
    deposit(saleId, salePaymentId, 50000, { idempotencyKey: 'mv-amount' });

    expect(() => deposit(saleId, salePaymentId, 60000, { idempotencyKey: 'mv-amount' })).toThrow(
      /already recorded/i
    );
    expect(depositPayloads(saleId)).toHaveLength(1);
    expect(tenderStatus(salePaymentId)).toBe('needs_reconciliation');
    expect(pendingRow(salePaymentId)?.appliedAmount).toBe(50000);
  });

  it('rejects a key recorded on another sale instead of moving money there', () => {
    const first = saleWithTransfer(100000);
    const other = saleWithTransfer(100000);
    deposit(first.saleId, first.salePaymentId, 50000, { idempotencyKey: 'mv-cross-sale' });

    expect(() =>
      deposit(other.saleId, other.salePaymentId, 50000, { idempotencyKey: 'mv-cross-sale' })
    ).toThrow(/already recorded/i);

    expect(depositPayloads(other.saleId)).toHaveLength(0);
    expect(tenderStatus(other.salePaymentId)).toBe('pending');
    expect(saleTotal(other.saleId)).toBe(100000);
  });

  it('returns the recorded outcome instead of adding money twice when a movement is replayed', () => {
    const { saleId, salePaymentId } = saleWithTransfer(100000);

    const original = deposit(saleId, salePaymentId, 50000, {
      idempotencyKey: 'mv-replay',
      note: 'Primer abono',
      valueDate: '2026-11-23',
    });
    const replay = deposit(saleId, salePaymentId, 50000, {
      idempotencyKey: 'mv-replay',
      note: 'Primer abono',
      valueDate: '2026-11-23',
    });

    expect(replay).toEqual(original);
    expect(depositPayloads(saleId)).toHaveLength(1);
    expect(pendingRow(salePaymentId)?.appliedAmount).toBe(50000);

    // The replayed 50.000 was not counted a second time: the next instalment
    // is what completes the tender.
    const completing = deposit(saleId, salePaymentId, 50000, { idempotencyKey: 'mv-next' });
    expect(completing.appliedAmount).toBe(100000);
    expect(completing.surplusAmount).toBe(0);
    expect(completing.status).toBe('manual_confirmed');
    expect(depositPayloads(saleId)).toHaveLength(2);
  });

  it('ignores deposits recorded under another tenant for the same sale', () => {
    const { saleId, salePaymentId } = saleWithTransfer(100000);

    const foreignTenantId = `tenant-${nanoid()}`;
    const foreignUserId = `user-${nanoid()}`;
    getDatabase()
      .insert(tenants)
      .values({ id: foreignTenantId, slug: `other-${nanoid(8)}`, name: 'Otra tienda' })
      .run();
    getDatabase()
      .insert(users)
      .values({
        id: foreignUserId,
        tenantId: foreignTenantId,
        // A human identity must carry both credentials (schema CHECK).
        email: `foreign-${nanoid(8)}@localhost`,
        passwordHash: 'fixture-not-a-real-hash',
        name: 'Cajero ajeno',
        role: 'cashier',
      })
      .run();
    rawDepositRow({
      tenantId: foreignTenantId,
      actorId: foreignUserId,
      saleId,
      salePaymentId,
      after: {
        salePaymentId,
        verifiedAmount: 50000,
        appliedAmount: 50000,
        surplusAmount: 0,
        status: 'needs_reconciliation',
        valueDate: null,
        note: null,
        idempotencyKey: 'foreign-key',
      },
    });

    const result = deposit(saleId, salePaymentId, 50000);

    expect(result.appliedAmount).toBe(50000);
    expect(result.status).toBe('needs_reconciliation');
    expect(pendingRow(salePaymentId)?.appliedAmount).toBe(50000);
  });

  it('counts only finite positive amounts of its own tender', () => {
    const { saleId, salePaymentId } = saleWithTransfer(100000);
    const siblingTenderId = addTransferTender(saleId, 50000);

    // Corrupt or foreign-typed evidence must never reach the money decision.
    for (const verifiedAmount of ['50000', -50000, null, 0, Number.NaN]) {
      rawDepositRow({
        tenantId,
        actorId: userId,
        saleId,
        salePaymentId,
        after: {
          salePaymentId,
          verifiedAmount,
          appliedAmount: verifiedAmount,
          surplusAmount: 0,
          status: 'manual_confirmed',
          valueDate: null,
          note: null,
          idempotencyKey: null,
        },
      });
    }
    // Another tender of the same sale has its own money.
    rawDepositRow({
      tenantId,
      actorId: userId,
      saleId,
      salePaymentId: siblingTenderId,
      after: {
        salePaymentId: siblingTenderId,
        verifiedAmount: 40000,
        appliedAmount: 40000,
        surplusAmount: 0,
        status: 'needs_reconciliation',
        valueDate: null,
        note: null,
        idempotencyKey: null,
      },
    });

    const result = deposit(saleId, salePaymentId, 60000);

    expect(result.appliedAmount).toBe(60000);
    expect(result.surplusAmount).toBe(0);
    expect(result.status).toBe('needs_reconciliation');
  });

  it('exposes the accumulated applied and surplus amounts on the pending row', () => {
    const { saleId, salePaymentId } = saleWithTransfer(100000);

    deposit(saleId, salePaymentId, 50000);
    const afterFirst = pendingRow(salePaymentId);
    expect(afterFirst?.appliedAmount).toBe(50000);
    expect(afterFirst?.surplusAmount).toBe(0);

    deposit(saleId, salePaymentId, 60000);
    const afterExcess = pendingRow(salePaymentId);
    expect(afterExcess?.appliedAmount).toBe(100000);
    expect(afterExcess?.surplusAmount).toBe(10000);
  });

  it('documents the pending row contract, accumulated deposits included', () => {
    const { saleId, salePaymentId } = saleWithTransfer(100000);
    deposit(saleId, salePaymentId, 110000);

    const row = pendingRow(salePaymentId);
    expect(row).toBeDefined();
    const parsed = pendingTransferRowOutput.parse(row);
    expect(parsed.appliedAmount).toBe(100000);
    expect(parsed.surplusAmount).toBe(10000);
    // Strict: a new field in the row must be added to the contract deliberately.
    expect(() => pendingTransferRowOutput.strict().parse(row)).not.toThrow();
  });

  it('reports a tender confirmed without a deposit chain as fully applied', () => {
    const { salePaymentId } = saleWithTransfer(100000);
    // The register can confirm a transfer at creation (the cashier already
    // verified it), which leaves no manual movement chain behind.
    getDatabase()
      .update(salePayments)
      .set({ confirmationStatus: 'manual_confirmed', confirmationSource: 'operator' })
      .where(and(eq(salePayments.id, salePaymentId), eq(salePayments.tenantId, tenantId)))
      .run();

    const row = listPendingTransfers(getDatabase(), {
      tenantId,
      status: 'manual_confirmed',
      limit: 200,
    }).find(candidate => candidate.salePaymentId === salePaymentId);

    expect(row?.appliedAmount).toBe(100000);
    expect(row?.surplusAmount).toBe(0);
  });

  it('keeps provider confirmation terminal for deposits', () => {
    const { saleId, salePaymentId } = saleWithTransfer(100000);
    getDatabase()
      .update(salePayments)
      .set({ confirmationStatus: 'provider_confirmed', confirmationSource: 'provider_api' })
      .where(and(eq(salePayments.id, salePaymentId), eq(salePayments.tenantId, tenantId)))
      .run();

    expect(() => deposit(saleId, salePaymentId, 50000)).toThrow(/already confirmed/i);
    expect(tenderStatus(salePaymentId)).toBe('provider_confirmed');
    expect(depositPayloads(saleId)).toHaveLength(0);
  });

  it('rejects a non-positive deposit without touching the tender or the chain', () => {
    const { saleId, salePaymentId } = saleWithTransfer(100000);

    expect(() => deposit(saleId, salePaymentId, 0)).toThrow(/positive/i);
    expect(() => deposit(saleId, salePaymentId, -50000)).toThrow(/positive/i);

    expect(tenderStatus(salePaymentId)).toBe('pending');
    expect(depositPayloads(saleId)).toHaveLength(0);
  });

  it('hands the accumulated tender to the sale read model a receipt prints from', async () => {
    // The receipt path reads `sales.getById` / `sales.getForReprint`, which both
    // go through the sale read model. A printed receipt can only show what this
    // record carries, so the accumulated money and the lifecycle state have to
    // arrive here, not be re-derived by the client.
    const { saleId, salePaymentId } = saleWithTransfer(100000);

    deposit(saleId, salePaymentId, 50000);
    const afterFirst = await getSaleRecord(getDatabase(), tenantId, saleId);
    const firstTender = afterFirst.payments.find(payment => payment.id === salePaymentId);
    expect(firstTender?.confirmationStatus).toBe('needs_reconciliation');
    expect(firstTender?.appliedAmount).toBe(50000);
    expect(firstTender?.surplusAmount).toBe(0);

    deposit(saleId, salePaymentId, 50000);
    const afterSecond = await getSaleRecord(getDatabase(), tenantId, saleId);
    const secondTender = afterSecond.payments.find(payment => payment.id === salePaymentId);
    expect(secondTender?.confirmationStatus).toBe('manual_confirmed');
    expect(secondTender?.appliedAmount).toBe(100000);
    expect(secondTender?.surplusAmount).toBe(0);
    // The tender is paid; the sale total never moved.
    expect(afterSecond.total).toBe(100000);
  });

  it('reads the frozen destination from the sale so a receipt never shows today config', async () => {
    const { saleId, salePaymentId } = saleWithTransfer(80000);
    const destination = { id: 'dest-1', label: 'Cuenta de ahorros', kind: 'bank_account' };
    getDatabase()
      .update(salePayments)
      .set({ destinationSnapshot: destination })
      .where(and(eq(salePayments.id, salePaymentId), eq(salePayments.tenantId, tenantId)))
      .run();

    const sale = await getSaleRecord(getDatabase(), tenantId, saleId);
    const tender = sale.payments.find(payment => payment.id === salePaymentId);
    expect(tender?.destinationSnapshot).toEqual(destination);
    // A tender with no deposit chain reports no accumulation: the receipt must
    // not invent one.
    expect(tender?.appliedAmount).toBeUndefined();
  });
});
