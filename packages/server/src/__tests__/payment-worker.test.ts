/**
 * ENG-038c — Payment worker (Timer A housekeeping + Timer B statement
 * import + catch-up on boot) unit tests.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { paymentOutbox, tenants, users } from '../db/schema.js';
import {
  advanceLastImportedAt,
  createPaymentWorker,
  readLastImportedAtMap,
} from '../services/payments/payment-worker.js';
import type { FetchStatementFn } from '../services/payments/payment-worker.js';
import type { StatementRow } from '../services/payments/reconciliation.js';

const TENANT_ID = 'eng038c-worker-tenant';
const ADMIN_ID = 'eng038c-worker-admin';

let server: PuntovivoServer;

async function seedTenant(): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  await db.insert(tenants).values({
    id: TENANT_ID,
    name: 'ENG-038c worker tenant',
    slug: 'eng038c-worker',
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values({
    id: ADMIN_ID,
    tenantId: TENANT_ID,
    email: 'admin@eng038c-worker.test',
    name: 'Worker admin',
    passwordHash: 'x',
    sessionVersion: 1,
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}

async function cleanupTenant(): Promise<void> {
  const db = getDatabase();
  await db.delete(paymentOutbox).where(eq(paymentOutbox.tenantId, TENANT_ID));
  await db.delete(users).where(eq(users.tenantId, TENANT_ID));
  await db.delete(tenants).where(eq(tenants.id, TENANT_ID));
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  return async () => {
    await server.close();
  };
});

beforeEach(async () => {
  await seedTenant();
});

afterEach(async () => {
  await cleanupTenant();
});

describe('payment-worker housekeeping', () => {
  it('sweeps stale claims and flips submitting rows back to queued', async () => {
    const db = getDatabase();
    const staleCutoffMs = Date.now() - 6 * 60_000;
    await db.insert(paymentOutbox).values({
      id: 'worker-stale-row',
      tenantId: TENANT_ID,
      salePaymentId: null,
      railId: 'wompi',
      kind: 'charge',
      status: 'submitting',
      amount: 50_000,
      currencyCode: 'COP',
      reference: 'STALE-REF',
      providerTransactionId: null,
      payload: { fixture: true },
      payloadVersion: 1,
      attempts: 0,
      nextRetryAt: null,
      lastError: null,
      priority: 0,
      claimToken: 'worker:dead',
      lockedAt: new Date(staleCutoffMs).toISOString(),
      idempotencyKey: null,
      createdAt: new Date(staleCutoffMs).toISOString(),
      updatedAt: new Date(staleCutoffMs).toISOString(),
    });

    const worker = createPaymentWorker({ db });
    await worker.housekeepingTick(TENANT_ID);

    const row = await db
      .select({ status: paymentOutbox.status, claimToken: paymentOutbox.claimToken })
      .from(paymentOutbox)
      .where(eq(paymentOutbox.id, 'worker-stale-row'))
      .get();
    expect(row?.status).toBe('queued');
    expect(row?.claimToken).toBeNull();
  });

  it('does not touch fresh rows whose lockedAt is inside the staleness window', async () => {
    const db = getDatabase();
    await db.insert(paymentOutbox).values({
      id: 'worker-fresh-row',
      tenantId: TENANT_ID,
      salePaymentId: null,
      railId: 'bold',
      kind: 'charge',
      status: 'submitting',
      amount: 21_000,
      currencyCode: 'COP',
      reference: 'FRESH-REF',
      providerTransactionId: null,
      payload: { fixture: true },
      payloadVersion: 1,
      attempts: 0,
      nextRetryAt: null,
      lastError: null,
      priority: 0,
      claimToken: 'worker:alive',
      lockedAt: new Date().toISOString(),
      idempotencyKey: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const worker = createPaymentWorker({ db });
    await worker.housekeepingTick(TENANT_ID);

    const row = await db
      .select({ status: paymentOutbox.status, claimToken: paymentOutbox.claimToken })
      .from(paymentOutbox)
      .where(eq(paymentOutbox.id, 'worker-fresh-row'))
      .get();
    expect(row?.status).toBe('submitting');
    expect(row?.claimToken).toBe('worker:alive');
  });
});

describe('payment-worker statement import', () => {
  it('returns skippedReason=fetcher-missing when no fetcher is wired', async () => {
    const db = getDatabase();
    const worker = createPaymentWorker({ db });
    const outcome = await worker.runStatementImport({
      tenantId: TENANT_ID,
      railId: 'wompi',
      fromIso: '2026-04-01T00:00:00.000Z',
      toIso: '2026-05-01T00:00:00.000Z',
    });
    expect(outcome.skippedReason).toBe('fetcher-missing');
    expect(outcome.pass).toBeNull();
    const markers = await readLastImportedAtMap(db, TENANT_ID);
    expect(markers.wompi).toBeUndefined();
  });

  it('advances lastImportedAt on successful import', async () => {
    const db = getDatabase();
    const fetcher: FetchStatementFn = async () => [];
    const worker = createPaymentWorker({ db, fetchStatement: fetcher });
    const outcome = await worker.runStatementImport({
      tenantId: TENANT_ID,
      railId: 'wompi',
      fromIso: '2026-04-01T00:00:00.000Z',
      toIso: '2026-05-01T00:00:00.000Z',
    });
    expect(outcome.skippedReason).toBeUndefined();
    expect(outcome.pass).not.toBeNull();
    const markers = await readLastImportedAtMap(db, TENANT_ID);
    expect(markers.wompi).toBe('2026-05-01T00:00:00.000Z');
  });

  it('does NOT advance lastImportedAt when fetcher throws', async () => {
    const db = getDatabase();
    const fetcher: FetchStatementFn = async () => {
      throw new Error('network down');
    };
    const worker = createPaymentWorker({ db, fetchStatement: fetcher });
    const outcome = await worker.runStatementImport({
      tenantId: TENANT_ID,
      railId: 'wompi',
      fromIso: '2026-04-01T00:00:00.000Z',
      toIso: '2026-05-01T00:00:00.000Z',
    });
    expect(outcome.skippedReason).toBe('fetch-failed');
    const markers = await readLastImportedAtMap(db, TENANT_ID);
    expect(markers.wompi).toBeUndefined();
  });

  it('walks statement rows into the matcher and counts matched rows', async () => {
    const db = getDatabase();
    await db.insert(paymentOutbox).values({
      id: 'worker-import-row',
      tenantId: TENANT_ID,
      salePaymentId: null,
      railId: 'wompi',
      kind: 'charge',
      status: 'approved',
      amount: 75_000,
      currencyCode: 'COP',
      reference: 'WMP-IMPORT-001',
      providerTransactionId: 'wompi-tx-import',
      payload: { fixture: true },
      payloadVersion: 1,
      attempts: 0,
      nextRetryAt: null,
      lastError: null,
      priority: 0,
      claimToken: null,
      lockedAt: null,
      idempotencyKey: null,
      createdAt: '2026-04-30T12:00:00.000Z',
      updatedAt: '2026-04-30T12:00:00.000Z',
    });

    const fetcher: FetchStatementFn = async (): Promise<StatementRow[]> => [
      {
        railId: 'wompi',
        reference: 'WMP-IMPORT-001',
        providerTransactionId: 'wompi-tx-import',
        amount: 75_000,
        currencyCode: 'COP',
        status: 'settled',
        settledAt: '2026-04-30T12:00:00.000Z',
        fee: 1_125,
      },
    ];
    const worker = createPaymentWorker({ db, fetchStatement: fetcher });

    const outcome = await worker.runStatementImport({
      tenantId: TENANT_ID,
      railId: 'wompi',
      fromIso: '2026-04-01T00:00:00.000Z',
      toIso: '2026-05-01T00:00:00.000Z',
    });

    expect(outcome.pass?.matched).toBe(1);
    const settled = await db
      .select({ status: paymentOutbox.status })
      .from(paymentOutbox)
      .where(eq(paymentOutbox.id, 'worker-import-row'))
      .get();
    expect(settled?.status).toBe('settled');
  });
});

describe('payment-worker catch-up on boot', () => {
  it('triggers an import when lastImportedAt is null (first boot)', async () => {
    const db = getDatabase();
    const calls: Array<{ tenantId: string; railId: string; fromIso: string }> = [];
    const fetcher: FetchStatementFn = async args => {
      calls.push({ tenantId: args.tenantId, railId: args.railId, fromIso: args.fromIso });
      return [];
    };
    // Scope the worker to TENANT_ID so the default seeded tenant in
    // `:memory:` does not double the call count via the fan-out walk.
    const worker = createPaymentWorker({
      db,
      fetchStatement: fetcher,
      tenantIdsProvider: async () => [TENANT_ID],
    });
    await worker.catchUpOnBoot();
    // Six rails × one import per rail when there is no prior marker.
    expect(calls.length).toBe(6);
    const wompiCall = calls.find(call => call.railId === 'wompi');
    expect(wompiCall).toBeDefined();
    expect(wompiCall?.tenantId).toBe(TENANT_ID);
  });

  it('triggers an import when the gap exceeds the catch-up threshold', async () => {
    const db = getDatabase();
    // Set lastImportedAt 14h in the past.
    await advanceLastImportedAt({
      db,
      tenantId: TENANT_ID,
      railId: 'wompi',
      newMarker: new Date(Date.now() - 14 * 60 * 60_000).toISOString(),
    });
    const calls: Array<{ tenantId: string; railId: string }> = [];
    const fetcher: FetchStatementFn = async args => {
      calls.push({ tenantId: args.tenantId, railId: args.railId });
      return [];
    };
    const worker = createPaymentWorker({
      db,
      fetchStatement: fetcher,
      tenantIdsProvider: async () => [TENANT_ID],
    });
    await worker.catchUpOnBoot();
    expect(calls.some(c => c.railId === 'wompi' && c.tenantId === TENANT_ID)).toBe(true);
  });

  it('skips the rail when the gap is below the catch-up threshold', async () => {
    const db = getDatabase();
    await advanceLastImportedAt({
      db,
      tenantId: TENANT_ID,
      railId: 'bold',
      newMarker: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
    });
    const calls: Array<{ tenantId: string; railId: string }> = [];
    const fetcher: FetchStatementFn = async args => {
      calls.push({ tenantId: args.tenantId, railId: args.railId });
      return [];
    };
    const worker = createPaymentWorker({
      db,
      fetchStatement: fetcher,
      tenantIdsProvider: async () => [TENANT_ID],
    });
    await worker.catchUpOnBoot();
    // Bold should be skipped for TENANT_ID (gap below 12h); other rails
    // missing markers still pull. So calls for TENANT_ID must NOT
    // contain bold but should contain wompi (no marker → first-boot).
    const tenantCalls = calls.filter(c => c.tenantId === TENANT_ID);
    expect(tenantCalls.some(c => c.railId === 'bold')).toBe(false);
    expect(tenantCalls.some(c => c.railId === 'wompi')).toBe(true);
  });
});
