import { expectedSealedPrefix, type SafeStorageLike } from '../../db-key-store.ts';

const MASK = 0x5a;

/** Reversible stand-in for Electron's sealed format: platform prefix plus XOR, not encryption. */
export function sealForTest(plain: string, platform: NodeJS.Platform = process.platform): Buffer {
  const prefix = Buffer.from(expectedSealedPrefix(platform) ?? 'v10', 'latin1');
  return Buffer.concat([prefix, Buffer.from(Buffer.from(plain, 'utf8').map(byte => byte ^ MASK))]);
}

export function unsealForTest(sealed: Buffer): string {
  const prefix = sealed.subarray(0, 3).toString('latin1');
  if (prefix !== 'v10' && prefix !== 'v11') {
    throw new Error(
      'Error while decrypting the ciphertext provided to safeStorage.decryptStringAsync.'
    );
  }
  return Buffer.from(sealed.subarray(3).map(byte => byte ^ MASK)).toString('utf8');
}

export function createSafeStorageStub(
  overrides: Partial<SafeStorageLike> = {},
  platform: NodeJS.Platform = process.platform
): SafeStorageLike {
  return {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async plain => sealForTest(plain, platform),
    decryptStringAsync: async sealed => ({ result: unsealForTest(sealed), shouldReEncrypt: false }),
    getSelectedStorageBackend: () => 'unknown',
    ...overrides,
  };
}
