// Pins the trust verdict logic. The regressions this guards are the ones that
// would quietly overstate a release: a missing tool counted as a pass, a
// non-macOS host reported as trusted, or an unsigned bundle promoted because
// notarization happened to answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDistributionTrust, TRUST_VERDICTS } from './lib/distribution-trust.mjs';

/** Scripted runner: map command name -> result. */
function runner(byCommand) {
  return command =>
    byCommand[command] ?? { ok: false, available: true, output: `unscripted: ${command}` };
}

const SIGNED = { ok: true, available: true, output: '' };
const REJECTED = { ok: false, available: true, output: 'rejected' };
const MISSING = { ok: false, available: false, output: 'spawn ENOENT' };

test('a signed, notarized, Gatekeeper-accepted bundle is trusted', () => {
  const result = assessDistributionTrust({
    appPath: '/tmp/x.app',
    platform: 'darwin',
    run: runner({ codesign: SIGNED, xcrun: SIGNED, spctl: SIGNED }),
  });
  assert.equal(result.verdict, TRUST_VERDICTS.TRUSTED);
  assert.equal(result.assessed, true);
  assert.equal(result.checks.length, 3);
  assert.ok(result.checks.every(c => c.status === 'passed'));
});

test('a valid signature without notarization is not trusted', () => {
  const result = assessDistributionTrust({
    appPath: '/tmp/x.app',
    platform: 'darwin',
    run: runner({ codesign: SIGNED, xcrun: REJECTED, spctl: REJECTED }),
  });
  assert.equal(result.verdict, TRUST_VERDICTS.SIGNED_NOT_NOTARIZED);
  const notarization = result.checks.find(c => c.id === 'notarization');
  assert.equal(notarization.status, 'failed');
  assert.match(notarization.remediation, /notarytool|stapler/);
});

test('Gatekeeper alone cannot promote a bundle whose signature failed', () => {
  const result = assessDistributionTrust({
    appPath: '/tmp/x.app',
    platform: 'darwin',
    run: runner({ codesign: REJECTED, xcrun: SIGNED, spctl: SIGNED }),
  });
  assert.equal(result.verdict, TRUST_VERDICTS.UNTRUSTED);
});

test('a missing tool is unknown, never a pass', () => {
  const result = assessDistributionTrust({
    appPath: '/tmp/x.app',
    platform: 'darwin',
    run: runner({ codesign: MISSING, xcrun: MISSING, spctl: MISSING }),
  });
  // codesign could not answer, so the bundle is not signed as far as we know.
  assert.equal(result.verdict, TRUST_VERDICTS.UNTRUSTED);
  assert.ok(result.checks.every(c => c.status === 'unknown'));
  assert.ok(result.checks.every(c => /not available/.test(c.evidence)));
});

test('non-macOS hosts report unsupported rather than inventing a verdict', () => {
  for (const platform of ['linux', 'win32']) {
    const result = assessDistributionTrust({ appPath: '/tmp/x.app', platform });
    assert.equal(result.verdict, TRUST_VERDICTS.UNSUPPORTED);
    assert.equal(result.assessed, false);
    assert.deepEqual(result.checks, []);
    assert.match(result.reason, new RegExp(platform));
  }
});

test('a macOS run with no bundle to inspect is unsupported, not trusted', () => {
  const result = assessDistributionTrust({ appPath: null, platform: 'darwin' });
  assert.equal(result.verdict, TRUST_VERDICTS.UNSUPPORTED);
  assert.equal(result.assessed, false);
  assert.match(result.reason, /no \.app bundle/);
});

test('evidence is captured but bounded so a verbose tool cannot bloat the manifest', () => {
  const noisy = { ok: false, available: true, output: 'x'.repeat(5000) };
  const result = assessDistributionTrust({
    appPath: '/tmp/x.app',
    platform: 'darwin',
    run: runner({ codesign: noisy, xcrun: noisy, spctl: noisy }),
  });
  assert.ok(result.checks.every(c => c.evidence.length <= 400));
});
