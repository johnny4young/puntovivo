import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const stateFile = path.join(
  repoRoot,
  'node_modules',
  '.cache',
  'open-yojob',
  'native-runtime-state.json'
);

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readState() {
  try {
    return await readJson(stateFile);
  } catch {
    return { keys: {}, lastPreparedRuntime: null };
  }
}

async function writeState(nextState) {
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');
}

async function getBetterSqliteVersion() {
  const packageJsonPath = require.resolve('better-sqlite3/package.json');
  const packageJson = await readJson(packageJsonPath);
  return packageJson.version;
}

async function getElectronVersion() {
  const desktopPackageJson = await readJson(path.join(repoRoot, 'apps/desktop/package.json'));
  return desktopPackageJson.devDependencies?.electron ?? desktopPackageJson.dependencies?.electron;
}

async function getDesiredKey(runtime) {
  const betterSqliteVersion = await getBetterSqliteVersion();

  if (runtime === 'node') {
    return [
      'node',
      process.version,
      process.versions.modules,
      process.platform,
      process.arch,
      betterSqliteVersion,
    ].join(':');
  }

  const electronVersion = await getElectronVersion();
  return ['electron', electronVersion, process.platform, process.arch, betterSqliteVersion].join(':');
}

function runCommand(command, args, label) {
  console.log(`[native-runtime] ${label}`);
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}

async function main() {
  const runtime = process.argv[2];

  if (runtime !== 'node' && runtime !== 'electron') {
    console.error('Usage: node scripts/ensure-native-runtime.mjs <node|electron>');
    process.exit(1);
  }

  const desiredKey = await getDesiredKey(runtime);
  const state = await readState();

  if (state.keys?.[runtime] === desiredKey) {
    console.log(`[native-runtime] ${runtime} runtime already prepared`);
    return;
  }

  if (runtime === 'node') {
    runCommand(
      process.execPath,
      [path.join(repoRoot, 'packages/server/scripts/rebuild-better-sqlite3-node.mjs')],
      'Rebuilding better-sqlite3 for the active Node runtime'
    );
  } else {
    runCommand(
      npmCommand,
      ['run', 'rebuild', '--workspace=@open-yojob/desktop'],
      'Rebuilding better-sqlite3 for Electron'
    );
  }

  await writeState({
    keys: {
      ...state.keys,
      [runtime]: desiredKey,
    },
    lastPreparedRuntime: runtime,
  });

  console.log(`[native-runtime] Prepared ${runtime} runtime`);
}

await main();
