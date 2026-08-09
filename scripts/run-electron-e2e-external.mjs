#!/usr/bin/env node
/**
 * Run the complete Electron journey suite from a standalone operator terminal
 * and retain sanitized evidence for Gate 5 review.
 *
 * The ordinary `test:e2e:electron` command remains automation-friendly. This
 * wrapper is deliberately stricter: CI, Codex, XCTest/injection signals,
 * non-interactive shells, and dirty source trees are refused before Electron is
 * launched so host-framework failures cannot be mistaken for release proof.
 */
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, release } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  assessExternalElectronHost,
  EXTERNAL_ELECTRON_E2E_COMMAND,
  EXTERNAL_ELECTRON_E2E_SCHEMA_VERSION,
  normalizeEvidenceSessionId,
  validateExternalElectronE2eEvidence,
} from './lib/external-electron-e2e-evidence.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

export function resolveExternalElectronRunnerOptions(argv, repoRoot = REPO_ROOT) {
  let output = null;
  let candidateRoot = repoRoot;
  let sessionId = null;
  let packagedApp = null;
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!value) {
      throw new Error(`unknown or incomplete option: ${option ?? '(missing)'}`);
    }
    if (option === '--output') output = value;
    else if (option === '--candidate-root') candidateRoot = path.resolve(value);
    else if (option === '--session-id') sessionId = normalizeEvidenceSessionId(value);
    else if (option === '--packaged-app') packagedApp = path.resolve(value);
    else throw new Error(`unknown option: ${option}`);
  }
  return { output, candidateRoot, sessionId, packagedApp };
}

function checkedGitOutput(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

export function buildExternalElectronReport({
  sessionId,
  candidateSha,
  startedAt,
  completedAt,
  totalMs,
  platform,
  architecture,
  osVersion,
  nodeVersion,
  electronVersion,
  appVersion,
  suiteExitCode,
  suiteSignal,
  cleanWorktree = true,
}) {
  const suitePassed = suiteExitCode === 0 && suiteSignal === null;
  const passed = suitePassed && cleanWorktree;
  const suiteDetail = suitePassed
    ? 'all Electron journeys passed'
    : suiteSignal
      ? `Electron E2E exited on signal ${suiteSignal}`
      : `Electron E2E exited with code ${String(suiteExitCode)}`;
  const report = {
    schemaVersion: EXTERNAL_ELECTRON_E2E_SCHEMA_VERSION,
    outcome: passed ? 'passed' : 'failed',
    sessionId: normalizeEvidenceSessionId(sessionId),
    candidateSha,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    environment: {
      platform,
      architecture,
      osVersion,
      nodeVersion,
      electronVersion,
      appVersion,
    },
    source: { cleanWorktree },
    execution: {
      interactiveTty: true,
      automationSignals: [],
      command: EXTERNAL_ELECTRON_E2E_COMMAND,
    },
    timings: { totalMs },
    checks: [
      {
        id: 'standalone-interactive-host',
        outcome: 'passed',
        detail: 'interactive terminal with no CI, Codex, XCTest, or injection signals',
      },
      {
        id: 'clean-worktree',
        outcome: cleanWorktree ? 'passed' : 'failed',
        detail: cleanWorktree
          ? 'tracked and untracked source remained clean'
          : 'candidate worktree changed during the suite',
      },
      {
        id: 'electron-e2e-suite',
        outcome: suitePassed ? 'passed' : 'failed',
        detail: suiteDetail,
      },
    ],
    failureCode: passed
      ? null
      : !cleanWorktree
        ? 'WORKTREE_CHANGED'
        : suiteSignal
          ? 'ELECTRON_E2E_SIGNAL'
          : 'ELECTRON_E2E_FAILED',
  };
  validateExternalElectronE2eEvidence(report);
  return report;
}

export function resolveExternalHostOsVersion(
  platform = process.platform,
  exec = execFileSync,
  fallback = release
) {
  if (platform === 'darwin') {
    return exec('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim();
  }
  return fallback();
}

async function runChild(command, args, options) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, options);
    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => resolvePromise({ code, signal }));
  });
}

export function buildExternalElectronChildEnv(env, packagedApp, expectedVersion) {
  return {
    ...env,
    PUNTOVIVO_PACKAGED_APP: packagedApp,
    PUNTOVIVO_EXPECTED_APP_VERSION: expectedVersion,
  };
}

async function main() {
  const options = resolveExternalElectronRunnerOptions(process.argv.slice(2));
  if (!options.sessionId) {
    throw new Error('--session-id is required and must match the Gate 5 draft');
  }
  if (!options.packagedApp || !existsSync(options.packagedApp)) {
    throw new Error('--packaged-app must point to the installed signed candidate');
  }
  const host = assessExternalElectronHost();
  if (!host.eligible) {
    throw new Error(
      `representative Electron evidence requires a standalone interactive terminal; blocked signals: ${host.signals.join(', ')}. Open Terminal/iTerm/Windows Terminal outside Codex, XCTest, and CI, then rerun pnpm run test:e2e:electron:external`
    );
  }

  const dirty = checkedGitOutput(
    ['status', '--porcelain', '--untracked-files=all'],
    options.candidateRoot
  );
  if (dirty) {
    throw new Error('representative Electron evidence requires a completely clean worktree');
  }

  const candidateSha = checkedGitOutput(['rev-parse', 'HEAD'], options.candidateRoot).toLowerCase();
  const desktopPackage = JSON.parse(
    readFileSync(path.join(options.candidateRoot, 'apps/desktop/package.json'), 'utf8')
  );
  const installedElectronPackagePath = path.join(
    options.candidateRoot,
    'node_modules/electron/package.json'
  );
  const electronVersion = existsSync(installedElectronPackagePath)
    ? JSON.parse(readFileSync(installedElectronPackagePath, 'utf8')).version
    : desktopPackage.devDependencies.electron.replace(/^[^0-9]*/, '');
  const output = path.resolve(
    REPO_ROOT,
    options.output ??
      path.join(
        '.artifacts',
        'electron-e2e',
        `external-${candidateSha}-${process.platform}-${process.arch}.json`
      )
  );

  const startedAt = new Date();
  const startedAtMs = performance.now();
  const result = await runChild(PNPM_COMMAND, ['run', 'test:e2e:electron:packaged'], {
    cwd: options.candidateRoot,
    env: buildExternalElectronChildEnv(process.env, options.packagedApp, desktopPackage.version),
    stdio: 'inherit',
    shell: false,
  });
  const completedAt = new Date();
  const cleanWorktree =
    checkedGitOutput(['status', '--porcelain', '--untracked-files=all'], options.candidateRoot) ===
    '';
  const report = buildExternalElectronReport({
    sessionId: options.sessionId,
    candidateSha,
    startedAt,
    completedAt,
    totalMs: Math.round(performance.now() - startedAtMs),
    platform: process.platform,
    architecture: arch(),
    osVersion: resolveExternalHostOsVersion(),
    nodeVersion: process.version,
    electronVersion,
    appVersion: desktopPackage.version,
    suiteExitCode: result.code,
    suiteSignal: result.signal,
    cleanWorktree,
  });

  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  const cleanAfterEvidenceWrite =
    checkedGitOutput(['status', '--porcelain', '--untracked-files=all'], options.candidateRoot) ===
    '';
  if (report.source.cleanWorktree && !cleanAfterEvidenceWrite) {
    const failedReport = buildExternalElectronReport({
      sessionId: options.sessionId,
      candidateSha,
      startedAt,
      completedAt,
      totalMs: report.timings.totalMs,
      platform: process.platform,
      architecture: arch(),
      osVersion: report.environment.osVersion,
      nodeVersion: process.version,
      electronVersion,
      appVersion: desktopPackage.version,
      suiteExitCode: result.code,
      suiteSignal: result.signal,
      cleanWorktree: false,
    });
    writeFileSync(output, `${JSON.stringify(failedReport, null, 2)}\n`);
    Object.assign(report, failedReport);
  }
  console.log(
    JSON.stringify({
      outcome: report.outcome,
      candidateSha: report.candidateSha,
      evidence: path.relative(REPO_ROOT, output),
    })
  );
  if (report.outcome !== 'passed') process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`[electron-e2e-external] ${error.message}`);
    process.exit(1);
  });
}
