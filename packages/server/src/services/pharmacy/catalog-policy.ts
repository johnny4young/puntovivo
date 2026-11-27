import type { PharmacyClassification } from '../../db/schema.js';
import { throwServerError, type ServerErrorCode } from '../../lib/errorCodes.js';
import { isCalendarDateExpired } from './business-clock.js';
import { resolvePharmacyPolicy, type PharmacyPolicyDecision } from './policy.js';

export interface PharmacyPolicyProfile {
  classification: PharmacyClassification;
  sanitaryRegistration: string | null;
  registrationExpiresAt: string | null;
}

/** Product-level policy verdict without the customer requirement; null means sellable. */
export function pharmacyProductPolicyBlockCode(
  decision: PharmacyPolicyDecision,
  profile: Omit<PharmacyPolicyProfile, 'classification'>,
  businessDate: string
): ServerErrorCode | null {
  if (!decision.allowed) return decision.errorCode ?? 'PHARMACY_POLICY_UNAVAILABLE';
  if (
    decision.requiredProductFields.includes('sanitaryRegistration') &&
    !profile.sanitaryRegistration?.trim()
  ) {
    return 'PHARMACY_PRODUCT_REGISTRATION_REQUIRED';
  }
  if (
    profile.registrationExpiresAt &&
    isCalendarDateExpired(profile.registrationExpiresAt, businessDate)
  ) {
    return 'PHARMACY_PRODUCT_REGISTRATION_EXPIRED';
  }
  return null;
}

const BLOCK_MESSAGES: Partial<Record<ServerErrorCode, string>> = {
  PHARMACY_PRODUCT_REGISTRATION_REQUIRED: 'A sanitary registration is required',
  PHARMACY_PRODUCT_REGISTRATION_EXPIRED: 'The sanitary registration is expired',
};

/** Fail-closed policy check shared by checkout and evidence registration. */
export function assertPharmacyProductPolicy(args: {
  profile: PharmacyPolicyProfile;
  countryCode: string;
  businessDate: string;
  customerId: string | null;
  fneAuthorized?: boolean;
}): PharmacyPolicyDecision {
  const decision = resolvePharmacyPolicy(
    args.countryCode,
    args.businessDate,
    args.profile.classification,
    args.fneAuthorized ? { fneAuthorized: true } : undefined
  );
  const blockCode = pharmacyProductPolicyBlockCode(decision, args.profile, args.businessDate);
  if (blockCode) {
    throwServerError({
      trpcCode: 'PRECONDITION_FAILED',
      errorCode: blockCode,
      message: BLOCK_MESSAGES[blockCode] ?? 'The effective pharmacy policy blocks this product',
    });
  }
  if (decision.customerRequired && !args.customerId) {
    throwServerError({
      trpcCode: 'PRECONDITION_FAILED',
      errorCode: 'PHARMACY_CUSTOMER_REQUIRED',
      message: 'A customer is required by the pharmacy policy',
    });
  }
  return decision;
}
