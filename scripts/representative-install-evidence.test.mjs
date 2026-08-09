import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { collectRepresentativeInstallEvidence } from './collect-representative-install-evidence.mjs';
import {
  validatePassingRepresentativeInstallEvidence,
  validateRepresentativeInstallEvidenceEnvelope,
} from './lib/representative-install-evidence.mjs';
import { buildExternalElectronReport } from './run-electron-e2e-external.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const SESSION_ID = '018f6f8c-4e5b-7a21-8abc-1234567890ab';
const ARTIFACT_FILES = Object.freeze({
  candidateInstaller: 'Puntovivo-1.10.1-mac-arm64.zip',
  previousInstaller: 'Puntovivo-1.10.0-mac-arm64.zip',
  cleanInstallCapture: 'clean-install.png',
  upgradeCapture: 'upgrade.png',
  upgradeCanaryBefore: 'upgrade-canary-before.json',
  upgradeCanaryAfter: 'upgrade-canary-after.json',
  downgradeCapture: 'downgrade-refusal.txt',
  downgradeDatabaseBefore: 'downgrade-before.db',
  downgradeDatabaseAfter: 'downgrade-after.db',
  externalElectronE2e: 'external-electron.json',
});

function externalReport(overrides = {}) {
  return buildExternalElectronReport({
    sessionId: SESSION_ID,
    candidateSha: SHA,
    startedAt: new Date('2026-08-08T10:00:00.000Z'),
    completedAt: new Date('2026-08-08T10:10:00.000Z'),
    totalMs: 600_000,
    platform: 'darwin',
    architecture: 'arm64',
    osVersion: '15.7.1',
    nodeVersion: 'v24.18.0',
    electronVersion: '42.6.2',
    appVersion: '1.10.1',
    suiteExitCode: 0,
    suiteSignal: null,
    ...overrides,
  });
}

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'puntovivo-gate5-'));
  const contents = {
    candidateInstaller: 'signed candidate installer',
    previousInstaller: 'signed previous installer',
    cleanInstallCapture: 'clean install capture',
    upgradeCapture: 'real updater capture',
    upgradeCanaryBefore: '{"canary":"preserved"}',
    upgradeCanaryAfter: '{"canary":"preserved"}',
    downgradeCapture: 'SchemaNewerThanAppError observed',
    downgradeDatabaseBefore: 'encrypted database bytes',
    downgradeDatabaseAfter: 'encrypted database bytes',
    externalElectronE2e: `${JSON.stringify(externalReport(), null, 2)}\n`,
  };
  for (const [key, fileName] of Object.entries(ARTIFACT_FILES)) {
    writeFileSync(path.join(directory, fileName), contents[key]);
  }
  return directory;
}

function draft(overrides = {}) {
  const base = {
    schemaVersion: 1,
    outcome: 'passed',
    sessionId: SESSION_ID,
    candidateSha: SHA,
    candidateVersion: '1.10.1',
    previousVersion: '1.10.0',
    startedAt: '2026-08-08T09:00:00.000Z',
    completedAt: '2026-08-08T11:00:00.000Z',
    environment: {
      platform: 'darwin',
      architecture: 'arm64',
      osVersion: '15.7.1',
      supportTarget: 'macos-15-sequoia-arm64',
      machineProfile: 'retail-register-apple-silicon',
    },
    probes: {
      cleanInstall: {
        freshUserData: true,
        installedVersion: '1.10.1',
        firstLaunchSucceeded: true,
      },
      upgrade: {
        fromVersion: '1.10.0',
        offeredVersion: '1.10.1',
        installedVersion: '1.10.1',
        transport: 'production-auto-updater',
        updateHistoryRecorded: true,
      },
      downgrade: {
        attemptedVersion: '1.10.0',
        attemptMethod: 'previous-signed-installer',
        policyMode: 'normal',
        downgradeRefused: true,
        refusalKind: 'schema-newer-than-app',
      },
    },
    artifactFiles: { ...ARTIFACT_FILES },
    review: {
      outcome: 'approved',
      reviewerRole: 'release-operator',
      reviewedAt: '2026-08-08T11:05:00.000Z',
      notes: 'Captures and immutable canary/database pairs reviewed on the representative host.',
    },
    failureCode: null,
  };
  return { ...base, ...overrides };
}

describe('representative install evidence', () => {
  it('collects and revalidates a passing hash-bound Gate 5 manifest', async () => {
    const directory = fixture();
    const report = await collectRepresentativeInstallEvidence(draft(), directory);

    assert.equal(report.outcome, 'passed');
    assert.equal(
      report.artifacts.upgradeCanaryBefore.sha256,
      report.artifacts.upgradeCanaryAfter.sha256
    );
    assert.equal(
      report.artifacts.downgradeDatabaseBefore.sha256,
      report.artifacts.downgradeDatabaseAfter.sha256
    );
    assert.equal('artifactFiles' in report, false);
    assert.equal(
      await validatePassingRepresentativeInstallEvidence(report, {
        artifactDirectory: directory,
        candidateSha: SHA,
        candidateVersion: '1.10.1',
        previousVersion: '1.10.0',
        supportTarget: 'macos-15-sequoia-arm64',
      }),
      report
    );
  });

  it('does not serialize local file locations into the manifest', async () => {
    const directory = fixture();
    const report = await collectRepresentativeInstallEvidence(draft(), directory);
    assert.doesNotMatch(JSON.stringify(report), new RegExp(directory.replaceAll('\\', '\\\\')));
  });

  it('rejects a canary changed by the real upgrade', async () => {
    const directory = fixture();
    writeFileSync(path.join(directory, ARTIFACT_FILES.upgradeCanaryAfter), '{"canary":"lost"}');
    await assert.rejects(
      collectRepresentativeInstallEvidence(draft(), directory),
      /outcome, probes, review, and failure code disagree/
    );
  });

  it('rejects any database mutation during downgrade refusal', async () => {
    const directory = fixture();
    writeFileSync(path.join(directory, ARTIFACT_FILES.downgradeDatabaseAfter), 'mutated database');
    await assert.rejects(
      collectRepresentativeInstallEvidence(draft(), directory),
      /outcome, probes, review, and failure code disagree/
    );
  });

  it('requires the production updater and normal no-downgrade policy', async () => {
    for (const mutate of [
      value => (value.probes.upgrade.transport = 'not-observed'),
      value => (value.probes.downgrade.policyMode = 'rollback'),
      value => (value.probes.downgrade.attemptMethod = 'not-observed'),
    ]) {
      const directory = fixture();
      const value = draft();
      mutate(value);
      await assert.rejects(
        collectRepresentativeInstallEvidence(value, directory),
        /outcome, probes, review, and failure code disagree/
      );
    }
  });

  it('accepts an observed refusal by the previous signed installer', async () => {
    const directory = fixture();
    const value = draft();
    value.probes.downgrade.refusalKind = 'installer-refused';
    const report = await collectRepresentativeInstallEvidence(value, directory);
    assert.equal(report.outcome, 'passed');
  });

  it('requires an independent approved review for passing evidence', async () => {
    const directory = fixture();
    const value = draft();
    value.review.outcome = 'rejected';
    await assert.rejects(
      collectRepresentativeInstallEvidence(value, directory),
      /outcome, probes, review, and failure code disagree/
    );
  });

  it('pins the external Electron suite to the same candidate and host class', async () => {
    const directory = fixture();
    writeFileSync(
      path.join(directory, ARTIFACT_FILES.externalElectronE2e),
      `${JSON.stringify(externalReport({ platform: 'win32', architecture: 'x64' }), null, 2)}\n`
    );
    await assert.rejects(
      collectRepresentativeInstallEvidence(draft(), directory),
      /platform does not match/
    );
  });

  it('binds the external suite to the same session, OS version, and evidence window', async () => {
    for (const externalOverrides of [
      { sessionId: '028f6f8c-4e5b-7a21-8abc-1234567890ab' },
      { osVersion: '26.5.2' },
      {
        startedAt: new Date('2026-08-08T10:55:00.000Z'),
        completedAt: new Date('2026-08-08T11:05:00.000Z'),
      },
    ]) {
      const directory = fixture();
      writeFileSync(
        path.join(directory, ARTIFACT_FILES.externalElectronE2e),
        `${JSON.stringify(externalReport(externalOverrides), null, 2)}\n`
      );
      await assert.rejects(collectRepresentativeInstallEvidence(draft(), directory));
    }
  });

  it('pins support labels to the observed platform, architecture, and macOS major', async () => {
    for (const mutate of [
      value => (value.environment.supportTarget = 'macos-26-tahoe-arm64'),
      value => (value.environment.supportTarget = 'future-unknown-target'),
      value => (value.environment.architecture = 'x64'),
    ]) {
      const directory = fixture();
      const value = draft();
      mutate(value);
      await assert.rejects(
        collectRepresentativeInstallEvidence(value, directory),
        /support target/
      );
    }
  });

  it('detects artifact tampering after collection', async () => {
    const directory = fixture();
    const report = await collectRepresentativeInstallEvidence(draft(), directory);
    writeFileSync(path.join(directory, ARTIFACT_FILES.cleanInstallCapture), 'replaced capture');
    await assert.rejects(
      validatePassingRepresentativeInstallEvidence(report, { artifactDirectory: directory }),
      /artifact (size|hash) does not match/
    );
  });

  it('requires every artifact basename exactly once', async () => {
    const directory = fixture();
    const value = draft();
    value.artifactFiles.cleanInstallCapture = '../clean-install.png';
    await assert.rejects(
      collectRepresentativeInstallEvidence(value, directory),
      /must be a basename/
    );
  });

  it('requires distinct clean, upgrade, and downgrade captures', async () => {
    const directory = fixture();
    writeFileSync(path.join(directory, ARTIFACT_FILES.upgradeCapture), 'clean install capture');
    await assert.rejects(
      collectRepresentativeInstallEvidence(draft(), directory),
      /captures must be distinct/
    );
  });

  it('rejects a relabelled installer and symbolic-link artifacts', async () => {
    const duplicateDirectory = fixture();
    writeFileSync(
      path.join(duplicateDirectory, ARTIFACT_FILES.previousInstaller),
      'signed candidate installer'
    );
    await assert.rejects(
      collectRepresentativeInstallEvidence(draft(), duplicateDirectory),
      /installers must be distinct/
    );

    const linkedDirectory = fixture();
    symlinkSync(
      path.join(linkedDirectory, ARTIFACT_FILES.cleanInstallCapture),
      path.join(linkedDirectory, 'linked-clean-install.png')
    );
    const linkedDraft = draft();
    linkedDraft.artifactFiles.cleanInstallCapture = 'linked-clean-install.png';
    await assert.rejects(
      collectRepresentativeInstallEvidence(linkedDraft, linkedDirectory),
      /regular files, not links/
    );
  });

  it('requires review only after the evidence window closes', async () => {
    const directory = fixture();
    const value = draft();
    value.review.reviewedAt = '2026-08-08T10:59:59.000Z';
    await assert.rejects(
      collectRepresentativeInstallEvidence(value, directory),
      /review predates evidence completion/
    );
  });

  it('requires a strictly older stable source release', async () => {
    const directory = fixture();
    await assert.rejects(
      collectRepresentativeInstallEvidence(draft({ previousVersion: '1.10.1' }), directory),
      /must be older/
    );
    await assert.rejects(
      collectRepresentativeInstallEvidence(draft({ previousVersion: '1.10.0-beta.1' }), directory),
      /stable semantic version/
    );
  });

  it('retains a failed observation envelope but never accepts it as a passing gate', async () => {
    const directory = fixture();
    const value = draft({ outcome: 'failed', failureCode: 'CLEAN_INSTALL_FAILED' });
    value.probes.cleanInstall.firstLaunchSucceeded = false;
    value.review.outcome = 'rejected';
    const report = await collectRepresentativeInstallEvidence(value, directory);

    assert.equal(validateRepresentativeInstallEvidenceEnvelope(report), report);
    await assert.rejects(
      validatePassingRepresentativeInstallEvidence(report, { artifactDirectory: directory }),
      /did not pass/
    );
  });

  it('retains a failed external Electron report without laundering it into a pass', async () => {
    const directory = fixture();
    writeFileSync(
      path.join(directory, ARTIFACT_FILES.externalElectronE2e),
      `${JSON.stringify(externalReport({ suiteExitCode: null, suiteSignal: 'SIGTRAP' }), null, 2)}\n`
    );
    const value = draft({ outcome: 'failed', failureCode: 'EXTERNAL_ELECTRON_E2E_FAILED' });
    value.review.outcome = 'rejected';

    const report = await collectRepresentativeInstallEvidence(value, directory);
    assert.equal(report.outcome, 'failed');
    await assert.rejects(
      validatePassingRepresentativeInstallEvidence(report, { artifactDirectory: directory }),
      /did not pass/
    );
  });

  it('rejects local filesystem disclosure in reviewed fields', async () => {
    const directory = fixture();
    const value = draft();
    value.review.notes = '/Users/operator/private test output';
    await assert.rejects(
      collectRepresentativeInstallEvidence(value, directory),
      /local filesystem location/
    );
  });

  it('fails closed when an artifact is missing', async () => {
    const directory = fixture();
    writeFileSync(path.join(directory, ARTIFACT_FILES.cleanInstallCapture), '');
    await assert.rejects(
      collectRepresentativeInstallEvidence(draft(), directory),
      /size is invalid/
    );
  });

  it('produces valid JSON records for retained artifacts', async () => {
    const directory = fixture();
    const report = await collectRepresentativeInstallEvidence(draft(), directory);
    const manifest = path.join(directory, 'gate5-manifest.json');
    writeFileSync(manifest, `${JSON.stringify(report, null, 2)}\n`);
    assert.deepEqual(JSON.parse(readFileSync(manifest, 'utf8')), report);
  });
});
