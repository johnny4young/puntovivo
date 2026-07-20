import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolveBackupProtectionStatus } from '../backup-protection.ts';

describe('resolveBackupProtectionStatus', () => {
  it('reports an unavailable state before encryption preparation completes', () => {
    assert.deepEqual(
      resolveBackupProtectionStatus({
        prepared: false,
        keySource: null,
        platform: 'darwin',
      }),
      {
        protected: false,
        databaseEncrypted: false,
        backupEncryption: 'sqlcipher',
        keyStorage: 'unavailable',
        provider: 'unknown',
        recoveryKeyAvailable: false,
      }
    );
  });

  it('distinguishes the development environment key from OS-keychain protection', () => {
    const status = resolveBackupProtectionStatus({
      prepared: true,
      keySource: 'environment',
      platform: 'darwin',
    });

    assert.equal(status.databaseEncrypted, true);
    assert.equal(status.protected, false);
    assert.equal(status.keyStorage, 'environment');
    assert.equal(status.provider, 'environment');
  });

  it('attests macOS Keychain and Windows DPAPI', () => {
    const macos = resolveBackupProtectionStatus({
      prepared: true,
      keySource: 'safe_storage',
      platform: 'darwin',
    });
    const windows = resolveBackupProtectionStatus({
      prepared: true,
      keySource: 'safe_storage',
      platform: 'win32',
    });

    assert.equal(macos.protected, true);
    assert.equal(macos.provider, 'macos_keychain');
    assert.equal(windows.protected, true);
    assert.equal(windows.provider, 'windows_dpapi');
  });

  it('attests libsecret and every supported KWallet backend on Linux', () => {
    const libsecret = resolveBackupProtectionStatus({
      prepared: true,
      keySource: 'safe_storage',
      platform: 'linux',
      safeStorageBackend: 'gnome_libsecret',
    });
    assert.equal(libsecret.protected, true);
    assert.equal(libsecret.provider, 'linux_libsecret');

    for (const backend of ['kwallet', 'kwallet5', 'kwallet6'] as const) {
      const status = resolveBackupProtectionStatus({
        prepared: true,
        keySource: 'safe_storage',
        platform: 'linux',
        safeStorageBackend: backend,
      });
      assert.equal(status.protected, true);
      assert.equal(status.provider, 'linux_kwallet');
    }
  });

  it('reports Linux basic_text and unknown providers as degraded', () => {
    const basicText = resolveBackupProtectionStatus({
      prepared: true,
      keySource: 'safe_storage',
      platform: 'linux',
      safeStorageBackend: 'basic_text',
    });
    const unknown = resolveBackupProtectionStatus({
      prepared: true,
      keySource: 'safe_storage',
      platform: 'linux',
      safeStorageBackend: 'unknown',
    });

    assert.equal(basicText.protected, false);
    assert.equal(basicText.keyStorage, 'basic_text');
    assert.equal(basicText.provider, 'linux_basic_text');
    assert.equal(unknown.protected, false);
    assert.equal(unknown.provider, 'unknown');
  });

  it('contains no secret-shaped key field', () => {
    const status = resolveBackupProtectionStatus({
      prepared: true,
      keySource: 'safe_storage',
      platform: 'darwin',
    });
    const record = status as unknown as Record<string, unknown>;

    assert.equal(record.key, undefined);
    assert.equal(record.encryptionKey, undefined);
    assert.doesNotMatch(JSON.stringify(status), /[0-9a-f]{64}/i);
  });
});
