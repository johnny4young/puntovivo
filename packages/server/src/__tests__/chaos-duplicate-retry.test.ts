/**
 * ENG-067 — Chaos: duplicate retry across outbox retry paths.
 *
 * Pins the idempotency contract at the boundary every retry hits when a
 * worker process crashes mid-tick: a same-envelope retry MUST collapse
 * to a single row.
 *
 * Coverage matrix:
 *
 *   - sync_outbox  — partial unique idx idempotent (ENG-064). Already
 *     exercised end-to-end in `sync-contract-v1.test.ts`. This file
 *     re-asserts the cross-tenant safety story (same key on tenant A
 *     vs tenant B → two rows, not one) so the multi-tenant invariant
 *     stays under chaos coverage.
 *   - hardware_outbox — DOES NOT have a schema-level unique index.
 *     The chaos test documents the gap explicitly: enqueue twice with
 *     the same `(tenantId, kind, payload)` → two rows result. If a
 *     follow-up ticket adds idempotency (e.g. via the operation
 *     envelope `idempotencyKey`), the assertion flips and this test
 *     pins the new contract.
 *
 * @module __tests__/chaos-duplicate-retry
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  hardwareOutbox,
  syncOutbox,
  tenants,
  users,
} from '../db/schema.js';
import { enqueueSync } from '../services/sync/enqueue.js';

let server: PuntovivoServer;

interface ChaosHarness {
  tenantId: string;
  userId: string;
}

async function seedHarness(suffix: string): Promise<ChaosHarness> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `chaos-dup-tenant-${suffix}`;
  const userId = `chaos-dup-user-${suffix}`;

  await db.insert(tenants).values({
    id: tenantId,
    name: `Chaos Dup Tenant ${suffix}`,
    slug: `chaos-dup-${suffix}`,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values({
    id: userId,
    tenantId,
    email: `admin-${suffix}@chaos-dup.test`,
    name: `Admin ${suffix}`,
    passwordHash: 'x',
    sessionVersion: 1,
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return { tenantId, userId };
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});

afterAll(async () => {
  await server.close();
});

describe('chaos: duplicate retry across outboxes (ENG-067)', () => {
  describe('sync_outbox cross-tenant safety with shared idempotencyKey', () => {
    it('produces ONE row per tenant when the same key collides with the partial unique idx', async () => {
      const db = getDatabase();
      const a = await seedHarness('sync-a');
      const b = await seedHarness('sync-b');

      // Same envelope key on both tenants. The partial unique idx is
      // tenant-scoped, so each tenant collapses its OWN duplicates but
      // never each other's.
      const sharedKey = `chaos-key-${nanoid()}`;
      const entityId = nanoid();

      // deviceId is a soft FK with `set null` on delete, but the FK
      // is enforced at insert. We leave it null for chaos-only fixtures
      // so we don't have to seed `devices` rows for the dedup contract.
      const ctxA = {
        tenantId: a.tenantId,
        db,
        envelope: { operationId: nanoid(), idempotencyKey: sharedKey },
        deviceId: null,
      };
      const ctxB = {
        tenantId: b.tenantId,
        db,
        envelope: { operationId: nanoid(), idempotencyKey: sharedKey },
        deviceId: null,
      };

      // Tenant A retries twice.
      const r1 = await enqueueSync(ctxA, {
        entityType: 'sales',
        entityId,
        operation: 'create',
        data: { sample: 1 },
      });
      const r2 = await enqueueSync(ctxA, {
        entityType: 'sales',
        entityId,
        operation: 'create',
        data: { sample: 2 },
      });
      // Tenant B's writes use the SAME key.
      const r3 = await enqueueSync(ctxB, {
        entityType: 'sales',
        entityId,
        operation: 'create',
        data: { sample: 3 },
      });

      expect(r1.id).toBe(r2.id);
      expect(r2.deduped).toBe(true);
      expect(r3.id).not.toBe(r1.id);

      const rowsA = await db
        .select({ id: syncOutbox.id })
        .from(syncOutbox)
        .where(eq(syncOutbox.tenantId, a.tenantId))
        .all();
      const rowsB = await db
        .select({ id: syncOutbox.id })
        .from(syncOutbox)
        .where(eq(syncOutbox.tenantId, b.tenantId))
        .all();
      expect(rowsA).toHaveLength(1);
      expect(rowsB).toHaveLength(1);
    });
  });

  describe('hardware_outbox has NO schema-level idempotency today', () => {
    /**
     * Documents the current contract so a future tightening (adding a
     * partial unique idx + envelope-keyed dedup) flips the assertion
     * and the test stays meaningful.
     *
     * The risk this gap creates: a worker process that crashes after
     * ESCPos transmission but before status flip can lead to a printed
     * receipt that doesn't get marked `printed`. A second worker boot
     * picks the row up via stale-claim sweep and re-prints it. ENG-067b
     * (potential follow-up) would close this by giving the enqueue path
     * a `(tenantId, idempotencyKey)` partial unique idx.
     */
    it('two enqueues with the same envelope produce TWO rows (gap documented)', async () => {
      const db = getDatabase();
      const h = await seedHarness('hw');
      const sharedKey = `chaos-hw-${nanoid()}`;
      const samePayload = {
        kind: 'print-receipt' as const,
        idempotencyKey: sharedKey,
      };

      const id1 = nanoid();
      const id2 = nanoid();
      await db.insert(hardwareOutbox).values({
        id: id1,
        tenantId: h.tenantId,
        status: 'queued',
        kind: 'print-receipt',
        payload: samePayload,
        payloadVersion: 1,
        attempts: 0,
        priority: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      await db.insert(hardwareOutbox).values({
        id: id2,
        tenantId: h.tenantId,
        status: 'queued',
        kind: 'print-receipt',
        payload: samePayload,
        payloadVersion: 1,
        attempts: 0,
        priority: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const rows = await db
        .select({ id: hardwareOutbox.id })
        .from(hardwareOutbox)
        .where(eq(hardwareOutbox.tenantId, h.tenantId))
        .all();
      // Today: two rows. If a future migration adds dedup, this expectation
      // flips to `toHaveLength(1)` and that flip is the right break point.
      expect(rows).toHaveLength(2);
      expect(rows.map(r => r.id).sort()).toEqual([id1, id2].sort());
    });
  });

  describe('cross-tenant safety on hardware_outbox', () => {
    it('same key on tenants A and B always produces two rows (no leakage)', async () => {
      const db = getDatabase();
      const a = await seedHarness('hw-cta');
      const b = await seedHarness('hw-ctb');
      const sharedKey = `chaos-cross-${nanoid()}`;
      const samePayload = { kind: 'print-receipt' as const, idempotencyKey: sharedKey };

      await db.insert(hardwareOutbox).values({
        id: nanoid(),
        tenantId: a.tenantId,
        status: 'queued',
        kind: 'print-receipt',
        payload: samePayload,
        payloadVersion: 1,
        attempts: 0,
        priority: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      await db.insert(hardwareOutbox).values({
        id: nanoid(),
        tenantId: b.tenantId,
        status: 'queued',
        kind: 'print-receipt',
        payload: samePayload,
        payloadVersion: 1,
        attempts: 0,
        priority: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const rowsA = await db
        .select({ id: hardwareOutbox.id })
        .from(hardwareOutbox)
        .where(eq(hardwareOutbox.tenantId, a.tenantId))
        .all();
      const rowsB = await db
        .select({ id: hardwareOutbox.id })
        .from(hardwareOutbox)
        .where(eq(hardwareOutbox.tenantId, b.tenantId))
        .all();
      expect(rowsA).toHaveLength(1);
      expect(rowsB).toHaveLength(1);
    });
  });
});
