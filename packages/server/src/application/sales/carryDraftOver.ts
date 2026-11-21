import { and, eq, isNotNull, sql } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import { sales } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';

export interface CarryDraftOverContext {
  db: DatabaseInstance;
  tenantId: string;
  actorId: string;
  envelope?: { operationId: string; idempotencyKey?: string } | null;
  deviceId?: string | null;
}

/** Carried only while the decision is not older than the park, so parking again clears it. */
export function isCarriedOverSql() {
  return sql<boolean>`(${sales.carriedOverAt} IS NOT NULL AND ${sales.carriedOverAt} >= ${sales.suspendedAt})`;
}

/** Mark a parked draft as left for the next business day; `listDrafts` reports it as carried. */
export function carryDraftOver(ctx: CarryDraftOverContext, saleId: string) {
  const now = new Date().toISOString();
  return ctx.db.transaction(
    tx => {
      const draft = tx
        .select()
        .from(sales)
        .where(
          and(
            eq(sales.id, saleId),
            eq(sales.tenantId, ctx.tenantId),
            eq(sales.status, 'draft'),
            isNotNull(sales.suspendedAt)
          )
        )
        .get();
      if (!draft) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'SALE_CARRY_OVER_INVALID',
          message: 'Only a parked draft sale can be left for tomorrow',
          details: { saleId },
        });
      }

      const syncVersion = (draft.syncVersion ?? 0) + 1;
      tx.update(sales)
        .set({
          carriedOverAt: now,
          carriedOverBy: ctx.actorId,
          syncStatus: 'pending',
          syncVersion,
          updatedAt: now,
        })
        .where(and(eq(sales.id, draft.id), eq(sales.tenantId, ctx.tenantId)))
        .run();

      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        action: 'sale.carry_over',
        resourceType: 'sale',
        resourceId: draft.id,
        before: { carriedOverAt: draft.carriedOverAt },
        after: { carriedOverAt: now },
        metadata: { saleNumber: draft.saleNumber, suspendedAt: draft.suspendedAt },
        operationId: ctx.envelope?.operationId,
      });

      enqueueSyncInTransaction(
        {
          db: tx as unknown as DatabaseInstance,
          tenantId: ctx.tenantId,
          envelope: ctx.envelope ?? null,
          deviceId: ctx.deviceId ?? null,
        },
        {
          entityType: 'sales',
          entityId: draft.id,
          operation: 'update',
          data: { id: draft.id, carriedOverAt: now, carriedOverBy: ctx.actorId, syncVersion },
        }
      );

      return { id: draft.id, carriedOverAt: now, carriedOverBy: ctx.actorId };
    },
    { behavior: 'immediate' }
  );
}
