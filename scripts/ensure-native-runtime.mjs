import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, '..');
const probeScript = path.join(scriptsDir, 'probe-sqlite-native.cjs');
const requireFromRoot = createRequire(path.join(repoRoot, 'package.json'));

export function detectLibc({ platform = process.platform, report = process.report } = {}) {
  if (platform !== 'linux') return null;
  return report.getReport().header.glibcVersionRuntime ? 'glibc' : 'musl';
}

export function getPrebuildTarget({
  platform = process.platform,
  arch = process.arch,
  libc = detectLibc({ platform }),
} = {}) {
  if (!['darwin', 'linux', 'win32'].includes(platform)) {
    throw new Error(`Unsupported better-sqlite3 platform: ${platform}`);
  }
  if (!['arm64', 'x64'].includes(arch)) {
    throw new Error(`Unsupported better-sqlite3 architecture: ${arch}`);
  }
  const platformKey = platform === 'linux' && libc === 'musl' ? 'linuxmusl' : platform;
  return `${platformKey}-${arch}`;
}

export function getInstalledNativePackage() {
  const packageJsonPath = requireFromRoot.resolve('better-sqlite3/package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const packageDir = path.dirname(packageJsonPath);
  const target = getPrebuildTarget();
  const prebuildPath = path.join(packageDir, 'prebuilds', `${target}.node`);

  return { packageDir, packageJson, prebuildPath, target };
}

export function assertNodeApiPackage() {
  const installed = getInstalledNativePackage();
  if (installed.packageJson.name !== 'better-sqlite3-multiple-ciphers') {
    throw new Error(`Unexpected SQLite package: ${installed.packageJson.name}`);
  }
  const major = Number.parseInt(installed.packageJson.version, 10);
  if (!Number.isInteger(major) || major < 13) {
    throw new Error(
      `better-sqlite3-multiple-ciphers 13+ is required for Node-API; found ${installed.packageJson.version}`
    );
  }
  if (!existsSync(installed.prebuildPath)) {
    throw new Error(
      `Missing bundled Node-API prebuild for ${installed.target}: ${installed.prebuildPath}`
    );
  }
  return installed;
}

function runProbe(command, { env = process.env, label }) {
  const stdout = execFileSync(command, [probeScript], {
    cwd: repoRoot,
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let result;
  try {
    result = JSON.parse(stdout.trim());
  } catch {
    throw new Error(`${label} returned malformed native probe output: ${stdout.trim()}`);
  }
  if (result.sqlite !== 1 || result.cipher !== 'sqlcipher') {
    throw new Error(`${label} did not load the encrypted SQLite contract`);
  }
  return result;
}

export function verifyNativeRuntime(runtime) {
  const installed = assertNodeApiPackage();
  let command = process.execPath;
  let env = process.env;

  if (runtime === 'electron') {
    command = requireFromRoot('electron');
    if (typeof command !== 'string' || !existsSync(command)) {
      throw new Error('Electron runtime is missing; run electron:ensure:binary first');
    }
    env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  } else if (runtime !== 'node') {
    throw new Error(`Unknown native runtime: ${runtime}`);
  }

  const result = runProbe(command, { env, label: runtime });
  console.log(
    `[native-runtime] ${runtime} verified ${installed.packageJson.name}@${installed.packageJson.version} ` +
      `via ${installed.target}.node (runtime N-API ${result.napi})`
  );
  return result;
}

function main() {
  const runtime = process.argv[2];
  if (runtime !== 'node' && runtime !== 'electron') {
    console.error('Usage: node scripts/ensure-native-runtime.mjs <node|electron>');
    process.exitCode = 1;
    return;
  }
  verifyNativeRuntime(runtime);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
