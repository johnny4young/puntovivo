/**
 * shared `BackupIpcDeps` stub factory. One canonical default
 * per contract member; suites override only what they exercise, so a
 * new dep added to the contract lands in exactly one place.
 */

import type { BackupIpcDeps } from '../../ipc/backup/contracts.ts';
import { createBackupCloudVaultStub } from './backup-cloud-vault.ts';

function notExpected(member: string): () => Promise<never> {
  return async () => {
    throw new Error(`${member} not expected in this test`);
  };
}

export function makeBackupIpcDeps(overrides: Partial<BackupIpcDeps> = {}): BackupIpcDeps {
  return {
    dbPath: '/tmp/puntovivo-test.db',
    getMainWindow: () => null,
    resolveDatabaseEncryptionKey: async () => 'a'.repeat(64),
    resolveAuditAnchorKey: async () => 'b'.repeat(64),
    getBackupProtectionStatus: () => ({
      protected: true,
      databaseEncrypted: true,
      backupEncryption: 'sqlcipher',
      keyStorage: 'os_keychain',
      provider: 'macos_keychain',
      recoveryKeyAvailable: true,
    }),
    runWithServerRestart: async operation => operation(),
    runExclusiveBackupOperation: async operation => operation(),
    rotateDatabaseKey: notExpected('rotateDatabaseKey'),
    getKeyRotationStatus: () => ({
      supported: true,
      pending: false,
      envelopeUpdatedAt: null,
    }),
    recordDbKeyRotationAudit: () => {},
    chooseBackupScheduleDirectory: async () => null,
    backupCloudVault: createBackupCloudVaultStub(),
    backupScheduler: {
      start: async () => {},
      stop: async () => {},
      tick: async () => {},
      getStatus: notExpected('backupScheduler.getStatus'),
      updateSchedule: notExpected('backupScheduler.updateSchedule'),
      setCustomDestination: notExpected('backupScheduler.setCustomDestination'),
      runNow: notExpected('backupScheduler.runNow'),
    },
    runBackupRestoreDrill: notExpected('runBackupRestoreDrill'),
    recordBackupRestoreDrillAudit: () => {},
    recordBackupKeyRevealAudit: () => {},
    ...overrides,
  };
}
