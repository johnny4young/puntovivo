/**
 * ENG-052b — MEGA seed: sync queue + sync conflicts. Populates the
 * /sync admin pages with pending entries and a mix of resolved /
 * unresolved conflicts so the conflict-resolution flow has data.
 *
 * @module db/seed-mega/historical-sync
 */

import { nanoid } from 'nanoid';
import { syncConflicts, syncQueue } from '../schema.js';
import { laterIso, randomDaysAgoIso } from './time-helpers.js';
import type { MegaContext, MegaTarget } from './types.js';

interface CreatedHistoricalSync {
  syncQueueRows: number;
  syncConflictsRows: number;
}

export async function seedHistoricalSync(
  ctx: MegaContext,
  target: MegaTarget
): Promise<CreatedHistoricalSync> {
  const { db, clock, tenantId, products } = ctx;

  const queueRows: Array<typeof syncQueue.$inferInsert> = [];
  const conflictRows: Array<typeof syncConflicts.$inferInsert> = [];

  // Pending sync queue rows — distributed across last 5 days, attempts > 0
  for (let i = 0; i < target.syncQueuePending; i += 1) {
    const product = products[i % products.length]!;
    const createdAtIso = randomDaysAgoIso(clock, 0, 5, i);
    queueRows.push({
      id: nanoid(),
      tenantId,
      entityType: 'products',
      entityId: product.id,
      operation: 'update',
      data: { id: product.id, sku: product.sku, price: product.price + 100 },
      localVersion: 1 + (i % 3),
      attempts: i % 3,
      lastError: i % 3 > 0 ? 'connectivity timeout (seed)' : null,
      createdAt: createdAtIso,
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

  if (queueRows.length > 0) {
    await db.insert(syncQueue).values(queueRows).run();
  }
  if (conflictRows.length > 0) {
    await db.insert(syncConflicts).values(conflictRows).run();
  }

  return {
    syncQueueRows: queueRows.length,
    syncConflictsRows: conflictRows.length,
  };
}
