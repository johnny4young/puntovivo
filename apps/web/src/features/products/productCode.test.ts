import { describe, expect, it } from 'vitest';
import { createInternalProductCode } from './productCode';

describe('createInternalProductCode', () => {
  it('builds a readable uppercase code and strips accents', () => {
    expect(createInternalProductCode('Café molido premium', 'abc-123-xyz-789')).toBe(
      'PV-CAFE-MOLIDO-PREMIUM-XYZ789'
    );
  });

  it('uses a stable fallback when the name has no code-safe characters', () => {
    expect(createInternalProductCode('  ☕  ', '123')).toBe('PV-PRODUCTO-000123');
  });

  it('bounds the readable stem so the generated SKU stays compact', () => {
    const code = createInternalProductCode('a'.repeat(100), 'abcdef');

    expect(code).toBe(`PV-${'A'.repeat(32)}-ABCDEF`);
    expect(code.length).toBeLessThanOrEqual(42);
  });
});
