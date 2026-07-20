/**
 * Quotation service — delete ( split).
 *
 * `deleteQuotation` (draft-only; audit snapshot before delete; tx whole).
 *
 * @module services/quotations/delete
 */
import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { quotations } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../audit-logs.js';

import type { DeleteQuotationArgs } from './types.js';

export function deleteQuotation(db: DatabaseInstance, args: DeleteQuotationArgs): { id: string } {
  return db.transaction(tx => {
    // Load the snapshot we want to persist in the audit trail BEFORE deleting
    // the row (and its cascade children) is gone after the DELETE.
    const current = tx
      .select({
        id: quotations.id,
        quotationNumber: quotations.quotationNumber,
        status: quotations.status,
        customerId: quotations.customerId,
        siteId: quotations.siteId,
        total: quotations.total,
      })
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

    if (current.status !== 'draft') {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'QUOTATION_DELETE_NOT_DRAFT',
        message: 'Only draft quotations can be deleted',
        details: { quotationId: args.quotationId, status: current.status },
      });
    }

    // Items are removed by the FK ON DELETE CASCADE. The tenant guard on the
    // DELETE mirrors updateQuotationStatus — even though the SELECT above
    // already filtered by tenant, repeating the check at the write layer
    // keeps the invariant consistent and blocks any TOCTOU race against a
    // hypothetical second caller.
    tx.delete(quotations)
      .where(and(eq(quotations.id, args.quotationId), eq(quotations.tenantId, args.tenantId)))
      .run();

    // record the deletion with the pre-delete snapshot
    // as `before` so the audit trail can reconstruct what was removed.
    // `after` is null by design (the row no longer exists).
    writeAuditLog({
      tx,
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: 'quotation.delete',
      resourceType: 'quotation',
      resourceId: args.quotationId,
      before: {
        quotationNumber: current.quotationNumber,
        status: current.status,
        customerId: current.customerId,
        siteId: current.siteId,
        total: current.total,
      },
      after: null,
    });

    return { id: args.quotationId };
  });
}
