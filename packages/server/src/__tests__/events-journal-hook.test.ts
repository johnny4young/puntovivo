/**
 * ENG-070 — Operation-journal → webhook_outbox hook integration test.
 *
 * Drives the full hook end-to-end against an in-memory DB:
 *
 *   - When the events-api module is OFF (default), `markOperationCompleted`
 *     does NOT enqueue a webhook_outbox row.
 *   - When the module is ON, a succeeded `sales.create` → one
 *     webhook_outbox row of type sale.completed.
 *   - When the op fails, no row is enqueued (status≠succeeded short-
 *     circuit).
 *   - Re-marking the same op (idempotent terminal-state guard) does
 *     NOT enqueue a second row — the partial unique idx on
 *     `(tenantId, eventType, idempotencyKey)` collapses replays.
 *
 * The fixture uses `recordOperationStart` + `markOperationCompleted`
 * directly — no full sales.create round-trip needed because the
 * journal hook is the contract under test.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  devices,
  tenants,
  users,
  webhookOutbox,
} from '../db/schema.js';
import {
  markOperationCompleted,
  recordOperationStart,
  updateOperationSummary,
} from '../services/operation-journal/journal.js';

let server: PuntovivoServer;

interface HookHarness {
  tenantId: string;
  userId: string;
  deviceId: string;
}

async function seedHarness(suffix: string): Promise<HookHarness> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `hook-tenant-${suffix}`;
  const userId = `hook-user-${suffix}`;
  const deviceId = `hook-device-${suffix}`;

  await db.insert(tenants).values({
    id: tenantId,
    name: `Hook Tenant ${suffix}`,
    slug: `hook-${suffix}`,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values({
    id: userId,
    tenantId,
    email: `user-${suffix}@hook.test`,
    name: `User ${suffix}`,
    passwordHash: 'x',
    sessionVersion: 1,
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(devices).values({
    id: deviceId,
    tenantId,
    kind: 'web',
    name: `Device ${suffix}`,
    isActive: true,
    registeredByUserId: userId,
    createdAt: now,
    updatedAt: now,
  });
  return { tenantId, userId, deviceId };
}

async function setEventsApiActive(tenantId: string, enabled: boolean): Promise<void> {
  const db = getDatabase();
  await db
    .update(tenants)
    .set({
      settings: sql`json_set(COALESCE(${tenants.settings}, '{}'), ${'$.modules.events-api'}, ${
        enabled ? sql`json('true')` : sql`json('false')`
      })`,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(tenants.id, tenantId));
}

async function startSalesOp(
  h: HookHarness,
  operationId: string
): Promise<string> {
  const db = getDatabase();
  const result = await recordOperationStart(db, {
    tenantId: h.tenantId,
    operationId,
    operationKind: 'sales.create',
    deviceId: h.deviceId,
    userId: h.userId,
    requestHash: 'hash',
    summary: {
      saleId: `sale-${operationId}`,
      saleNumber: 'VTA-001',
      siteId: 'site-1',
      cashSessionId: 'cs-1',
      customerId: null,
      subtotal: 100,
      taxAmount: 19,
      discountAmount: 0,
      total: 119,
      currencyCode: 'COP',
      paymentMethod: 'cash',
    },
  });
  return result.eventId;
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});

afterAll(async () => {
  await server.close();
});

beforeEach(async () => {
  const db = getDatabase();
  await db.delete(webhookOutbox).run();
});

describe('operation-journal → webhook_outbox hook (ENG-070)', () => {
  it('does NOT enqueue when events-api is OFF (default)', async () => {
    const h = await seedHarness('off');
    const eventId = await startSalesOp(h, 'op-off-1');
    await markOperationCompleted(getDatabase(), eventId, 'succeeded');

    const rows = await getDatabase()
      .select()
      .from(webhookOutbox)
      .where(eq(webhookOutbox.tenantId, h.tenantId))
      .all();
    expect(rows).toHaveLength(0);
  });

  it('enqueues a sale.completed row when events-api is ON', async () => {
    const h = await seedHarness('on');
    await setEventsApiActive(h.tenantId, true);
    const eventId = await startSalesOp(h, 'op-on-1');
    await markOperationCompleted(getDatabase(), eventId, 'succeeded');

    const rows = await getDatabase()
      .select()
      .from(webhookOutbox)
      .where(eq(webhookOutbox.tenantId, h.tenantId))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe('sale.completed');
    expect(rows[0].status).toBe('queued');
    expect(rows[0].idempotencyKey).toBe('op-on-1');
  });

  it('enqueues after the use-case fills a post-start summary', async () => {
    const h = await seedHarness('late-summary');
    await setEventsApiActive(h.tenantId, true);
    const { eventId } = await recordOperationStart(getDatabase(), {
      tenantId: h.tenantId,
      operationId: 'op-late-summary-1',
      operationKind: 'sales.create',
      deviceId: h.deviceId,
      userId: h.userId,
      requestHash: 'hash',
    });

    await updateOperationSummary(getDatabase(), eventId, {
      saleId: 'sale-late-summary',
      saleNumber: 'VTA-002',
      siteId: 'site-1',
      cashSessionId: 'cs-1',
      customerId: null,
      subtotal: 100,
      taxAmount: 19,
      discountAmount: 0,
      total: 119,
      currencyCode: 'COP',
      paymentMethod: 'cash',
    });
    await markOperationCompleted(getDatabase(), eventId, 'succeeded');

    const rows = await getDatabase()
      .select()
      .from(webhookOutbox)
      .where(eq(webhookOutbox.tenantId, h.tenantId))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe('sale.completed');
  });

  it('does NOT enqueue when status is failed', async () => {
    const h = await seedHarness('failed');
    await setEventsApiActive(h.tenantId, true);
    const eventId = await startSalesOp(h, 'op-failed-1');
    await markOperationCompleted(getDatabase(), eventId, 'failed');

    const rows = await getDatabase()
      .select()
      .from(webhookOutbox)
      .where(eq(webhookOutbox.tenantId, h.tenantId))
      .all();
    expect(rows).toHaveLength(0);
  });

  it('replaying the same op does NOT enqueue a second row (idempotent)', async () => {
    const h = await seedHarness('replay');
    await setEventsApiActive(h.tenantId, true);
    const eventId = await startSalesOp(h, 'op-replay-1');
    await markOperationCompleted(getDatabase(), eventId, 'succeeded');
    // Second call: the journal's terminal-state guard refuses to
    // re-transition; the hook is also re-entered but the partial
    // unique idx on (tenant_id, event_type, idempotency_key) catches
    // the duplicate so the outbox stays at one row.
    await markOperationCompleted(getDatabase(), eventId, 'succeeded');

    const rows = await getDatabase()
      .select()
      .from(webhookOutbox)
      .where(eq(webhookOutbox.tenantId, h.tenantId))
      .all();
    expect(rows).toHaveLength(1);
  });

  it('isolates tenants — tenant A flipping ON does not affect tenant B', async () => {
    const a = await seedHarness('iso-a');
    const b = await seedHarness('iso-b');
    await setEventsApiActive(a.tenantId, true);
    // tenant B stays default off.

    const eventA = await startSalesOp(a, 'op-iso-a');
    const eventB = await startSalesOp(b, 'op-iso-b');
    await markOperationCompleted(getDatabase(), eventA, 'succeeded');
    await markOperationCompleted(getDatabase(), eventB, 'succeeded');

    const rowsA = await getDatabase()
      .select()
      .from(webhookOutbox)
      .where(eq(webhookOutbox.tenantId, a.tenantId))
      .all();
    const rowsB = await getDatabase()
      .select()
      .from(webhookOutbox)
      .where(eq(webhookOutbox.tenantId, b.tenantId))
      .all();
    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(0);
  });
});
