/**
 * Detached Ed25519 + SHA-512 verification for downloaded desktop release artifacts
 * (primarily Linux AppImage, where the OS installer provides no built-in signature check).
 *
 * @module main/auto-updater/artifact-signature
 */

import { createHash, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PAYLOAD_DOMAIN = 'puntovivo-release-v1';
const SHA512_B64_PATTERN = /^[A-Za-z0-9+/]{86}==$/;

export type ArtifactSignatureFailureReason =
  | 'invalid_sha512'
  | 'invalid_public_key'
  | 'invalid_signature_encoding'
  | 'sha512_mismatch'
  | 'signature_invalid';

export interface ArtifactSignatureVerificationResult {
  valid: boolean;
  computedSha512?: string;
  reason?: ArtifactSignatureFailureReason;
}

/** Canonical signing payload binding version and SHA-512 digest to prevent replay across releases. */
export function buildReleaseSignaturePayload(version: string, sha512Base64: string): Buffer {
  return Buffer.from(`${PAYLOAD_DOMAIN}\n${version.trim()}\n${sha512Base64.trim()}`, 'utf8');
}

export function computeBufferSha512Base64(data: Buffer): string {
  return createHash('sha512').update(data).digest('base64');
}

export function isValidEd25519PublicKeyPem(pem: string | null | undefined): boolean {
  // createPublicKey also derives a key from a private PEM; never accept signing material.
  if (!pem || !pem.trim() || /PRIVATE KEY/.test(pem)) return false;
  try {
    const key = createPublicKey(pem);
    return key.asymmetricKeyType === 'ed25519';
  } catch {
    return false;
  }
}

/** Sign a release digest with an Ed25519 private key PEM (used by release tooling and tests). */
export function signReleaseArtifactDigest(args: {
  version: string;
  sha512Base64: string;
  privateKeyPem: string;
}): string {
  const payload = buildReleaseSignaturePayload(args.version, args.sha512Base64);
  return sign(null, payload, args.privateKeyPem).toString('base64');
}

/** Verify both SHA-512 integrity and detached Ed25519 signature over an artifact buffer. */
export function verifyArtifactDetachedSignature(args: {
  artifactBytes: Buffer;
  version: string;
  expectedSha512Base64: string;
  signatureBase64: string;
  publicKeyPem: string;
}): ArtifactSignatureVerificationResult {
  if (!SHA512_B64_PATTERN.test(args.expectedSha512Base64)) {
    return { valid: false, reason: 'invalid_sha512' };
  }
  if (!isValidEd25519PublicKeyPem(args.publicKeyPem)) {
    return { valid: false, reason: 'invalid_public_key' };
  }

  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(args.signatureBase64.trim(), 'base64');
    if (signatureBytes.length !== 64) {
      return { valid: false, reason: 'invalid_signature_encoding' };
    }
  } catch {
    return { valid: false, reason: 'invalid_signature_encoding' };
  }

  const computedSha512 = computeBufferSha512Base64(args.artifactBytes);
  if (computedSha512 !== args.expectedSha512Base64) {
    return { valid: false, computedSha512, reason: 'sha512_mismatch' };
  }

  const payload = buildReleaseSignaturePayload(args.version, computedSha512);
  const ok = verify(null, payload, args.publicKeyPem, signatureBytes);
  if (!ok) {
    return { valid: false, computedSha512, reason: 'signature_invalid' };
  }
  return { valid: true, computedSha512 };
}

/** Convenience wrapper that reads an artifact file from disk before verifying. */
export function verifyFileDetachedSignature(args: {
  artifactPath: string;
  version: string;
  expectedSha512Base64: string;
  signatureBase64: string;
  publicKeyPem: string;
}): ArtifactSignatureVerificationResult {
  const artifactBytes = readFileSync(args.artifactPath);
  return verifyArtifactDetachedSignature({
    artifactBytes,
    version: args.version,
    expectedSha512Base64: args.expectedSha512Base64,
    signatureBase64: args.signatureBase64,
    publicKeyPem: args.publicKeyPem,
  });
}
