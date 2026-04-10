import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
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
const nativeBinaryCacheDir = path.join(
  repoRoot,
  'node_modules',
  '.cache',
  'open-yojob',
  'native-binaries'
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

function getBetterSqliteBinaryPath() {
  const packageJsonPath = require.resolve('better-sqlite3/package.json');
  const packageDir = path.dirname(packageJsonPath);
  return path.join(packageDir, 'build', 'Release', 'better_sqlite3.node');
}

async function getFileHash(filePath) {
  try {
    const content = await readFile(filePath);
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
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

function getCachedBinaryPath(runtimeKey) {
  const safeKey = runtimeKey.replaceAll(/[^a-zA-Z0-9._-]+/g, '_');
  return path.join(nativeBinaryCacheDir, `${safeKey}.node`);
}

async function restoreCachedBinary(runtimeKey) {
  const cachedBinaryPath = getCachedBinaryPath(runtimeKey);
  const cachedBinaryHash = await getFileHash(cachedBinaryPath);

  if (!cachedBinaryHash) {
    return null;
  }

  await mkdir(path.dirname(getBetterSqliteBinaryPath()), { recursive: true });
  await copyFile(cachedBinaryPath, getBetterSqliteBinaryPath());
  return cachedBinaryHash;
}

async function cacheActiveBinary(runtimeKey) {
  const nativeBinaryPath = getBetterSqliteBinaryPath();
  const nativeBinaryHash = await getFileHash(nativeBinaryPath);

  if (!nativeBinaryHash) {
    throw new Error(`Unable to cache missing native binary at ${nativeBinaryPath}`);
  }

  await mkdir(nativeBinaryCacheDir, { recursive: true });
  await copyFile(nativeBinaryPath, getCachedBinaryPath(runtimeKey));
  return nativeBinaryHash;
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
  const nativeBinaryHash = await getFileHash(getBetterSqliteBinaryPath());
  const cachedBinaryHash = await getFileHash(getCachedBinaryPath(desiredKey));
  const alreadyPreparedForRuntime =
    state.keys?.[runtime] === desiredKey &&
    state.lastPreparedRuntime === runtime &&
    state.currentArtifactHash === nativeBinaryHash &&
    state.cachedArtifactHash === cachedBinaryHash;

  if (alreadyPreparedForRuntime) {
    console.log(`[native-runtime] ${runtime} runtime already prepared`);
    return;
  }

  if (cachedBinaryHash && cachedBinaryHash !== nativeBinaryHash) {
    console.log(`[native-runtime] Restoring cached better-sqlite3 binary for ${runtime}`);
    const restoredHash = await restoreCachedBinary(desiredKey);
    await writeState({
      keys: {
        ...state.keys,
        [runtime]: desiredKey,
      },
      cachedArtifactHash: restoredHash,
      currentArtifactHash: restoredHash,
      lastPreparedRuntime: runtime,
    });
    console.log(`[native-runtime] Prepared ${runtime} runtime from cache`);
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

  const currentArtifactHash = await cacheActiveBinary(desiredKey);

  await writeState({
    keys: {
      ...state.keys,
      [runtime]: desiredKey,
    },
    cachedArtifactHash: currentArtifactHash,
    currentArtifactHash,
    lastPreparedRuntime: runtime,
  });

  console.log(`[native-runtime] Prepared ${runtime} runtime`);
}

await main();
