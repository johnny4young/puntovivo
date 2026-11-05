#!/usr/bin/env node
// Every other gate injects the key or mocks the key store. This one seals under the
// old Electron, opens under the pinned one, then rolls back, using a throwaway app identity.
// Usage: --from <version> [--output report.json]; Linux needs a display and an unlocked keyring.
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
const keyStore = path.join(repoRoot, 'apps/desktop/src/main/db-key-store.ts');
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

/** Lines Electron itself warned with that the log policy would fail a run for. */
export function unexpectedElectronWarnings(stderr) {
  return stderr
    .split(/\r?\n/)
    .filter(line => line.startsWith('(electron) '))
    .filter(line => classifyElectronStderrLine(line) === 'unexpected');
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
  const expected = checksumFor((await fetchChecked(`${release}/SHASUMS256.txt`)).toString(), fileName);
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

/** Open to any app, so both runtimes read it without a Keychain prompt. */
function createThrowawayKeychainItem() {
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
  return remove;
}

function runPhase(binary, phase, workDirectory) {
  const resultPath = path.join(workDirectory, `${phase}.json`);
  const args = [proofApp, `--user-data-dir=${path.join(workDirectory, 'user-data')}`];
  if (process.platform === 'linux') args.push('--password-store=gnome-libsecret', '--no-sandbox');
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;
  const run = spawnSync(binary, args, {
    encoding: 'utf8',
    timeout: PHASE_TIMEOUT_MS,
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
  if (run.status !== 0 || !existsSync(resultPath)) {
    throw new Error(
      `${phase} phase exited with ${run.status ?? run.signal ?? run.error}\n${run.stderr ?? ''}`
    );
  }
  const unexpected = unexpectedElectronWarnings(run.stderr ?? '');
  if (unexpected.length > 0) {
    throw new Error(`${phase} phase printed unaccepted warnings:\n${unexpected.join('\n')}`);
  }
  return JSON.parse(readFileSync(resultPath, 'utf8'));
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const from = option('--from');
  const output = option('--output');
  const to = require('electron/package.json').version;
  if (!from) throw new Error('--from <version> is required');
  if (from === to) throw new Error(`--from must differ from the pinned Electron ${to}`);

  const workDirectory = mkdtempSync(path.join(os.tmpdir(), 'puntovivo-safe-storage-proof-'));
  const removeKeychainItem = createThrowawayKeychainItem();
  try {
    const oldBinary = await downloadElectron(from, workDirectory);
    const newBinary = require('electron');
    const seal = runPhase(oldBinary, 'seal', workDirectory);
    const reopen = runPhase(newBinary, 'reopen', workDirectory);
    const rollback = runPhase(oldBinary, 'rollback', workDirectory);
    assertProofChain({ from, to, seal, reopen, rollback });

    const report = {
      verdict: 'passed',
      from,
      to,
      platform: process.platform,
      arch: process.arch,
      backend: reopen.backend,
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
