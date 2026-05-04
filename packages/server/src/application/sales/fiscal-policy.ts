/**
 * ENG-055 — Shared fiscal helpers for the sale lifecycle services.
 *
 * Today this module hosts a single helper, `getOriginalDeeCufe`, used
 * by `returnSale` and `voidSale` to look up the CUFE of the original
 * DIAN DEE so the credit note (NC) can reference it. The query lived
 * duplicated in two places before ENG-055.
 *
 * Future additions: helpers around contingency lookups (ENG-057),
 * resolution snapshots, and per-country fiscal validation will land
 * here as more lifecycle services need them.
 *
 * @module application/sales/fiscal-policy
 */

import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { fiscalDocuments } from '../../db/schema.js';

/**
 * Fetch the CUFE of the DIAN DEE that was emitted for `saleId`, if
 * any. Returns `undefined` when no DEE row exists (e.g. tenant is not
 * DIAN-enabled, or the sale completed before fiscal opt-in).
 *
 * Used by `returnSale` to populate `originalCufe` on the NC, and by
 * `voidSale` for the same purpose. Tenant-scoped by composite key.
 */
export async function getOriginalDeeCufe(
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
        eq(fiscalDocuments.sourceId, saleId),
        eq(fiscalDocuments.kind, 'DEE')
      )
    )
    .get();
  return row?.cufe ?? undefined;
}
