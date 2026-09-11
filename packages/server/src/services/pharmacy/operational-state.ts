import { eq } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import {
  pharmacyPrescriptionEvidence,
  pharmacyProductProfiles,
  pharmacyProfessionalAuthorizations,
  pharmacyRecalls,
} from '../../db/schema.js';

/**
 * Whether any product of this tenant carries a pharmacy profile.
 *
 * Catalog search keys its regulated-metadata predicates off this rather than
 * the vertical preset. A tenant without a profile has nothing those predicates
 * could match, so it skips a join probe per scanned product; a tenant that left
 * the pharmacy preset still owns its medicines and keeps finding them. One
 * probe of the tenant index, so it is cheap enough for every search.
 */
export function hasPharmacyProductProfiles(db: DatabaseInstance, tenantId: string): boolean {
  return (
    db
      .select({ id: pharmacyProductProfiles.productId })
      .from(pharmacyProductProfiles)
      .where(eq(pharmacyProductProfiles.tenantId, tenantId))
      .get() !== undefined
  );
}

/**
 * Whether this tenant still owns pharmacy state that requires an operator UI.
 *
 * The selected vertical preset is presentation/configuration, not lifecycle
 * authority. Switching away from the pharmacy preset must not hide medicine,
 * recall, prescription, or professional-authorization controls while durable
 * records still exist.
 */
export function hasPharmacyOperationalData(db: DatabaseInstance, tenantId: string): boolean {
  return (
    hasPharmacyProductProfiles(db, tenantId) ||
    db
      .select({ id: pharmacyProfessionalAuthorizations.id })
      .from(pharmacyProfessionalAuthorizations)
      .where(eq(pharmacyProfessionalAuthorizations.tenantId, tenantId))
      .get() !== undefined ||
    db
      .select({ id: pharmacyPrescriptionEvidence.id })
      .from(pharmacyPrescriptionEvidence)
      .where(eq(pharmacyPrescriptionEvidence.tenantId, tenantId))
      .get() !== undefined ||
    db
      .select({ id: pharmacyRecalls.id })
      .from(pharmacyRecalls)
      .where(eq(pharmacyRecalls.tenantId, tenantId))
      .get() !== undefined
  );
}
