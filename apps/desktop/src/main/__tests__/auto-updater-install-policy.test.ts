import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyInstallPolicy, resolveUpdateInstallPolicy } from '../auto-updater/install-policy.ts';

describe('update install policy', () => {
  it('lets macOS install silently because Squirrel verifies the signature', () => {
    const policy = resolveUpdateInstallPolicy({ platform: 'darwin' });

    assert.equal(policy.signatureTrust, 'verified');
    assert.equal(policy.allowSilentInstall, true);
    assert.equal(policy.reason, 'platform-verified');
  });

  it('withholds silent install on an unsigned Windows build', () => {
    // No certificate yet, so electron-updater has no publisher to compare a
    // downloaded installer against: whoever writes the feed would otherwise
    // execute code on every register at the next quit.
    for (const publisher of [undefined, null, '', '   ']) {
      const policy = resolveUpdateInstallPolicy({
        platform: 'win32',
        windowsPublisherName: publisher,
      });
      assert.equal(policy.allowSilentInstall, false, `publisher: ${JSON.stringify(publisher)}`);
      assert.equal(policy.signatureTrust, 'unverified');
      assert.equal(policy.reason, 'no-publisher-identity');
    }
  });

  it('trusts Windows once the build declares a publisher identity', () => {
    const policy = resolveUpdateInstallPolicy({
      platform: 'win32',
      windowsPublisherName: 'Puntovivo SAS',
    });

    assert.equal(policy.signatureTrust, 'verified');
    assert.equal(policy.allowSilentInstall, true);
  });

  it('never installs silently on Linux, where AppImage carries no signature', () => {
    const policy = resolveUpdateInstallPolicy({ platform: 'linux' });

    assert.equal(policy.signatureTrust, 'unverified');
    assert.equal(policy.allowSilentInstall, false);
    assert.equal(policy.reason, 'no-signature-support');
  });

  it('fails closed on an unknown platform', () => {
    const policy = resolveUpdateInstallPolicy({ platform: 'freebsd' });

    assert.equal(policy.allowSilentInstall, false);
  });
});

describe('applying the policy to the updater', () => {
  it('turns install-on-quit off wherever the signature is unverified', () => {
    // electron-updater defaults this to true, so the assignment is the whole
    // mitigation: if it is ever skipped, unverified silent install returns.
    for (const platform of ['win32', 'linux'] as const) {
      const updater = { autoInstallOnAppQuit: true };
      applyInstallPolicy(updater, resolveUpdateInstallPolicy({ platform }));
      assert.equal(updater.autoInstallOnAppQuit, false, platform);
    }
  });

  it('leaves install-on-quit on where the platform verifies the package', () => {
    const updater = { autoInstallOnAppQuit: false };
    applyInstallPolicy(updater, resolveUpdateInstallPolicy({ platform: 'darwin' }));
    assert.equal(updater.autoInstallOnAppQuit, true);
  });
});

describe('the shipped runtime policy', () => {
  it('keeps Windows closed until a certificate is proven, not merely configured', () => {
    // The runtime passes null unconditionally today. Reading a publisher name
    // out of the packaged app-update.yml was rejected: electron-updater skips
    // verification for a YAML null, and a per-user install leaves that file
    // writable, so a config read could claim protection the updater never
    // applies.
    const policy = resolveUpdateInstallPolicy({
      platform: 'win32',
      windowsPublisherName: null,
    });
    assert.equal(policy.allowSilentInstall, false);
  });
});
