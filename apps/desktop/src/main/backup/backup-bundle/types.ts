// ENG-066 — backup-bundle shared types (ENG-178 slice 31).

export interface BackupManifest {
  schemaVersion: number;
  generatedAt: string;
  /** Desktop app version that produced the backup, when available. */
  appVersion?: string;
  /**
   * Optional tenant slug embedded by callers that have it on hand.
   * Used in the default filename + audit trail; the manifest carries
   * it so support can verify the bundle's tenant before restoring.
   */
  tenantSlug?: string;
  /** Number of bytes in the snapshotted DB before zipping. */
  dbBytes: number;
}

export interface CreateBackupBundleArgs {
  /** Live DB path. The function reads it; never writes. */
  dbPath: string;
  /** Optional device-id file path. Bundled when present + readable. */
  deviceIdPath?: string;
  /** Destination ZIP path. Overwritten if it exists. */
  outZipPath: string;
  /** Optional metadata for the manifest entry. */
  manifest?: Partial<BackupManifest>;
  /**
   * ENG-167 — SQLCipher key for encrypted local.db files. When supplied,
   * every read connection applies SQLCipher v4 before touching the file,
   * and the staged backup DB remains encrypted with the same key.
   */
  encryptionKey?: string;
}

export interface CreateBackupBundleResult {
  zipPath: string;
  zipBytes: number;
  manifest: BackupManifest;
}

// ENG-179b — explicit `| undefined` on optional fields.
export interface ExtractBackupBundleResult {
  /** Path of the extracted (or as-is) DB file. */
  dbPath: string;
  /** Path of the extracted device-id, if the bundle carried one. */
  deviceIdPath?: string | undefined;
  /** Parsed manifest, when the bundle is a ZIP carrying one. */
  manifest?: BackupManifest | undefined;
  /** Format detected at the boundary. */
  format: 'zip' | 'sqlite';
}
