/**
 * A-33 — the client NIT hint mirrors the server DIAN algorithm. These cases
 * are the SAME hand-computed pairs the server test uses (co-nit.test.ts), so
 * any drift between the two implementations turns one of them red:
 *   NIT 900373115 → DV 3, NIT 900123456 → DV 8.
 */
import { describe, expect, it } from 'vitest';
import { computeNitVerificationDigit, nitHint } from './coNit';

describe('computeNitVerificationDigit (client mirror)', () => {
  it('matches the server for the pinned cases', () => {
    expect(computeNitVerificationDigit('900373115')).toBe(3);
    expect(computeNitVerificationDigit('900123456')).toBe(8);
    expect(computeNitVerificationDigit('8300')).toBe(1);
  });
});

describe('nitHint', () => {
  it('is idle for empty input', () => {
    expect(nitHint('').kind).toBe('idle');
    expect(nitHint('   ').kind).toBe('idle');
  });

  it('suggests the DV for a bare NIT', () => {
    expect(nitHint('900373115')).toEqual({ kind: 'suggest', nit: '900373115', dv: 3 });
  });

  it('confirms a matching dashed DV', () => {
    expect(nitHint('900373115-3')).toEqual({ kind: 'match', nit: '900373115', dv: 3 });
  });

  it('warns on a wrong DV and carries the correct one', () => {
    expect(nitHint('900123456-7')).toEqual({
      kind: 'mismatch',
      nit: '900123456',
      dv: 8,
      provided: 7,
    });
  });

  it('accepts dot-grouped input', () => {
    expect(nitHint('900.373.115-3')).toEqual({ kind: 'match', nit: '900373115', dv: 3 });
  });

  it('flags non-numeric input and preserves the 9-10 digit base contract', () => {
    expect(nitHint('90A')).toEqual({ kind: 'invalid', reason: 'non_numeric' });
    expect(nitHint('12345678')).toEqual({ kind: 'invalid', reason: 'too_short' });
    expect(nitHint('12345678901')).toEqual({ kind: 'invalid', reason: 'too_long' });
  });
});
