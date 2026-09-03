import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

let encryptionKey: Buffer | null = null;
let digestKey: Buffer | null = null;
const MAX_SEALED_EVIDENCE_CHARACTERS = 32_768;

export interface PharmacyEvidencePayload {
  reference: string;
  prescriberName?: string | null;
  prescriberCredential?: string | null;
  buyerDocument?: string | null;
  notes?: string | null;
}

export type PharmacySecretPurpose = 'prescription' | 'professional-credential';

export interface PharmacySecretContext {
  purpose: PharmacySecretPurpose;
  tenantId: string;
  /** Record id for ciphertexts; product/country scope for duplicate digests. */
  subjectId: string;
}

export interface StoredPharmacyPrescriptionEvidence {
  id: string;
  tenantId: string;
  productId: string;
  referenceDigest: string;
  sealedEvidence: string;
}

export interface StoredPharmacyProfessionalCredential {
  id: string;
  tenantId: string;
  countryCode: string;
  credentialType: string;
  credentialDigest: string;
  sealedCredential: string;
}

/** Configure process-local keys derived with domain separation. */
export function configurePharmacyEvidenceKey(source: string | undefined): void {
  encryptionKey?.fill(0);
  digestKey?.fill(0);
  encryptionKey = source
    ? createHash('sha256')
        .update('puntovivo:pharmacy-evidence:encryption:v1')
        .update(source)
        .digest()
    : null;
  digestKey = source
    ? createHash('sha256').update('puntovivo:pharmacy-evidence:digest:v1').update(source).digest()
    : null;
}

export function hasPharmacyEvidenceKey(): boolean {
  return encryptionKey !== null && digestKey !== null;
}

function requireKeys(): { encryption: Buffer; digest: Buffer } {
  if (!encryptionKey || !digestKey) {
    throw new Error('PHARMACY_EVIDENCE_KEY_UNAVAILABLE');
  }
  return { encryption: encryptionKey, digest: digestKey };
}

function purposeBytes(purpose: PharmacySecretPurpose): Buffer {
  return Buffer.from(`puntovivo:pharmacy-secret:${purpose}:v1`, 'utf8');
}

function contextBytes(context: PharmacySecretContext): Buffer {
  if (!context.tenantId || !context.subjectId) {
    throw new Error('PHARMACY_EVIDENCE_CONTEXT_INVALID');
  }
  return Buffer.from(
    JSON.stringify([
      'puntovivo:pharmacy-secret:v2',
      context.purpose,
      context.tenantId,
      context.subjectId,
    ]),
    'utf8'
  );
}

function normalizeSensitiveReference(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleUpperCase('en-US');
}

/** Stable keyed digest used only for duplicate/reuse detection. */
export function digestPharmacyReference(
  reference: string,
  purposeOrContext: PharmacySecretPurpose | PharmacySecretContext = 'prescription'
): string {
  const { digest } = requireKeys();
  const domain =
    typeof purposeOrContext === 'string'
      ? purposeBytes(purposeOrContext)
      : contextBytes(purposeOrContext);
  return createHmac('sha256', digest)
    .update(domain)
    .update('\0')
    .update(normalizeSensitiveReference(reference))
    .digest('hex');
}

/** AES-256-GCM envelope. No pharmacy evidence is ever stored as plaintext. */
export function sealPharmacyEvidence(
  payload: PharmacyEvidencePayload,
  purposeOrContext: PharmacySecretPurpose | PharmacySecretContext = 'prescription'
): string {
  const { encryption } = requireKeys();
  const context =
    typeof purposeOrContext === 'string'
      ? { version: 'v1' as const, purpose: purposeOrContext, aad: purposeBytes(purposeOrContext) }
      : {
          version: 'v2' as const,
          purpose: purposeOrContext.purpose,
          aad: contextBytes(purposeOrContext),
        };
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryption, iv);
  cipher.setAAD(context.aad);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  try {
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      context.version,
      context.purpose,
      iv.toString('base64url'),
      tag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');
  } finally {
    plaintext.fill(0);
  }
}

function decodeCanonicalBase64Url(value: string, expectedBytes?: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('PHARMACY_EVIDENCE_INVALID');
  }
  const decoded = Buffer.from(value, 'base64url');
  if (
    decoded.toString('base64url') !== value ||
    (expectedBytes !== undefined && decoded.length !== expectedBytes)
  ) {
    throw new Error('PHARMACY_EVIDENCE_INVALID');
  }
  return decoded;
}

/** Administrative/test recovery primitive; ordinary reads never call it. */
export function openPharmacyEvidence(
  sealed: string,
  purposeOrContext: PharmacySecretPurpose | PharmacySecretContext = 'prescription'
): PharmacyEvidencePayload {
  const { encryption } = requireKeys();
  if (sealed.length > MAX_SEALED_EVIDENCE_CHARACTERS) {
    throw new Error('PHARMACY_EVIDENCE_INVALID');
  }
  const expectedPurpose =
    typeof purposeOrContext === 'string' ? purposeOrContext : purposeOrContext.purpose;
  const parts = sealed.split('.');
  const [version, purpose, ivValue, tagValue, ciphertextValue] = parts;
  if (
    parts.length !== 5 ||
    (version !== 'v1' && version !== 'v2') ||
    purpose !== expectedPurpose ||
    !ivValue ||
    !tagValue ||
    !ciphertextValue
  ) {
    throw new Error('PHARMACY_EVIDENCE_INVALID');
  }
  if (version === 'v2' && typeof purposeOrContext === 'string') {
    throw new Error('PHARMACY_EVIDENCE_CONTEXT_REQUIRED');
  }
  const iv = decodeCanonicalBase64Url(ivValue, 12);
  const tag = decodeCanonicalBase64Url(tagValue, 16);
  const ciphertext = decodeCanonicalBase64Url(ciphertextValue);
  const decipher = createDecipheriv('aes-256-gcm', encryption, iv);
  decipher.setAAD(
    version === 'v1'
      ? purposeBytes(expectedPurpose)
      : contextBytes(purposeOrContext as PharmacySecretContext)
  );
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  try {
    const parsed = JSON.parse(plaintext.toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('PHARMACY_EVIDENCE_INVALID');
    }
    const payload = parsed as Record<string, unknown>;
    const optionalTextFields = [
      'prescriberName',
      'prescriberCredential',
      'buyerDocument',
      'notes',
    ] as const;
    if (
      typeof payload.reference !== 'string' ||
      optionalTextFields.some(
        field =>
          payload[field] !== undefined &&
          payload[field] !== null &&
          typeof payload[field] !== 'string'
      )
    ) {
      throw new Error('PHARMACY_EVIDENCE_INVALID');
    }
    return payload as unknown as PharmacyEvidencePayload;
  } finally {
    plaintext.fill(0);
  }
}

function digestMatches(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

/**
 * Authenticate a stored prescription envelope and bind its plaintext
 * reference back to the tenant/product duplicate-detection digest. This is
 * intentionally separate from ordinary list reads so PII is opened only at
 * the approval and dispensing decision boundaries.
 */
export function openStoredPharmacyPrescriptionEvidence(
  evidence: StoredPharmacyPrescriptionEvidence
): PharmacyEvidencePayload {
  const payload = openPharmacyEvidence(evidence.sealedEvidence, {
    purpose: 'prescription',
    tenantId: evidence.tenantId,
    subjectId: evidence.id,
  });
  const currentDigest = digestPharmacyReference(payload.reference, {
    purpose: 'prescription',
    tenantId: evidence.tenantId,
    subjectId: evidence.productId,
  });
  const legacyDigest = digestPharmacyReference(payload.reference, 'prescription');
  if (
    !digestMatches(evidence.referenceDigest, currentDigest) &&
    !digestMatches(evidence.referenceDigest, legacyDigest)
  ) {
    throw new Error('PHARMACY_EVIDENCE_INVALID');
  }
  return payload;
}

/** Authenticate and bind one professional credential to its stored identity. */
export function openStoredPharmacyProfessionalCredential(
  authorization: StoredPharmacyProfessionalCredential
): PharmacyEvidencePayload {
  const payload = openPharmacyEvidence(authorization.sealedCredential, {
    purpose: 'professional-credential',
    tenantId: authorization.tenantId,
    subjectId: authorization.id,
  });
  const currentDigest = digestPharmacyReference(payload.reference, {
    purpose: 'professional-credential',
    tenantId: authorization.tenantId,
    subjectId: authorization.countryCode,
  });
  const legacyDigest = digestPharmacyReference(payload.reference, 'professional-credential');
  if (
    payload.notes !== authorization.credentialType ||
    (!digestMatches(authorization.credentialDigest, currentDigest) &&
      !digestMatches(authorization.credentialDigest, legacyDigest))
  ) {
    throw new Error('PHARMACY_AUTHORIZATION_INVALID');
  }
  return payload;
}
