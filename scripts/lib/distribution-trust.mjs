/**
 * Assess whether a packaged desktop artifact is one an operating system will
 * actually trust.
 *
 * The candidate evidence previously hardcoded `distributionTrust: not-assessed`,
 * which was honest but left the release gate's most important question
 * unanswered. These are the same three checks Apple's tooling answers, run
 * directly rather than through any external service, so the collector can carry
 * a real verdict.
 *
 * Deliberately NOT fatal. The manual cross-OS workflow builds without signing
 * credentials on purpose, so an untrusted verdict there is the expected result,
 * not a broken build. Enforcement belongs to the release workflow, which is the
 * one that loads signing material; this module only reports.
 *
 * @module scripts/lib/distribution-trust
 */

import { spawnSync } from 'node:child_process';

/**
 * Verdicts, ordered from most to least trustworthy.
 *
 * `unsupported-platform` is not a failure: Linux and Windows have their own
 * trust models and no equivalent to `spctl`, so claiming pass or fail there
 * would be inventing evidence. It is reported as its own state precisely so it
 * cannot be mistaken for either.
 */
export const TRUST_VERDICTS = Object.freeze({
  TRUSTED: 'trusted',
  SIGNED_NOT_NOTARIZED: 'signed-not-notarized',
  UNTRUSTED: 'untrusted',
  UNSUPPORTED: 'unsupported-platform',
});

const CHECK_STATUS = Object.freeze({
  PASSED: 'passed',
  FAILED: 'failed',
  UNKNOWN: 'unknown',
});

/** Run a command and normalise the bits the checks care about. */
function defaultRun(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) {
    return { ok: false, available: false, output: result.error.message };
  }
  return {
    ok: result.status === 0,
    available: true,
    // The macOS trust tools write their verdicts to stderr, not stdout.
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}

/**
 * The three macOS trust checks, in the order a user's machine applies them:
 * a valid signature, a notarization ticket stapled to the bundle, and finally
 * Gatekeeper's own assessment.
 */
const DARWIN_CHECKS = [
  {
    id: 'code-signing',
    command: 'codesign',
    args: appPath => ['--verify', '--deep', '--strict', appPath],
    remediation: 'Sign the bundle with a Developer ID Application certificate.',
  },
  {
    id: 'notarization',
    command: 'xcrun',
    args: appPath => ['stapler', 'validate', appPath],
    remediation:
      'Notarize with xcrun notarytool submit --wait, then staple the ticket with xcrun stapler staple.',
  },
  {
    id: 'gatekeeper',
    command: 'spctl',
    args: appPath => ['--assess', '--type', 'execute', appPath],
    remediation: 'Gatekeeper accepts a Developer ID signature only once the app is notarized.',
  },
];

/** Collapse the individual check results into one verdict. */
function verdictFor(checks) {
  const status = id => checks.find(check => check.id === id)?.status;
  if (status('code-signing') !== CHECK_STATUS.PASSED) return TRUST_VERDICTS.UNTRUSTED;
  const notarized = status('notarization') === CHECK_STATUS.PASSED;
  const gatekeeper = status('gatekeeper') === CHECK_STATUS.PASSED;
  return notarized && gatekeeper ? TRUST_VERDICTS.TRUSTED : TRUST_VERDICTS.SIGNED_NOT_NOTARIZED;
}

/**
 * Assess a packaged macOS `.app`. On any other platform the result is
 * `unsupported-platform` with no checks — see the note on TRUST_VERDICTS.
 *
 * @param {object} input
 * @param {string|null} input.appPath absolute path to the .app bundle
 * @param {NodeJS.Platform} input.platform host platform
 * @param {(command: string, args: string[]) => {ok: boolean, available: boolean, output: string}} [input.run]
 * @returns {{verdict: string, assessed: boolean, platform: string, checks: Array<object>, reason?: string}}
 */
export function assessDistributionTrust({ appPath, platform, run = defaultRun }) {
  if (platform !== 'darwin') {
    return {
      verdict: TRUST_VERDICTS.UNSUPPORTED,
      assessed: false,
      platform,
      checks: [],
      reason: `no trust assessment is implemented for ${platform}; macOS is the only platform whose trust tooling this collector runs`,
    };
  }

  if (!appPath) {
    return {
      verdict: TRUST_VERDICTS.UNSUPPORTED,
      assessed: false,
      platform,
      checks: [],
      reason: 'no .app bundle was found next to the installer, so nothing could be assessed',
    };
  }

  const checks = DARWIN_CHECKS.map(check => {
    const result = run(check.command, check.args(appPath));
    if (!result.available) {
      // A missing tool is unknown, never a pass: the absence of evidence is
      // not evidence of trust.
      return {
        id: check.id,
        status: CHECK_STATUS.UNKNOWN,
        evidence: `${check.command} is not available on this host`,
      };
    }
    return {
      id: check.id,
      status: result.ok ? CHECK_STATUS.PASSED : CHECK_STATUS.FAILED,
      evidence: result.output.slice(0, 400) || null,
      ...(result.ok ? {} : { remediation: check.remediation }),
    };
  });

  return { verdict: verdictFor(checks), assessed: true, platform, checks };
}
