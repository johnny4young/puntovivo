/**
 * ENG-053 — `outbox_metadata` helpers.
 *
 * The metadata table is the cross-outbox health surface ENG-065
 * (Operations Center) reads to render its panels. Every concrete
 * outbox refreshes its row periodically: the worker calls
 * `recordSuccess` after a completed row and `recordFailure` on
 * dead-letter; a separate periodic job calls `refreshPendingCount`
 * to update the snapshot count without a full table scan on every
 * tick.
 *
 * The kernel never writes here directly — that would force every
 * concrete outbox to import the metadata module. Instead workers
 * call these helpers explicitly so they remain optional during
 * early integration.
 *
 * @module lib/outbox/metadata
 */

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { outboxMetadata, type OutboxKind } from '../../db/schema.js';

/**
 * Upsert helper: ensures a row exists for `(tenantId, kind)` and
 * applies the patch. SQLite's `INSERT … ON CONFLICT DO UPDATE`
 * handles both first-touch and subsequent updates without
 * duplicating the insert vs update logic at every call site.
 */
async function upsertMetadata(
  db: DatabaseInstance,
  tenantId: string,
  outboxKind: OutboxKind,
  patch: Partial<typeof outboxMetadata.$inferInsert>
): Promise<void> {
  const nowIso = new Date().toISOString();
  await db
    .insert(outboxMetadata)
    .values({
      id: nanoid(),
      tenantId,
      outboxKind,
      pendingCount: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      oldestPendingAt: null,
      refreshedAt: nowIso,
      ...patch,
    })
    .onConflictDoUpdate({
      target: [outboxMetadata.tenantId, outboxMetadata.outboxKind],
      set: { ...patch, refreshedAt: nowIso },
    })
    .run();
}

export async function recordSuccess(
  db: DatabaseInstance,
  args: { tenantId: string; outboxKind: OutboxKind; nowIso?: string }
): Promise<void> {
  const ts = args.nowIso ?? new Date().toISOString();
  await upsertMetadata(db, args.tenantId, args.outboxKind, {
    lastSuccessAt: ts,
  });
}

export async function recordFailure(
  db: DatabaseInstance,
  args: { tenantId: string; outboxKind: OutboxKind; nowIso?: string }
): Promise<void> {
  const ts = args.nowIso ?? new Date().toISOString();
  await upsertMetadata(db, args.tenantId, args.outboxKind, {
    lastFailureAt: ts,
  });
}

/**
 * Refresh the cached `pending_count` and `oldest_pending_at` from a
 * concrete outbox table. The caller hands in the count + oldest
 * timestamp it computed (typically via a single aggregate query
 * over the concrete table); this helper just persists them.
 *
 * Why not query the table here: the kernel doesn't know the SHAPE
 * of the concrete outbox table (only the base columns). The caller
 * — which DOES know its table — runs the aggregate and feeds the
 * results in.
 */
export async function refreshPendingCount(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    outboxKind: OutboxKind;
    pendingCount: number;
    oldestPendingAt: string | null;
    nowIso?: string;
  }
): Promise<void> {
  await upsertMetadata(db, args.tenantId, args.outboxKind, {
    pendingCount: args.pendingCount,
    oldestPendingAt: args.oldestPendingAt,
  });
}

/**
 * Read the metadata row for `(tenantId, outboxKind)`. Returns
 * `null` when no row exists yet (no recorded activity for that
 * tenant + kind).
 */
export async function readMetadata(
  db: DatabaseInstance,
  args: { tenantId: string; outboxKind: OutboxKind }
): Promise<typeof outboxMetadata.$inferSelect | null> {
  const row = await db
    .select()
    .from(outboxMetadata)
    .where(
      and(
        eq(outboxMetadata.tenantId, args.tenantId),
        eq(outboxMetadata.outboxKind, args.outboxKind)
      )
    )
    .get();
  return row ?? null;
}

/**
 * Read every metadata row for a tenant in one shot. Used by the
 * Operations Center landing page (ENG-065) so the panel grid is
 * served by a single query.
 */
export async function listMetadata(
  db: DatabaseInstance,
  args: { tenantId: string }
): Promise<(typeof outboxMetadata.$inferSelect)[]> {
  return db
    .select()
    .from(outboxMetadata)
    .where(eq(outboxMetadata.tenantId, args.tenantId))
    .all();
}
