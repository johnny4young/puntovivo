// ENG-066 — public barrel for the backup-bundle helpers (ENG-178 slice 31).
// Re-exports ONLY the public surface; the internal helpers
// assertEncryptionKeyShape / applySqlCipherKey / ALLOWED_ZIP_ENTRIES /
// STAGING_PREFIXES stay module-private.

export {
  ZIP_DB_ENTRY,
  ZIP_DEVICE_ID_ENTRY,
  ZIP_MANIFEST_ENTRY,
  BACKUP_BUNDLE_SCHEMA_VERSION,
} from './constants.ts';
export type {
  BackupManifest,
  CreateBackupBundleArgs,
  CreateBackupBundleResult,
  ExtractBackupBundleResult,
} from './types.ts';
export { rekeySqliteDatabase } from './encryption.ts';
export { assertSqliteIntegrity } from './integrity.ts';
export {
  BACKUP_RESTORE_DRILL_TABLES,
  inspectBackupTenantCounts,
  readTenantRestoreDrillCounts,
} from './inspection.ts';
export type { BackupRestoreDrillCounts, BackupRestoreDrillTable } from './inspection.ts';
export { detectBackupFormat, isCleartextSqliteFile } from './detect.ts';
export { createBackupBundle } from './create.ts';
export { extractBackupBundle } from './extract.ts';
export { sweepStaleBackupStaging } from './sweep.ts';
export { createBackupFileName } from './filename.ts';
