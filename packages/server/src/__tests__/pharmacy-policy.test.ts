import { afterEach, describe, expect, it } from 'vitest';

import {
  configurePharmacyEvidenceKey,
  digestPharmacyReference,
  openPharmacyEvidence,
  openStoredPharmacyProfessionalCredential,
  openStoredPharmacyPrescriptionEvidence,
  sealPharmacyEvidence,
} from '../services/pharmacy/evidence-box.js';
import { resolvePharmacyPolicy } from '../services/pharmacy/policy.js';
import { assertPharmacyProfileTransitionAllowed } from '../services/pharmacy/product-profile.js';
import { pharmacyProductProfileInput } from '../trpc/schemas/products.js';
import {
  createPharmacyAuthorizationInput,
  destroyPharmacyLotInput,
  pharmacyCheckoutRequirementsInput,
  recordPharmacyEvidenceInput,
} from '../trpc/schemas/pharmacy.js';

describe('pharmacy policy and secret contracts', () => {
  afterEach(() => configurePharmacyEvidenceKey(undefined));

  it('keeps unsupported countries OTC-only and controlled products disabled', () => {
    const genericOtc = resolvePharmacyPolicy('PE', '2026-09-02', 'otc');
    expect(genericOtc).toMatchObject({ allowed: true, evidenceRequired: false });

    const genericPrescription = resolvePharmacyPolicy('PE', '2026-09-02', 'prescription');
    expect(genericPrescription).toMatchObject({
      allowed: false,
      errorCode: 'PHARMACY_POLICY_UNAVAILABLE',
    });

    const colombiaPrescription = resolvePharmacyPolicy('CO', '2026-09-02', 'prescription');
    expect(colombiaPrescription).toMatchObject({
      allowed: true,
      evidenceRequired: true,
      professionalApprovalRequired: true,
      customerRequired: true,
      policyVersion: 'co-pharmacy-v1-2026-09-01',
      minimumRetentionDays: null,
    });
    expect(colombiaPrescription.requiredEvidenceFields).toEqual([
      'prescriberName',
      'prescriberCredential',
    ]);

    expect(resolvePharmacyPolicy('CO', '2026-09-02', 'controlled')).toMatchObject({
      allowed: false,
      errorCode: 'PHARMACY_CONTROLLED_NOT_ENABLED',
    });
  });

  it('requires canonical calendar days and bounded positive quantities', () => {
    expect(
      pharmacyProductProfileInput.safeParse({
        classification: 'otc',
        requiresColdChain: false,
        registrationExpiresAt: '2027-09-02T00:00:00.000Z',
      }).success
    ).toBe(false);
    expect(
      createPharmacyAuthorizationInput.safeParse({
        userId: 'u1',
        countryCode: 'co',
        credentialType: 'reg',
        credential: 'credential',
        validFrom: '2026-02-30',
      }).success
    ).toBe(false);
    expect(
      recordPharmacyEvidenceInput.safeParse({
        productId: 'p1',
        customerId: 'c1',
        reference: 'rx-1',
        authorizedQuantity: 0.0000000001,
        validFrom: '2026-09-01',
        expiresAt: '2026-09-02',
      }).success
    ).toBe(false);
    expect(
      destroyPharmacyLotInput.parse({
        lotId: 'l1',
        quantity: 1.2345678914,
        reason: 'Verified disposal',
      }).quantity
    ).toBe(1.234567891);
  });

  it('accepts the same 200-line cart boundary as sale checkout', () => {
    const items = Array.from({ length: 200 }, (_, index) => ({
      productId: `retail-${index}`,
      quantity: 1,
      unitEquivalence: 1,
    }));

    expect(pharmacyCheckoutRequirementsInput.safeParse({ items }).success).toBe(true);
    expect(
      pharmacyCheckoutRequirementsInput.safeParse({
        items: [...items, { productId: 'retail-overflow', quantity: 1, unitEquivalence: 1 }],
      }).success
    ).toBe(false);
  });

  it('fails closed when corrupted stock would relax a medicine profile', () => {
    for (const currentStock of [-1, Number.POSITIVE_INFINITY]) {
      expect(() =>
        assertPharmacyProfileTransitionAllowed({
          existing: {
            classification: 'prescription',
            sanitaryRegistration: 'INVIMA-1',
            requiresColdChain: true,
          },
          next: {
            classification: 'otc',
            sanitaryRegistration: 'INVIMA-1',
            requiresColdChain: false,
          },
          currentStock,
        })
      ).toThrow('cannot remove or relax its classification');
    }
  });

  it('reads legacy v1 envelopes while binding v2 ciphertexts to tenant and record', () => {
    configurePharmacyEvidenceKey('a-secure-pharmacy-key-with-at-least-32-bytes');
    const payload = { reference: 'RX 123', prescriberName: 'Dra. Rivera' };

    const legacy = sealPharmacyEvidence(payload, 'prescription');
    expect(openPharmacyEvidence(legacy, 'prescription')).toEqual(payload);

    const context = { purpose: 'prescription' as const, tenantId: 'tenant-a', subjectId: 'rx-a' };
    const current = sealPharmacyEvidence(payload, context);
    expect(openPharmacyEvidence(current, context)).toEqual(payload);
    expect(() => openPharmacyEvidence(current, { ...context, tenantId: 'tenant-b' })).toThrow();
    expect(() => openPharmacyEvidence(current, { ...context, subjectId: 'rx-b' })).toThrow();
    expect(() => openPharmacyEvidence(`${current}.ignored`, context)).toThrow(
      'PHARMACY_EVIDENCE_INVALID'
    );
    const nonCanonicalCiphertext = current.replace(/([A-Za-z0-9_-]+)$/, '$1!');
    expect(() => openPharmacyEvidence(nonCanonicalCiphertext, context)).toThrow(
      'PHARMACY_EVIDENCE_INVALID'
    );
    const oversizedParts = current.split('.');
    oversizedParts[4] = 'A'.repeat(32_769);
    expect(() => openPharmacyEvidence(oversizedParts.join('.'), context)).toThrow(
      'PHARMACY_EVIDENCE_INVALID'
    );

    const digestA = digestPharmacyReference(' rx   123 ', {
      purpose: 'prescription',
      tenantId: 'tenant-a',
      subjectId: 'product-a',
    });
    expect(digestA).toBe(
      digestPharmacyReference('RX 123', {
        purpose: 'prescription',
        tenantId: 'tenant-a',
        subjectId: 'product-a',
      })
    );
    expect(digestA).not.toBe(
      digestPharmacyReference('RX 123', {
        purpose: 'prescription',
        tenantId: 'tenant-b',
        subjectId: 'product-a',
      })
    );

    const stored = {
      id: 'rx-a',
      tenantId: 'tenant-a',
      productId: 'product-a',
      referenceDigest: digestA,
      sealedEvidence: current,
    };
    expect(openStoredPharmacyPrescriptionEvidence(stored)).toEqual(payload);
    expect(() =>
      openStoredPharmacyPrescriptionEvidence({
        ...stored,
        referenceDigest: '0'.repeat(64),
      })
    ).toThrow('PHARMACY_EVIDENCE_INVALID');

    const credentialPayload = { reference: 'RETHUS-123', notes: 'pharmacist-license' };
    const sealedCredential = sealPharmacyEvidence(credentialPayload, {
      purpose: 'professional-credential',
      tenantId: 'tenant-a',
      subjectId: 'authorization-a',
    });
    const storedCredential = {
      id: 'authorization-a',
      tenantId: 'tenant-a',
      countryCode: 'CO',
      credentialType: 'pharmacist-license',
      credentialDigest: digestPharmacyReference(credentialPayload.reference, {
        purpose: 'professional-credential' as const,
        tenantId: 'tenant-a',
        subjectId: 'CO',
      }),
      sealedCredential,
    };
    expect(openStoredPharmacyProfessionalCredential(storedCredential)).toEqual(credentialPayload);
    expect(() =>
      openStoredPharmacyProfessionalCredential({
        ...storedCredential,
        credentialType: 'different-license',
      })
    ).toThrow('PHARMACY_AUTHORIZATION_INVALID');
  });
});
