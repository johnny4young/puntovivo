import { describe, expect, it } from 'vitest';
import { createIdentityProjection } from './privacy.js';

describe('request-local identity projection', () => {
  it('preserves exact value equality, distinct case variants and empty fields', () => {
    const projection = createIdentityProjection(['Ana', 'Ana', 'ANA', '', null]);
    expect(projection.identity('Ana')).not.toBe(projection.identity('ANA'));
    expect(projection.identity('')).toMatch(/^person_/);
    expect(projection.redact('Ana ANA ana')).toBe(
      `${projection.identity('Ana')} ${projection.identity('ANA')} [ambiguous identity]`
    );
    expect(() => projection.identity('unknown')).toThrow('outside');
  });

  it('matches longer names first and escapes regex metacharacters', () => {
    const projection = createIdentityProjection(['Ana', 'Ana María', 'Client (A)+']);
    expect(projection.redact('Ana María / Client (A)+')).toBe(
      `${projection.identity('Ana María')} / ${projection.identity('Client (A)+')}`
    );
    expect(projection.redact('ANA MARÍA')).toBe(projection.identity('Ana María'));
  });

  it('does not claim arbitrary text detection or rewrite embedded identifiers', () => {
    const projection = createIdentityProjection(['Ana']);
    expect(projection.redact('banana customer_Ana unknown@example.invalid')).toBe(
      'banana customer_Ana unknown@example.invalid'
    );
    expect(createIdentityProjection([null, '']).redact('unchanged')).toBe('unchanged');
  });
});
