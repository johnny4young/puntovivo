/**
 * Durable ownership rules for an unsuspended sale draft.
 *
 * `sales.resume` deliberately lets the same actor recover an active claim from
 * another registered terminal, then rebinds it to the requesting device. Every
 * destructive mutation after that recovery must require both dimensions; an
 * actor-only check would let a stale workspace on the old register win the
 * next writer race and charge or release inventory from the wrong terminal.
 */

import { TRPCError } from '@trpc/server';
import { and, eq, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { restaurantChecks, restaurantServices, sales } from '../../db/schema.js';

/** A parked draft belongs to who parked it; legacy parks without one fall back to the creator. */
export function parkedDraftOwnedBy(userId: string) {
  return sql`(${sales.suspendedBy} = ${userId} OR (${sales.suspendedBy} IS NULL AND ${sales.createdBy} = ${userId}))`;
}

/** Same rule as {@link parkedDraftOwnedBy}, for a draft already read. */
export function ownsParkedDraft(
  draft: { suspendedAt: string | null; suspendedBy: string | null; createdBy: string },
  userId: string
): boolean {
  return (
    draft.suspendedAt !== null &&
    (draft.suspendedBy === userId || (draft.suspendedBy === null && draft.createdBy === userId))
  );
}

export interface ActiveDraftClaim {
  suspendedAt: string | null;
  resumedBy: string | null;
  resumedDeviceId: string | null;
}

export function ownsActiveDraftClaim(
  draft: ActiveDraftClaim,
  actorId: string,
  deviceId: string | null | undefined
): boolean {
  return (
    draft.suspendedAt === null &&
    draft.resumedBy === actorId &&
    typeof deviceId === 'string' &&
    deviceId.length > 0 &&
    draft.resumedDeviceId === deviceId
  );
}

/**
 * Enforce draft read privacy across `sales.getById` and receipt renderers.
 * Completed/voided sales pass untouched; viewers cannot inspect drafts, and
 * cashiers can only view their own active claim, their own parked draft, or
 * an open normalized restaurant check at their active site.
 */
export function assertCanViewSaleDraft(
  db: DatabaseInstance,
  actor: { tenantId: string; siteId: string | null; userId: string; role: string },
  sale: {
    id: string;
    status: string;
    suspendedAt: string | null;
    suspendedBy: string | null;
    resumedBy?: string | null;
    createdBy: string;
    tableId?: string | null;
  }
): void {
  if (sale.status !== 'draft') return;
  if (actor.role === 'admin' || actor.role === 'manager') return;
  if (actor.role !== 'cashier') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only cashiers, managers, and administrators can view sale drafts',
    });
  }
  if (ownsParkedDraft(sale, actor.userId)) return;

  const ownershipRow =
    sale.resumedBy === undefined || sale.tableId === undefined
      ? db
          .select({ resumedBy: sales.resumedBy, tableId: sales.tableId })
          .from(sales)
          .where(and(eq(sales.id, sale.id), eq(sales.tenantId, actor.tenantId)))
          .get()
      : { resumedBy: sale.resumedBy, tableId: sale.tableId };
  const resumedBy = ownershipRow?.resumedBy ?? null;
  const tableId = ownershipRow?.tableId ?? null;

  if (sale.suspendedAt === null && resumedBy === actor.userId) return;

  if (sale.suspendedAt !== null && tableId && actor.siteId) {
    const openCheck = db
      .select({ id: restaurantChecks.id })
      .from(restaurantChecks)
      .innerJoin(
        restaurantServices,
        and(
          eq(restaurantServices.id, restaurantChecks.serviceId),
          eq(restaurantServices.tenantId, actor.tenantId)
        )
      )
      .where(
        and(
          eq(restaurantChecks.tenantId, actor.tenantId),
          eq(restaurantChecks.saleId, sale.id),
          eq(restaurantChecks.status, 'open'),
          eq(restaurantServices.status, 'open'),
          eq(restaurantServices.siteId, actor.siteId),
          eq(restaurantServices.tableId, tableId)
        )
      )
      .get();
    if (openCheck) return;
  }

  throw new TRPCError({
    code: 'FORBIDDEN',
    message: 'You do not have permission to view this sale draft',
  });
}
