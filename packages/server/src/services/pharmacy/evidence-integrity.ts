import { throwServerError } from '../../lib/errorCodes.js';
import {
  hasPharmacyEvidenceKey,
  openStoredPharmacyProfessionalCredential,
  openStoredPharmacyPrescriptionEvidence,
  type PharmacyEvidencePayload,
  type StoredPharmacyPrescriptionEvidence,
  type StoredPharmacyProfessionalCredential,
} from './evidence-box.js';

/** Fail closed with a stable public code before a regulated decision. */
export function requireAuthenticPharmacyPrescriptionEvidence(
  evidence: StoredPharmacyPrescriptionEvidence
): PharmacyEvidencePayload {
  if (!hasPharmacyEvidenceKey()) {
    throwServerError({
      trpcCode: 'PRECONDITION_FAILED',
      errorCode: 'PHARMACY_EVIDENCE_KEY_UNAVAILABLE',
      message: 'Prescription evidence encryption is unavailable',
    });
  }
  try {
    return openStoredPharmacyPrescriptionEvidence(evidence);
  } catch {
    throwServerError({
      trpcCode: 'PRECONDITION_FAILED',
      errorCode: 'PHARMACY_EVIDENCE_INVALID',
      message: 'Prescription evidence could not be authenticated',
    });
  }
}

/** Fail closed when the credential behind an effective authorization is corrupt. */
export function requireAuthenticPharmacyProfessionalCredential(
  authorization: StoredPharmacyProfessionalCredential
): PharmacyEvidencePayload {
  if (!hasPharmacyEvidenceKey()) {
    throwServerError({
      trpcCode: 'PRECONDITION_FAILED',
      errorCode: 'PHARMACY_EVIDENCE_KEY_UNAVAILABLE',
      message: 'Pharmacy secret protection is unavailable',
    });
  }
  try {
    return openStoredPharmacyProfessionalCredential(authorization);
  } catch {
    throwServerError({
      trpcCode: 'PRECONDITION_FAILED',
      errorCode: 'PHARMACY_AUTHORIZATION_INVALID',
      message: 'Professional authorization credential could not be authenticated',
    });
  }
}
