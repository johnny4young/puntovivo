/**
 * ENG-067b — `enqueueHardware` helper tests.
 *
 * Pins the dedup contract that closes the gap ENG-067 documented:
 * a same-envelope retry to hardware_outbox MUST collapse to a single
 * row when an idempotencyKey is provided, and MUST stay independent
 * when no key is provided (legacy "user pressed Print twice → two
 * prints" path).
 *
 * Cases:
 *   1. Insert without idempotencyKey → fresh row, deduped: false.
 *   2. Insert with idempotencyKey (first call) → fresh row, deduped: false.
 *   3. Insert with same key (second call) → same id, deduped: true.
 *   4. Insert with same key on a different tenant → independent fresh row.
 *   5. Insert with same key but DIFFERENT kind → two rows (idx includes kind).
 *   6. Empty-string idempotencyKey is normalized to null (no dedup).
 *   7. Helper rethrows non-UNIQUE errors (e.g. FK violation).
 *   8. Public input schemas normalize empty-string idempotencyKey to omitted.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { hardwareOutbox, tenants } from '../db/schema.js';
import { enqueueHardware } from '../services/peripherals/enqueue-hardware.js';
import {
  kickCashDrawerInput,
  printReceiptInput,
} from '../trpc/schemas/peripherals.js';

let server: PuntovivoServer;

interface HwHarness {
  tenantId: string;
}

async function seedHarness(suffix: string): Promise<HwHarness> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `eq-hw-tenant-${suffix}`;
  await db.insert(tenants).values({
    id: tenantId,
    name: `EnqueueHw Tenant ${suffix}`,
    slug: `eq-hw-${suffix}`,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return { tenantId };
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});

afterAll(async () => {
  await server.close();
});

describe('hardware idempotency input schemas (ENG-067b)', () => {
  it('normalizes empty-string idempotencyKey to omitted at the tRPC boundary', () => {
    const printInput = printReceiptInput.parse({
      saleId: 'sale-1',
      siteId: 'site-1',
      idempotencyKey: '',
    });
    const kickInput = kickCashDrawerInput.parse({
      siteId: 'site-1',
      idempotencyKey: '',
    });

    expect(printInput.idempotencyKey).toBeUndefined();
    expect(kickInput.idempotencyKey).toBeUndefined();
  });
});

describe('enqueueHardware (ENG-067b)', () => {
  it('inserts a fresh row when idempotencyKey is omitted', async () => {
    const db = getDatabase();
    const h = await seedHarness('omit');
    const result = await enqueueHardware(
      { db, tenantId: h.tenantId },
      {
        kind: 'print-receipt',
        peripheralId: null,
        payload: { kind: 'print-receipt', sample: 1 },
      }
    );
    expect(result.deduped).toBe(false);
    expect(result.id).toBeTruthy();

    const rows = await db
      .select({ id: hardwareOutbox.id, idempotencyKey: hardwareOutbox.idempotencyKey })
      .from(hardwareOutbox)
      .where(eq(hardwareOutbox.tenantId, h.tenantId))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.idempotencyKey).toBeNull();
  });

  it('first call with idempotencyKey returns fresh row + deduped:false', async () => {
    const db = getDatabase();
    const h = await seedHarness('first');
    const key = `key-${nanoid()}`;
    const result = await enqueueHardware(
      { db, tenantId: h.tenantId },
      {
        kind: 'print-receipt',
        peripheralId: null,
        payload: { kind: 'print-receipt' },
        idempotencyKey: key,
      }
    );
    expect(result.deduped).toBe(false);
  });

  it('second call with same key collapses to one row', async () => {
    const db = getDatabase();
    const h = await seedHarness('dedup');
    const key = `key-${nanoid()}`;

    const r1 = await enqueueHardware(
      { db, tenantId: h.tenantId },
      {
        kind: 'print-receipt',
        peripheralId: null,
        payload: { kind: 'print-receipt', attempt: 1 },
        idempotencyKey: key,
      }
    );
    const r2 = await enqueueHardware(
      { db, tenantId: h.tenantId },
      {
        kind: 'print-receipt',
        peripheralId: null,
        payload: { kind: 'print-receipt', attempt: 2 },
        idempotencyKey: key,
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
  });

  it('same key on different tenants produces independent rows', async () => {
    const db = getDatabase();
    const a = await seedHarness('cross-a');
    const b = await seedHarness('cross-b');
    const sharedKey = `key-${nanoid()}`;

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

  it('same key but different kind produces two rows (idx includes kind)', async () => {
    const db = getDatabase();
    const h = await seedHarness('kind');
    const sharedKey = `key-${nanoid()}`;

    const r1 = await enqueueHardware(
      { db, tenantId: h.tenantId },
      {
        kind: 'print-receipt',
        peripheralId: null,
        payload: { kind: 'print-receipt' },
        idempotencyKey: sharedKey,
      }
    );
    const r2 = await enqueueHardware(
      { db, tenantId: h.tenantId },
      {
        kind: 'kick-drawer',
        peripheralId: null,
        payload: { kind: 'kick-drawer' },
        idempotencyKey: sharedKey,
      }
    );

    expect(r1.deduped).toBe(false);
    expect(r2.deduped).toBe(false);
    expect(r1.id).not.toBe(r2.id);

    const rows = await db
      .select({ id: hardwareOutbox.id, kind: hardwareOutbox.kind })
      .from(hardwareOutbox)
      .where(eq(hardwareOutbox.tenantId, h.tenantId))
      .all();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(r => r.kind))).toEqual(
      new Set(['print-receipt', 'kick-drawer'])
    );
  });

  it('empty-string idempotencyKey is normalized to null (no dedup)', async () => {
    const db = getDatabase();
    const h = await seedHarness('empty');

    const r1 = await enqueueHardware(
      { db, tenantId: h.tenantId },
      {
        kind: 'print-receipt',
        peripheralId: null,
        payload: { kind: 'print-receipt' },
        idempotencyKey: '',
      }
    );
    const r2 = await enqueueHardware(
      { db, tenantId: h.tenantId },
      {
        kind: 'print-receipt',
        peripheralId: null,
        payload: { kind: 'print-receipt' },
        idempotencyKey: '',
      }
    );

    expect(r1.deduped).toBe(false);
    expect(r2.deduped).toBe(false);
    expect(r1.id).not.toBe(r2.id);

    const rows = await db
      .select({
        id: hardwareOutbox.id,
        idempotencyKey: hardwareOutbox.idempotencyKey,
      })
      .from(hardwareOutbox)
      .where(eq(hardwareOutbox.tenantId, h.tenantId))
      .all();
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.idempotencyKey === null)).toBe(true);
  });

  it('rethrows non-UNIQUE errors instead of swallowing them as deduped', async () => {
    const db = getDatabase();
    // Force a foreign-key violation by passing a tenantId that
    // doesn't exist in `tenants`. The FK error is NOT a UNIQUE
    // constraint failure, so the helper must rethrow rather than
    // silently return `{deduped: true}`.
    const orphanTenantId = `nonexistent-tenant-${nanoid()}`;
    await expect(
      enqueueHardware(
        { db, tenantId: orphanTenantId },
        {
          kind: 'print-receipt',
          peripheralId: null,
          payload: {},
          idempotencyKey: 'key-throw',
        }
      )
    ).rejects.toThrow(/FOREIGN KEY|constraint failed/i);

    const rows = await db
      .select({ id: hardwareOutbox.id })
      .from(hardwareOutbox)
      .where(eq(hardwareOutbox.tenantId, orphanTenantId))
      .all();
    expect(rows).toHaveLength(0);
  });
});
