import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeBufferSha512Base64,
  isValidEd25519PublicKeyPem,
  signReleaseArtifactDigest,
  verifyArtifactDetachedSignature,
  verifyFileDetachedSignature,
} from '../auto-updater/artifact-signature.ts';
import { resolveUpdateInstallPolicy } from '../auto-updater/install-policy.ts';

function generateEd25519PemPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }) as string,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  };
}

describe('detached Ed25519 artifact signature verification', () => {
  const releaseKey = generateEd25519PemPair();
  const attackerKey = generateEd25519PemPair();
  const artifactBytes = Buffer.from('Puntovivo-1.19.1-linux-x64.AppImage binary payload', 'utf8');
  const sha512 = computeBufferSha512Base64(artifactBytes);

  it('accepts an intact artifact signed with the pinned Ed25519 release key', () => {
    const signature = signReleaseArtifactDigest({
      version: '1.19.1',
      sha512Base64: sha512,
      privateKeyPem: releaseKey.privateKeyPem,
    });

    const result = verifyArtifactDetachedSignature({
      artifactBytes,
      version: '1.19.1',
      expectedSha512Base64: sha512,
      signatureBase64: signature,
      publicKeyPem: releaseKey.publicKeyPem,
    });
    assert.equal(result.valid, true);
    assert.equal(result.computedSha512, sha512);
  });

  it('rejects a 1-byte tampered artifact even when the feed signature is valid', () => {
    const signature = signReleaseArtifactDigest({
      version: '1.19.1',
      sha512Base64: sha512,
      privateKeyPem: releaseKey.privateKeyPem,
    });
    const tampered = Buffer.from(artifactBytes);
    tampered[0] = tampered[0]! ^ 0xff;

    const result = verifyArtifactDetachedSignature({
      artifactBytes: tampered,
      version: '1.19.1',
      expectedSha512Base64: sha512,
      signatureBase64: signature,
      publicKeyPem: releaseKey.publicKeyPem,
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'sha512_mismatch');
  });

  it('rejects signatures produced by a different key or replayed across versions', () => {
    const forgedSig = signReleaseArtifactDigest({
      version: '1.19.1',
      sha512Base64: sha512,
      privateKeyPem: attackerKey.privateKeyPem,
    });
    assert.deepEqual(
      verifyArtifactDetachedSignature({
        artifactBytes,
        version: '1.19.1',
        expectedSha512Base64: sha512,
        signatureBase64: forgedSig,
        publicKeyPem: releaseKey.publicKeyPem,
      }).reason,
      'signature_invalid'
    );

    const validForOlder = signReleaseArtifactDigest({
      version: '1.19.1',
      sha512Base64: sha512,
      privateKeyPem: releaseKey.privateKeyPem,
    });
    assert.deepEqual(
      verifyArtifactDetachedSignature({
        artifactBytes,
        version: '1.20.0',
        expectedSha512Base64: sha512,
        signatureBase64: validForOlder,
        publicKeyPem: releaseKey.publicKeyPem,
      }).reason,
      'signature_invalid'
    );
  });

  it('stream-verifies files on disk and rejects a tampered file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pv-sig-'));
    try {
      const filePath = join(dir, 'Puntovivo.AppImage');
      writeFileSync(filePath, artifactBytes);
      const signature = signReleaseArtifactDigest({
        version: '1.19.1',
        sha512Base64: sha512,
        privateKeyPem: releaseKey.privateKeyPem,
      });
      const args = {
        artifactPath: filePath,
        version: '1.19.1',
        expectedSha512Base64: sha512,
        signatureBase64: signature,
        publicKeyPem: releaseKey.publicKeyPem,
      };
      assert.equal((await verifyFileDetachedSignature(args)).valid, true);

      writeFileSync(filePath, Buffer.concat([artifactBytes, Buffer.from([0])]));
      assert.equal((await verifyFileDetachedSignature(args)).reason, 'sha512_mismatch');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never accepts a private key PEM as the pinned release public key', () => {
    assert.equal(isValidEd25519PublicKeyPem(releaseKey.publicKeyPem), true);
    assert.equal(isValidEd25519PublicKeyPem(releaseKey.privateKeyPem), false);
  });

  it('keeps Linux unverified while no downloaded artifact is verified, even with a key at hand', () => {
    const input = { platform: 'linux' as const, linuxPublicKeyPem: releaseKey.publicKeyPem };
    const policy = resolveUpdateInstallPolicy(input);
    assert.equal(policy.signatureTrust, 'unverified');
    assert.equal(policy.allowSilentInstall, false);
  });
});
