/**
 * `computeCude` tests, anchored on the worked example of the DIAN
 * Anexo Técnico del Documento Equivalente Electrónico v1.0
 * (Resolución 000165/2023, §14.1.5).
 */

import { describe, expect, it } from 'vitest';
import { composeCudeInput, computeCude } from '../services/fiscal/cude.js';
import { composeCufeInput } from '../services/fiscal/cufe.js';

const DIAN_EXAMPLE = {
  documentNumber: '8110007871',
  issueDate: '2019-01-12',
  issueTime: '07:00:00-05:00',
  subtotal: 5000,
  ivaAmount: 950,
  incAmount: 0,
  icaAmount: 0,
  totalAmount: 5950,
  issuerNit: '900373076',
  buyerIdNumber: '8355990',
  softwarePin: '12301',
  environment: '1' as const,
};

describe('computeCude', () => {
  it('composes the exact string published in the annex', () => {
    expect(composeCudeInput(DIAN_EXAMPLE)).toBe(
      '81100078712019-01-1207:00:00-05:005000.0001950.00040.00030.005950.009003730768355990123011'
    );
  });

  it('reproduces the annex CUDE', () => {
    expect(computeCude(DIAN_EXAMPLE)).toBe(
      '907e4444decc9e59c160a2fb3b6659b33dc5b632a5008922b9a62f83f757b1c448e47f5867f2b50dbdb96f48c7681168'
    );
  });

  it('places the software PIN where the CUFE places the technical key', () => {
    const { softwarePin, ...fields } = DIAN_EXAMPLE;
    expect(composeCudeInput(DIAN_EXAMPLE)).toBe(
      composeCufeInput({ ...fields, technicalKey: softwarePin })
    );
  });

  it('reacts to every CUDE input field (avalanche test)', () => {
    const reference = computeCude(DIAN_EXAMPLE);
    const mutations: Array<Partial<typeof DIAN_EXAMPLE>> = [
      { documentNumber: '8110007872' },
      { issueDate: '2019-01-13' },
      { issueTime: '07:00:01-05:00' },
      { subtotal: 5000.01 },
      { ivaAmount: 950.01 },
      { incAmount: 0.01 },
      { icaAmount: 0.01 },
      { totalAmount: 5950.01 },
      { issuerNit: '900373077' },
      { buyerIdNumber: '8355991' },
      { softwarePin: '12302' },
      { environment: '2' as const },
    ];
    for (const mutation of mutations) {
      expect(
        computeCude({ ...DIAN_EXAMPLE, ...mutation }),
        `expected mutation of ${Object.keys(mutation)[0]} to change the CUDE`
      ).not.toBe(reference);
    }
  });
});
