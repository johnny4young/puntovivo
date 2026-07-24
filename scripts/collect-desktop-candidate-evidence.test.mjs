import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  collectCandidateEvidence,
  normalizeCandidateSha,
  parseUpdateFeed,
} from './collect-desktop-candidate-evidence.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const VERSION = '1.8.1';
const INSTALLER = `Puntovivo-${VERSION}-mac-arm64.zip`;
const INSTALLER_CONTENT = 'current-installer';
const INSTALLER_SHA512 = createHash('sha512').update(INSTALLER_CONTENT).digest('base64');

function fixture() {
  const outDir = mkdtempSync(path.join(tmpdir(), 'puntovivo-candidate-evidence-'));
  writeFileSync(path.join(outDir, INSTALLER), INSTALLER_CONTENT);
  writeFileSync(path.join(outDir, `${INSTALLER}.blockmap`), 'current-blockmap');
  writeFileSync(path.join(outDir, 'Puntovivo-1.5.1-mac-arm64.zip'), 'stale-installer');
  writeFileSync(
    path.join(outDir, 'latest-mac.yml'),
    `version: ${VERSION}\nfiles:\n  - url: ${INSTALLER}\n    sha512: ${INSTALLER_SHA512}\n    size: ${Buffer.byteLength(INSTALLER_CONTENT)}\npath: ${INSTALLER}\n`
  );
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
  assert.deepEqual(evidence.checks, {
    exactHead: 'passed',
    packagedStructureSmoke: 'passed',
    packagedRuntimeSmoke: 'passed',
    updateFeedMatchesInstaller: 'passed',
    distributionTrust: 'not-assessed',
  });
  assert.equal(evidence.generatedAt, '2026-07-24T14:00:00.000Z');
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

    const evidence = await collectCandidateEvidence(
      input(outDir, { platform: target.platform, arch: target.arch })
    );
    assert.equal(evidence.platform, target.artifactOs);
    assert.equal(evidence.architecture, target.arch);
    assert.equal(evidence.artifactArchitecture, artifactArch);
    assert.equal(evidence.artifacts.installer.name, installer);
    assert.equal(evidence.artifacts.updateFeed.name, target.feedName);
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
