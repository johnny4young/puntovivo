import type { PharmacyClassification } from '../../db/schema.js';

export type PharmacyPolicyErrorCode =
  'PHARMACY_POLICY_UNAVAILABLE' | 'PHARMACY_CONTROLLED_NOT_ENABLED';

export type PharmacyEvidenceField = 'prescriberName' | 'prescriberCredential' | 'buyerDocument';

export interface PharmacyPolicyDecision {
  countryCode: string;
  policyVersion: string;
  effectiveFrom: string;
  classification: PharmacyClassification;
  allowed: boolean;
  errorCode: PharmacyPolicyErrorCode | null;
  evidenceRequired: boolean;
  professionalApprovalRequired: boolean;
  customerRequired: boolean;
  requiredEvidenceFields: ReadonlyArray<PharmacyEvidenceField>;
  allowedEvidenceStatuses: ReadonlyArray<'approved'>;
  /** Null means no automatic purge is permitted until legal review supplies a floor. */
  minimumRetentionDays: number | null;
  requiredProductFields: ReadonlyArray<'sanitaryRegistration'>;
  maxQuantity: number | null;
}

export interface PharmacyPolicyOptions {
  /** True only when the server has verified an active tenant/site FNE authorization. */
  fneAuthorized?: boolean;
}

interface PharmacyPolicyAdapter {
  countryCode: string;
  policyVersion: string;
  effectiveFrom: string;
  decide(
    classification: PharmacyClassification,
    options?: PharmacyPolicyOptions
  ): PharmacyPolicyDecision;
}

const colombiaV1: PharmacyPolicyAdapter = {
  countryCode: 'CO',
  policyVersion: 'co-pharmacy-v1-2026-09-01',
  effectiveFrom: '2026-09-01',
  decide(classification, options) {
    const base = {
      countryCode: this.countryCode,
      policyVersion: this.policyVersion,
      effectiveFrom: this.effectiveFrom,
      classification,
      requiredProductFields: ['sanitaryRegistration'] as const,
      allowedEvidenceStatuses: ['approved'] as const,
      minimumRetentionDays: null,
      maxQuantity: null,
    };
    if (classification === 'otc') {
      return {
        ...base,
        allowed: true,
        errorCode: null,
        evidenceRequired: false,
        professionalApprovalRequired: false,
        customerRequired: false,
        requiredEvidenceFields: [],
      };
    }
    if (classification === 'prescription') {
      return {
        ...base,
        allowed: true,
        errorCode: null,
        evidenceRequired: true,
        professionalApprovalRequired: true,
        customerRequired: true,
        requiredEvidenceFields: ['prescriberName', 'prescriberCredential'],
      };
    }
    if (options?.fneAuthorized) {
      return {
        ...base,
        policyVersion: 'co-pharmacy-fne-v1-2026-11-27',
        allowed: true,
        errorCode: null,
        evidenceRequired: true,
        professionalApprovalRequired: true,
        customerRequired: true,
        requiredEvidenceFields: ['prescriberName', 'prescriberCredential', 'buyerDocument'],
      };
    }
    // Controlled medicines stay disabled unless an active FNE resolution is registered.
    return {
      ...base,
      allowed: false,
      errorCode: 'PHARMACY_CONTROLLED_NOT_ENABLED',
      evidenceRequired: true,
      professionalApprovalRequired: true,
      customerRequired: true,
      requiredEvidenceFields: ['prescriberName', 'prescriberCredential', 'buyerDocument'],
    };
  },
};

const ADAPTERS = [colombiaV1] as const;

/**
 * Resolve an effective policy. Unsupported countries deliberately expose only
 * OTC operation; prescription and controlled classifications fail closed.
 */
export function resolvePharmacyPolicy(
  countryCode: string,
  businessDate: string,
  classification: PharmacyClassification,
  options?: PharmacyPolicyOptions
): PharmacyPolicyDecision {
  const adapter = [...ADAPTERS]
    .filter(
      candidate => candidate.countryCode === countryCode && candidate.effectiveFrom <= businessDate
    )
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0];
  if (adapter) return adapter.decide(classification, options);

  const allowed = classification === 'otc';
  return {
    countryCode,
    policyVersion: `generic-otc-only-v1:${countryCode}`,
    effectiveFrom: '1970-01-01',
    classification,
    allowed,
    errorCode: allowed ? null : 'PHARMACY_POLICY_UNAVAILABLE',
    evidenceRequired: !allowed,
    professionalApprovalRequired: !allowed,
    customerRequired: !allowed,
    requiredEvidenceFields: [],
    allowedEvidenceStatuses: ['approved'],
    minimumRetentionDays: null,
    requiredProductFields: [],
    maxQuantity: null,
  };
}
