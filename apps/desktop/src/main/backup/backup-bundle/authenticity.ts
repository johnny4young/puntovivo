/**
 * Backup bundle authenticity (manifest MAC).
 *
 * The DB inside a bundle is SQLCipher-encrypted (confidentiality +
 * page integrity), but the BUNDLE itself — manifest, device identity,
 * archive layout — was previously unauthenticated: anyone could edit
 * the manifest, swap the device-id, or repackage a different snapshot
 * around a stolen key. Manifest v2 closes that:
 *
 * - `dbSha256` / `deviceIdSha256` bind the payload bytes to the
 *   manifest.
 * - `manifestMac` is HMAC-SHA256 over the canonical manifest fields
 *   under a key derived from the install's SQLCipher key, so whoever
 *   legitimately holds the bundle's restore key (same machine, or a
 *   cross-device operator who received it) can verify authenticity,
 *   and nobody without the key can forge it.
 *
 * v1 bundles (no MAC) predate this and are tolerated as
 * `legacy-unsigned` — the caller decides whether to surface that.
 * An encrypted v2 bundle without its MAC or DB digest is a downgrade
 * attempt and fails closed. Cleartext dev bundles have no key and the
 * restore paths do not run this keyed verifier for them.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { BackupManifest } from './types.ts';

function deriveBackupMacKey(encryptionKey: string): Buffer {
  return createHash('sha256').update('puntovivo:backup-mac:v1').update(encryptionKey).digest();
}

/**
 * Canonical byte string the MAC covers. A fixed-order array (same
 * pattern as the audit chain's canonical payload) so key order or
 * whitespace in the stored JSON can never change the verdict.
 */
function canonicalManifestPayload(manifest: BackupManifest): string {
  return JSON.stringify([
    manifest.schemaVersion,
    manifest.generatedAt,
    manifest.appVersion ?? null,
    manifest.tenantSlug ?? null,
    manifest.dbBytes,
    manifest.dbSha256 ?? null,
    manifest.deviceIdSha256 ?? null,
    manifest.keyWrapSha256 ?? null,
  ]);
}

export function sha256HexOf(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function computeBackupManifestMac(manifest: BackupManifest, encryptionKey: string): string {
  return createHmac('sha256', deriveBackupMacKey(encryptionKey))
    .update(canonicalManifestPayload(manifest))
    .digest('hex');
}

export type BundleAuthenticity =
  | { status: 'verified' }
  | { status: 'legacy-unsigned' }
  | {
      status: 'failed';
      reason: 'manifest-mac' | 'db-digest' | 'device-id-digest' | 'key-wrap-digest';
    };

/**
 * Verify an EXTRACTED bundle against its manifest under the restore
 * key. Call AFTER extraction and once the key that opens the bundle
 * is known (the local key, or the one the operator provided for a
 * cross-device restore).
 *
 * - Missing manifest, or a v1 manifest without `manifestMac` →
 *   `legacy-unsigned`.
 * - A v2+ manifest without `manifestMac` or `dbSha256` → `failed`.
 *   Those fields are mandatory in the authenticated schema; accepting
 *   their removal would turn a tampered current bundle into legacy.
 * - MAC present but wrong, a payload digest not matching the
 *   extracted bytes, or an entry added/removed relative to the
 *   signed digests (device-id, key-wrap) → `failed`.
 */
export async function verifyExtractedBundleAuthenticity(args: {
  manifest: BackupManifest | undefined;
  dbPath: string;
  deviceIdPath?: string | undefined;
  /** Raw bytes of the extracted key-wrap entry, when present. */
  keyWrapRaw?: string | undefined;
  encryptionKey: string;
}): Promise<BundleAuthenticity> {
  const { manifest, dbPath, deviceIdPath, keyWrapRaw, encryptionKey } = args;
  if (!manifest) {
    return { status: 'legacy-unsigned' };
  }
  if (manifest.manifestMac === undefined) {
    return manifest.schemaVersion >= 2
      ? { status: 'failed', reason: 'manifest-mac' }
      : { status: 'legacy-unsigned' };
  }

  const expected = computeBackupManifestMac(manifest, encryptionKey);
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(manifest.manifestMac, 'hex');
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    return { status: 'failed', reason: 'manifest-mac' };
  }

  // The MAC binds the manifest; the digests bind the payload bytes to
  // the manifest. Presence must match too: a signed digest with no
  // entry means something was REMOVED, an entry with no signed digest
  // means something was INJECTED — both are tampering, not tolerance.
  if (manifest.schemaVersion >= 2 && manifest.dbSha256 === undefined) {
    return { status: 'failed', reason: 'db-digest' };
  }
  if (manifest.dbSha256 !== undefined) {
    const dbDigest = sha256HexOf(await readFile(dbPath));
    if (dbDigest !== manifest.dbSha256) {
      return { status: 'failed', reason: 'db-digest' };
    }
  }
  if (manifest.deviceIdSha256 !== undefined) {
    if (deviceIdPath === undefined) {
      return { status: 'failed', reason: 'device-id-digest' };
    }
    const idDigest = sha256HexOf(await readFile(deviceIdPath));
    if (idDigest !== manifest.deviceIdSha256) {
      return { status: 'failed', reason: 'device-id-digest' };
    }
  } else if (deviceIdPath !== undefined) {
    return { status: 'failed', reason: 'device-id-digest' };
  }
  if (manifest.keyWrapSha256 !== undefined) {
    if (
      keyWrapRaw === undefined ||
      sha256HexOf(Buffer.from(keyWrapRaw, 'utf8')) !== manifest.keyWrapSha256
    ) {
      return { status: 'failed', reason: 'key-wrap-digest' };
    }
  } else if (keyWrapRaw !== undefined) {
    return { status: 'failed', reason: 'key-wrap-digest' };
  }
  return { status: 'verified' };
}
