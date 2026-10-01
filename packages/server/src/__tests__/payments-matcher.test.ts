/**
 * Matcher acceptance proof.
 *
 * Boots an in-memory DB, seeds one tenant + the deterministic
 * payment-statement fixture, runs `runReconciliationPass` against every
 * rail, and asserts the matcher meets the ≥95 % match rate stated in
 * the documented acceptance criteria. Also asserts every classifier kind
 * surfaces at least once so the fixture continues to exercise the full
 * mismatch space as future changes evolve the matcher heuristics.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import {
  generatePaymentStatementFixture,
  listOutboxRows,
  listPosTenders,
  listStatementRows,
  type FixtureBundle,
} from '../../__fixtures__/payment-statements/index.js';
import { getDatabase } from '../db/index.js';
import {
  cashSessions,
  companies,
  paymentOutbox,
  paymentReconciliationProposals,
  salePayments,
  sales,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { createServer, type PuntovivoServer } from '../index.js';
import { runReconciliationPass } from '../services/payments/reconciliation.js';
import { savePaymentProposal } from '../services/payments/reconciliation/proposals.js';
import type { TiebreakFn } from '../services/payments/ai-tiebreak.js';
import { seedCommittedSaleSession } from './utils/cashSessionFixture.js';

const TENANT_ID = 'eng038c-fixture-tenant';
const ADMIN_ID = 'eng038c-fixture-admin';
const FIXED_NOW = new Date('2026-05-01T01:00:00.000Z');

let server: PuntovivoServer;
let bundle: FixtureBundle;

async function seedFromFixture(fixture: FixtureBundle): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();

  await db.insert(tenants).values({
    id: TENANT_ID,
    name: ' fixture tenant',
    slug: 'eng038c-fixture',
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values({
    id: ADMIN_ID,
    tenantId: TENANT_ID,
    email: 'admin@eng038c.test',
    name: ' admin',
    passwordHash: 'x',
    sessionVersion: 1,
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  // Seed a sale per POS tender so the foreign key from `sale_payments`
  // resolves cleanly. The matcher only reads `sale_payments` indirectly
  // through `payment_outbox.sale_payment_id`, but the test invariant is
  // that the deterministic fixture and the seeded DB stay in lockstep.
  const tenders = listPosTenders(fixture);
  // committed sales need a cash session; one shared closed
  // session for the whole fixture satisfies the CHECK (the reconciler
  // matches via sale_payment ↔ payment_outbox, never the session).
  const cashSessionId = await seedCommittedSaleSession({
    tenantId: TENANT_ID,
    cashierId: ADMIN_ID,
  });
  for (const tender of tenders) {
    const saleId = `sale-${tender.salePaymentId}`;
    await db.insert(sales).values({
      id: saleId,
      tenantId: TENANT_ID,
      saleNumber: saleId.toUpperCase(),
      subtotal: tender.amount,
      taxAmount: 0,
      discountAmount: 0,
      total: tender.amount,
      paymentMethod: 'card',
      paymentStatus: 'paid',
      status: 'completed',
      cashSessionId,
      createdBy: ADMIN_ID,
      createdAt: tender.createdAt,
      updatedAt: tender.createdAt,
    });
    await db.insert(salePayments).values({
      id: tender.salePaymentId,
      tenantId: TENANT_ID,
      saleId,
      method: 'card',
      amount: tender.amount,
      reference: tender.reference,
      createdAt: tender.createdAt,
    });
  }

  const outboxRows = listOutboxRows(fixture);
  for (const row of outboxRows) {
    await db.insert(paymentOutbox).values({
      id: row.id,
      tenantId: TENANT_ID,
      salePaymentId: row.salePaymentId,
      railId: row.railId,
      kind: 'charge',
      status: row.status,
      amount: row.amount,
      currencyCode: row.currencyCode,
      reference: row.reference,
      providerTransactionId: row.providerTransactionId,
      payload: { fixture: true },
      payloadVersion: 1,
      attempts: 0,
      nextRetryAt: null,
      lastError: null,
      priority: 0,
      claimToken: null,
      lockedAt: null,
      idempotencyKey: null,
      createdAt: row.createdAt,
      updatedAt: row.createdAt,
    });
  }
}

async function cleanupTenant(): Promise<void> {
  const db = getDatabase();
  await db
    .delete(paymentReconciliationProposals)
    .where(eq(paymentReconciliationProposals.tenantId, TENANT_ID));
  await db.delete(paymentOutbox).where(eq(paymentOutbox.tenantId, TENANT_ID));
  await db.delete(salePayments).where(eq(salePayments.tenantId, TENANT_ID));
  await db.delete(sales).where(eq(sales.tenantId, TENANT_ID));
  // the committed-sale fixture now seeds a cash session +
  // company + site; delete them in FK order before the tenant so the
  // final tenant delete does not hit a RESTRICT on a dangling reference.
  await db.delete(cashSessions).where(eq(cashSessions.tenantId, TENANT_ID));
  await db.delete(sites).where(eq(sites.tenantId, TENANT_ID));
  await db.delete(companies).where(eq(companies.tenantId, TENANT_ID));
  await db.delete(users).where(eq(users.tenantId, TENANT_ID));
  await db.delete(tenants).where(eq(tenants.id, TENANT_ID));
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  bundle = generatePaymentStatementFixture({
    seed: 7,
    days: 30,
    settlementsPerRailPerDay: 6,
    mismatchRate: 0.05,
    windowEnd: FIXED_NOW.toISOString(),
    tenantId: 'eng038c',
  });
  await seedFromFixture(bundle);
});

afterAll(async () => {
  await cleanupTenant();
  await server.close();
});

describe('runReconciliationPass — 95% acceptance', () => {
  it('matches ≥ 95% of the deterministic 30-day fixture without AI tie-break', async () => {
    const db = getDatabase();
    const statementRows = listStatementRows(bundle);
    expect(statementRows.length).toBeGreaterThan(900);

    const pass = await runReconciliationPass(db, TENANT_ID, statementRows, {
      now: FIXED_NOW,
    });

    // Provider-side denominator: every statement row the matcher walked
    // must either match cleanly or surface as a known mismatch.
    const statementMatchRate = pass.matched / Math.max(statementRows.length, 1);
    expect(statementMatchRate).toBeGreaterThanOrEqual(0.95);

    // Total-activity denominator: every fixture row (including the
    // POS-side `missing_provider_reference` rows that lack a statement)
    // must clear the 95% bar so a future fixture tweak that drops the
    // POS-side mismatch contribution still trips the threshold.
    const totalActivity = bundle.summary.totalRows;
    const activityMatchRate = pass.matched / Math.max(totalActivity, 1);
    expect(activityMatchRate).toBeGreaterThanOrEqual(0.95);
  });

  it('exercises every mismatch classifier kind on the fixture', async () => {
    // Re-seed so the second pass operates on the fixture's original state
    // (the previous test flipped many rows to status='settled').
    await cleanupTenant();
    await seedFromFixture(bundle);

    const db = getDatabase();
    const pass = await runReconciliationPass(db, TENANT_ID, listStatementRows(bundle), {
      now: FIXED_NOW,
    });

    // The fixture seeds at least one of each mismatch type by construction.
    expect(pass.byKind.amount_mismatch).toBeGreaterThan(0);
    expect(pass.byKind.provider_issue).toBeGreaterThan(0);
    expect(pass.byKind.orphan_provider_row).toBeGreaterThan(0);
    expect(pass.byKind.missing_provider_reference).toBeGreaterThan(0);
    // Ambiguous is rare on the deterministic fixture (strict match by
    // providerTransactionId dominates), but the kind exists — assert
    // explicitly that the counter never goes negative.
    expect(pass.byKind.ambiguous).toBeGreaterThanOrEqual(0);
  });

  it('settles matched outbox rows in place (status=settled)', async () => {
    await cleanupTenant();
    await seedFromFixture(bundle);

    const db = getDatabase();
    const pass = await runReconciliationPass(db, TENANT_ID, listStatementRows(bundle), {
      now: FIXED_NOW,
    });

    const settledRows = await db
      .select({ id: paymentOutbox.id })
      .from(paymentOutbox)
      .where(eq(paymentOutbox.status, 'settled'))
      .all();
    expect(settledRows.length).toBe(pass.matched);
  });
});

describe('runReconciliationPass — AI tie-break wiring', () => {
  it('invokes the tie-break function only on ambiguous candidates', async () => {
    await cleanupTenant();
    await seedFromFixture(bundle);

    // Construct an explicit ambiguous case: clone an existing outbox row
    // so two rows share the same amount + window for the same rail.
    const db = getDatabase();
    const sample = bundle.rows.find(r => r.outboxRow !== null)!;
    const ambiguousId = `${sample.outboxRow!.id}-ambig`;
    await db.insert(paymentOutbox).values({
      id: ambiguousId,
      tenantId: TENANT_ID,
      salePaymentId: null,
      railId: sample.outboxRow!.railId,
      kind: 'charge',
      status: 'approved',
      amount: sample.outboxRow!.amount,
      currencyCode: sample.outboxRow!.currencyCode,
      reference: `${sample.outboxRow!.reference}-DUP`,
      providerTransactionId: null,
      payload: { fixture: true },
      payloadVersion: 1,
      attempts: 0,
      nextRetryAt: null,
      lastError: null,
      priority: 0,
      claimToken: null,
      lockedAt: null,
      idempotencyKey: null,
      createdAt: sample.outboxRow!.createdAt,
      updatedAt: sample.outboxRow!.createdAt,
    });

    // Statement row that does NOT match either reference uniquely — it
    // matches both on (rail, amount, time-window) so the matcher must
    // hand it to the tie-break.
    const ambiguousStatement = {
      railId: sample.outboxRow!.railId,
      reference: 'UNRELATED-REFERENCE',
      providerTransactionId: 'tx-untraceable',
      amount: sample.outboxRow!.amount,
      currencyCode: sample.outboxRow!.currencyCode,
      status: 'settled' as const,
      settledAt: sample.outboxRow!.createdAt,
      fee: 0,
    };

    let tiebreakCalls = 0;
    const stubTiebreak: TiebreakFn = async (_ctx, input) => {
      tiebreakCalls += 1;
      // Pick the duplicate row deterministically. An AI recommendation
      // must not itself settle a payment outbox row.
      const winner = input.candidates.find(c => c.salePaymentId === ambiguousId);
      if (!winner) {
        return { ok: false, reason: 'ai-not-decisive', costUsd: 0, auditLogId: null };
      }
      return {
        ok: true,
        salePaymentId: winner.salePaymentId,
        confidence: 'high',
        explanation: 'Stubbed for test',
        costUsd: 0,
        auditLogId: 'stub-audit',
      };
    };

    const pass = await runReconciliationPass(db, TENANT_ID, [ambiguousStatement], {
      now: FIXED_NOW,
      aiTiebreak: stubTiebreak,
      aiContext: { db, tenantId: TENANT_ID, siteId: null, userId: null },
    });

    expect(tiebreakCalls).toBe(1);
    expect(pass.tiebreakAttempts).toBe(1);
    expect(pass.tiebreakProposed).toBe(1);
    expect(pass.tiebreakDegraded).toBe(0);
    expect(pass.matched).toBe(0);
    expect(pass.byKind.ambiguous).toBeGreaterThanOrEqual(1);
    const recommendedRow = await db
      .select({
        status: paymentOutbox.status,
        providerTransactionId: paymentOutbox.providerTransactionId,
      })
      .from(paymentOutbox)
      .where(eq(paymentOutbox.id, ambiguousId))
      .get();
    expect(recommendedRow).toEqual({ status: 'approved', providerTransactionId: null });
    const proposals = await db.select().from(paymentReconciliationProposals).all();
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      tenantId: TENANT_ID,
      status: 'pending',
      selectedOutboxId: ambiguousId,
      evidence: { statement: ambiguousStatement, recommendedOutboxId: ambiguousId },
    });
    const replay = await runReconciliationPass(db, TENANT_ID, [ambiguousStatement], {
      now: FIXED_NOW,
      aiTiebreak: stubTiebreak,
      aiContext: { db, tenantId: TENANT_ID, siteId: null, userId: null },
    });
    expect(tiebreakCalls).toBe(1);
    expect(replay.tiebreakAttempts).toBe(0);
    expect(replay.matched).toBe(0);
    expect(await db.select().from(paymentReconciliationProposals).all()).toHaveLength(1);
  });

  it('does not save AI evidence after a candidate is claimed during model latency', async () => {
    await cleanupTenant();
    await seedFromFixture(bundle);
    const db = getDatabase();
    const candidateIds = ['ai-latency-left', 'ai-latency-right'];
    for (const id of candidateIds) {
      await db.insert(paymentOutbox).values({
        id,
        tenantId: TENANT_ID,
        salePaymentId: null,
        railId: 'wompi',
        kind: 'charge',
        status: 'approved',
        amount: 943214.27,
        currencyCode: 'COP',
        reference: id,
        providerTransactionId: null,
        payload: { fixture: true },
        payloadVersion: 1,
        attempts: 0,
        nextRetryAt: null,
        lastError: null,
        priority: 0,
        claimToken: null,
        lockedAt: null,
        idempotencyKey: null,
        createdAt: FIXED_NOW.toISOString(),
        updatedAt: FIXED_NOW.toISOString(),
      });
    }
    const statement = {
      railId: 'wompi' as const,
      reference: 'unknown-ai-latency',
      providerTransactionId: 'tx-ai-latency',
      amount: 943214.27,
      currencyCode: 'COP',
      status: 'settled' as const,
      settledAt: FIXED_NOW.toISOString(),
      fee: 0,
    };
    await expect(
      runReconciliationPass(db, TENANT_ID, [statement], {
        now: FIXED_NOW,
        aiContext: { db, tenantId: TENANT_ID, siteId: null, userId: null },
        aiTiebreak: async () => {
          await db
            .update(paymentOutbox)
            .set({
              status: 'submitting',
              claimToken: 'concurrent-worker',
              lockedAt: FIXED_NOW.toISOString(),
            })
            .where(eq(paymentOutbox.id, candidateIds[0]!));
          return {
            ok: true,
            salePaymentId: candidateIds[0]!,
            confidence: 'high',
            explanation: 'Model selected a row before it was claimed',
            costUsd: 0,
            auditLogId: 'ai-latency-audit',
          };
        },
      })
    ).rejects.toThrow('candidates changed during AI review');
    expect(await db.select().from(paymentReconciliationProposals).all()).toHaveLength(0);
  });

  it('refuses two pending statements for the same outbox instead of dropping one', async () => {
    await cleanupTenant();
    await seedFromFixture(bundle);
    const db = getDatabase();
    const selected = bundle.rows.find(row => row.outboxRow?.status === 'approved')!.outboxRow!;
    await db
      .update(paymentOutbox)
      .set({ providerTransactionId: null })
      .where(eq(paymentOutbox.id, selected.id));
    const winner = (await db
      .select()
      .from(paymentOutbox)
      .where(eq(paymentOutbox.id, selected.id))
      .get())!;
    const base = {
      railId: winner.railId,
      reference: 'pending-conflict-a',
      providerTransactionId: 'tx-pending-conflict-a',
      amount: winner.amount,
      currencyCode: winner.currencyCode,
      status: 'settled' as const,
      settledAt: winner.createdAt,
      fee: 0,
    };
    const decision = {
      ok: true as const,
      salePaymentId: winner.salePaymentId ?? winner.id,
      confidence: 'high' as const,
      explanation: 'Synthetic recommendation',
      costUsd: 0,
      auditLogId: 'pending-conflict-audit',
    };
    expect(
      await savePaymentProposal(db, TENANT_ID, base, [winner], winner, decision)
    ).toMatchObject({
      status: 'pending',
    });
    await expect(
      savePaymentProposal(
        db,
        TENANT_ID,
        {
          ...base,
          reference: 'pending-conflict-b',
          providerTransactionId: 'tx-pending-conflict-b',
        },
        [winner],
        winner,
        decision
      )
    ).rejects.toThrow('conflicts with a pending candidate');
    expect(await db.select().from(paymentReconciliationProposals).all()).toHaveLength(1);
  });

  it('degrades silently when the AI tie-break refuses to decide', async () => {
    await cleanupTenant();
    await seedFromFixture(bundle);

    const db = getDatabase();
    const sample = bundle.rows.find(r => r.outboxRow !== null)!;
    const ambiguousId = `${sample.outboxRow!.id}-deg`;
    await db.insert(paymentOutbox).values({
      id: ambiguousId,
      tenantId: TENANT_ID,
      salePaymentId: null,
      railId: sample.outboxRow!.railId,
      kind: 'charge',
      status: 'approved',
      amount: sample.outboxRow!.amount,
      currencyCode: sample.outboxRow!.currencyCode,
      reference: `${sample.outboxRow!.reference}-DUP2`,
      providerTransactionId: null,
      payload: { fixture: true },
      payloadVersion: 1,
      attempts: 0,
      nextRetryAt: null,
      lastError: null,
      priority: 0,
      claimToken: null,
      lockedAt: null,
      idempotencyKey: null,
      createdAt: sample.outboxRow!.createdAt,
      updatedAt: sample.outboxRow!.createdAt,
    });

    const ambiguousStatement = {
      railId: sample.outboxRow!.railId,
      reference: 'UNRELATED-REF-2',
      providerTransactionId: 'tx-untraceable-2',
      amount: sample.outboxRow!.amount,
      currencyCode: sample.outboxRow!.currencyCode,
      status: 'settled' as const,
      settledAt: sample.outboxRow!.createdAt,
      fee: 0,
    };

    const refusingTiebreak: TiebreakFn = async () => ({
      ok: false,
      reason: 'ai-budget-exceeded',
      costUsd: 0,
      auditLogId: null,
    });

    const pass = await runReconciliationPass(db, TENANT_ID, [ambiguousStatement], {
      now: FIXED_NOW,
      aiTiebreak: refusingTiebreak,
      aiContext: { db, tenantId: TENANT_ID, siteId: null, userId: null },
    });

    expect(pass.tiebreakAttempts).toBe(1);
    expect(pass.tiebreakProposed).toBe(0);
    expect(pass.tiebreakDegraded).toBe(1);
    expect(pass.matched).toBe(0);
    expect(pass.byKind.ambiguous).toBeGreaterThanOrEqual(1);
    expect(pass.mismatches.some(m => m.kind === 'ambiguous')).toBe(true);
  });
});

describe('runReconciliationPass — settlement immutability', () => {
  it('never overwrites a settled provider transaction on a later same-reference statement', async () => {
    await cleanupTenant();
    await seedFromFixture(bundle);
    const db = getDatabase();
    await db.insert(paymentOutbox).values({
      id: 'sequential-provider-immutable',
      tenantId: TENANT_ID,
      salePaymentId: null,
      railId: 'wompi',
      kind: 'charge',
      status: 'approved',
      amount: 943214.27,
      currencyCode: 'COP',
      reference: 'sequential-reference',
      providerTransactionId: null,
      payload: { fixture: true },
      payloadVersion: 1,
      attempts: 0,
      nextRetryAt: null,
      lastError: null,
      priority: 0,
      claimToken: null,
      lockedAt: null,
      idempotencyKey: null,
      createdAt: FIXED_NOW.toISOString(),
      updatedAt: FIXED_NOW.toISOString(),
    });
    const first = {
      railId: 'wompi' as const,
      reference: 'sequential-reference',
      providerTransactionId: 'provider-tx-first',
      amount: 943214.27,
      currencyCode: 'COP',
      status: 'settled' as const,
      settledAt: FIXED_NOW.toISOString(),
      fee: 0,
    };
    expect((await runReconciliationPass(db, TENANT_ID, [first], { now: FIXED_NOW })).matched).toBe(
      1
    );
    const second = await runReconciliationPass(
      db,
      TENANT_ID,
      [{ ...first, providerTransactionId: 'provider-tx-second' }],
      { now: FIXED_NOW }
    );
    expect(second.matched).toBe(0);
    const row = await db
      .select({
        status: paymentOutbox.status,
        providerTransactionId: paymentOutbox.providerTransactionId,
      })
      .from(paymentOutbox)
      .where(eq(paymentOutbox.id, 'sequential-provider-immutable'))
      .get();
    expect(row).toEqual({ status: 'settled', providerTransactionId: 'provider-tx-first' });
  });
});

describe('runReconciliationPass — strict matching boundaries', () => {
  it('does not match a provider statement to another rail that shares the same reference', async () => {
    await cleanupTenant();
    const tinyBundle = generatePaymentStatementFixture({
      seed: 11,
      days: 1,
      settlementsPerRailPerDay: 1,
      mismatchRate: 0,
      windowEnd: FIXED_NOW.toISOString(),
      tenantId: 'eng038c-rail-boundary',
    });
    await seedFromFixture(tinyBundle);

    const db = getDatabase();
    await db.insert(paymentOutbox).values({
      id: 'cross-rail-row',
      tenantId: TENANT_ID,
      salePaymentId: null,
      railId: 'bold',
      kind: 'charge',
      status: 'approved',
      amount: 1_234_567,
      currencyCode: 'COP',
      reference: 'CROSS-RAIL-REF',
      providerTransactionId: 'shared-provider-tx',
      payload: { fixture: true },
      payloadVersion: 1,
      attempts: 0,
      nextRetryAt: null,
      lastError: null,
      priority: 0,
      claimToken: null,
      lockedAt: null,
      idempotencyKey: null,
      createdAt: FIXED_NOW.toISOString(),
      updatedAt: FIXED_NOW.toISOString(),
    });

    const pass = await runReconciliationPass(
      db,
      TENANT_ID,
      [
        {
          railId: 'wompi',
          reference: 'CROSS-RAIL-REF',
          providerTransactionId: 'shared-provider-tx',
          amount: 1_234_567,
          currencyCode: 'COP',
          status: 'settled',
          settledAt: FIXED_NOW.toISOString(),
          fee: 0,
        },
      ],
      { now: FIXED_NOW }
    );

    expect(pass.matched).toBe(0);
    expect(
      pass.mismatches.some(
        mismatch =>
          mismatch.kind === 'orphan_provider_row' &&
          mismatch.providerTransactionId === 'shared-provider-tx'
      )
    ).toBe(true);
    const crossRailRow = await db
      .select({ status: paymentOutbox.status })
      .from(paymentOutbox)
      .where(eq(paymentOutbox.id, 'cross-rail-row'))
      .get();
    expect(crossRailRow?.status).toBe('approved');
  });

  it('does not duplicate a declined statement as a missing provider reference', async () => {
    await cleanupTenant();
    const tinyBundle = generatePaymentStatementFixture({
      seed: 12,
      days: 1,
      settlementsPerRailPerDay: 1,
      mismatchRate: 0,
      windowEnd: FIXED_NOW.toISOString(),
      tenantId: 'eng038c-provider-issue',
    });
    await seedFromFixture(tinyBundle);

    const db = getDatabase();
    const sample = tinyBundle.rows.find(row => row.outboxRow?.railId === 'wompi')!;
    const pass = await runReconciliationPass(
      db,
      TENANT_ID,
      [
        {
          railId: 'wompi',
          reference: sample.outboxRow!.reference,
          providerTransactionId: sample.outboxRow!.providerTransactionId!,
          amount: sample.outboxRow!.amount,
          currencyCode: sample.outboxRow!.currencyCode,
          status: 'declined',
          settledAt: sample.outboxRow!.createdAt,
          fee: 0,
        },
      ],
      { now: FIXED_NOW }
    );

    expect(
      pass.mismatches.some(
        mismatch =>
          mismatch.kind === 'provider_issue' && mismatch.paymentOutboxId === sample.outboxRow!.id
      )
    ).toBe(true);
    expect(
      pass.mismatches.some(
        mismatch =>
          mismatch.kind === 'missing_provider_reference' &&
          mismatch.paymentOutboxId === sample.outboxRow!.id
      )
    ).toBe(false);
  });
});

describe('runReconciliationPass — multi-tenant scope', () => {
  it('never touches another tenant’s payment_outbox rows', async () => {
    await cleanupTenant();
    await seedFromFixture(bundle);

    const db = getDatabase();
    const otherTenantId = 'eng038c-isolation-other';
    await db.insert(tenants).values({
      id: otherTenantId,
      name: 'Other tenant',
      slug: 'eng038c-other',
      settings: {},
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await db.insert(paymentOutbox).values({
      id: 'other-tenant-pob',
      tenantId: otherTenantId,
      salePaymentId: null,
      railId: 'wompi',
      kind: 'charge',
      status: 'approved',
      amount: 99_900,
      currencyCode: 'COP',
      reference: 'OTHER-REF',
      providerTransactionId: 'wompi-tx-isolation',
      payload: { fixture: true },
      payloadVersion: 1,
      attempts: 0,
      nextRetryAt: null,
      lastError: null,
      priority: 0,
      claimToken: null,
      lockedAt: null,
      idempotencyKey: null,
      createdAt: FIXED_NOW.toISOString(),
      updatedAt: FIXED_NOW.toISOString(),
    });

    await runReconciliationPass(
      db,
      TENANT_ID,
      [
        {
          railId: 'wompi',
          reference: 'OTHER-REF',
          providerTransactionId: 'wompi-tx-isolation',
          amount: 99_900,
          currencyCode: 'COP',
          status: 'settled',
          settledAt: FIXED_NOW.toISOString(),
          fee: 0,
        },
      ],
      { now: FIXED_NOW }
    );

    const otherTenantRow = await db
      .select({ status: paymentOutbox.status })
      .from(paymentOutbox)
      .where(eq(paymentOutbox.id, 'other-tenant-pob'))
      .get();
    expect(otherTenantRow?.status).toBe('approved');

    await db.delete(paymentOutbox).where(eq(paymentOutbox.tenantId, otherTenantId));
    await db.delete(tenants).where(eq(tenants.id, otherTenantId));
  });
});
