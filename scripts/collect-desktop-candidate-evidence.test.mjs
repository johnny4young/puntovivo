import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  collectCandidateEvidence,
  normalizeCandidateSha,
  parseUpdateFeed,
} from './collect-desktop-candidate-evidence.mjs';
import {
  PACKAGED_RECOVERY_MINIMUM_COUNTS,
  REQUIRED_PACKAGED_RECOVERY_CHECKS,
} from './lib/packaged-recovery-evidence.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const VERSION = '1.8.1';
const INSTALLER = `Puntovivo-${VERSION}-mac-arm64.zip`;
const INSTALLER_CONTENT = 'current-installer';
const INSTALLER_SHA512 = createHash('sha512').update(INSTALLER_CONTENT).digest('base64');
const RECOVERY_EVIDENCE_NAME = 'packaged-recovery.json';

function writeRecoveryEvidence(outDir, platform = 'darwin', architecture = 'arm64') {
  const counts = { ...PACKAGED_RECOVERY_MINIMUM_COUNTS };
  const hash = 'a'.repeat(64);
  const report = {
    schemaVersion: 1,
    outcome: 'passed',
    candidateSha: SHA,
    startedAt: '2026-07-24T13:59:00.000Z',
    completedAt: '2026-07-24T14:00:00.000Z',
    environment: {
      packaged: true,
      platform,
      architecture,
      nodeVersion: 'v24.0.0',
      electronVersion: '42.6.2',
      appVersion: VERSION,
      databaseSchemaVersion: 33,
    },
    dataset: {
      profile: 'retail-annual-medium-v1',
      counts,
      totalBusinessRows: Object.values(counts).reduce((sum, value) => sum + value, 0),
      logicalSha256: hash,
      databaseBytes: 1_000_000,
    },
    recovery: {
      bundleSha256: hash,
      bundleBytes: 500_000,
      manifestSchemaVersion: 1,
      sourceDatabaseSha256: hash,
      restoredDatabaseSha256: 'b'.repeat(64),
      restoredLogicalSha256: hash,
      recoveryPointAgeMs: 25,
      recoveryTimeMs: 750,
      wrongKeyRejected: true,
      corruptBundleRejected: true,
      sourceDatabaseUnchanged: true,
      restoredCopyBooted: true,
    },
    timings: {
      datasetSeedMs: 100,
      backupMs: 100,
      wrongKeyRejectionMs: 20,
      corruptBundleRejectionMs: 20,
      restoreMs: 350,
      restoredBootMs: 400,
      totalMs: 990,
    },
    checks: REQUIRED_PACKAGED_RECOVERY_CHECKS.map(id => ({
      id,
      outcome: 'passed',
      detail: 'verified',
    })),
    failureCode: null,
  };
  const evidencePath = path.join(outDir, RECOVERY_EVIDENCE_NAME);
  writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
  return evidencePath;
}

function fixture() {
  const outDir = mkdtempSync(path.join(tmpdir(), 'puntovivo-candidate-evidence-'));
  writeFileSync(path.join(outDir, INSTALLER), INSTALLER_CONTENT);
  writeFileSync(path.join(outDir, `${INSTALLER}.blockmap`), 'current-blockmap');
  writeFileSync(path.join(outDir, 'Puntovivo-1.5.1-mac-arm64.zip'), 'stale-installer');
  writeFileSync(
    path.join(outDir, 'latest-mac.yml'),
    `version: ${VERSION}\nfiles:\n  - url: ${INSTALLER}\n    sha512: ${INSTALLER_SHA512}\n    size: ${Buffer.byteLength(INSTALLER_CONTENT)}\npath: ${INSTALLER}\n`
  );
  writeRecoveryEvidence(outDir);
  return outDir;
}

function input(outDir, overrides = {}) {
  return {
    outDir,
    candidateSha: SHA,
    headSha: SHA,
    version: VERSION,
    platform: 'darwin',
    arch: 'arm64',
    structureSmoke: 'passed',
    runtimeSmoke: 'passed',
    rendererSmoke: 'passed',
    hostOsVersion: '15.7.1',
    supportTarget: 'macos-15-sequoia-arm64',
    recoveryEvidencePath: path.join(outDir, RECOVERY_EVIDENCE_NAME),
    generatedAt: new Date('2026-07-24T14:00:00.000Z'),
    repository: 'johnny4young/puntovivo',
    workflowRunId: '100',
    workflowRunAttempt: '2',
    ...overrides,
  };
}

test('collectCandidateEvidence selects only the exact version/platform/architecture artifact', async () => {
  const evidence = await collectCandidateEvidence(input(fixture()));

  assert.equal(evidence.candidateSha, SHA);
  assert.equal(evidence.artifacts.installer.name, INSTALLER);
  assert.equal(evidence.artifacts.installer.bytes, Buffer.byteLength('current-installer'));
  assert.equal(evidence.artifacts.blockmap.name, `${INSTALLER}.blockmap`);
  assert.equal(evidence.artifacts.updateFeed.installer, INSTALLER);
  assert.equal(evidence.artifacts.installer.sha512, INSTALLER_SHA512);
  assert.equal(evidence.artifacts.updateFeed.installerSha512, INSTALLER_SHA512);
  assert.deepEqual(evidence.host, {
    osVersion: '15.7.1',
    supportTarget: 'macos-15-sequoia-arm64',
  });
  assert.deepEqual(evidence.checks, {
    exactHead: 'passed',
    packagedStructureSmoke: 'passed',
    packagedRuntimeSmoke: 'passed',
    packagedRendererSmoke: 'passed',
    packagedEncryptedRecovery: 'passed',
    updateFeedMatchesInstaller: 'passed',
    // The fixture has no .app to inspect, so trust is explicitly unassessed
    // rather than defaulted to something reassuring.
    distributionTrust: 'unsupported-platform',
  });
  assert.equal(evidence.distributionTrustReport.assessed, false);
  assert.equal(evidence.recoveryEvidence.profile, 'retail-annual-medium-v1');
  assert.equal(evidence.recoveryEvidence.totalBusinessRows, 262_865);
  assert.equal(evidence.artifacts.packagedRecoveryEvidence.name, RECOVERY_EVIDENCE_NAME);
  assert.match(evidence.distributionTrustReport.reason, /no \.app bundle/);
  assert.equal(evidence.generatedAt, '2026-07-24T14:00:00.000Z');
});

test('collectCandidateEvidence assesses trust against a bundle beside the installer', async () => {
  const dir = fixture();
  // A structurally-present but unsigned bundle: whatever the host's tooling
  // reports, an unsigned app must never come back trusted.
  mkdirSync(path.join(dir, 'mac-arm64', 'puntovivo.app', 'Contents', 'MacOS'), {
    recursive: true,
  });
  writeFileSync(path.join(dir, 'mac-arm64', 'puntovivo.app', 'Contents', 'MacOS', 'puntovivo'), '');

  const evidence = await collectCandidateEvidence(input(dir));

  assert.equal(evidence.checks.distributionTrust, 'untrusted');
  assert.equal(evidence.distributionTrustReport.assessed, true);
  assert.deepEqual(
    evidence.distributionTrustReport.checks.map(check => check.id),
    ['code-signing', 'notarization', 'gatekeeper']
  );
});

test('the evidence schema version moves when the manifest shape changes', async () => {
  // Schema 6 pins the actual host OS plus the intended support target; an
  // older reader would silently conflate Tahoe proof with Sequoia support.
  const evidence = await collectCandidateEvidence(input(fixture()));
  assert.equal(evidence.schemaVersion, 6);
});

test('collectCandidateEvidence requires bounded host OS and support labels', async () => {
  await assert.rejects(
    collectCandidateEvidence(input(fixture(), { hostOsVersion: '' })),
    /host OS version is required/
  );
  await assert.rejects(
    collectCandidateEvidence(input(fixture(), { supportTarget: 'Tahoe 26' })),
    /stable lowercase platform label/
  );
});

test('collectCandidateEvidence rejects a checkout that differs from the requested candidate', async () => {
  await assert.rejects(
    collectCandidateEvidence(
      input(fixture(), {
        headSha: 'fedcba9876543210fedcba9876543210fedcba98',
      })
    ),
    /does not match checked-out HEAD/
  );
});

test('collectCandidateEvidence rejects a feed that references another installer', async () => {
  const outDir = fixture();
  writeFileSync(
    path.join(outDir, 'latest-mac.yml'),
    `version: ${VERSION}\nfiles:\n  - url: Puntovivo-1.5.1-mac-arm64.zip\n    sha512: ${INSTALLER_SHA512}\n    size: ${Buffer.byteLength(INSTALLER_CONTENT)}\n`
  );

  await assert.rejects(
    collectCandidateEvidence(input(outDir)),
    /update feed url does not reference/
  );
});

test('collectCandidateEvidence requires a successful structure smoke', async () => {
  await assert.rejects(
    collectCandidateEvidence(input(fixture(), { structureSmoke: 'skipped' })),
    /structure smoke must pass/
  );
});

test('collectCandidateEvidence requires a successful runtime smoke', async () => {
  await assert.rejects(
    collectCandidateEvidence(input(fixture(), { runtimeSmoke: 'skipped' })),
    /runtime smoke must pass/
  );
});

test('collectCandidateEvidence requires a packaged renderer journey on every platform', async () => {
  await assert.rejects(
    collectCandidateEvidence(input(fixture(), { rendererSmoke: 'not-assessed' })),
    /renderer smoke must pass/
  );
});

test('collectCandidateEvidence requires passing packaged encrypted recovery evidence', async () => {
  await assert.rejects(
    collectCandidateEvidence(
      input(fixture(), { recoveryEvidencePath: '/definitely/missing/recovery.json' })
    ),
    /recovery evidence is missing/
  );
  const outDir = fixture();
  const report = JSON.parse(readFileSync(path.join(outDir, RECOVERY_EVIDENCE_NAME), 'utf8'));
  report.recovery.corruptBundleRejected = false;
  writeFileSync(path.join(outDir, RECOVERY_EVIDENCE_NAME), JSON.stringify(report));
  await assert.rejects(collectCandidateEvidence(input(outDir)), /corrupt bundle was not rejected/);
});

test('collectCandidateEvidence rejects update metadata for different installer bytes', async () => {
  const outDir = fixture();
  writeFileSync(
    path.join(outDir, 'latest-mac.yml'),
    `version: ${VERSION}\nfiles:\n  - url: ${INSTALLER}\n    sha512: invalid\n    size: ${Buffer.byteLength(INSTALLER_CONTENT)}\n`
  );

  await assert.rejects(
    collectCandidateEvidence(input(outDir)),
    /update feed sha512 does not match/
  );
});

test('collectCandidateEvidence resolves the Windows and Linux updater contracts', async () => {
  for (const target of [
    {
      platform: 'win32',
      artifactOs: 'win',
      arch: 'x64',
      extension: 'exe',
      feedName: 'latest.yml',
    },
    {
      platform: 'linux',
      artifactOs: 'linux',
      arch: 'x64',
      artifactArch: 'x86_64',
      extension: 'AppImage',
      feedName: 'latest-linux.yml',
    },
  ]) {
    const outDir = mkdtempSync(path.join(tmpdir(), 'puntovivo-candidate-evidence-'));
    const artifactArch = target.artifactArch ?? target.arch;
    const installer = `Puntovivo-${VERSION}-${target.artifactOs}-${artifactArch}.${target.extension}`;
    writeFileSync(path.join(outDir, installer), INSTALLER_CONTENT);
    writeFileSync(
      path.join(outDir, target.feedName),
      `version: ${VERSION}\nfiles:\n  - url: ${installer}\n    sha512: ${INSTALLER_SHA512}\n    size: ${Buffer.byteLength(INSTALLER_CONTENT)}\n`
    );
    const recoveryEvidencePath = writeRecoveryEvidence(outDir, target.platform, target.arch);

    const evidence = await collectCandidateEvidence(
      input(outDir, {
        platform: target.platform,
        arch: target.arch,
        rendererSmoke: 'passed',
        recoveryEvidencePath,
      })
    );
    assert.equal(evidence.platform, target.artifactOs);
    assert.equal(evidence.architecture, target.arch);
    assert.equal(evidence.artifactArchitecture, artifactArch);
    assert.equal(evidence.artifacts.installer.name, installer);
    assert.equal(evidence.artifacts.updateFeed.name, target.feedName);
    assert.equal(evidence.checks.packagedRendererSmoke, 'passed');
  }
});

test('candidate and feed parsing reject incomplete evidence', () => {
  assert.equal(normalizeCandidateSha(SHA.toUpperCase()), SHA);
  assert.throws(() => normalizeCandidateSha('main'), /complete 40-character/);
  assert.deepEqual(
    parseUpdateFeed(
      `version: '${VERSION}'\nfiles:\n  - url: https://example.test/releases/${INSTALLER}\n    sha512: ${INSTALLER_SHA512}\n    size: ${Buffer.byteLength(INSTALLER_CONTENT)}\n`
    ),
    {
      version: VERSION,
      url: `https://example.test/releases/${INSTALLER}`,
      path: null,
      sha512: INSTALLER_SHA512,
      size: Buffer.byteLength(INSTALLER_CONTENT),
    }
  );
  assert.throws(
    () =>
      parseUpdateFeed(readFileSync(new URL('./rewrite-update-feed.mjs', import.meta.url), 'utf8')),
    /must contain root version/
  );
});
