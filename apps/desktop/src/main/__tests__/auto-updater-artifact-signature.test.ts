import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeBufferSha512Base64,
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

  it('verifies files on disk via verifyFileDetachedSignature', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pv-sig-'));
    try {
      const filePath = join(dir, 'Puntovivo.AppImage');
      writeFileSync(filePath, artifactBytes);
      const signature = signReleaseArtifactDigest({
        version: '1.19.1',
        sha512Base64: sha512,
        privateKeyPem: releaseKey.privateKeyPem,
      });
      const res = verifyFileDetachedSignature({
        artifactPath: filePath,
        version: '1.19.1',
        expectedSha512Base64: sha512,
        signatureBase64: signature,
        publicKeyPem: releaseKey.publicKeyPem,
      });
      assert.equal(res.valid, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('unlocks Linux verified policy only when a valid Ed25519 release public key is pinned', () => {
    const verified = resolveUpdateInstallPolicy({
      platform: 'linux',
      linuxPublicKeyPem: releaseKey.publicKeyPem,
    });
    assert.equal(verified.signatureTrust, 'verified');
    assert.equal(verified.allowSilentInstall, true);
    assert.equal(verified.reason, 'detached-ed25519-verified');

    const malformed = resolveUpdateInstallPolicy({
      platform: 'linux',
      linuxPublicKeyPem: 'not-a-valid-pem',
    });
    assert.equal(malformed.signatureTrust, 'unverified');
    assert.equal(malformed.allowSilentInstall, false);
    assert.equal(malformed.reason, 'no-signature-support');

    const privateKeyPinned = resolveUpdateInstallPolicy({
      platform: 'linux',
      linuxPublicKeyPem: releaseKey.privateKeyPem,
    });
    assert.equal(privateKeyPinned.signatureTrust, 'unverified');
    assert.equal(privateKeyPinned.allowSilentInstall, false);
  });
});
