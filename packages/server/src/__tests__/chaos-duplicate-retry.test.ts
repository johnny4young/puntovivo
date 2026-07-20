/**
 * Chaos: duplicate retry across outbox retry paths.
 *
 * Pins the idempotency contract at the boundary every retry hits when a
 * worker process crashes mid-tick: a same-envelope retry MUST collapse
 * to a single row.
 *
 * Coverage matrix:
 *
 * - sync_outbox  — partial unique idx idempotent (). Already
 * exercised end-to-end in `sync-contract-v1.test.ts`. This file
 * re-asserts the cross-tenant safety story (same key on tenant A
 * vs tenant B → two rows, not one) so the multi-tenant invariant
 * stays under chaos coverage.
 * - hardware_outbox — DOES NOT have a schema-level unique index.
 * The chaos test documents the gap explicitly: enqueue twice with
 * the same `(tenantId, kind, payload)` → two rows result. If a
 * follow-up change adds idempotency (e.g. via the operation
 * envelope `idempotencyKey`), the assertion flips and this test
 * pins the new contract.
 *
 * @module __tests__/chaos-duplicate-retry
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { hardwareOutbox, syncOutbox, tenants, users } from '../db/schema.js';
import { enqueueSync } from '../services/sync/enqueue.js';
import { enqueueHardware } from '../services/peripherals/enqueue-hardware.js';

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

describe('chaos: duplicate retry across outboxes', () => {
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

  describe('hardware_outbox idempotent retry collapses to one row', () => {
    /**
     * documented the gap: two enqueues with the same envelope
     * produced TWO rows in `hardware_outbox`.  closed it by
     * adding a nullable `idempotency_key` column + partial unique idx
     * `(tenant_id, kind, idempotency_key) WHERE idempotency_key IS
     * NOT NULL` and routing both inline insert sites through
     * `enqueueHardware()`.
     *
     * The test now PROVES the dedup contract: same envelope → one
     * row, second call returns `{deduped: true}`. The legacy "no key
     * provided → two rows" path stays under cover by the
     * `enqueue-hardware.test.ts > inserts a fresh row when
     * idempotencyKey is omitted` case, so this chaos test focuses
     * specifically on the with-key path.
     */
    it('two enqueues with the same envelope key collapse to ONE row', async () => {
      const db = getDatabase();
      const h = await seedHarness('hw');
      const sharedKey = `chaos-hw-${nanoid()}`;

      const r1 = await enqueueHardware(
        { db, tenantId: h.tenantId },
        {
          kind: 'print-receipt',
          peripheralId: null,
          payload: { kind: 'print-receipt', attempt: 1 },
          idempotencyKey: sharedKey,
        }
      );
      const r2 = await enqueueHardware(
        { db, tenantId: h.tenantId },
        {
          kind: 'print-receipt',
          peripheralId: null,
          payload: { kind: 'print-receipt', attempt: 2 },
          idempotencyKey: sharedKey,
        }
      );

      expect(r1.deduped).toBe(false);
      expect(r2.deduped).toBe(true);
      expect(r2.id).toBe(r1.id);

      const rows = await db
        .select({ id: hardwareOutbox.id })
        .from(hardwareOutbox)
        .where(eq(hardwareOutbox.tenantId, h.tenantId))
        .all();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(r1.id);
    });
  });

  describe('cross-tenant safety on hardware_outbox', () => {
    it('same envelope key on tenants A and B produces two independent rows', async () => {
      const db = getDatabase();
      const a = await seedHarness('hw-cta');
      const b = await seedHarness('hw-ctb');
      const sharedKey = `chaos-cross-${nanoid()}`;

      const ra = await enqueueHardware(
        { db, tenantId: a.tenantId },
        {
          kind: 'print-receipt',
          peripheralId: null,
          payload: { kind: 'print-receipt' },
          idempotencyKey: sharedKey,
        }
      );
      const rb = await enqueueHardware(
        { db, tenantId: b.tenantId },
        {
          kind: 'print-receipt',
          peripheralId: null,
          payload: { kind: 'print-receipt' },
          idempotencyKey: sharedKey,
        }
      );

      expect(ra.deduped).toBe(false);
      expect(rb.deduped).toBe(false);
      expect(ra.id).not.toBe(rb.id);

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
