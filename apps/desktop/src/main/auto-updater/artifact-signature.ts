/**
 * Detached Ed25519 + SHA-512 verification for downloaded desktop release artifacts
 * (primarily Linux AppImage, where the OS installer provides no built-in signature check).
 * Not wired into the updater yet, so the install policy keeps Linux unverified.
 *
 * @module main/auto-updater/artifact-signature
 */

import { createHash, createPublicKey, sign, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

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

interface DetachedSignatureArgs {
  version: string;
  expectedSha512Base64: string;
  signatureBase64: string;
  publicKeyPem: string;
}

function decodeSignature(signatureBase64: string): Buffer | null {
  const bytes = Buffer.from(signatureBase64.trim(), 'base64');
  return bytes.length === 64 ? bytes : null;
}

function preflight(args: DetachedSignatureArgs): ArtifactSignatureFailureReason | Buffer {
  if (!SHA512_B64_PATTERN.test(args.expectedSha512Base64)) return 'invalid_sha512';
  if (!isValidEd25519PublicKeyPem(args.publicKeyPem)) return 'invalid_public_key';
  return decodeSignature(args.signatureBase64) ?? 'invalid_signature_encoding';
}

function verifyComputedDigest(
  args: DetachedSignatureArgs,
  signatureBytes: Buffer,
  computedSha512: string
): ArtifactSignatureVerificationResult {
  if (computedSha512 !== args.expectedSha512Base64) {
    return { valid: false, computedSha512, reason: 'sha512_mismatch' };
  }
  const payload = buildReleaseSignaturePayload(args.version, computedSha512);
  if (!verify(null, payload, args.publicKeyPem, signatureBytes)) {
    return { valid: false, computedSha512, reason: 'signature_invalid' };
  }
  return { valid: true, computedSha512 };
}

/** Verify both SHA-512 integrity and detached Ed25519 signature over an artifact buffer. */
export function verifyArtifactDetachedSignature(
  args: DetachedSignatureArgs & { artifactBytes: Buffer }
): ArtifactSignatureVerificationResult {
  const signatureBytes = preflight(args);
  if (typeof signatureBytes === 'string') return { valid: false, reason: signatureBytes };
  return verifyComputedDigest(args, signatureBytes, computeBufferSha512Base64(args.artifactBytes));
}

/** Stream-hash an artifact on disk, so a large AppImage never blocks the main thread. */
export async function verifyFileDetachedSignature(
  args: DetachedSignatureArgs & { artifactPath: string }
): Promise<ArtifactSignatureVerificationResult> {
  const signatureBytes = preflight(args);
  if (typeof signatureBytes === 'string') return { valid: false, reason: signatureBytes };
  const hash = createHash('sha512');
  await pipeline(createReadStream(args.artifactPath), hash);
  return verifyComputedDigest(args, signatureBytes, hash.digest('base64'));
}
