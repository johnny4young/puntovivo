const SHA_PATTERN = /^[0-9a-f]{40}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export const PACKAGED_RECOVERY_REPORT_SCHEMA_VERSION = 1;
export const PACKAGED_RECOVERY_PROFILE_ID = 'retail-annual-medium-v1';
export const PACKAGED_RECOVERY_MINIMUM_COUNTS = Object.freeze({
  products: 2_500,
  customers: 10_000,
  cashSessions: 365,
  sales: 50_000,
  saleItems: 150_000,
  salePayments: 50_000,
});
export const REQUIRED_PACKAGED_RECOVERY_CHECKS = Object.freeze([
  'packaged-runtime',
  'representative-dataset',
  'encrypted-backup-created',
  'wrong-key-rejected',
  'corrupt-bundle-rejected',
  'correct-key-restored',
  'restored-copy-booted',
  'logical-data-preserved',
  'source-database-unchanged',
]);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function assertExactKeys(value, expectedKeys, label) {
  requireCondition(
    value && typeof value === 'object' && !Array.isArray(value),
    `packaged recovery evidence ${label} must be an object`
  );
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  requireCondition(
    actualKeys.length === sortedExpectedKeys.length &&
      actualKeys.every((key, index) => key === sortedExpectedKeys[index]),
    `packaged recovery evidence ${label} shape is unsupported`
  );
}

function assertReportShape(report) {
  assertExactKeys(
    report,
    [
      'schemaVersion',
      'outcome',
      'candidateSha',
      'startedAt',
      'completedAt',
      'environment',
      'dataset',
      'recovery',
      'timings',
      'checks',
      'failureCode',
    ],
    'root'
  );
  assertExactKeys(
    report.environment,
    [
      'packaged',
      'platform',
      'architecture',
      'nodeVersion',
      'electronVersion',
      'appVersion',
      'databaseSchemaVersion',
    ],
    'environment'
  );
  assertExactKeys(
    report.dataset,
    ['profile', 'counts', 'totalBusinessRows', 'logicalSha256', 'databaseBytes'],
    'dataset'
  );
  assertExactKeys(
    report.dataset.counts,
    Object.keys(PACKAGED_RECOVERY_MINIMUM_COUNTS),
    'dataset counts'
  );
  assertExactKeys(
    report.recovery,
    [
      'bundleSha256',
      'bundleBytes',
      'manifestSchemaVersion',
      'sourceDatabaseSha256',
      'restoredDatabaseSha256',
      'restoredLogicalSha256',
      'recoveryPointAgeMs',
      'recoveryTimeMs',
      'wrongKeyRejected',
      'corruptBundleRejected',
      'sourceDatabaseUnchanged',
      'restoredCopyBooted',
    ],
    'recovery'
  );
  assertExactKeys(
    report.timings,
    [
      'datasetSeedMs',
      'backupMs',
      'wrongKeyRejectionMs',
      'corruptBundleRejectionMs',
      'restoreMs',
      'restoredBootMs',
      'totalMs',
    ],
    'timings'
  );
  requireCondition(Array.isArray(report.checks), 'packaged recovery checks are missing');
  for (const check of report.checks) {
    assertExactKeys(check, ['id', 'outcome', 'detail'], 'check');
  }
}

function isNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function assertSanitizedShape(report) {
  const forbiddenField = /(?:path|directory|secret|encryption.?key|device.?id)$/i;
  const forbiddenString =
    /^(?:file:\/\/|\/|[a-zA-Z]:\\)|(?:\/Users\/|\/home\/|\/tmp\/|\/private\/var\/|\\Users\\)/;
  const visit = (value, key = '') => {
    if (forbiddenField.test(key)) {
      throw new Error(`packaged recovery evidence contains forbidden field ${key}`);
    }
    if (typeof value === 'string' && forbiddenString.test(value)) {
      throw new Error('packaged recovery evidence contains a local filesystem path');
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

export function validatePackagedRecoveryEvidenceEnvelope(
  report,
  { candidateSha, appVersion, platform, architecture } = {}
) {
  requireCondition(report && typeof report === 'object', 'packaged recovery evidence must be JSON');
  assertReportShape(report);
  requireCondition(
    report.schemaVersion === PACKAGED_RECOVERY_REPORT_SCHEMA_VERSION,
    `packaged recovery evidence schema must be ${PACKAGED_RECOVERY_REPORT_SCHEMA_VERSION}`
  );
  requireCondition(
    report.outcome === 'passed' || report.outcome === 'failed',
    'packaged recovery evidence outcome is invalid'
  );
  requireCondition(
    typeof report.candidateSha === 'string' && SHA_PATTERN.test(report.candidateSha),
    'packaged recovery evidence requires a complete candidate SHA'
  );
  const startedAtMs = Date.parse(report.startedAt);
  const completedAtMs = Date.parse(report.completedAt);
  requireCondition(Number.isFinite(startedAtMs), 'packaged recovery start time is invalid');
  requireCondition(Number.isFinite(completedAtMs), 'packaged recovery completion time is invalid');
  requireCondition(completedAtMs >= startedAtMs, 'packaged recovery completion precedes its start');
  if (candidateSha) {
    requireCondition(
      report.candidateSha === candidateSha.toLowerCase(),
      'packaged recovery evidence candidate SHA does not match'
    );
  }

  const environment = report.environment;
  requireCondition(environment.packaged === true, 'recovery evidence did not run in a package');
  requireCondition(
    ['darwin', 'linux', 'win32'].includes(environment.platform),
    'recovery evidence has an unsupported platform'
  );
  requireCondition(
    ['arm64', 'x64'].includes(environment.architecture),
    'recovery evidence has an unsupported architecture'
  );
  requireCondition(isNonEmptyString(environment.nodeVersion), 'recovery evidence is missing Node');
  requireCondition(
    isNonEmptyString(environment.electronVersion) && environment.electronVersion !== 'unknown',
    'recovery evidence is missing its Electron runtime version'
  );
  requireCondition(
    isNonEmptyString(environment.appVersion),
    'recovery evidence is missing app version'
  );
  requireCondition(
    Number.isInteger(environment.databaseSchemaVersion) && environment.databaseSchemaVersion >= 0,
    'recovery evidence has an invalid database schema version'
  );
  if (appVersion) {
    requireCondition(
      environment.appVersion === appVersion,
      'packaged recovery app version does not match the candidate'
    );
  }
  if (platform) {
    requireCondition(
      environment.platform === platform,
      'packaged recovery platform does not match the workflow host'
    );
  }
  if (architecture) {
    requireCondition(
      environment.architecture === architecture,
      'packaged recovery architecture does not match the workflow host'
    );
  }

  const dataset = report.dataset;
  requireCondition(
    dataset.profile === PACKAGED_RECOVERY_PROFILE_ID,
    `packaged recovery must use ${PACKAGED_RECOVERY_PROFILE_ID}`
  );
  let totalBusinessRows = 0;
  for (const key of Object.keys(PACKAGED_RECOVERY_MINIMUM_COUNTS)) {
    const actual = dataset.counts[key];
    requireCondition(
      Number.isInteger(actual) && actual >= 0,
      `packaged recovery ${key} count is invalid`
    );
    totalBusinessRows += actual;
  }
  requireCondition(
    dataset.totalBusinessRows === totalBusinessRows,
    'packaged recovery total business-row count is inconsistent'
  );
  requireCondition(
    dataset.logicalSha256 === null || HASH_PATTERN.test(dataset.logicalSha256),
    'source logical hash is invalid'
  );
  requireCondition(
    Number.isInteger(dataset.databaseBytes) && dataset.databaseBytes >= 0,
    'packaged recovery database size is invalid'
  );

  const recovery = report.recovery;
  for (const [label, value] of [
    ['bundle', recovery.bundleSha256],
    ['source database', recovery.sourceDatabaseSha256],
    ['restored database', recovery.restoredDatabaseSha256],
    ['restored logical', recovery.restoredLogicalSha256],
  ]) {
    requireCondition(value === null || HASH_PATTERN.test(value), `${label} hash is invalid`);
  }
  requireCondition(
    Number.isInteger(recovery.bundleBytes) && recovery.bundleBytes >= 0,
    'packaged recovery bundle size is invalid'
  );
  requireCondition(
    recovery.manifestSchemaVersion === null ||
      (Number.isInteger(recovery.manifestSchemaVersion) && recovery.manifestSchemaVersion > 0),
    'backup manifest schema is invalid'
  );
  for (const name of [
    'wrongKeyRejected',
    'corruptBundleRejected',
    'sourceDatabaseUnchanged',
    'restoredCopyBooted',
  ]) {
    requireCondition(typeof recovery[name] === 'boolean', `packaged recovery ${name} is invalid`);
  }
  requireCondition(
    recovery.recoveryPointAgeMs === null || isNonNegativeNumber(recovery.recoveryPointAgeMs),
    'recovery point age is invalid'
  );
  requireCondition(
    recovery.recoveryTimeMs === null || isNonNegativeNumber(recovery.recoveryTimeMs),
    'recovery time is invalid'
  );

  for (const [name, value] of Object.entries(report.timings)) {
    requireCondition(isNonNegativeNumber(value), `packaged recovery timing ${name} is invalid`);
  }
  requireCondition(report.checks.length <= 20, 'packaged recovery evidence has too many checks');
  requireCondition(
    report.checks.every(
      check =>
        isNonEmptyString(check.id) &&
        check.id.length <= 80 &&
        (check.outcome === 'passed' || check.outcome === 'failed') &&
        typeof check.detail === 'string' &&
        check.detail.length <= 160
    ),
    'packaged recovery evidence contains an invalid or unbounded check'
  );
  requireCondition(
    report.failureCode === null ||
      (typeof report.failureCode === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(report.failureCode)),
    'packaged recovery evidence failure code is invalid'
  );
  requireCondition(
    (report.outcome === 'passed' && report.failureCode === null) ||
      (report.outcome === 'failed' && report.failureCode !== null),
    'packaged recovery outcome and failure code disagree'
  );
  assertSanitizedShape(report);
  return report;
}

export function validatePackagedRecoveryEvidence(report, expectations = {}) {
  validatePackagedRecoveryEvidenceEnvelope(report, expectations);
  requireCondition(report.outcome === 'passed', 'packaged recovery rehearsal must pass');
  const environment = report.environment;
  requireCondition(
    Number.isInteger(environment.databaseSchemaVersion) && environment.databaseSchemaVersion > 0,
    'recovery evidence is missing its database schema version'
  );

  const dataset = report.dataset;
  requireCondition(
    dataset.profile === PACKAGED_RECOVERY_PROFILE_ID,
    `packaged recovery must use ${PACKAGED_RECOVERY_PROFILE_ID}`
  );
  let totalBusinessRows = 0;
  for (const [key, minimum] of Object.entries(PACKAGED_RECOVERY_MINIMUM_COUNTS)) {
    const actual = dataset.counts?.[key];
    requireCondition(
      Number.isInteger(actual) && actual >= minimum,
      `packaged recovery ${key} volume must be at least ${minimum}`
    );
    totalBusinessRows += actual;
  }
  requireCondition(
    dataset.totalBusinessRows === totalBusinessRows,
    'packaged recovery total business-row count is inconsistent'
  );
  requireCondition(
    HASH_PATTERN.test(dataset.logicalSha256 ?? ''),
    'source logical hash is missing'
  );
  requireCondition(dataset.databaseBytes > 0, 'packaged recovery database is empty');

  const recovery = report.recovery;
  for (const [label, value] of [
    ['bundle', recovery.bundleSha256],
    ['source database', recovery.sourceDatabaseSha256],
    ['restored database', recovery.restoredDatabaseSha256],
    ['restored logical', recovery.restoredLogicalSha256],
  ]) {
    requireCondition(HASH_PATTERN.test(value ?? ''), `${label} hash is missing`);
  }
  requireCondition(
    recovery.restoredLogicalSha256 === dataset.logicalSha256,
    'restored logical hash differs from the source'
  );
  requireCondition(recovery.bundleBytes > 0, 'packaged recovery bundle is empty');
  requireCondition(recovery.manifestSchemaVersion === 1, 'backup manifest schema is unsupported');
  requireCondition(recovery.wrongKeyRejected === true, 'wrong-key restore was not rejected');
  requireCondition(recovery.corruptBundleRejected === true, 'corrupt bundle was not rejected');
  requireCondition(
    recovery.sourceDatabaseUnchanged === true,
    'source database changed during restore'
  );
  requireCondition(recovery.restoredCopyBooted === true, 'restored database did not boot');
  requireCondition(
    isNonNegativeNumber(recovery.recoveryPointAgeMs),
    'recovery point age was not measured'
  );
  requireCondition(isNonNegativeNumber(recovery.recoveryTimeMs), 'recovery time was not measured');

  requireCondition(
    report.timings.totalMs >= recovery.recoveryTimeMs,
    'packaged recovery total time is shorter than recovery time'
  );

  const checks = new Map(report.checks.map(check => [check.id, check]));
  for (const id of REQUIRED_PACKAGED_RECOVERY_CHECKS) {
    requireCondition(
      checks.get(id)?.outcome === 'passed',
      `packaged recovery check ${id} did not pass`
    );
  }
  requireCondition(
    report.checks.every(
      check =>
        typeof check.id === 'string' &&
        check.outcome === 'passed' &&
        typeof check.detail === 'string' &&
        check.detail.length <= 160
    ),
    'packaged recovery evidence contains a failed or unbounded check'
  );
  requireCondition(
    report.failureCode === null,
    'packaged recovery evidence retains a failure code'
  );
  return report;
}
