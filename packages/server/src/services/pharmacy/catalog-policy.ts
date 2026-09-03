import type { PharmacyClassification } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { isCalendarDateExpired } from './business-clock.js';
import { resolvePharmacyPolicy, type PharmacyPolicyDecision } from './policy.js';

export interface PharmacyPolicyProfile {
  classification: PharmacyClassification;
  sanitaryRegistration: string | null;
  registrationExpiresAt: string | null;
}

/** Fail-closed policy check shared by checkout and evidence registration. */
export function assertPharmacyProductPolicy(args: {
  profile: PharmacyPolicyProfile;
  countryCode: string;
  businessDate: string;
  customerId: string | null;
}): PharmacyPolicyDecision {
  const decision = resolvePharmacyPolicy(
    args.countryCode,
    args.businessDate,
    args.profile.classification
  );
  if (!decision.allowed && decision.errorCode) {
    throwServerError({
      trpcCode: 'PRECONDITION_FAILED',
      errorCode: decision.errorCode,
      message: 'The effective pharmacy policy blocks this product',
    });
  }
  if (
    decision.requiredProductFields.includes('sanitaryRegistration') &&
    !args.profile.sanitaryRegistration?.trim()
  ) {
    throwServerError({
      trpcCode: 'PRECONDITION_FAILED',
      errorCode: 'PHARMACY_PRODUCT_REGISTRATION_REQUIRED',
      message: 'A sanitary registration is required',
    });
  }
  if (
    args.profile.registrationExpiresAt &&
    isCalendarDateExpired(args.profile.registrationExpiresAt, args.businessDate)
  ) {
    throwServerError({
      trpcCode: 'PRECONDITION_FAILED',
      errorCode: 'PHARMACY_PRODUCT_REGISTRATION_EXPIRED',
      message: 'The sanitary registration is expired',
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
