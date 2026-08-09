const SHA_PATTERN = /^[0-9a-f]{40}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const EXTERNAL_ELECTRON_E2E_SCHEMA_VERSION = 1;
export const EXTERNAL_ELECTRON_E2E_COMMAND = 'pnpm run test:e2e:electron:packaged';
export const REQUIRED_EXTERNAL_ELECTRON_CHECKS = Object.freeze([
  'standalone-interactive-host',
  'clean-worktree',
  'electron-e2e-suite',
]);

const AUTOMATION_ENV_KEYS = Object.freeze([
  'CI',
  'GITHUB_ACTIONS',
  'BUILDKITE',
  'CIRCLECI',
  'TEAMCITY_VERSION',
  'TF_BUILD',
  'JENKINS_URL',
  'XCTestConfigurationFilePath',
  'XCTestSessionIdentifier',
  'XCInjectBundleInto',
  'DYLD_INSERT_LIBRARIES',
  '__XPC_DYLD_INSERT_LIBRARIES',
  'DYLD_FRAMEWORK_PATH',
  'DYLD_LIBRARY_PATH',
  'NODE_OPTIONS',
  'ELECTRON_RUN_AS_NODE',
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

function isEnabledSignal(value) {
  return value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false';
}

/**
 * Detect execution contexts that cannot be retained as representative desktop
 * evidence. This is intentionally fail-closed: the ordinary Electron command
 * remains available for development, while the external-evidence wrapper only
 * runs from a standalone interactive terminal without CI, Codex, XCTest, or
 * dynamic-library injection signals.
 */
export function assessExternalElectronHost({
  env = process.env,
  stdinIsTTY = process.stdin.isTTY === true,
  stdoutIsTTY = process.stdout.isTTY === true,
} = {}) {
  const signals = [];

  if (!stdinIsTTY || !stdoutIsTTY) signals.push('non-interactive-terminal');
  if (env.TERM === 'dumb') signals.push('dumb-terminal');

  for (const key of Object.keys(env)) {
    if (key === 'CODEX' || key.startsWith('CODEX_')) signals.push(key);
  }
  for (const key of AUTOMATION_ENV_KEYS) {
    if (isEnabledSignal(env[key])) signals.push(key);
  }

  const uniqueSignals = [...new Set(signals)].sort();
  return {
    eligible: uniqueSignals.length === 0,
    signals: uniqueSignals,
    interactiveTty: stdinIsTTY && stdoutIsTTY,
  };
}

export function normalizeEvidenceSessionId(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  requireCondition(
    SESSION_ID_PATTERN.test(normalized),
    'external Electron evidence session id must be a UUID'
  );
  return normalized;
}

export function assertObservedPackagedVersion(observedVersion, expectedVersion) {
  requireCondition(
    typeof observedVersion === 'string' && VERSION_PATTERN.test(observedVersion),
    'packaged Electron runtime did not expose a stable app version'
  );
  if (expectedVersion) {
    requireCondition(
      observedVersion === expectedVersion,
      `packaged Electron runtime version ${observedVersion} does not match candidate ${expectedVersion}`
    );
  }
  return observedVersion;
}

function assertSanitizedEvidence(report) {
  const forbiddenKey = /(?:hostname|device.?id|serial|path|directory)$/i;
  const forbiddenValue = /(?:file:\/\/|\/(?:Users|home|tmp|private\/var)\/|[a-zA-Z]:\\|\\\\)/;
  const visit = (value, key = '') => {
    if (forbiddenKey.test(key)) {
      throw new Error(`external Electron evidence contains forbidden field ${key}`);
    }
    if (typeof value === 'string' && forbiddenValue.test(value)) {
      throw new Error('external Electron evidence contains a local filesystem location');
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

export function validateExternalElectronE2eEvidence(report, expectations = {}) {
  assertExactKeys(
    report,
    [
      'schemaVersion',
      'outcome',
      'sessionId',
      'candidateSha',
      'startedAt',
      'completedAt',
      'environment',
      'source',
      'execution',
      'timings',
      'checks',
      'failureCode',
    ],
    'external Electron evidence'
  );
  assertExactKeys(
    report.environment,
    ['platform', 'architecture', 'osVersion', 'nodeVersion', 'electronVersion', 'appVersion'],
    'external Electron evidence environment'
  );
  assertExactKeys(report.source, ['cleanWorktree'], 'external Electron evidence source');
  assertExactKeys(
    report.execution,
    ['interactiveTty', 'automationSignals', 'command'],
    'external Electron evidence execution'
  );
  assertExactKeys(report.timings, ['totalMs'], 'external Electron evidence timings');

  requireCondition(
    report.schemaVersion === EXTERNAL_ELECTRON_E2E_SCHEMA_VERSION,
    `external Electron evidence schema must be ${EXTERNAL_ELECTRON_E2E_SCHEMA_VERSION}`
  );
  requireCondition(
    report.outcome === 'passed' || report.outcome === 'failed',
    'external Electron evidence outcome is invalid'
  );
  requireCondition(
    report.sessionId === normalizeEvidenceSessionId(report.sessionId),
    'external Electron evidence session id must be canonical lowercase'
  );
  requireCondition(
    typeof report.candidateSha === 'string' && SHA_PATTERN.test(report.candidateSha),
    'external Electron evidence requires a complete candidate SHA'
  );

  const startedAtMs = Date.parse(report.startedAt);
  const completedAtMs = Date.parse(report.completedAt);
  requireCondition(Number.isFinite(startedAtMs), 'external Electron start time is invalid');
  requireCondition(Number.isFinite(completedAtMs), 'external Electron completion time is invalid');
  requireCondition(
    new Date(startedAtMs).toISOString() === report.startedAt &&
      new Date(completedAtMs).toISOString() === report.completedAt,
    'external Electron timestamps must be canonical ISO instants'
  );
  requireCondition(completedAtMs >= startedAtMs, 'external Electron completion precedes start');

  const environment = report.environment;
  requireCondition(
    ['darwin', 'linux', 'win32'].includes(environment.platform),
    'external Electron evidence platform is unsupported'
  );
  requireCondition(
    ['arm64', 'x64'].includes(environment.architecture),
    'external Electron evidence architecture is unsupported'
  );
  for (const [label, value] of [
    ['OS version', environment.osVersion],
    ['Node version', environment.nodeVersion],
    ['Electron version', environment.electronVersion],
  ]) {
    requireCondition(
      typeof value === 'string' && value.length > 0 && value.length <= 80,
      `external Electron evidence ${label} is invalid`
    );
  }
  requireCondition(
    typeof environment.appVersion === 'string' && VERSION_PATTERN.test(environment.appVersion),
    'external Electron evidence app version is invalid'
  );

  requireCondition(
    typeof report.source.cleanWorktree === 'boolean',
    'external Electron clean-worktree observation is invalid'
  );
  requireCondition(
    report.execution.interactiveTty === true,
    'external Electron evidence did not run in an interactive terminal'
  );
  requireCondition(
    Array.isArray(report.execution.automationSignals) &&
      report.execution.automationSignals.length === 0,
    'external Electron evidence contains automation-host signals'
  );
  requireCondition(
    report.execution.command === EXTERNAL_ELECTRON_E2E_COMMAND,
    'external Electron evidence command is unsupported'
  );
  requireCondition(
    typeof report.timings.totalMs === 'number' &&
      Number.isFinite(report.timings.totalMs) &&
      report.timings.totalMs >= 0 &&
      report.timings.totalMs <= completedAtMs - startedAtMs + 1_000,
    'external Electron evidence duration is invalid'
  );

  requireCondition(Array.isArray(report.checks), 'external Electron checks are missing');
  requireCondition(
    report.checks.length === REQUIRED_EXTERNAL_ELECTRON_CHECKS.length,
    'external Electron checks are incomplete'
  );
  const checkIds = new Set();
  for (const check of report.checks) {
    assertExactKeys(check, ['id', 'outcome', 'detail'], 'external Electron check');
    requireCondition(
      REQUIRED_EXTERNAL_ELECTRON_CHECKS.includes(check.id) && !checkIds.has(check.id),
      'external Electron check id is invalid or duplicated'
    );
    requireCondition(
      check.outcome === 'passed' || check.outcome === 'failed',
      'external Electron check outcome is invalid'
    );
    requireCondition(
      typeof check.detail === 'string' && check.detail.length > 0 && check.detail.length <= 160,
      'external Electron check detail is invalid'
    );
    checkIds.add(check.id);
  }

  const checksById = new Map(report.checks.map(check => [check.id, check]));
  requireCondition(
    checksById.get('standalone-interactive-host').outcome === 'passed',
    'external Electron standalone-host check disagrees with execution metadata'
  );
  requireCondition(
    checksById.get('clean-worktree').outcome ===
      (report.source.cleanWorktree ? 'passed' : 'failed'),
    'external Electron clean-worktree check disagrees with source metadata'
  );

  const allChecksPassed = report.checks.every(check => check.outcome === 'passed');
  requireCondition(
    report.failureCode === null || /^[A-Z][A-Z0-9_]{0,79}$/.test(report.failureCode),
    'external Electron failure code is invalid'
  );
  requireCondition(
    (report.outcome === 'passed' && allChecksPassed && report.failureCode === null) ||
      (report.outcome === 'failed' && !allChecksPassed && report.failureCode !== null),
    'external Electron outcome, checks, and failure code disagree'
  );

  if (expectations.candidateSha) {
    requireCondition(
      report.candidateSha === expectations.candidateSha.toLowerCase(),
      'external Electron candidate SHA does not match'
    );
  }
  if (expectations.sessionId) {
    requireCondition(
      report.sessionId === normalizeEvidenceSessionId(expectations.sessionId),
      'external Electron session id does not match'
    );
  }
  for (const key of ['platform', 'architecture', 'osVersion', 'appVersion']) {
    if (expectations[key]) {
      requireCondition(
        environment[key] === expectations[key],
        `external Electron ${key} does not match`
      );
    }
  }

  assertSanitizedEvidence(report);
  return report;
}

export function validatePassingExternalElectronE2eEvidence(report, expectations = {}) {
  validateExternalElectronE2eEvidence(report, expectations);
  requireCondition(report.outcome === 'passed', 'external Electron E2E suite did not pass');
  return report;
}
