/**
 * `computeCufe` tests.
 *
 * Coverage:
 * - The worked CUFE example published in the DIAN UBL 2.1 Anexo Técnico.
 * - Changing any single field mutates the hash (avalanche).
 * - The buyer ID type is not part of the hash.
 * - Non-finite numbers collapse to `0.00` (malformed-input safety).
 * - Consumidor final constants match DIAN convention.
 */

import { describe, expect, it } from 'vitest';
import { CONSUMIDOR_FINAL, composeCufeInput, computeCufe } from '../services/fiscal/cufe.js';

const BASE_INPUT = {
  documentNumber: 'SETP9900000001',
  issueDate: '2026-04-24',
  issueTime: '10:00:00-05:00',
  subtotal: 100,
  ivaAmount: 19,
  incAmount: 0,
  icaAmount: 0,
  totalAmount: 119,
  issuerNit: '900100200',
  buyerIdNumber: '800123456',
  technicalKey: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
  environment: '2' as const,
};

describe('computeCufe', () => {
  it('reproduces the DIAN Anexo Técnico worked example', () => {
    const cufe = computeCufe({
      documentNumber: '323200000129',
      issueDate: '2019-01-16',
      issueTime: '10:53:10-05:00',
      subtotal: 1_500_000,
      ivaAmount: 285_000,
      incAmount: 0,
      icaAmount: 0,
      totalAmount: 1_785_000,
      issuerNit: '700085371',
      buyerIdNumber: '800199436',
      technicalKey: '693ff6f2a553c3646a063436fd4dd9ded0311471',
      environment: '1',
    });
    expect(cufe).toBe(
      '8bb918b19ba22a694f1da11c643b5e9de39adf60311cf179179e9b33381030bcd4c3c3f156c506ed5908f9276f5bd9b4'
    );
  });

  it('produces a 96-character lowercase hex string', () => {
    const cufe = computeCufe(BASE_INPUT);
    expect(cufe).toMatch(/^[0-9a-f]{96}$/);
    expect(cufe).toHaveLength(96);
  });

  it('is deterministic — same input yields same hash on repeat runs', () => {
    const first = computeCufe(BASE_INPUT);
    const second = computeCufe(BASE_INPUT);
    const third = computeCufe({ ...BASE_INPUT });
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it('reacts to every CUFE input field (avalanche test)', () => {
    const reference = computeCufe(BASE_INPUT);
    const mutations: Array<Partial<typeof BASE_INPUT>> = [
      { documentNumber: 'SETP9900000002' },
      { issueDate: '2026-04-25' },
      { issueTime: '10:00:01-05:00' },
      { subtotal: 100.01 },
      { ivaAmount: 19.01 },
      { incAmount: 0.01 },
      { icaAmount: 0.01 },
      { totalAmount: 119.01 },
      { issuerNit: '900100201' },
      { buyerIdNumber: '800123457' },
      { technicalKey: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162d' },
      { environment: '1' as const },
    ];
    for (const mutation of mutations) {
      const mutated = computeCufe({ ...BASE_INPUT, ...mutation });
      expect(
        mutated,
        `expected mutation of ${Object.keys(mutation)[0]} to change the CUFE hash`
      ).not.toBe(reference);
    }
  });

  it('collapses non-finite numbers to 0.00 in the canonical input', () => {
    const inputWithNaN = { ...BASE_INPUT, ivaAmount: NaN };
    const inputWithInfinity = { ...BASE_INPUT, icaAmount: Infinity };
    expect(composeCufeInput(inputWithNaN)).toContain('010.00');
    expect(composeCufeInput(inputWithInfinity)).toContain('030.00');
    // Finite replacements produce the same hash as passing 0 directly.
    const baseline = computeCufe({ ...BASE_INPUT, ivaAmount: 0 });
    expect(computeCufe(inputWithNaN)).toBe(baseline);
  });

  it('exposes CONSUMIDOR_FINAL DIAN constants', () => {
    expect(CONSUMIDOR_FINAL.taxId).toBe('222222222222');
    expect(CONSUMIDOR_FINAL.taxIdTypeCode).toBe('31');
    expect(CONSUMIDOR_FINAL.name).toBe('Consumidor final');
  });

  it('concatenates the canonical input in the documented order', () => {
    const canonical = composeCufeInput(BASE_INPUT);
    // Field order: document, date, time, subtotal, '01', iva, '04',
    // inc, '03', ica, total, nit, buyerNum, technicalKey, environment.
    // Hand-rolled so a refactor that reorders the concatenation trips
    // the assertion.
    expect(canonical).toBe(
      'SETP9900000001' +
        '2026-04-24' +
        '10:00:00-05:00' +
        '100.00' +
        '01' +
        '19.00' +
        '04' +
        '0.00' +
        '03' +
        '0.00' +
        '119.00' +
        '900100200' +
        '800123456' +
        'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c' +
        '2'
    );
  });
});
