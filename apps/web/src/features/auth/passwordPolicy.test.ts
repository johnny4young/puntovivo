import { describe, expect, it } from 'vitest';
import { getPasswordRequirementKey } from './passwordPolicy';

describe('password policy', () => {
  it('accepts a strong password', () => {
    expect(getPasswordRequirementKey('StrongPassword123!')).toBeNull();
  });

  it('rejects passwords shorter than 12 characters', () => {
    expect(getPasswordRequirementKey('Short1!')).toBe('minLength');
  });

  it('rejects passwords without a special character', () => {
    expect(getPasswordRequirementKey('StrongPassword123')).toBe('specialCharacter');
  });
});
