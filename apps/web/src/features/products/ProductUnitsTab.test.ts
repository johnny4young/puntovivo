import { describe, expect, it } from 'vitest';

import { validateSerialUnitEquivalence } from './serialTracking';

describe('validateSerialUnitEquivalence (ENG-110c)', () => {
  it('accepts only one-base-unit assignments for serialized products', () => {
    const message = 'Every serialized sale unit must equal one base unit';

    expect(validateSerialUnitEquivalence(true, 1, message)).toBe(true);
    expect(validateSerialUnitEquivalence(true, 1 + 1e-10, message)).toBe(true);
    expect(validateSerialUnitEquivalence(true, 12, message)).toBe(message);
    expect(validateSerialUnitEquivalence(false, 12, message)).toBe(true);
  });
});
