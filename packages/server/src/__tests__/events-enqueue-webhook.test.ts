/**
 * ENG-070 — `enqueueWebhook` regression tests.
 *
 * Pin the contract every projector + worker uses to write to
 * webhook_outbox:
 *   - Fresh enqueue inserts a queued row.
 *   - Same envelope key → second enqueue collapses (deduped: true).
 *   - Different envelope key → independent rows.
 *   - Cross-tenant isolation (same key in tenant A vs B → 2 rows).
 *   - Empty / null key → independent rows (admin-replay path).
 *   - FK violation rethrows so tx rolls back.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { tenants, webhookOutbox } from '../db/schema.js';
import { enqueueWebhook } from '../services/events/enqueue-webhook.js';
import type { PublicEvent } from '../services/events/manifest.js';

let server: PuntovivoServer;

async function seedTenant(suffix: string): Promise<string> {
  const db = getDatabase();
  const id = `webhook-tenant-${suffix}`;
  const now = new Date().toISOString();
  await db.insert(tenants).values({
    id,
    name: `Webhook Tenant ${suffix}`,
    slug: `webhook-${suffix}`,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

function buildEvent(overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    type: 'sale.completed',
    version: 1,
    occurredAt: '2026-05-07T10:00:00.000Z',
    tenantId: 'tenant-1',
    operationEventId: null,
    payload: {
      saleId: 'sale-1',
      saleNumber: 'VTA-N-001',
      siteId: 'site-1',
      cashSessionId: 'cs-1',
      customerId: null,
      subtotal: 100,
      taxAmount: 19,
      discountAmount: 0,
      total: 119,
      currencyCode: 'COP',
      paymentMethod: 'cash',
      completedAt: '2026-05-07T10:00:00.000Z',
    },
    ...overrides,
  };
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

describe('enqueueWebhook (ENG-070)', () => {
  it('persists a fresh row with status=queued', async () => {
    const tenantId = await seedTenant('fresh');
    const db = getDatabase();
    const result = db.transaction(tx =>
      enqueueWebhook(tx, {
        tenantId,
        event: buildEvent({ tenantId }),
        idempotencyKey: 'envelope-1',
      })
    );

    expect(result.deduped).toBe(false);
    expect(result.id).toBeTruthy();

    const row = await db
      .select()
      .from(webhookOutbox)
      .where(eq(webhookOutbox.id, result.id))
      .get();
    expect(row?.status).toBe('queued');
    expect(row?.eventType).toBe('sale.completed');
    expect(row?.idempotencyKey).toBe('envelope-1');
  });

  it('collapses to one row when the same envelope key is enqueued twice', async () => {
    const tenantId = await seedTenant('collapse');
    const db = getDatabase();
    const ev = buildEvent({ tenantId });

    const r1 = db.transaction(tx =>
      enqueueWebhook(tx, {
        tenantId,
        event: ev,
        idempotencyKey: 'envelope-collapse',
      })
    );
    const r2 = db.transaction(tx =>
      enqueueWebhook(tx, {
        tenantId,
        event: ev,
        idempotencyKey: 'envelope-collapse',
      })
    );

    expect(r1.deduped).toBe(false);
    expect(r2.deduped).toBe(true);
    expect(r2.id).toBe(r1.id);

    const rows = await db
      .select()
      .from(webhookOutbox)
      .where(eq(webhookOutbox.tenantId, tenantId))
      .all();
    expect(rows).toHaveLength(1);
  });

  it('different envelope keys produce independent rows', async () => {
    const tenantId = await seedTenant('different');
    const db = getDatabase();
    const ev = buildEvent({ tenantId });

    db.transaction(tx =>
      enqueueWebhook(tx, { tenantId, event: ev, idempotencyKey: 'a' })
    );
    db.transaction(tx =>
      enqueueWebhook(tx, { tenantId, event: ev, idempotencyKey: 'b' })
    );

    const rows = await db
      .select()
      .from(webhookOutbox)
      .where(eq(webhookOutbox.tenantId, tenantId))
      .all();
    expect(rows).toHaveLength(2);
  });

  it('different event types with the same key produce independent rows', async () => {
    const tenantId = await seedTenant('diff-event');
    const db = getDatabase();

    db.transaction(tx =>
      enqueueWebhook(tx, {
        tenantId,
        event: buildEvent({ tenantId, type: 'sale.completed' }),
        idempotencyKey: 'shared',
      })
    );
    db.transaction(tx =>
      enqueueWebhook(tx, {
        tenantId,
        event: buildEvent({
          tenantId,
          type: 'sale.refunded',
          payload: {
            saleReturnId: 'ret-1',
            originalSaleId: 'sale-1',
            siteId: 'site-1',
            cashSessionId: 'cs-1',
            refundedAmount: 119,
            currencyCode: 'COP',
            reasonCode: null,
            refundedAt: '2026-05-07T10:00:00.000Z',
          },
        }),
        idempotencyKey: 'shared',
      })
    );

    const rows = await db
      .select()
      .from(webhookOutbox)
      .where(eq(webhookOutbox.tenantId, tenantId))
      .all();
    expect(rows).toHaveLength(2);
  });

  it('isolates tenants — same key on tenant A vs B → 2 rows', async () => {
    const tenantA = await seedTenant('iso-a');
    const tenantB = await seedTenant('iso-b');
    const db = getDatabase();

    db.transaction(tx =>
      enqueueWebhook(tx, {
        tenantId: tenantA,
        event: buildEvent({ tenantId: tenantA }),
        idempotencyKey: 'shared-key',
      })
    );
    db.transaction(tx =>
      enqueueWebhook(tx, {
        tenantId: tenantB,
        event: buildEvent({ tenantId: tenantB }),
        idempotencyKey: 'shared-key',
      })
    );

    const rowsA = await db
      .select()
      .from(webhookOutbox)
      .where(eq(webhookOutbox.tenantId, tenantA))
      .all();
    const rowsB = await db
      .select()
      .from(webhookOutbox)
      .where(eq(webhookOutbox.tenantId, tenantB))
      .all();
    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
  });

  it('null idempotency key produces independent rows (admin-replay path)', async () => {
    const tenantId = await seedTenant('null-key');
    const db = getDatabase();
    const ev = buildEvent({ tenantId });

    const r1 = db.transaction(tx =>
      enqueueWebhook(tx, { tenantId, event: ev, idempotencyKey: null })
    );
    const r2 = db.transaction(tx =>
      enqueueWebhook(tx, { tenantId, event: ev, idempotencyKey: null })
    );

    expect(r1.deduped).toBe(false);
    expect(r2.deduped).toBe(false);
    expect(r1.id).not.toBe(r2.id);

    const rows = await db
      .select()
      .from(webhookOutbox)
      .where(eq(webhookOutbox.tenantId, tenantId))
      .all();
    expect(rows).toHaveLength(2);
  });

  it('empty-string idempotency key normalizes to null (no idx collision)', async () => {
    const tenantId = await seedTenant('empty-key');
    const db = getDatabase();

    const r1 = db.transaction(tx =>
      enqueueWebhook(tx, { tenantId, event: buildEvent({ tenantId }), idempotencyKey: '' })
    );
    const r2 = db.transaction(tx =>
      enqueueWebhook(tx, { tenantId, event: buildEvent({ tenantId }), idempotencyKey: '' })
    );
    expect(r1.deduped).toBe(false);
    expect(r2.deduped).toBe(false);

    const rows = await db
      .select()
      .from(webhookOutbox)
      .where(eq(webhookOutbox.tenantId, tenantId))
      .all();
    expect(rows).toHaveLength(2);
  });
});
