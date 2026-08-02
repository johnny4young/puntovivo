#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolvePackagedBinary } from './lib/packaged-binary.mjs';
import {
  validatePackagedRecoveryEvidence,
  validatePackagedRecoveryEvidenceEnvelope,
} from './lib/packaged-recovery-evidence.mjs';

const MODE_ARGUMENT = '--puntovivo-packaged-recovery-rehearsal';
const DEFAULT_TIMEOUT_MS = 15 * 60_000;
const MAX_DIAGNOSTIC_BYTES = 32_000;

function requireValue(value, option) {
  if (!value) throw new Error(`${option} is required`);
  return value;
}

export function parsePackagedRecoveryArgs(argv) {
  const options = {
    packagedPath: null,
    candidateSha: null,
    output: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!option?.startsWith('--') || !value) {
      throw new Error(`unknown or incomplete option: ${option ?? '(missing)'}`);
    }
    if (option === '--against-packaged') options.packagedPath = value;
    else if (option === '--candidate-sha') options.candidateSha = value.toLowerCase();
    else if (option === '--output') options.output = value;
    else if (option === '--timeout-ms') options.timeoutMs = Number(value);
    else throw new Error(`unknown option: ${option}`);
  }
  requireValue(options.packagedPath, '--against-packaged');
  requireValue(options.candidateSha, '--candidate-sha');
  requireValue(options.output, '--output');
  if (!/^[0-9a-f]{40}$/.test(options.candidateSha)) {
    throw new Error('--candidate-sha must be a complete 40-character commit SHA');
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive number');
  }
  return options;
}

export function buildPackagedRecoveryLaunchArgs({
  outputDirectory,
  candidateSha,
  userDataDirectory,
  platform = process.platform,
}) {
  const args = [
    MODE_ARGUMENT,
    `--recovery-output=${outputDirectory}`,
    `--candidate-sha=${candidateSha}`,
    `--user-data-dir=${userDataDirectory}`,
  ];
  if (platform === 'darwin') args.push('--use-mock-keychain');
  if (platform === 'linux') {
    args.push('--password-store=basic', '--disable-gpu', '--disable-software-rasterizer');
  }
  return args;
}

function appendBounded(current, chunk) {
  const next = `${current}${chunk}`;
  return next.length <= MAX_DIAGNOSTIC_BYTES ? next : next.slice(-MAX_DIAGNOSTIC_BYTES);
}

function redactDiagnostics(value) {
  return value
    .replace(/(\[Database\] Password:\s+)\S+/g, '$1[Redacted]')
    .replace(/[a-f0-9]{64}/gi, '[hash-or-secret-redacted]');
}

export function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    let forceKillTimeout;
    let abandonTimeout;
    const timeoutError = () =>
      new Error(`packaged recovery rehearsal timed out after ${timeoutMs} ms`);
    const clearTimers = () => {
      clearTimeout(timeout);
      clearTimeout(forceKillTimeout);
      clearTimeout(abandonTimeout);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
      forceKillTimeout = setTimeout(() => {
        child.kill('SIGKILL');
        abandonTimeout = setTimeout(() => {
          clearTimers();
          reject(timeoutError());
        }, 5_000);
      }, 5_000);
    }, timeoutMs);
    child.once('error', error => {
      clearTimers();
      reject(timedOut ? timeoutError() : error);
    });
    child.once('close', (code, signal) => {
      clearTimers();
      if (timedOut) reject(timeoutError());
      else resolve({ code, signal });
    });
  });
}

export async function runPackagedRecoveryCli(options, dependencies = {}) {
  const platform = dependencies.platform ?? process.platform;
  const architecture = dependencies.architecture ?? process.arch;
  const resolveBinary = dependencies.resolveBinary ?? resolvePackagedBinary;
  const spawnProcess = dependencies.spawnProcess ?? spawn;
  const packagedPath = path.resolve(options.packagedPath);
  const outputPath = path.resolve(options.output);
  const binary = resolveBinary(packagedPath, platform);
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'puntovivo-packaged-recovery-host-'));
  const outputDirectory = path.join(temporaryRoot, 'evidence');
  const userDataDirectory = path.join(temporaryRoot, 'user-data');
  const reportPath = path.join(outputDirectory, 'report.json');
  let stdout = '';
  let stderr = '';
  try {
    await mkdir(outputDirectory, { recursive: true });
    const child = spawnProcess(
      binary,
      buildPackagedRecoveryLaunchArgs({
        outputDirectory,
        candidateSha: options.candidateSha,
        userDataDirectory,
        platform,
      }),
      {
        env: {
          ...process.env,
          AUTO_UPDATE: 'false',
          ELECTRON_ENABLE_LOGGING: '1',
          ELECTRON_DISABLE_GPU: '1',
          PUNTOVIVO_LOG_LEVEL: 'warn',
          PUNTOVIVO_SUPPRESS_CREDENTIAL_BANNER: 'true',
          PUNTOVIVO_PACKAGED_RECOVERY_REHEARSAL: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    child.stdout?.on('data', chunk => {
      stdout = appendBounded(stdout, chunk.toString());
    });
    child.stderr?.on('data', chunk => {
      stderr = appendBounded(stderr, chunk.toString());
    });
    const exit = await waitForExit(child, options.timeoutMs);
    let report = null;
    try {
      report = JSON.parse(await readFile(reportPath, 'utf8'));
    } catch {
      // The exit diagnostic below distinguishes a missing report from a failed one.
    }
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const desktopPackage = JSON.parse(
      await readFile(path.join(repoRoot, 'apps/desktop/package.json'), 'utf8')
    );
    const evidenceExpectations = {
      candidateSha: options.candidateSha,
      appVersion: desktopPackage.version,
      platform,
      architecture,
    };
    let envelopeError = null;
    if (report) {
      try {
        validatePackagedRecoveryEvidenceEnvelope(report, evidenceExpectations);
      } catch (error) {
        envelopeError = error;
        report = null;
      }
    }
    if (report) {
      await mkdir(path.dirname(outputPath), { recursive: true });
      await copyFile(reportPath, outputPath);
      if (platform !== 'win32') await chmod(outputPath, 0o600);
    }
    if (exit.code !== 0) {
      const failure =
        report?.failureCode ?? `exit ${String(exit.code)} signal ${String(exit.signal)}`;
      const diagnostics = redactDiagnostics(`${stdout}\n${stderr}`.trim());
      const evidenceStatus = report
        ? `; sanitized evidence retained at ${path.relative(process.cwd(), outputPath)}`
        : envelopeError instanceof Error
          ? `; failure report rejected: ${envelopeError.message}`
          : '; no failure report was produced';
      throw new Error(
        `packaged recovery rehearsal failed (${failure}${evidenceStatus})${diagnostics ? `\n${diagnostics}` : ''}`
      );
    }
    if (!report) {
      throw new Error(
        envelopeError instanceof Error
          ? `packaged recovery rehearsal report was rejected: ${envelopeError.message}`
          : 'packaged recovery rehearsal exited without a report'
      );
    }

    validatePackagedRecoveryEvidence(report, evidenceExpectations);
    const serialized = JSON.stringify(report);
    if (serialized.includes(temporaryRoot)) {
      throw new Error('packaged recovery evidence leaked its temporary root');
    }
    return { report, outputPath };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function main() {
  const options = parsePackagedRecoveryArgs(process.argv.slice(2));
  const result = await runPackagedRecoveryCli(options);
  process.stdout.write(
    `${JSON.stringify({
      outcome: result.report.outcome,
      candidateSha: result.report.candidateSha,
      profile: result.report.dataset.profile,
      businessRows: result.report.dataset.totalBusinessRows,
      recoveryTimeMs: result.report.recovery.recoveryTimeMs,
      recoveryPointAgeMs: result.report.recovery.recoveryPointAgeMs,
      evidencePath: path.relative(process.cwd(), result.outputPath),
    })}\n`
  );
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`[packaged-recovery] ${error.message}\n`);
    process.exit(1);
  });
}
