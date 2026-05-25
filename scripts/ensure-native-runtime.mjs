import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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
  'puntovivo',
  'native-runtime-state.json'
);
const nativeBinaryCacheDir = path.join(
  repoRoot,
  'node_modules',
  '.cache',
  'puntovivo',
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
  // ENG-167 — combine the actual package name with the version so a
  // swap from `better-sqlite3` to `better-sqlite3-multiple-ciphers`
  // (which preserves the same `12.10.0` semver but ships a different
  // native binary with SQLCipher v4 linked in) invalidates the cache.
  // Without this the previously-cached plain better-sqlite3 .node
  // would silently restore over the SQLCipher build and break the
  // `PRAGMA key` path.
  return `${packageJson.name}@${packageJson.version}`;
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

async function collectNodeBinaries(rootDir) {
  const results = [];
  let entries;

  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectNodeBinaries(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith('.node')) {
      results.push(entryPath);
    }
  }

  return results;
}

function runCodesign(binaryPath) {
  const displayPath = path.relative(repoRoot, binaryPath);

  try {
    execFileSync('codesign', ['--force', '--sign', '-', binaryPath], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    execFileSync('codesign', ['--verify', '--verbose=2', binaryPath], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to ad-hoc sign native addon ${displayPath}: ${message}`);
  }
}

async function signElectronNativeAddons() {
  if (process.platform !== 'darwin') {
    return;
  }

  const candidates = new Set([
    getBetterSqliteBinaryPath(),
    path.join(repoRoot, 'node_modules', 'argon2', 'build', 'Release', 'argon2.node'),
  ]);

  for (const binaryPath of await collectNodeBinaries(path.join(repoRoot, 'node_modules', 'argon2', 'bin'))) {
    candidates.add(binaryPath);
  }

  for (const binaryPath of candidates) {
    if (!(await getFileHash(binaryPath))) {
      continue;
    }

    console.log(`[native-runtime] Ensuring macOS code signature for ${path.relative(repoRoot, binaryPath)}`);
    runCodesign(binaryPath);
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
    if (runtime === 'electron') {
      await signElectronNativeAddons();
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
    }
    console.log(`[native-runtime] ${runtime} runtime already prepared`);
    return;
  }

  if (cachedBinaryHash && cachedBinaryHash !== nativeBinaryHash) {
    console.log(`[native-runtime] Restoring cached better-sqlite3 binary for ${runtime}`);
    await restoreCachedBinary(desiredKey);
    if (runtime === 'electron') {
      await signElectronNativeAddons();
    }
    const restoredHash = await cacheActiveBinary(desiredKey);
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
      ['run', 'rebuild', '--workspace=@puntovivo/desktop'],
      'Rebuilding better-sqlite3 for Electron'
    );
  }

  if (runtime === 'electron') {
    await signElectronNativeAddons();
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
