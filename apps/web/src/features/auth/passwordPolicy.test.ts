import { describe, expect, it } from 'vitest';
import { getPasswordRequirementMessage } from './passwordPolicy';

describe('password policy', () => {
  it('accepts a strong password', () => {
    expect(getPasswordRequirementMessage('StrongPassword123!')).toBeNull();
  });

  it('rejects passwords shorter than 12 characters', () => {
    expect(getPasswordRequirementMessage('Short1!')).toBe('Password must be at least 12 characters');
  });

  it('rejects passwords without a special character', () => {
    expect(getPasswordRequirementMessage('StrongPassword123')).toBe(
      'Password must contain at least one special character'
    );
  });
});
