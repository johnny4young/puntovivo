import { describe, expect, it } from 'vitest';
import {
  getDummyStaffPinHash,
  hashStaffPin,
  isValidStaffPin,
  verifyStaffPin,
  warmUpStaffPinSecurity,
} from '../security/staffPins.js';

describe('ENG-106a staff PIN security', () => {
  it('accepts exactly six digits and rejects malformed values', () => {
    expect(isValidStaffPin('123456')).toBe(true);
    expect(isValidStaffPin('12345')).toBe(false);
    expect(isValidStaffPin('1234567')).toBe(false);
    expect(isValidStaffPin('12a456')).toBe(false);
  });

  it('stores a one-way Argon2id hash with domain separation', async () => {
    const hash = await hashStaffPin('123456');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('123456');
    await expect(verifyStaffPin(hash, '123456')).resolves.toBe(true);
    await expect(verifyStaffPin(hash, '654321')).resolves.toBe(false);
  });

  it('rejects invalid PIN shapes before hashing or verification', async () => {
    await expect(hashStaffPin('12345')).rejects.toThrow('exactly 6 digits');
    const hash = await hashStaffPin('123456');
    await expect(verifyStaffPin(hash, '12345')).resolves.toBe(false);
  });

  it('prewarms and reuses the unavailable-target timing hash', async () => {
    await expect(warmUpStaffPinSecurity()).resolves.toBeUndefined();
    expect(await getDummyStaffPinHash()).toBe(await getDummyStaffPinHash());
  });
});
