import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  assessExternalElectronHost,
  assertObservedPackagedVersion,
  validateExternalElectronE2eEvidence,
  validatePassingExternalElectronE2eEvidence,
} from './lib/external-electron-e2e-evidence.mjs';
import {
  buildExternalElectronReport,
  buildExternalElectronChildEnv,
  resolveExternalElectronRunnerOptions,
  resolveExternalHostOsVersion,
} from './run-electron-e2e-external.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const SESSION_ID = '018f6f8c-4e5b-7a21-8abc-1234567890ab';

function report(overrides = {}) {
  return buildExternalElectronReport({
    sessionId: SESSION_ID,
    candidateSha: SHA,
    startedAt: new Date('2026-08-08T12:00:00.000Z'),
    completedAt: new Date('2026-08-08T12:01:00.000Z'),
    totalMs: 60_000,
    platform: 'darwin',
    architecture: 'arm64',
    osVersion: '26.5.2',
    nodeVersion: 'v24.18.0',
    electronVersion: '43.4.1',
    appVersion: '1.10.1',
    suiteExitCode: 0,
    suiteSignal: null,
    ...overrides,
  });
}

describe('external Electron host assessment', () => {
  it('accepts only a standalone interactive terminal', () => {
    assert.deepEqual(
      assessExternalElectronHost({
        env: { TERM: 'xterm-256color' },
        stdinIsTTY: true,
        stdoutIsTTY: true,
      }),
      { eligible: true, signals: [], interactiveTty: true }
    );
  });

  it('rejects Codex, CI, XCTest, injection, dumb-terminal, and non-TTY signals', () => {
    const result = assessExternalElectronHost({
      env: {
        TERM: 'dumb',
        CODEX_THREAD_ID: 'thread',
        CI: 'true',
        XCTestSessionIdentifier: 'session',
        DYLD_INSERT_LIBRARIES: '/tmp/injected.dylib',
        NODE_OPTIONS: '--require injected.cjs',
      },
      stdinIsTTY: false,
      stdoutIsTTY: true,
    });

    assert.equal(result.eligible, false);
    assert.deepEqual(result.signals, [
      'CI',
      'CODEX_THREAD_ID',
      'DYLD_INSERT_LIBRARIES',
      'NODE_OPTIONS',
      'XCTestSessionIdentifier',
      'dumb-terminal',
      'non-interactive-terminal',
    ]);
  });

  it('does not treat explicit false CI values as active signals', () => {
    const result = assessExternalElectronHost({
      env: { TERM: 'xterm', CI: 'false', GITHUB_ACTIONS: '0' },
      stdinIsTTY: true,
      stdoutIsTTY: true,
    });
    assert.equal(result.eligible, true);
  });
});

describe('external Electron evidence', () => {
  it('can orchestrate a separate immutable candidate worktree', () => {
    assert.deepEqual(
      resolveExternalElectronRunnerOptions(
        [
          '--candidate-root',
          '../candidate',
          '--output',
          'evidence.json',
          '--session-id',
          SESSION_ID,
          '--packaged-app',
          '../Puntovivo.app',
        ],
        '/tooling'
      ),
      {
        candidateRoot: path.resolve('../candidate'),
        output: 'evidence.json',
        sessionId: SESSION_ID,
        packagedApp: path.resolve('../Puntovivo.app'),
      }
    );
  });

  it('records the macOS product version rather than its Darwin kernel version', () => {
    assert.equal(
      resolveExternalHostOsVersion('darwin', (command, args) => {
        assert.equal(command, 'sw_vers');
        assert.deepEqual(args, ['-productVersion']);
        return '26.5.2\n';
      }),
      '26.5.2'
    );
    assert.equal(
      resolveExternalHostOsVersion('linux', undefined, () => '6.12.0'),
      '6.12.0'
    );
  });

  it('pins the packaged runtime version to the candidate source version', () => {
    assert.equal(assertObservedPackagedVersion('1.10.1', '1.10.1'), '1.10.1');
    assert.throws(
      () => assertObservedPackagedVersion('1.10.0', '1.10.1'),
      /does not match candidate/
    );
    assert.throws(() => assertObservedPackagedVersion('dev', '1.10.1'), /stable app version/);
    assert.deepEqual(buildExternalElectronChildEnv({ SAFE: '1' }, '/Applications/App', '1.10.1'), {
      SAFE: '1',
      PUNTOVIVO_PACKAGED_APP: '/Applications/App',
      PUNTOVIVO_EXPECTED_APP_VERSION: '1.10.1',
    });
  });

  it('builds a passing, sanitized report for a clean suite exit', () => {
    const evidence = report();
    assert.equal(evidence.outcome, 'passed');
    assert.equal(evidence.failureCode, null);
    assert.deepEqual(evidence.execution.automationSignals, []);
    assert.equal('hostname' in evidence.environment, false);
    assert.equal(validatePassingExternalElectronE2eEvidence(evidence), evidence);
  });

  it('retains a failed suite as failed evidence instead of converting it to a pass', () => {
    const evidence = report({ suiteExitCode: null, suiteSignal: 'SIGTRAP' });
    assert.equal(evidence.outcome, 'failed');
    assert.equal(evidence.failureCode, 'ELECTRON_E2E_SIGNAL');
    assert.equal(validateExternalElectronE2eEvidence(evidence), evidence);
    assert.throws(() => validatePassingExternalElectronE2eEvidence(evidence), /suite did not pass/);
  });

  it('fails evidence if the candidate worktree changes during the suite', () => {
    const evidence = report({ cleanWorktree: false });
    assert.equal(evidence.outcome, 'failed');
    assert.equal(evidence.failureCode, 'WORKTREE_CHANGED');
    assert.equal(
      evidence.checks.find(check => check.id === 'electron-e2e-suite').outcome,
      'passed'
    );
    assert.equal(evidence.checks.find(check => check.id === 'clean-worktree').outcome, 'failed');
  });

  it('pins candidate, platform, architecture, and app version expectations', () => {
    const evidence = report();
    assert.equal(
      validatePassingExternalElectronE2eEvidence(evidence, {
        candidateSha: SHA,
        sessionId: SESSION_ID,
        platform: 'darwin',
        osVersion: '26.5.2',
        architecture: 'arm64',
        appVersion: '1.10.1',
      }),
      evidence
    );
    assert.throws(
      () => validateExternalElectronE2eEvidence(evidence, { platform: 'win32' }),
      /platform does not match/
    );
  });

  it('rejects automation signals, dirty source, and non-interactive evidence', () => {
    for (const mutate of [
      evidence => (evidence.execution.automationSignals = ['CODEX_CI']),
      evidence => (evidence.execution.interactiveTty = false),
      evidence => (evidence.source.cleanWorktree = false),
    ]) {
      const evidence = report();
      mutate(evidence);
      assert.throws(() => validateExternalElectronE2eEvidence(evidence));
    }
  });

  it('rejects local filesystem disclosure', () => {
    const evidence = report();
    evidence.environment.osVersion = '/Users/operator/private';
    assert.throws(() => validateExternalElectronE2eEvidence(evidence), /local filesystem location/);
  });
});
