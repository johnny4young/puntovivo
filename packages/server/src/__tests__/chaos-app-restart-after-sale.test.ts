/**
 * Chaos: app restart after sale.
 *
 * The retail-store failure mode this guards against: a cajero apaga
 * la laptop mid-tick. The fiscal/hardware worker had claimed a row
 * (`status='submitting'` + `claimToken='abc'` + `lockedAt=now`) and
 * was about to flip it to `accepted`/`printed`, but the process
 * died. On the next boot, that row is stuck forever unless the
 * stale-claim sweep reclaims it.
 *
 * Both `fiscal-worker.ts` and `hardware-worker.ts` run a
 * `sweepStaleClaims()` at `start()` (before the first periodic tick)
 * + every `STALE_CLAIM_MS` (5 min) thereafter. The sweep flips
 * `claim_token`/`locked_at` to `null` and resets `submitting` →
 * `queued`.
 *
 * This file exercises the sweep by:
 * 1. Booting a server (which auto-starts both workers + runs an
 * initial sweep against an empty table).
 * 2. Inserting an outbox row with a stale claim token + a
 * `lockedAt` from 6 minutes ago.
 * 3. Calling `worker.stop()` then `worker.start()` to force a
 * fresh sweep without waiting 5 minutes.
 * 4. Asserting the row was reclaimed.
 *
 * Sync worker daemon does NOT exist today (sync remains
 * operator-driven per  close-out). The third case asserts
 * this gap explicitly so a future change that introduces the daemon
 * can mirror the assertion shape.
 *
 * @module __tests__/chaos-app-restart-after-sale
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, isNotNull, lte, and, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { fiscalOutbox, hardwareOutbox, syncOutbox, tenants } from '../db/schema.js';

let server: PuntovivoServer;
let tenantId: string;

const MINUTE_MS = 60_000;
const STALE_CUTOFF_MS = 6 * MINUTE_MS; // > STALE_CLAIM_MS (5min)

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  tenantId = `chaos-restart-tenant-${nanoid()}`;
  const now = new Date().toISOString();
  await db.insert(tenants).values({
    id: tenantId,
    name: 'Chaos Restart Tenant',
    slug: tenantId,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
});

afterAll(async () => {
  await server.close();
});

/**
 * Re-run a worker's startup sweep without waiting for the periodic
 * interval. We stop+start the worker; `start()` triggers
 * `sweepStaleClaims()` synchronously after re-arming the intervals
 * (the void Promise resolves on the next tick, so we await briefly).
 */
async function bounceFiscalWorker(): Promise<void> {
  await server.fiscalWorker?.stop();
  server.fiscalWorker?.start();
  // The startup sweep is fire-and-forget; let the SQLite write land.
  await new Promise(resolve => setTimeout(resolve, 100));
}

async function bounceHardwareWorker(): Promise<void> {
  await server.hardwareWorker?.stop();
  server.hardwareWorker?.start();
  await new Promise(resolve => setTimeout(resolve, 100));
}

describe('chaos: app restart after sale', () => {
  it('fiscal worker reclaims a stale `submitting` row on boot', async () => {
    const db = getDatabase();
    const rowId = `chaos-fiscal-${nanoid()}`;
    const staleLockedAt = new Date(Date.now() - STALE_CUTOFF_MS).toISOString();
    await db.insert(fiscalOutbox).values({
      id: rowId,
      tenantId,
      status: 'submitting',
      kind: 'emit',
      fiscalDocumentId: null,
      providerId: 'mock-co',
      payload: { kind: 'fixture' },
      payloadVersion: 1,
      attempts: 1,
      claimToken: 'dead-fiscal-claim',
      lockedAt: staleLockedAt,
      createdAt: staleLockedAt,
      updatedAt: staleLockedAt,
    });

    await bounceFiscalWorker();

    const swept = await db
      .select({
        status: fiscalOutbox.status,
        claimToken: fiscalOutbox.claimToken,
        lockedAt: fiscalOutbox.lockedAt,
      })
      .from(fiscalOutbox)
      .where(eq(fiscalOutbox.id, rowId))
      .get();
    expect(swept).toBeDefined();
    expect(swept?.status).toBe('queued');
    expect(swept?.claimToken).toBeNull();
    expect(swept?.lockedAt).toBeNull();
  });

  it('hardware worker reclaims a stale `submitting` row on boot', async () => {
    const db = getDatabase();
    const rowId = `chaos-hw-${nanoid()}`;
    const staleLockedAt = new Date(Date.now() - STALE_CUTOFF_MS).toISOString();
    await db.insert(hardwareOutbox).values({
      id: rowId,
      tenantId,
      status: 'submitting',
      kind: 'print-receipt',
      payload: { kind: 'fixture' },
      payloadVersion: 1,
      attempts: 1,
      claimToken: 'dead-hw-claim',
      lockedAt: staleLockedAt,
      createdAt: staleLockedAt,
      updatedAt: staleLockedAt,
    });

    await bounceHardwareWorker();

    const swept = await db
      .select({
        status: hardwareOutbox.status,
        claimToken: hardwareOutbox.claimToken,
        lockedAt: hardwareOutbox.lockedAt,
      })
      .from(hardwareOutbox)
      .where(eq(hardwareOutbox.id, rowId))
      .get();
    expect(swept).toBeDefined();
    expect(swept?.status).toBe('queued');
    expect(swept?.claimToken).toBeNull();
    expect(swept?.lockedAt).toBeNull();
  });

  it('the sweep ONLY clears stale claims, leaving fresh claims intact', async () => {
    const db = getDatabase();
    const freshId = `chaos-fresh-${nanoid()}`;
    // 1-minute lock — well inside the 5-minute STALE_CLAIM_MS window.
    const freshLockedAt = new Date(Date.now() - MINUTE_MS).toISOString();
    await db.insert(fiscalOutbox).values({
      id: freshId,
      tenantId,
      status: 'submitting',
      kind: 'emit',
      fiscalDocumentId: null,
      providerId: 'mock-co',
      payload: { kind: 'fresh-fixture' },
      payloadVersion: 1,
      attempts: 1,
      claimToken: 'live-fiscal-claim',
      lockedAt: freshLockedAt,
      createdAt: freshLockedAt,
      updatedAt: freshLockedAt,
    });

    await bounceFiscalWorker();

    const after = await db
      .select({
        status: fiscalOutbox.status,
        claimToken: fiscalOutbox.claimToken,
        lockedAt: fiscalOutbox.lockedAt,
      })
      .from(fiscalOutbox)
      .where(eq(fiscalOutbox.id, freshId))
      .get();
    // Fresh claim is preserved — sweeping it would race the worker
    // that's actually doing the work.
    expect(after?.status).toBe('submitting');
    expect(after?.claimToken).toBe('live-fiscal-claim');
    expect(after?.lockedAt).toBe(freshLockedAt);
  });

  it('sync worker daemon gap is documented ( close-out)', async () => {
    // Sync remains operator-driven per . There's no scheduled
    // sweep for sync_outbox today — `sync.retry` is the only re-arm
    // path. This test pins the gap so a future change that adds the
    // sync worker daemon can mirror the assertion shape used by the
    // fiscal + hardware tests above.
    expect((server as Record<string, unknown>).syncWorker).toBeUndefined();

    // Demonstrate the manual sweep SQL works the same way: insert a
    // stale row, run the SQL the worker would run, assert the reset.
    const db = getDatabase();
    const rowId = `chaos-sync-${nanoid()}`;
    const staleLockedAt = new Date(Date.now() - STALE_CUTOFF_MS).toISOString();
    await db.insert(syncOutbox).values({
      id: rowId,
      tenantId,
      status: 'submitting',
      entityType: 'sales',
      entityId: 'chaos-sales-1',
      operation: 'create',
      conflictPolicy: 'manual',
      payload: { kind: 'fixture' },
      payloadVersion: 1,
      attempts: 1,
      claimToken: 'dead-sync-claim',
      lockedAt: staleLockedAt,
      createdAt: staleLockedAt,
      updatedAt: staleLockedAt,
    });

    // Mirror the worker SQL — same shape used in fiscal-worker.ts and
    // hardware-worker.ts. When the sync worker daemon ships, it will
    // own this code; the test then flips to bouncing the worker.
    const cutoff = new Date(Date.now() - 5 * MINUTE_MS).toISOString();
    await db
      .update(syncOutbox)
      .set({
        claimToken: null,
        lockedAt: null,
        status: sql`CASE WHEN ${syncOutbox.status} = 'submitting' THEN 'queued' ELSE ${syncOutbox.status} END`,
        updatedAt: new Date().toISOString(),
      })
      .where(and(isNotNull(syncOutbox.lockedAt), lte(syncOutbox.lockedAt, cutoff)));

    const swept = await db
      .select({
        status: syncOutbox.status,
        claimToken: syncOutbox.claimToken,
        lockedAt: syncOutbox.lockedAt,
      })
      .from(syncOutbox)
      .where(eq(syncOutbox.id, rowId))
      .get();
    expect(swept?.status).toBe('queued');
    expect(swept?.claimToken).toBeNull();
    expect(swept?.lockedAt).toBeNull();
  });
});
