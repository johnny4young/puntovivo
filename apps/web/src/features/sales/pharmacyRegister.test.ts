import { describe, expect, it } from 'vitest';
import {
  formatDayMonth,
  formatLotMonth,
  pharmacyCustomerNote,
  pharmacyLineHint,
  type PharmacyTicketRequirement,
} from './pharmacyRegister';

function requirement(
  overrides: Partial<PharmacyTicketRequirement> = {}
): PharmacyTicketRequirement {
  return {
    productId: 'amox',
    productName: 'Amoxicilina',
    policyVersion: 'co-v1',
    professionalApprovalRequired: true,
    classification: 'prescription',
    requestedQuantity: 2,
    evidenceRequired: true,
    customerRequired: true,
    blockedErrorCode: null,
    nextLot: null,
    eligibleEvidence: [],
    ...overrides,
  };
}

let evidenceId = 0;
const evidence = (remaining: number, expiresAt = '2026-11-25') => ({
  id: `ev-${(evidenceId += 1)}`,
  expiresAt,
  authorizedQuantity: 21,
  remainingQuantity: remaining,
  approverName: 'Daniela Ortiz',
});

describe('pharmacyLineHint', () => {
  it('gives OTC and controlled lines no status tag', () => {
    expect(
      pharmacyLineHint(requirement({ classification: 'otc', evidenceRequired: false })).status
    ).toBeNull();
    expect(
      pharmacyLineHint(
        requirement({
          classification: 'controlled',
          blockedErrorCode: 'PHARMACY_CONTROLLED_NOT_ENABLED',
        })
      ).status
    ).toBeNull();
  });

  it('names the approver once the prescriptions cover the quantity', () => {
    expect(pharmacyLineHint(requirement({ eligibleEvidence: [evidence(2)] })).status).toEqual({
      kind: 'ready',
      approverName: 'Daniela Ortiz',
    });
    expect(pharmacyLineHint(requirement({ eligibleEvidence: [evidence(1)] })).status).toEqual({
      kind: 'missing',
    });
  });

  it('leaves a missing customer to the card and blocks every other policy refusal', () => {
    expect(
      pharmacyLineHint(requirement({ blockedErrorCode: 'PHARMACY_CUSTOMER_REQUIRED' })).status
    ).toEqual({ kind: 'missing' });
    expect(
      pharmacyLineHint(requirement({ blockedErrorCode: 'PHARMACY_PRODUCT_REGISTRATION_EXPIRED' }))
        .status
    ).toEqual({ kind: 'blocked' });
  });
});

describe('pharmacyCustomerNote', () => {
  it('stays out of tickets that only carry free-sale medicines', () => {
    expect(pharmacyCustomerNote([requirement({ customerRequired: false })], false)).toBeNull();
  });

  it('asks for the customer when none is attached', () => {
    expect(pharmacyCustomerNote([requirement()], false)).toEqual({ missing: true });
  });

  it('reports the earliest expiry, and the quantity when one medicine needs a prescription', () => {
    expect(
      pharmacyCustomerNote(
        [
          requirement({
            eligibleEvidence: [evidence(21, '2026-12-01'), evidence(4, '2026-11-25')],
          }),
        ],
        true
      )
    ).toEqual({
      missing: false,
      validUntil: '2026-11-25',
      quantity: { remaining: 25, authorized: 42 },
    });
    expect(
      pharmacyCustomerNote(
        [
          requirement({ eligibleEvidence: [evidence(21)] }),
          requirement({ productId: 'other', eligibleEvidence: [evidence(3, '2026-11-30')] }),
        ],
        true
      )
    ).toEqual({ missing: false, validUntil: '2026-11-25', quantity: null });
  });

  it('ignores a controlled medicine, which no customer unblocks', () => {
    expect(
      pharmacyCustomerNote(
        [
          requirement({
            classification: 'controlled',
            blockedErrorCode: 'PHARMACY_CONTROLLED_NOT_ENABLED',
          }),
        ],
        false
      )
    ).toBeNull();
  });
});

describe('lot dates', () => {
  it('reads expiries as calendar dates in the active language', () => {
    expect(formatLotMonth('2027-03-01', 'es')).toBe('mar 2027');
    expect(formatLotMonth('2027-03-01T03:00:00.000Z', 'en')).toBe('Mar 2027');
    expect(formatDayMonth('2026-11-25', 'es')).toBe('25 de noviembre');
    expect(formatLotMonth('not-a-date', 'es')).toBe('');
    expect(formatLotMonth('2026-02-30', 'es')).toBe('');
  });
});
