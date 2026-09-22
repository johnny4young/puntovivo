import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const serverDirectory = resolve(scriptDirectory, '..');
const workspaceDirectory = resolve(serverDirectory, '../..');
const configPath = resolve(serverDirectory, 'tsconfig.tests.json');
const baselinePath = resolve(serverDirectory, 'test-typecheck-baseline.json');
const compilerPath = resolve(workspaceDirectory, 'node_modules/@typescript/native/bin/tsc');

/** Convert native TypeScript's primary diagnostic lines into a stable file/code counter. */
export function parseDiagnostics(output) {
  const byFileAndCode = new Map();
  const pattern = /^(.*?)\((\d+),(\d+)\): error (TS\d+):/;

  for (const line of output.split(/\r?\n/)) {
    const match = line.match(pattern);
    if (!match) continue;

    const [, file, , , code] = match;
    const key = `${file.replaceAll('\\', '/')}|${code}`;
    byFileAndCode.set(key, (byFileAndCode.get(key) ?? 0) + 1);
  }

  return byFileAndCode;
}

/** Reject compiler diagnostics that have no file location and cannot enter the file/code ratchet. */
export function assertNoGlobalDiagnostics(output) {
  const diagnostics = output.split(/\r?\n/).filter(line => /^error TS\d+:/.test(line));
  if (diagnostics.length > 0) {
    throw new Error(
      `TypeScript reported unbaselineable global diagnostics:\n${diagnostics.join('\n')}`
    );
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
      [...diagnostics.entries()].sort(([left], [right]) => left.localeCompare(right))
    ),
  };
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

function runCompiler(args) {
  const result = spawnSync(process.execPath, [compilerPath, ...args], {
    cwd: serverDirectory,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });

  if (result.error) throw result.error;
  return {
    status: result.status,
    signal: result.signal,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

function readCompilerVersion() {
  const result = runCompiler(['--version']);
  const match = result.output.match(/Version\s+([^\s]+)/);
  if (result.status !== 0 || result.signal || !match) {
    throw new Error(`Unable to read native TypeScript version:\n${result.output}`);
  }
  return match[1];
}

function main() {
  for (const requiredPath of [compilerPath, configPath]) {
    if (!existsSync(requiredPath)) throw new Error(`Missing required file: ${requiredPath}`);
  }

  const compilerVersion = readCompilerVersion();
  const result = runCompiler(['--project', configPath, '--pretty', 'false']);
  if (result.status === null || result.signal) {
    throw new Error(`TypeScript was interrupted by ${result.signal ?? 'an unknown signal'}`);
  }
  assertNoGlobalDiagnostics(result.output);
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
  if (expected.schemaVersion !== 1) {
    throw new Error(`Unsupported test type baseline schema: ${expected.schemaVersion}`);
  }
  if (expected.compilerVersion !== compilerVersion) {
    throw new Error(
      `Native TypeScript changed from ${expected.compilerVersion} to ${compilerVersion}; review and regenerate the baseline`
    );
  }

  const { regressions, improvements } = compareBaseline(expected, diagnostics);
  if (regressions.length > 0 || improvements.length > 0 || expected.total !== current.total) {
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
