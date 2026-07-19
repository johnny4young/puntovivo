/**
 * ENG-129e — non-secret attestation for encrypted database backups.
 *
 * The renderer needs to tell an administrator whether SQLCipher and the
 * platform credential store are protecting backups. It must never receive the
 * SQLCipher key merely to render that status, so this module exposes metadata
 * only and stays pure for cross-platform regression coverage.
 */

export type BackupProtectionKeyStorage =
  'environment' | 'os_keychain' | 'basic_text' | 'unavailable';

export type BackupProtectionProvider =
  | 'environment'
  | 'macos_keychain'
  | 'windows_dpapi'
  | 'linux_libsecret'
  | 'linux_kwallet'
  | 'linux_basic_text'
  | 'unknown';

export interface BackupProtectionStatus {
  /** True only when the key is sealed by an OS credential store. */
  protected: boolean;
  /** True after SQLCipher preparation/migration completed successfully. */
  databaseEncrypted: boolean;
  backupEncryption: 'sqlcipher';
  keyStorage: BackupProtectionKeyStorage;
  provider: BackupProtectionProvider;
  /** The existing explicit admin recovery flow can return this install's key. */
  recoveryKeyAvailable: boolean;
}

export type SafeStorageBackend =
  'basic_text' | 'gnome_libsecret' | 'kwallet' | 'kwallet5' | 'kwallet6' | 'unknown';

interface ResolveBackupProtectionStatusOptions {
  prepared: boolean;
  keySource: 'environment' | 'safe_storage' | null;
  platform: NodeJS.Platform;
  safeStorageBackend?: SafeStorageBackend | undefined;
}

const UNAVAILABLE_STATUS: BackupProtectionStatus = {
  protected: false,
  databaseEncrypted: false,
  backupEncryption: 'sqlcipher',
  keyStorage: 'unavailable',
  provider: 'unknown',
  recoveryKeyAvailable: false,
};

export function resolveBackupProtectionStatus({
  prepared,
  keySource,
  platform,
  safeStorageBackend,
}: ResolveBackupProtectionStatusOptions): BackupProtectionStatus {
  if (!prepared || keySource === null) {
    return { ...UNAVAILABLE_STATUS };
  }

  if (keySource === 'environment') {
    return {
      protected: false,
      databaseEncrypted: true,
      backupEncryption: 'sqlcipher',
      keyStorage: 'environment',
      provider: 'environment',
      recoveryKeyAvailable: true,
    };
  }

  if (platform === 'darwin') {
    return {
      protected: true,
      databaseEncrypted: true,
      backupEncryption: 'sqlcipher',
      keyStorage: 'os_keychain',
      provider: 'macos_keychain',
      recoveryKeyAvailable: true,
    };
  }

  if (platform === 'win32') {
    return {
      protected: true,
      databaseEncrypted: true,
      backupEncryption: 'sqlcipher',
      keyStorage: 'os_keychain',
      provider: 'windows_dpapi',
      recoveryKeyAvailable: true,
    };
  }

  if (platform === 'linux') {
    if (safeStorageBackend === 'gnome_libsecret') {
      return {
        protected: true,
        databaseEncrypted: true,
        backupEncryption: 'sqlcipher',
        keyStorage: 'os_keychain',
        provider: 'linux_libsecret',
        recoveryKeyAvailable: true,
      };
    }

    if (
      safeStorageBackend === 'kwallet' ||
      safeStorageBackend === 'kwallet5' ||
      safeStorageBackend === 'kwallet6'
    ) {
      return {
        protected: true,
        databaseEncrypted: true,
        backupEncryption: 'sqlcipher',
        keyStorage: 'os_keychain',
        provider: 'linux_kwallet',
        recoveryKeyAvailable: true,
      };
    }

    if (safeStorageBackend === 'basic_text') {
      return {
        protected: false,
        databaseEncrypted: true,
        backupEncryption: 'sqlcipher',
        keyStorage: 'basic_text',
        provider: 'linux_basic_text',
        recoveryKeyAvailable: true,
      };
    }
  }

  return {
    protected: false,
    databaseEncrypted: true,
    backupEncryption: 'sqlcipher',
    keyStorage: 'unavailable',
    provider: 'unknown',
    recoveryKeyAvailable: true,
  };
}
