/**
 * Shared fiscal helpers for the sale lifecycle services.
 *
 * `getOriginalSaleDocumentCufe` is used by `returnSale` and `voidSale` to look
 * up the CUFE/CUDE of the document the sale issued (POS equivalent document or
 * electronic invoice) so the credit note can reference it.
 *
 * @module application/sales/fiscal-policy
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { fiscalDocuments } from '../../db/schema.js';

/**
 * Fetch the accepted identifier of the DEE or FEV emitted for `saleId`, if
 * any. Returns `undefined` when no such row exists (e.g. tenant is not
 * fiscal-enabled, or the sale completed before fiscal opt-in).
 * Tenant-scoped by composite key.
 */
export async function getOriginalSaleDocumentCufe(
  db: DatabaseInstance,
  tenantId: string,
  saleId: string
): Promise<string | undefined> {
  const row = await db
    .select({ cufe: fiscalDocuments.cufe })
    .from(fiscalDocuments)
    .where(
      and(
        eq(fiscalDocuments.tenantId, tenantId),
        eq(fiscalDocuments.source, 'sale'),
        eq(fiscalDocuments.sourceId, saleId),
        inArray(fiscalDocuments.kind, ['DEE', 'FEV']),
        eq(fiscalDocuments.status, 'accepted')
      )
    )
    .get();
  return row?.cufe && !row.cufe.startsWith('pending-') ? row.cufe : undefined;
}
