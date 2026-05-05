/**
 * ENG-052b — MEGA seed: sync outbox + sync conflicts. Populates the
 * /sync admin pages with pending entries and a mix of resolved /
 * unresolved conflicts so the conflict-resolution flow has data.
 *
 * ENG-064b cutover: writes directly to `sync_outbox` (the legacy
 * `sync_queue` was dropped in migration 0017). The bulk insert path
 * skips `enqueueSync` because there is no envelope context at seed
 * time and the per-row `operation_events` lookup adds gratuitous
 * round-trips for thousands of demo rows.
 *
 * @module db/seed-mega/historical-sync
 */

import { nanoid } from 'nanoid';
import { syncConflicts, syncOutbox } from '../schema.js';
import { laterIso, randomDaysAgoIso } from './time-helpers.js';
import type { MegaContext, MegaTarget } from './types.js';

interface CreatedHistoricalSync {
  syncOutboxRows: number;
  syncConflictsRows: number;
}

export async function seedHistoricalSync(
  ctx: MegaContext,
  target: MegaTarget
): Promise<CreatedHistoricalSync> {
  const { db, clock, tenantId, products } = ctx;

  const outboxRows: Array<typeof syncOutbox.$inferInsert> = [];
  const conflictRows: Array<typeof syncConflicts.$inferInsert> = [];

  // Pending sync outbox rows — distributed across last 5 days, attempts > 0.
  // `products` is in the auto_lww risk class per ADR-0004 / SYNC_CONFLICT_POLICY.
  for (let i = 0; i < target.syncOutboxPending; i += 1) {
    const product = products[i % products.length]!;
    const createdAtIso = randomDaysAgoIso(clock, 0, 5, i);
    const attempts = i % 3;
    outboxRows.push({
      id: nanoid(),
      tenantId,
      status: attempts > 0 ? 'retrying' : 'queued',
      entityType: 'products',
      entityId: product.id,
      operation: 'update',
      conflictPolicy: 'auto_lww',
      payload: { id: product.id, sku: product.sku, price: product.price + 100 },
      payloadVersion: 1,
      idempotencyKey: null,
      deviceId: null,
      dependsOnOperationId: null,
      operationEventId: null,
      attempts,
      nextRetryAt: null,
      lastError: attempts > 0 ? { kind: 'NETWORK_TIMEOUT', message: 'connectivity timeout (seed)' } : null,
      priority: 0,
      claimToken: null,
      lockedAt: null,
      createdAt: createdAtIso,
      updatedAt: createdAtIso,
    });
  }

  // Unresolved conflicts — operator must pick local_wins / remote_wins / merged
  for (let i = 0; i < target.syncConflictsUnresolved; i += 1) {
    const product = products[(i + 7) % products.length]!;
    const createdAtIso = randomDaysAgoIso(clock, 1, 4, i);
    conflictRows.push({
      id: nanoid(),
      tenantId,
      entityType: 'products',
      entityId: product.id,
      localData: { id: product.id, sku: product.sku, price: product.price + 200 },
      remoteData: { id: product.id, sku: product.sku, price: product.price + 100 },
      status: 'pending',
      resolution: null,
      resolvedAt: null,
      createdAt: createdAtIso,
    });
  }

  // Resolved conflicts — historical record
  const resolutions = ['local_wins', 'remote_wins', 'merged'] as const;
  for (let i = 0; i < target.syncConflictsResolved; i += 1) {
    const product = products[(i + 13) % products.length]!;
    const createdAtIso = randomDaysAgoIso(clock, 5, 30, i);
    const resolvedAtIso = laterIso(createdAtIso, 60 * 60 * 1000);
    conflictRows.push({
      id: nanoid(),
      tenantId,
      entityType: 'products',
      entityId: product.id,
      localData: { id: product.id, sku: product.sku, price: product.price + 300 },
      remoteData: { id: product.id, sku: product.sku, price: product.price + 250 },
      status: 'resolved',
      resolution: resolutions[i % resolutions.length]!,
      resolvedAt: resolvedAtIso,
      createdAt: createdAtIso,
    });
  }

  if (outboxRows.length > 0) {
    await db.insert(syncOutbox).values(outboxRows).run();
  }
  if (conflictRows.length > 0) {
    await db.insert(syncConflicts).values(conflictRows).run();
  }

  return {
    syncOutboxRows: outboxRows.length,
    syncConflictsRows: conflictRows.length,
  };
}
