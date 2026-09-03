import { and, eq, inArray } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { pharmacyProductProfiles } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';

/**
 * Inventory transformations are not a regulated compounding or repackaging
 * workflow. Until they can freeze ingredient lineage, propagate recalls and
 * record the required professional evidence, medicine inputs and outputs must
 * fail closed instead of producing ordinary sellable stock.
 */
export function assertTransformationExcludesPharmacyProducts(
  db: DatabaseInstance,
  input: { tenantId: string; productIds: readonly string[] }
): void {
  if (input.productIds.length === 0) return;

  const regulatedProduct = db
    .select({ productId: pharmacyProductProfiles.productId })
    .from(pharmacyProductProfiles)
    .where(
      and(
        eq(pharmacyProductProfiles.tenantId, input.tenantId),
        inArray(pharmacyProductProfiles.productId, [...new Set(input.productIds)])
      )
    )
    .get();
  if (!regulatedProduct) return;

  throwServerError({
    trpcCode: 'BAD_REQUEST',
    errorCode: 'TRANSFORMATION_PHARMACY_UNSUPPORTED',
    message: 'Pharmacy products require a regulated compounding or repackaging workflow',
    details: { productId: regulatedProduct.productId },
  });
}
