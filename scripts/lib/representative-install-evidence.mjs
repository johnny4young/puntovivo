import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import {
  normalizeEvidenceSessionId,
  validateExternalElectronE2eEvidence,
  validatePassingExternalElectronE2eEvidence,
} from './external-electron-e2e-evidence.mjs';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SAFE_LABEL_PATTERN = /^[a-z0-9][a-z0-9.-]{2,79}$/;
const SAFE_FILE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,119}$/;
const MAX_GATE_DURATION_MS = 24 * 60 * 60 * 1_000;
const MAX_EXTERNAL_REPORT_BYTES = 128 * 1_024;

const SUPPORT_TARGET_CONTRACT = Object.freeze({
  'macos-15-sequoia-arm64': { platform: 'darwin', architecture: 'arm64', osMajor: 15 },
  'macos-26-tahoe-arm64': { platform: 'darwin', architecture: 'arm64', osMajor: 26 },
  'linux-x64-current': { platform: 'linux', architecture: 'x64', osMajor: null },
  'windows-x64-current': { platform: 'win32', architecture: 'x64', osMajor: null },
});

export const REPRESENTATIVE_INSTALL_EVIDENCE_SCHEMA_VERSION = 1;
export const REPRESENTATIVE_INSTALL_ARTIFACT_KEYS = Object.freeze([
  'candidateInstaller',
  'previousInstaller',
  'cleanInstallCapture',
  'upgradeCapture',
  'upgradeCanaryBefore',
  'upgradeCanaryAfter',
  'downgradeCapture',
  'downgradeDatabaseBefore',
  'downgradeDatabaseAfter',
  'externalElectronE2e',
]);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function assertExactKeys(value, expectedKeys, label) {
  requireCondition(
    value && typeof value === 'object' && !Array.isArray(value),
    `${label} must be an object`
  );
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  requireCondition(
    actual.length === expected.length && actual.every((key, index) => key === expected[index]),
    `${label} shape is unsupported`
  );
}

function parseVersion(value, label) {
  const match = typeof value === 'string' ? VERSION_PATTERN.exec(value) : null;
  requireCondition(match, `${label} must be a stable semantic version`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function assertArtifactRecord(record, label) {
  assertExactKeys(record, ['name', 'bytes', 'sha256'], `Gate 5 ${label} artifact`);
  requireCondition(
    typeof record.name === 'string' &&
      SAFE_FILE_PATTERN.test(record.name) &&
      path.basename(record.name) === record.name,
    `Gate 5 ${label} artifact name is unsafe`
  );
  requireCondition(
    Number.isInteger(record.bytes) && record.bytes > 0,
    `Gate 5 ${label} artifact size is invalid`
  );
  requireCondition(
    typeof record.sha256 === 'string' && HASH_PATTERN.test(record.sha256),
    `Gate 5 ${label} artifact hash is invalid`
  );
}

function assertSanitizedShape(report) {
  const forbiddenKey = /(?:hostname|device.?id|serial|path|directory|email|user.?name)$/i;
  const forbiddenString = /(?:file:\/\/|\/(?:Users|home|tmp|private\/var)\/|[a-zA-Z]:\\|\\\\)/;
  const visit = (value, key = '') => {
    if (forbiddenKey.test(key)) throw new Error(`Gate 5 evidence contains forbidden field ${key}`);
    if (typeof value === 'string' && forbiddenString.test(value)) {
      throw new Error('Gate 5 evidence contains a local filesystem location');
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [childKey, childValue] of Object.entries(value)) visit(childValue, childKey);
    }
  };
  visit(report);
}

function passingProbeState(report) {
  const { cleanInstall, upgrade, downgrade } = report.probes;
  return (
    cleanInstall.freshUserData === true &&
    cleanInstall.installedVersion === report.candidateVersion &&
    cleanInstall.firstLaunchSucceeded === true &&
    upgrade.fromVersion === report.previousVersion &&
    upgrade.offeredVersion === report.candidateVersion &&
    upgrade.installedVersion === report.candidateVersion &&
    upgrade.transport === 'production-auto-updater' &&
    upgrade.updateHistoryRecorded === true &&
    downgrade.attemptedVersion === report.previousVersion &&
    downgrade.attemptMethod === 'previous-signed-installer' &&
    downgrade.policyMode === 'normal' &&
    downgrade.downgradeRefused === true &&
    ['schema-newer-than-app', 'installer-refused'].includes(downgrade.refusalKind) &&
    report.artifacts.upgradeCanaryBefore.sha256 === report.artifacts.upgradeCanaryAfter.sha256 &&
    report.artifacts.upgradeCanaryBefore.bytes === report.artifacts.upgradeCanaryAfter.bytes &&
    report.artifacts.downgradeDatabaseBefore.sha256 ===
      report.artifacts.downgradeDatabaseAfter.sha256 &&
    report.artifacts.downgradeDatabaseBefore.bytes ===
      report.artifacts.downgradeDatabaseAfter.bytes &&
    report.review.outcome === 'approved'
  );
}

export function validateRepresentativeInstallEvidenceEnvelope(report, expectations = {}) {
  assertExactKeys(
    report,
    [
      'schemaVersion',
      'outcome',
      'sessionId',
      'candidateSha',
      'candidateVersion',
      'previousVersion',
      'startedAt',
      'completedAt',
      'environment',
      'probes',
      'artifacts',
      'review',
      'failureCode',
    ],
    'Gate 5 evidence'
  );
  assertExactKeys(
    report.environment,
    ['platform', 'architecture', 'osVersion', 'supportTarget', 'machineProfile'],
    'Gate 5 environment'
  );
  assertExactKeys(report.probes, ['cleanInstall', 'upgrade', 'downgrade'], 'Gate 5 probes');
  assertExactKeys(
    report.probes.cleanInstall,
    ['freshUserData', 'installedVersion', 'firstLaunchSucceeded'],
    'Gate 5 clean-install probe'
  );
  assertExactKeys(
    report.probes.upgrade,
    ['fromVersion', 'offeredVersion', 'installedVersion', 'transport', 'updateHistoryRecorded'],
    'Gate 5 upgrade probe'
  );
  assertExactKeys(
    report.probes.downgrade,
    ['attemptedVersion', 'attemptMethod', 'policyMode', 'downgradeRefused', 'refusalKind'],
    'Gate 5 downgrade probe'
  );
  assertExactKeys(report.artifacts, REPRESENTATIVE_INSTALL_ARTIFACT_KEYS, 'Gate 5 artifacts');
  assertExactKeys(
    report.review,
    ['outcome', 'reviewerRole', 'reviewedAt', 'notes'],
    'Gate 5 review'
  );

  requireCondition(
    report.schemaVersion === REPRESENTATIVE_INSTALL_EVIDENCE_SCHEMA_VERSION,
    `Gate 5 evidence schema must be ${REPRESENTATIVE_INSTALL_EVIDENCE_SCHEMA_VERSION}`
  );
  requireCondition(
    report.outcome === 'passed' || report.outcome === 'failed',
    'Gate 5 evidence outcome is invalid'
  );
  requireCondition(
    report.sessionId === normalizeEvidenceSessionId(report.sessionId),
    'Gate 5 session id must be canonical lowercase'
  );
  requireCondition(
    typeof report.candidateSha === 'string' && SHA_PATTERN.test(report.candidateSha),
    'Gate 5 evidence requires a complete candidate SHA'
  );
  const candidateVersion = parseVersion(report.candidateVersion, 'Gate 5 candidate version');
  const previousVersion = parseVersion(report.previousVersion, 'Gate 5 previous version');
  requireCondition(
    compareVersions(previousVersion, candidateVersion) < 0,
    'Gate 5 previous version must be older than the candidate'
  );

  const startedAtMs = Date.parse(report.startedAt);
  const completedAtMs = Date.parse(report.completedAt);
  requireCondition(Number.isFinite(startedAtMs), 'Gate 5 start time is invalid');
  requireCondition(Number.isFinite(completedAtMs), 'Gate 5 completion time is invalid');
  requireCondition(
    new Date(startedAtMs).toISOString() === report.startedAt &&
      new Date(completedAtMs).toISOString() === report.completedAt,
    'Gate 5 timestamps must be canonical ISO instants'
  );
  requireCondition(completedAtMs >= startedAtMs, 'Gate 5 completion precedes start');
  requireCondition(
    completedAtMs - startedAtMs <= MAX_GATE_DURATION_MS,
    'Gate 5 evidence window exceeds 24 hours'
  );

  const environment = report.environment;
  requireCondition(
    ['darwin', 'linux', 'win32'].includes(environment.platform),
    'Gate 5 platform is unsupported'
  );
  requireCondition(
    ['arm64', 'x64'].includes(environment.architecture),
    'Gate 5 architecture is unsupported'
  );
  requireCondition(
    typeof environment.osVersion === 'string' &&
      environment.osVersion.length > 0 &&
      environment.osVersion.length <= 80,
    'Gate 5 OS version is invalid'
  );
  for (const [label, value] of [
    ['support target', environment.supportTarget],
    ['machine profile', environment.machineProfile],
  ]) {
    requireCondition(
      typeof value === 'string' && SAFE_LABEL_PATTERN.test(value),
      `Gate 5 ${label} must be a stable lowercase label`
    );
  }
  const supportTarget = SUPPORT_TARGET_CONTRACT[environment.supportTarget];
  requireCondition(supportTarget, 'Gate 5 support target is not part of the release contract');
  requireCondition(
    supportTarget.platform === environment.platform &&
      supportTarget.architecture === environment.architecture,
    'Gate 5 support target does not match platform and architecture'
  );
  if (supportTarget.osMajor !== null) {
    const osMajor = Number.parseInt(environment.osVersion.split('.')[0], 10);
    requireCondition(
      osMajor === supportTarget.osMajor,
      'Gate 5 support target does not match the observed OS major'
    );
  }

  for (const [label, value] of [
    ['fresh user data', report.probes.cleanInstall.freshUserData],
    ['first launch', report.probes.cleanInstall.firstLaunchSucceeded],
    ['update history', report.probes.upgrade.updateHistoryRecorded],
    ['downgrade refusal', report.probes.downgrade.downgradeRefused],
  ]) {
    requireCondition(typeof value === 'boolean', `Gate 5 ${label} observation is invalid`);
  }
  for (const [label, value] of [
    ['clean installed version', report.probes.cleanInstall.installedVersion],
    ['upgrade source version', report.probes.upgrade.fromVersion],
    ['upgrade offered version', report.probes.upgrade.offeredVersion],
    ['upgrade installed version', report.probes.upgrade.installedVersion],
    ['downgrade attempted version', report.probes.downgrade.attemptedVersion],
  ]) {
    parseVersion(value, `Gate 5 ${label}`);
  }
  requireCondition(
    ['production-auto-updater', 'not-observed'].includes(report.probes.upgrade.transport),
    'Gate 5 upgrade transport is invalid'
  );
  requireCondition(
    ['previous-signed-installer', 'not-observed'].includes(report.probes.downgrade.attemptMethod),
    'Gate 5 downgrade attempt method is invalid'
  );
  requireCondition(
    ['normal', 'rollback', 'unknown'].includes(report.probes.downgrade.policyMode),
    'Gate 5 downgrade policy mode is invalid'
  );
  requireCondition(
    ['schema-newer-than-app', 'installer-refused', 'not-observed'].includes(
      report.probes.downgrade.refusalKind
    ),
    'Gate 5 downgrade refusal kind is invalid'
  );

  const artifactNames = new Set();
  for (const key of REPRESENTATIVE_INSTALL_ARTIFACT_KEYS) {
    const record = report.artifacts[key];
    assertArtifactRecord(record, key);
    requireCondition(!artifactNames.has(record.name), 'Gate 5 artifact names must be unique');
    artifactNames.add(record.name);
  }
  requireCondition(
    report.artifacts.candidateInstaller.name.startsWith(`Puntovivo-${report.candidateVersion}-`) &&
      report.artifacts.previousInstaller.name.startsWith(`Puntovivo-${report.previousVersion}-`),
    'Gate 5 installer names do not match the observed versions'
  );
  requireCondition(
    report.artifacts.candidateInstaller.sha256 !== report.artifacts.previousInstaller.sha256,
    'Gate 5 candidate and previous installers must be distinct'
  );
  requireCondition(
    new Set([
      report.artifacts.cleanInstallCapture.sha256,
      report.artifacts.upgradeCapture.sha256,
      report.artifacts.downgradeCapture.sha256,
    ]).size === 3,
    'Gate 5 clean, upgrade, and downgrade captures must be distinct'
  );

  requireCondition(
    ['approved', 'rejected'].includes(report.review.outcome),
    'Gate 5 review outcome is invalid'
  );
  requireCondition(
    typeof report.review.reviewerRole === 'string' &&
      SAFE_LABEL_PATTERN.test(report.review.reviewerRole),
    'Gate 5 reviewer role must be a stable non-personal label'
  );
  const reviewedAtMs = Date.parse(report.review.reviewedAt);
  requireCondition(Number.isFinite(reviewedAtMs), 'Gate 5 review time is invalid');
  requireCondition(
    new Date(reviewedAtMs).toISOString() === report.review.reviewedAt,
    'Gate 5 review time must be a canonical ISO instant'
  );
  requireCondition(reviewedAtMs >= completedAtMs, 'Gate 5 review predates evidence completion');
  requireCondition(
    typeof report.review.notes === 'string' &&
      report.review.notes.length > 0 &&
      report.review.notes.length <= 500,
    'Gate 5 review notes are invalid'
  );

  const probesPassed = passingProbeState(report);
  requireCondition(
    report.failureCode === null || /^[A-Z][A-Z0-9_]{0,79}$/.test(report.failureCode),
    'Gate 5 failure code is invalid'
  );
  requireCondition(
    (report.outcome === 'passed' && probesPassed && report.failureCode === null) ||
      (report.outcome === 'failed' && !probesPassed && report.failureCode !== null),
    'Gate 5 outcome, probes, review, and failure code disagree'
  );

  if (expectations.candidateSha) {
    requireCondition(
      report.candidateSha === expectations.candidateSha.toLowerCase(),
      'Gate 5 candidate SHA does not match'
    );
  }
  for (const key of ['candidateVersion', 'previousVersion']) {
    if (expectations[key]) {
      requireCondition(report[key] === expectations[key], `Gate 5 ${key} does not match`);
    }
  }
  for (const key of ['platform', 'architecture', 'supportTarget']) {
    if (expectations[key]) {
      requireCondition(environment[key] === expectations[key], `Gate 5 ${key} does not match`);
    }
  }

  assertSanitizedShape(report);
  return report;
}

export async function artifactRecord(filePath) {
  const linkStatus = lstatSync(filePath);
  requireCondition(
    linkStatus.isFile() && !linkStatus.isSymbolicLink(),
    'Gate 5 artifacts must be regular files, not links'
  );
  const handle = await open(filePath, 'r');
  const sha256 = createHash('sha256');
  try {
    const before = await handle.stat();
    for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
      sha256.update(chunk);
    }
    const after = await handle.stat();
    requireCondition(
      before.isFile() &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs &&
        before.ino === after.ino,
      'Gate 5 artifact changed while it was being hashed'
    );
    return {
      name: path.basename(filePath),
      bytes: after.size,
      sha256: sha256.digest('hex'),
    };
  } finally {
    await handle.close();
  }
}

export async function validateRepresentativeInstallArtifactFiles(report, artifactDirectory) {
  for (const key of REPRESENTATIVE_INSTALL_ARTIFACT_KEYS) {
    const expected = report.artifacts[key];
    const actual = await artifactRecord(path.join(artifactDirectory, expected.name));
    requireCondition(actual.bytes === expected.bytes, `Gate 5 ${key} artifact size does not match`);
    requireCondition(
      actual.sha256 === expected.sha256,
      `Gate 5 ${key} artifact hash does not match`
    );
  }

  requireCondition(
    report.artifacts.externalElectronE2e.bytes <= MAX_EXTERNAL_REPORT_BYTES,
    'external Electron evidence exceeds its bounded JSON size'
  );
  const externalReport = JSON.parse(
    readFileSync(path.join(artifactDirectory, report.artifacts.externalElectronE2e.name), 'utf8')
  );
  const validateExternal =
    report.outcome === 'passed'
      ? validatePassingExternalElectronE2eEvidence
      : validateExternalElectronE2eEvidence;
  validateExternal(externalReport, {
    candidateSha: report.candidateSha,
    sessionId: report.sessionId,
    platform: report.environment.platform,
    architecture: report.environment.architecture,
    osVersion: report.environment.osVersion,
    appVersion: report.candidateVersion,
  });
  requireCondition(
    Date.parse(externalReport.startedAt) >= Date.parse(report.startedAt) &&
      Date.parse(externalReport.completedAt) <= Date.parse(report.completedAt),
    'external Electron evidence falls outside the Gate 5 evidence window'
  );
  return report;
}

export async function validatePassingRepresentativeInstallEvidence(
  report,
  { artifactDirectory, ...expectations } = {}
) {
  validateRepresentativeInstallEvidenceEnvelope(report, expectations);
  requireCondition(
    report.outcome === 'passed',
    'Gate 5 representative install evidence did not pass'
  );
  requireCondition(artifactDirectory, 'Gate 5 validation requires its artifact directory');
  await validateRepresentativeInstallArtifactFiles(report, artifactDirectory);
  return report;
}
