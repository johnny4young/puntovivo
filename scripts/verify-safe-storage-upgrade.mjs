#!/usr/bin/env node
// Every other gate injects the key or mocks the key store. This one seals with the previous
// release's key store and Electron, opens with this build, then rolls back to the previous
// release, using a throwaway app identity.
// Usage: --from <version> [--from-ref <release tag>] [--output report.json]; Linux needs a
// display and an unlocked keyring. On macOS, PROOF_KEYCHAIN_PASSWORD (the default keychain's
// password) lets both runtimes open the throwaway item without a Keychain dialog.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { classifyElectronStderrLine } from './electron-process-log-policy.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repoRoot, 'apps/desktop/package.json'));
const proofApp = path.join(repoRoot, 'scripts/fixtures/safe-storage-proof');
const KEY_STORE = 'apps/desktop/src/main/db-key-store.ts';
const currentKeyStore = path.join(repoRoot, KEY_STORE);
const APP_NAME = JSON.parse(readFileSync(path.join(proofApp, 'package.json'), 'utf8')).productName;
const PHASE_TIMEOUT_MS = 120_000;

export function electronZipName(version, platform = process.platform, arch = process.arch) {
  return `electron-v${version}-${platform}-${arch}.zip`;
}

export function checksumFor(shasums, fileName) {
  for (const line of shasums.split('\n')) {
    const match = line.trim().match(/^([0-9a-f]{64}) \*?(.+)$/);
    if (match?.[2] === fileName) return match[1];
  }
  throw new Error(`SHASUMS256.txt has no entry for ${fileName}`);
}

// The previous release may still call the synchronous API, which a newer Electron
// deprecates. Only this build must stay silent.
const SYNC_SAFE_STORAGE_DEPRECATION =
  /^\(electron\) 'safeStorage\.(isEncryptionAvailable|encryptString|decryptString)' is deprecated /;

/** Lines Electron itself warned with that the log policy would fail a run for. */
export function unexpectedElectronWarnings(stderr, { previousBuild = false } = {}) {
  return stderr
    .split(/\r?\n/)
    .filter(line => line.startsWith('(electron) '))
    .filter(line => !(previousBuild && SYNC_SAFE_STORAGE_DEPRECATION.test(line)))
    .filter(line => classifyElectronStderrLine(line) === 'unexpected');
}

export function assertSomethingUpgrades({ from, to, fromRef, previousSource, currentSource }) {
  if (from === to && previousSource === currentSource) {
    throw new Error(`--from ${from} and ${fromRef} match this build; nothing would be upgraded`);
  }
}

/** macOS lets a binary open a Keychain item without a dialog only if its partition is listed. */
export function keychainPartitionId(codesignInfo) {
  const team = codesignInfo.match(/^TeamIdentifier=(?!not set$)(\S+)$/m)?.[1];
  if (team) return `teamid:${team}`;
  const cdhash = codesignInfo.match(/^CDHash=([0-9a-f]+)$/m)?.[1];
  if (cdhash) return `cdhash:${cdhash}`;
  throw new Error('codesign reported neither a team identifier nor a CDHash');
}

export function phaseTimeoutMessage(phase, platform = process.platform) {
  const message = `${phase} phase did not finish in ${PHASE_TIMEOUT_MS / 1000} s`;
  if (platform !== 'darwin') return message;
  return `${message}; macOS was probably showing a Keychain access dialog for "${APP_NAME} Safe Storage". Set PROOF_KEYCHAIN_PASSWORD so both runtimes may open it without one.`;
}

export function assertProofChain({ from, to, seal, reopen, rollback }) {
  const fail = message => {
    throw new Error(`safeStorage upgrade proof failed: ${message}`);
  };
  if (seal.electron !== from || rollback.electron !== from) fail(`old phases did not run ${from}`);
  if (reopen.electron !== to) fail(`upgrade phase ran ${reopen.electron}, expected ${to}`);
  if (seal.hadEnvelope) fail('the seal phase found an existing envelope');
  if (!reopen.hadEnvelope || !rollback.hadEnvelope) fail('a later phase saw no envelope');
  if (reopen.envelope !== seal.envelope) fail('the upgrade replaced the envelope before reading');
  if (rollback.envelope !== reopen.resealedEnvelope) fail('rollback did not read the new envelope');
  for (const phase of [reopen, rollback]) {
    if (phase.osKey !== seal.osKey) fail(`${phase.phase} ran under another Local State key`);
    if (phase.keyFingerprint !== seal.keyFingerprint) fail(`${phase.phase} recovered another key`);
    if (phase.canary !== seal.canary) fail(`${phase.phase} read another database value`);
  }
}

async function fetchChecked(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function resolveBinary(root) {
  if (process.platform === 'darwin') {
    return path.join(root, 'Electron.app/Contents/MacOS/Electron');
  }
  return path.join(root, process.platform === 'win32' ? 'electron.exe' : 'electron');
}

async function downloadElectron(version, directory) {
  const release = `https://github.com/electron/electron/releases/download/v${version}`;
  const fileName = electronZipName(version);
  const expected = checksumFor(
    (await fetchChecked(`${release}/SHASUMS256.txt`)).toString(),
    fileName
  );
  const archive = await fetchChecked(`${release}/${fileName}`);
  const actual = createHash('sha256').update(archive).digest('hex');
  if (actual !== expected) throw new Error(`${fileName} failed its checksum`);

  const zipPath = path.join(directory, fileName);
  const root = path.join(directory, `electron-${version}`);
  writeFileSync(zipPath, archive);
  mkdirSync(root);
  if (process.platform === 'darwin') {
    execFileSync('ditto', ['-x', '-k', zipPath, root]);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', path.join(root, 'Electron.app')]);
  } else if (process.platform === 'win32') {
    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${root}' -Force`,
    ]);
  } else {
    execFileSync('unzip', ['-q', zipPath, '-d', root]);
  }
  return resolveBinary(root);
}

function partitionIdOf(binary) {
  const app = binary.slice(0, binary.indexOf('.app/') + '.app'.length);
  return keychainPartitionId(spawnSync('codesign', ['-dvvv', app], { encoding: 'utf8' }).stderr);
}

/** Open to any app; listing both runtimes' partitions needs the keychain password. */
function createThrowawayKeychainItem(binaries) {
  if (process.platform !== 'darwin') return () => {};
  // Electron looks up this exact service and account pair.
  const item = ['-s', `${APP_NAME} Safe Storage`, '-a', `${APP_NAME} Key`];
  const remove = () =>
    spawnSync('security', ['delete-generic-password', ...item], { stdio: 'ignore' });
  remove();
  execFileSync('security', [
    'add-generic-password',
    ...item,
    '-w',
    randomBytes(16).toString('base64'),
    '-A',
  ]);
  const password = process.env.PROOF_KEYCHAIN_PASSWORD;
  if (password) {
    const partitions = ['apple-tool:', 'apple:', ...binaries.map(partitionIdOf)];
    execFileSync(
      'security',
      ['set-generic-password-partition-list', ...item, '-S', partitions.join(','), '-k', password],
      { stdio: 'ignore' }
    );
  } else {
    console.warn(
      'PROOF_KEYCHAIN_PASSWORD is not set; macOS will ask before each runtime opens the throwaway Keychain item.'
    );
  }
  return remove;
}

/** Windows seals with the key in Local State, so a new one there orphans every envelope. */
function osKeyFingerprint(workDirectory) {
  if (process.platform !== 'win32') return undefined;
  const localState = path.join(workDirectory, 'user-data', 'Local State');
  if (!existsSync(localState)) return 'no Local State';
  const key = JSON.parse(readFileSync(localState, 'utf8')).os_crypt?.encrypted_key;
  return key ? createHash('sha256').update(key).digest('hex') : 'no os_crypt key';
}

function latestReleaseTag() {
  try {
    return execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
  } catch {
    return undefined;
  }
}

/** `.mts` so both Electron runtimes load it as ESM outside any package.json. */
function extractPreviousKeyStore(ref, directory) {
  const source = execFileSync('git', ['show', `${ref}:${KEY_STORE}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const file = path.join(directory, 'previous-db-key-store.mts');
  writeFileSync(file, source);
  return { file, source };
}

function runPhase(binary, phase, workDirectory, keyStore) {
  const resultPath = path.join(workDirectory, `${phase}.json`);
  const args = [proofApp, `--user-data-dir=${path.join(workDirectory, 'user-data')}`];
  if (process.platform === 'linux') args.push('--password-store=gnome-libsecret', '--no-sandbox');
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;
  const osKeyBefore = osKeyFingerprint(workDirectory);
  const run = spawnSync(binary, args, {
    encoding: 'utf8',
    timeout: PHASE_TIMEOUT_MS,
    // Electron handles SIGTERM on its main thread, which a Keychain dialog blocks.
    killSignal: 'SIGKILL',
    env: {
      ...env,
      PROOF_DATA_DIR: path.join(workDirectory, 'data'),
      PROOF_KEY_STORE: keyStore,
      PROOF_PHASE: phase,
      PROOF_RESULT: resultPath,
      PROOF_SQLITE: createRequire(path.join(repoRoot, 'packages/server/package.json')).resolve(
        'better-sqlite3'
      ),
    },
  });
  const osKey = osKeyFingerprint(workDirectory);
  if (run.error?.code === 'ETIMEDOUT') throw new Error(phaseTimeoutMessage(phase));
  if (run.status !== 0 || !existsSync(resultPath)) {
    const keys = osKey === undefined ? '' : `\nLocal State key: ${osKeyBefore} -> ${osKey}`;
    throw new Error(
      `${phase} phase exited with ${run.status ?? run.signal ?? run.error}${keys}\n${run.stderr ?? ''}`
    );
  }
  const unexpected = unexpectedElectronWarnings(run.stderr ?? '', {
    previousBuild: phase !== 'reopen',
  });
  if (unexpected.length > 0) {
    throw new Error(`${phase} phase printed unaccepted warnings:\n${unexpected.join('\n')}`);
  }
  return { ...JSON.parse(readFileSync(resultPath, 'utf8')), osKey };
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const from = option('--from');
  const fromRef = option('--from-ref') ?? latestReleaseTag();
  const output = option('--output');
  const to = require('electron/package.json').version;
  if (!from) throw new Error('--from <version> is required');
  if (!fromRef) throw new Error('--from-ref <release tag> is required when no v* tag is reachable');

  const workDirectory = mkdtempSync(path.join(os.tmpdir(), 'puntovivo-safe-storage-proof-'));
  let removeKeychainItem = () => {};
  try {
    const previous = extractPreviousKeyStore(fromRef, workDirectory);
    assertSomethingUpgrades({
      from,
      to,
      fromRef,
      previousSource: previous.source,
      currentSource: readFileSync(currentKeyStore, 'utf8'),
    });
    const oldBinary = await downloadElectron(from, workDirectory);
    const newBinary = require('electron');
    removeKeychainItem = createThrowawayKeychainItem([oldBinary, newBinary]);
    const seal = runPhase(oldBinary, 'seal', workDirectory, previous.file);
    const reopen = runPhase(newBinary, 'reopen', workDirectory, currentKeyStore);
    const rollback = runPhase(oldBinary, 'rollback', workDirectory, previous.file);
    assertProofChain({ from, to, seal, reopen, rollback });

    const report = {
      verdict: 'passed',
      from,
      fromRef,
      to,
      platform: process.platform,
      arch: process.arch,
      backend: reopen.backend,
      formats: { previous: seal.prefix, current: reopen.resealedPrefix },
      runtimes: [seal, reopen, rollback].map(({ phase, electron, node, chrome }) => ({
        phase,
        electron,
        node,
        chrome,
      })),
    };
    if (output) writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    removeKeychainItem();
    rmSync(workDirectory, { recursive: true, force: true });
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
