/**
 * Quotation service — status transition ( split).
 *
 * `ALLOWED_TRANSITIONS` + `updateQuotationStatus` (tx whole).
 *
 * @module services/quotations/updateStatus
 */
import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { quotations, type QuotationStatus } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../audit-logs.js';

import type { UpdateQuotationStatusArgs } from './types.js';
import { getTimestamp } from './pricing.js';

/**
 * Allowed status transitions. `draft` is the entry state. `accepted` can
 * close into either `expired` (time passed without becoming a sale) or
 * `converted` (operator linked the quote to a completed sale through the
 * regular POS flow — this is a terminal status with no deeper side effects;
 * inventory is mutated by the sale itself, not by the quote).
 */
const ALLOWED_TRANSITIONS: Record<QuotationStatus, readonly QuotationStatus[]> = {
  draft: ['sent', 'rejected', 'expired'],
  sent: ['accepted', 'rejected', 'expired'],
  accepted: ['expired', 'converted'],
  rejected: [],
  expired: [],
  converted: [],
};

export function updateQuotationStatus(
  db: DatabaseInstance,
  args: UpdateQuotationStatusArgs
): { id: string; status: QuotationStatus; statusChangedAt: string } {
  const now = getTimestamp();

  return db.transaction(tx => {
    const current = tx
      .select({ id: quotations.id, status: quotations.status })
      .from(quotations)
      .where(and(eq(quotations.id, args.quotationId), eq(quotations.tenantId, args.tenantId)))
      .get();

    if (!current) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'QUOTATION_NOT_FOUND',
        message: 'Quotation not found',
        details: { quotationId: args.quotationId },
      });
    }

    const allowed = ALLOWED_TRANSITIONS[current.status];
    if (!allowed.includes(args.nextStatus)) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'QUOTATION_INVALID_STATUS_TRANSITION',
        message: `Cannot move quotation from ${current.status} to ${args.nextStatus}`,
        details: { from: current.status, to: args.nextStatus },
      });
    }

    tx.update(quotations)
      .set({
        status: args.nextStatus,
        statusChangedAt: now,
        statusChangedBy: args.actorId,
        syncStatus: 'pending',
        updatedAt: now,
      })
      .where(and(eq(quotations.id, args.quotationId), eq(quotations.tenantId, args.tenantId)))
      .run();

    // audit the terminal-close transitions that
    // carry business impact. Intermediate transitions (draft → sent, sent
    // → accepted) are not audited because they represent normal workflow
    // progress; a reviewer looking at the log wants to see *outcomes*.
    if (args.nextStatus === 'converted') {
      writeAuditLog({
        tx,
        tenantId: args.tenantId,
        actorId: args.actorId,
        action: 'quotation.convert',
        resourceType: 'quotation',
        resourceId: args.quotationId,
        before: { status: current.status },
        after: { status: args.nextStatus },
      });
    }

    return {
      id: args.quotationId,
      status: args.nextStatus as QuotationStatus,
      statusChangedAt: now,
    };
  });
}
