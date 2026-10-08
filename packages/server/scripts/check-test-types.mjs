import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const serverDirectory = resolve(dirname(scriptPath), '..');
const configPath = resolve(serverDirectory, 'tsconfig.tests.json');
const baselinePath = resolve(serverDirectory, 'test-typecheck-baseline.json');
const primaryDiagnosticPattern = /^(.*?)\((\d+),(\d+)\): error (TS\d+):/;
const configFilePattern = /(^|[\\/])tsconfig[^\\/]*\.json$/;

/** Convert native TypeScript's primary diagnostic lines into a stable file/code counter. */
export function parseDiagnostics(output) {
  const byFileAndCode = new Map();

  for (const line of output.split(/\r?\n/)) {
    const match = line.match(primaryDiagnosticPattern);
    if (!match) continue;

    const [, file, , , code] = match;
    const key = `${file.replaceAll('\\', '/')}|${code}`;
    byFileAndCode.set(key, (byFileAndCode.get(key) ?? 0) + 1);
  }

  return byFileAndCode;
}

/**
 * Reject compiler diagnostics that cannot enter the file/code ratchet: unlocated
 * diagnostics, and configuration diagnostics that can stop checking every test file.
 */
export function assertNoGlobalDiagnostics(output) {
  const diagnostics = output.split(/\r?\n/).filter(line => {
    if (/^error TS\d+:/.test(line)) return true;
    const match = line.match(primaryDiagnosticPattern);
    return match !== null && configFilePattern.test(match[1]);
  });
  if (diagnostics.length > 0) {
    throw new Error(
      `TypeScript reported unbaselineable global diagnostics:\n${diagnostics.join('\n')}`
    );
  }
}

/** Reject unindented compiler output that is not a primary diagnostic, so a format change cannot hide debt. */
export function assertRecognizedOutput(output) {
  const unrecognized = output
    .split(/\r?\n/)
    .filter(line => line.trim().length > 0 && !/^\s/.test(line))
    .filter(line => !primaryDiagnosticPattern.test(line));
  if (unrecognized.length > 0) {
    throw new Error(`TypeScript printed unrecognized output:\n${unrecognized.join('\n')}`);
  }
}

/** Build the checked-in debt snapshot without coupling it to diagnostic line numbers. */
export function buildBaseline(compilerVersion, diagnostics) {
  return {
    schemaVersion: 1,
    compilerVersion,
    config: 'tsconfig.tests.json',
    total: [...diagnostics.values()].reduce((sum, count) => sum + count, 0),
    byFileAndCode: Object.fromEntries(
      [...diagnostics.entries()].sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0
      )
    ),
  };
}

/** Reject malformed snapshots before JavaScript coercion can hide a changed counter. */
export function assertValidBaseline(baseline) {
  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (
    !isRecord(baseline) ||
    baseline.schemaVersion !== 1 ||
    baseline.config !== 'tsconfig.tests.json' ||
    typeof baseline.compilerVersion !== 'string' ||
    baseline.compilerVersion.trim().length === 0 ||
    !Number.isSafeInteger(baseline.total) ||
    baseline.total < 0 ||
    !isRecord(baseline.byFileAndCode)
  ) {
    throw new Error('Invalid test type baseline metadata');
  }

  let total = 0;
  for (const [key, count] of Object.entries(baseline.byFileAndCode)) {
    if (!/^.+\|TS\d+$/.test(key) || !Number.isSafeInteger(count) || count <= 0) {
      throw new Error(`Invalid test type baseline counter: ${key}`);
    }
    total += count;
  }
  if (!Number.isSafeInteger(total) || total !== baseline.total) {
    throw new Error('Test type baseline total does not match its counters');
  }
}

/** Require an exact ratchet match so both regressions and unrecorded improvements fail closed. */
export function compareBaseline(expected, actual) {
  const expectedEntries = new Map(Object.entries(expected.byFileAndCode));
  const regressions = [];
  const improvements = [];
  const keys = new Set([...expectedEntries.keys(), ...actual.keys()]);

  for (const key of [...keys].sort()) {
    const expectedCount = expectedEntries.get(key) ?? 0;
    const actualCount = actual.get(key) ?? 0;
    if (actualCount > expectedCount) {
      regressions.push(`${key}: ${expectedCount} -> ${actualCount}`);
    } else if (actualCount < expectedCount) {
      improvements.push(`${key}: ${expectedCount} -> ${actualCount}`);
    }
  }

  return { regressions, improvements };
}

/** Resolve the native compiler the server package itself depends on. */
function resolveCompiler() {
  const packageJsonPath = createRequire(import.meta.url).resolve('@typescript/native/package.json');
  const { version, bin } = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const binPath = typeof bin === 'string' ? bin : bin?.tsc;
  if (typeof version !== 'string' || typeof binPath !== 'string') {
    throw new Error(`Unable to read native TypeScript metadata from ${packageJsonPath}`);
  }
  return { version, path: resolve(dirname(packageJsonPath), binPath) };
}

function runCompiler(compilerPath, args) {
  const result = spawnSync(process.execPath, [compilerPath, ...args], {
    cwd: serverDirectory,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });

  if (result.error) throw result.error;
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return {
    status: result.status,
    signal: result.signal,
    stdout,
    output: stderr ? `${stdout}\n${stderr}` : stdout,
  };
}

function main() {
  if (!existsSync(configPath)) throw new Error(`Missing required file: ${configPath}`);
  const compiler = resolveCompiler();
  const compilerVersion = compiler.version;
  const result = runCompiler(compiler.path, ['--project', configPath, '--pretty', 'false']);
  if (result.status === null || result.signal) {
    throw new Error(`TypeScript was interrupted by ${result.signal ?? 'an unknown signal'}`);
  }
  assertNoGlobalDiagnostics(result.output);
  assertRecognizedOutput(result.stdout);
  const diagnostics = parseDiagnostics(result.output);
  const current = buildBaseline(compilerVersion, diagnostics);

  if (result.status !== 0 && current.total === 0) {
    throw new Error(`TypeScript failed without parseable diagnostics:\n${result.output}`);
  }

  if (process.argv.includes('--write')) {
    writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
    console.log(`Wrote ${current.total} diagnostics to ${baselinePath}`);
    return;
  }

  if (!existsSync(baselinePath)) {
    throw new Error(
      'Missing test-typecheck-baseline.json; run typecheck:tests:update deliberately'
    );
  }

  const expected = JSON.parse(readFileSync(baselinePath, 'utf8'));
  assertValidBaseline(expected);
  if (expected.compilerVersion !== compilerVersion) {
    throw new Error(
      `Native TypeScript changed from ${expected.compilerVersion} to ${compilerVersion}; review and regenerate the baseline`
    );
  }

  const { regressions, improvements } = compareBaseline(expected, diagnostics);
  if (regressions.length > 0 || improvements.length > 0) {
    const sections = [
      `Test type baseline mismatch: expected ${expected.total}, observed ${current.total}`,
      regressions.length > 0 ? `New or increased diagnostics:\n- ${regressions.join('\n- ')}` : '',
      improvements.length > 0
        ? `Resolved diagnostics require a smaller checked-in baseline:\n- ${improvements.join('\n- ')}`
        : '',
      'Review the compiler output, then run typecheck:tests:update only for intentional changes.',
    ].filter(Boolean);
    throw new Error(sections.join('\n\n'));
  }

  console.log(`Server test type ratchet passed: ${current.total} known diagnostics, 0 new`);
}

/** Compare real paths so a symlinked or differently cased invocation cannot silently skip the gate. */
function isEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(scriptPath);
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
