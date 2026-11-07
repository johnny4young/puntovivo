import { describe, expect, it } from 'vitest';
import { normalizeCoBuyerId } from '../services/fiscal/packs/co/buyer-id.js';

describe('normalizeCoBuyerId', () => {
  it('writes a NIT as base and verification digit, computing a missing DV', () => {
    expect(normalizeCoBuyerId('31', '900.373.115')).toEqual({ ok: true, value: '900373115-3' });
    expect(normalizeCoBuyerId('31', '900373115 - 3')).toEqual({ ok: true, value: '900373115-3' });
  });

  it('accepts a natural-person NIT shorter than the issuer contract', () => {
    expect(normalizeCoBuyerId('31', '8.765.432')).toMatchObject({ ok: true });
  });

  it('rejects a NIT whose typed DV does not match', () => {
    expect(normalizeCoBuyerId('31', '900373115-9')).toEqual({ ok: false, reason: 'dv_mismatch' });
  });

  it('keeps letters and digits for other document types', () => {
    expect(normalizeCoBuyerId('13', '1.020.304.050')).toEqual({ ok: true, value: '1020304050' });
    expect(normalizeCoBuyerId('41', ' ab-123456 ')).toEqual({ ok: true, value: 'AB123456' });
  });

  it('rejects empty, malformed and consumidor final numbers', () => {
    expect(normalizeCoBuyerId('13', '  ')).toEqual({ ok: false, reason: 'empty' });
    expect(normalizeCoBuyerId('13', '12')).toEqual({ ok: false, reason: 'malformed' });
    expect(normalizeCoBuyerId('31', '90037ABC')).toEqual({ ok: false, reason: 'malformed' });
    expect(normalizeCoBuyerId('13', '222222222222')).toEqual({
      ok: false,
      reason: 'consumidor_final',
    });
    expect(normalizeCoBuyerId('31', '222222222222')).toEqual({
      ok: false,
      reason: 'consumidor_final',
    });
  });
});
