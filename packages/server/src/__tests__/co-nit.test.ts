/**
 * A-33 — NIT verification-digit validator.
 *
 * The DV is a mod-11 weighted sum with the official DIAN weights. The cases
 * below are hand-computed from the algorithm so the test pins the algorithm
 * itself, not a memorized (NIT, DV) authority:
 *
 *   NIT 900373115, digits right-to-left 5,1,1,3,7,3,0,0,9
 *   × weights      3,7,13,17,19,23,29,37,41
 *   = 15+7+13+51+133+69+0+0+369 = 657; 657 mod 11 = 8; DV = 11 − 8 = 3.
 */
import { describe, expect, it } from 'vitest';
import { computeNitVerificationDigit, validateNit } from '../services/fiscal/packs/co/nit.js';

describe('computeNitVerificationDigit', () => {
  it('matches the hand-computed DIAN digit', () => {
    expect(computeNitVerificationDigit('900373115')).toBe(3);
    // 8300, r-to-l 0,0,3,8 × 3,7,13,17 = 0+0+39+136 = 175; 175 mod 11 = 10; DV = 1.
    expect(computeNitVerificationDigit('8300')).toBe(1);
  });

  it('returns the remainder itself when it is 0 or 1 (no 11 − r)', () => {
    // 15: r-to-l 5,1 × 3,7 = 15+7 = 22; remainder 0 → DV 0.
    expect(computeNitVerificationDigit('15')).toBe(0);
    // 4: 4 × 3 = 12; remainder 1 → DV 1.
    expect(computeNitVerificationDigit('4')).toBe(1);
  });
});

describe('validateNit', () => {
  it('accepts a bare NIT and returns its correct DV', () => {
    const r = validateNit('900373115');
    expect(r.valid).toBe(true);
    expect(r.verificationDigit).toBe(3);
    expect(r.providedDigit).toBeNull();
  });

  it('accepts a NIT with a matching dashed DV', () => {
    const r = validateNit('900373115-3');
    expect(r.valid).toBe(true);
    expect(r.providedDigit).toBe(3);
  });

  it('accepts dot-grouped input with a dashed DV', () => {
    const r = validateNit('900.373.115-3');
    expect(r.valid).toBe(true);
    expect(r.nit).toBe('900373115');
    expect(r.verificationDigit).toBe(3);
  });

  it('rejects a NIT whose provided DV is wrong', () => {
    const r = validateNit('900373115-9');
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('dv_mismatch');
    // The result still carries the correct DV so the UI can suggest it.
    expect(r.verificationDigit).toBe(3);
    expect(r.providedDigit).toBe(9);
  });

  it('rejects non-numeric and empty input', () => {
    expect(validateNit('').reason).toBe('empty');
    expect(validateNit('90A373').reason).toBe('non_numeric');
    expect(validateNit('   ').reason).toBe('empty');
  });

  it('preserves the configured 9-10 digit NIT base contract', () => {
    expect(validateNit('12345678').reason).toBe('too_short');
    expect(validateNit('12345678901').reason).toBe('too_long');
  });
});
