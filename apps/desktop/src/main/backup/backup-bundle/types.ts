// backup-bundle shared types ( slice 31).

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
  /** SHA-256 of the snapshotted DB bytes (manifest v2). */
  dbSha256?: string;
  /** SHA-256 of the bundled device identity (manifest v2). */
  deviceIdSha256?: string;
  /** SHA-256 of the raw key-wrap entry (manifest v2, wrap present). */
  keyWrapSha256?: string;
  /**
   * HMAC-SHA256 over the canonical manifest fields under a
   * key derived from the install's SQLCipher key. Absent on v1 and
   * cleartext dev bundles — see backup-bundle/authenticity.ts.
   */
  manifestMac?: string;
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
   * SQLCipher key for encrypted local.db files. When supplied,
   * every read connection applies SQLCipher v4 before touching the file,
   * and the staged backup DB remains encrypted with the same key.
   */
  encryptionKey?: string;
  /**
   * Optional operator passphrase. When supplied together with
   * `encryptionKey`, the bundle carries `key-wrap.json` so a
   * cross-device restore can unwrap the install key from the phrase
   * instead of transporting the raw hex. See backup-bundle/key-wrap.ts.
   */
  passphrase?: string;
}

export interface CreateBackupBundleResult {
  zipPath: string;
  zipBytes: number;
  manifest: BackupManifest;
}

// explicit `| undefined` on optional fields.
export interface ExtractBackupBundleResult {
  /** Path of the extracted (or as-is) DB file. */
  dbPath: string;
  /** Path of the extracted device-id, if the bundle carried one. */
  deviceIdPath?: string | undefined;
  /** Parsed manifest, when the bundle is a ZIP carrying one. */
  manifest?: BackupManifest | undefined;
  /** Parsed passphrase key-wrap, when the bundle carries one. */
  keyWrap?: import('./key-wrap.ts').BackupKeyWrap | undefined;
  /** Raw bytes of the key-wrap entry, for authenticity digests. */
  keyWrapRaw?: string | undefined;
  /** Format detected at the boundary. */
  format: 'zip' | 'sqlite';
}
