import { describe, expect, it, vi } from 'vitest';
import { generateBackupPassphrase } from './backupPassphrase';

describe('generateBackupPassphrase', () => {
  it('encodes every CSPRNG byte into a grouped 192-bit base64url phrase', () => {
    const getRandomValues = vi.fn((target: Uint8Array) => {
      target.set(Array.from({ length: 24 }, (_value, index) => index));
      return target;
    });

    expect(generateBackupPassphrase({ getRandomValues })).toBe(
      'AAECAwQF.BgcICQoL.DA0ODxAR.EhMUFRYX'
    );
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it('fails closed when a cryptographic random source is unavailable', () => {
    expect(() => generateBackupPassphrase(null)).toThrow('SECURE_RANDOM_UNAVAILABLE');
  });
});
