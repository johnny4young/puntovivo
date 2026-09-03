import { describe, expect, it } from 'vitest';

import {
  retainEligibleEvidenceIds,
  selectedEvidenceCoversRequirement,
  selectedEvidenceCoversRequirements,
  type PharmacyCheckoutRequirement,
} from './pharmacyCheckout';

function requirement(
  overrides: Partial<PharmacyCheckoutRequirement> = {}
): PharmacyCheckoutRequirement {
  return {
    productId: 'medicine-1',
    productName: 'Medicine',
    classification: 'prescription',
    requestedQuantity: 2,
    policyVersion: 'co-v1',
    evidenceRequired: true,
    professionalApprovalRequired: true,
    blockedErrorCode: null,
    eligibleEvidence: [
      { id: 'evidence-a', remainingQuantity: 1 },
      { id: 'evidence-b', remainingQuantity: 1 },
    ],
    ...overrides,
  };
}

describe('pharmacy checkout evidence selection', () => {
  it('requires exact selected evidence to cover each medicine quantity', () => {
    const requirements = [
      requirement(),
      requirement({
        productId: 'medicine-2',
        requestedQuantity: 1,
        eligibleEvidence: [{ id: 'evidence-c', remainingQuantity: 1 }],
      }),
    ];

    expect(selectedEvidenceCoversRequirements(requirements, ['evidence-a', 'evidence-b'])).toBe(
      false
    );
    expect(
      selectedEvidenceCoversRequirements(requirements, ['evidence-a', 'evidence-b', 'evidence-c'])
    ).toBe(true);
  });

  it('fails closed on policy blocks even when no prescription is needed', () => {
    expect(
      selectedEvidenceCoversRequirements(
        [
          requirement({
            evidenceRequired: false,
            blockedErrorCode: 'PHARMACY_CONTROLLED_NOT_ENABLED',
            eligibleEvidence: [],
          }),
        ],
        []
      )
    ).toBe(false);
  });

  it('reports when one medicine already has sufficient selected evidence', () => {
    const single = requirement({
      eligibleEvidence: [
        { id: 'evidence-full', remainingQuantity: 2 },
        { id: 'evidence-extra', remainingQuantity: 1 },
      ],
    });

    expect(selectedEvidenceCoversRequirement(single, [])).toBe(false);
    expect(selectedEvidenceCoversRequirement(single, ['evidence-full'])).toBe(true);
  });

  it('removes stale, duplicate, and cross-customer ids after every policy refresh', () => {
    expect(
      retainEligibleEvidenceIds([requirement()], ['evidence-a', 'evidence-stale', 'evidence-a'])
    ).toEqual(['evidence-a']);
  });

  it('drops selected evidence that the authoritative FEFO allocation would not consume', () => {
    const requirements = [
      requirement({
        eligibleEvidence: [
          { id: 'evidence-earlier-full', remainingQuantity: 2 },
          { id: 'evidence-later-partial', remainingQuantity: 1 },
        ],
      }),
    ];

    expect(
      retainEligibleEvidenceIds(requirements, ['evidence-later-partial', 'evidence-earlier-full'])
    ).toEqual(['evidence-earlier-full']);
  });

  it('retains the minimum selected FEFO sequence required by each medicine', () => {
    const requirements = [
      requirement({
        eligibleEvidence: [
          { id: 'evidence-a', remainingQuantity: 1 },
          { id: 'evidence-b', remainingQuantity: 1 },
          { id: 'evidence-extra', remainingQuantity: 4 },
        ],
      }),
      requirement({
        productId: 'medicine-2',
        requestedQuantity: 1,
        eligibleEvidence: [{ id: 'evidence-c', remainingQuantity: 1 }],
      }),
    ];

    expect(
      retainEligibleEvidenceIds(requirements, [
        'evidence-extra',
        'evidence-c',
        'evidence-b',
        'evidence-a',
      ])
    ).toEqual(['evidence-a', 'evidence-b', 'evidence-c']);
  });
});
