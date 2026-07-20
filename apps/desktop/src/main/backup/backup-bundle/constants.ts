// backup-bundle constants: ZIP entry names, schema version, the
// entry allowlist, and the staging-dir prefixes ( slice 31).

/** Path inside the ZIP for the SQLite snapshot. */
export const ZIP_DB_ENTRY = 'local.db';
/** Path inside the ZIP for the device identity. */
export const ZIP_DEVICE_ID_ENTRY = 'device-id.txt';
/** Path inside the ZIP for the backup manifest (metadata only). */
export const ZIP_MANIFEST_ENTRY = 'manifest.json';

/**
 * the only entries a legitimate Puntovivo backup ZIP may
 * contain. `extractBackupBundle` refuses any bundle carrying an entry
 * outside this allowlist (or one using a traversal / absolute path)
 * instead of silently ignoring it, so a hand-crafted ZIP can never
 * smuggle an unexpected file past the restore boundary.
 */
export const ALLOWED_ZIP_ENTRIES: ReadonlySet<string> = new Set([
  ZIP_DB_ENTRY,
  ZIP_DEVICE_ID_ENTRY,
  ZIP_MANIFEST_ENTRY,
]);

/** Schema version of the ZIP manifest layout. Bump on shape change. */
export const BACKUP_BUNDLE_SCHEMA_VERSION = 1;

/**
 * staging-directory prefixes this module family creates
 * under the OS tmpdir (`createBackupBundle` and the restore flow in
 * the desktop main, respectively).
 */
export const STAGING_PREFIXES = ['puntovivo-backup-', 'puntovivo-restore-'] as const;
