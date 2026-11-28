/**
 * Electron budgets through `@electron-stagewright/plugin-budget`. perf-budget.json
 * stays the source of truth; each gate writes the kit's budget format from it,
 * measures its cold launches with `electron-stagewright-budget measure` and
 * checks the run under Puntovivo's warn-first and strict modes.
 *
 * @module scripts/lib/electron-budget
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import {
  checkRun,
  createRun,
  loadRun,
  renderCheckReport,
} from '@electron-stagewright/plugin-budget/check';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BUDGET_PATH = join(REPO_ROOT, 'perf-budget.json');
export const ELECTRON_MAIN_ENTRY = join(
  REPO_ROOT,
  'apps',
  'desktop',
  '.vite',
  'build',
  'index.cjs'
);
export const IPC_PROBE = 'window.electron.getAppVersion()';
// Three cold launches: the median of each metric ignores one noisy window.
export const DEFAULT_ROUNDS = 3;

const KIT_PLATFORMS = new Set(['darwin', 'win32', 'linux']);

/** Puntovivo's process names map one to one onto the kit's process types. */
const PROCESS_TYPES = ['main', 'renderer', 'gpu', 'utility'];

/**
 * The kit budget for one gate. Memory stays in app.getAppMetrics() working
 * set, so the existing ceilings keep their meaning; GPU and the total that
 * includes it stay gated.
 */
export function buildKitBudget(perfBudget, check, platform = process.platform) {
  if (check === 'memory') {
    const memory = perfBudget?.electronMemoryMb;
    const perProcess = memory?.perProcessMb;
    const launch = perfBudget?.operationalProfile;
    if (!perProcess || typeof memory.thresholdPercent !== 'number') {
      throw new Error(
        'perf-budget.json is missing electronMemoryMb.perProcessMb or thresholdPercent'
      );
    }
    if (
      typeof launch?.desktopLaunchElapsedMs !== 'number' ||
      typeof launch.thresholdPercent !== 'number'
    ) {
      throw new Error(
        'perf-budget.json is missing operationalProfile.desktopLaunchElapsedMs or thresholdPercent'
      );
    }
    if (!KIT_PLATFORMS.has(platform)) throw new Error(`unsupported platform: ${platform}`);
    const perTypeMb = Object.fromEntries(
      PROCESS_TYPES.filter(type => typeof perProcess[type] === 'number').map(type => [
        type,
        perProcess[type],
      ])
    );
    return {
      $comment: 'Generated from perf-budget.json by scripts/lib/electron-budget.mjs.',
      startup: {
        phase: 'cold',
        thresholdPercent: launch.thresholdPercent,
        maxFirstWindowMs: launch.desktopLaunchElapsedMs,
      },
      memory: {
        [platform]: {
          metric: 'workingSet',
          phase: 'cold',
          thresholdPercent: memory.thresholdPercent,
          perTypeMb,
          ...(typeof perProcess.total === 'number' ? { totalMb: perProcess.total } : {}),
        },
      },
    };
  }
  if (check === 'main-thread') {
    const main = perfBudget?.electronMainThread;
    for (const key of ['windowMs', 'maxBlockedPercent', 'maxStallMs', 'maxIpcP99Ms']) {
      if (typeof main?.[key] !== 'number') {
        throw new Error(`perf-budget.json is missing electronMainThread.${key}`);
      }
    }
    // The main-thread limits were always exact.
    return {
      $comment: 'Generated from perf-budget.json by scripts/lib/electron-budget.mjs.',
      mainThread: {
        thresholdPercent: 0,
        windowMs: main.windowMs,
        maxBlockedPercent: main.maxBlockedPercent,
        maxStallMs: main.maxStallMs,
      },
      ipc: { thresholdPercent: 0, probe: IPC_PROBE, intervalMs: 25, maxP99Ms: main.maxIpcP99Ms },
    };
  }
  throw new Error(`unknown budget check: ${check}`);
}

/** Puntovivo's gate flags; `--strict` fails the build, it never drops the threshold. */
export function resolveGateMode({
  argv = process.argv.slice(2),
  env = process.env,
  check = 'memory',
} = {}) {
  const rounds = Number.parseInt(env.PUNTOVIVO_BUDGET_ROUNDS ?? '', 10);
  const prefix = check === 'main-thread' ? 'PUNTOVIVO_MAIN_THREAD' : 'PUNTOVIVO_MEMORY';
  return {
    enforce: argv.includes('--strict') || env[`${prefix}_STRICT`] === '1',
    requireMeasurement:
      argv.includes('--require-measurement') || env[`${prefix}_REQUIRE_MEASUREMENT`] === '1',
    rounds: Number.isInteger(rounds) && rounds > 0 ? rounds : DEFAULT_ROUNDS,
  };
}

export function resolveBudgetCli() {
  return fileURLToPath(import.meta.resolve('@electron-stagewright/plugin-budget/cli'));
}

/** Launches whose median counts: a majority, so one window cannot decide. */
export function minSamples(rounds) {
  return Math.floor(rounds / 2) + 1;
}

/**
 * Command and arguments for the measured launches. A launch that fails is
 * skipped, and `minSamples` decides whether the rest still count. Linux CI
 * needs a display and no SUID sandbox.
 */
export function buildMeasureInvocation({
  cli,
  budgetPath,
  outPath,
  env,
  rounds,
  workload,
  beforeRound,
  platform = process.platform,
  nodePath = process.execPath,
}) {
  const args = [
    cli,
    'measure',
    '--main',
    ELECTRON_MAIN_ENTRY,
    '--budget',
    budgetPath,
    '--rounds',
    String(rounds),
    '--phases',
    'cold',
    '--skip-failed-rounds',
    '--out',
    outPath,
  ];
  if (workload) args.push('--workload', workload);
  if (beforeRound) args.push('--before-round', beforeRound);
  for (const [key, value] of Object.entries(env)) args.push('--env', `${key}=${value}`);
  if (platform === 'linux') {
    args.push('--arg', '--no-sandbox');
    return { command: 'xvfb-run', args: ['-a', nodePath, ...args] };
  }
  return { command: nodePath, args };
}

// A headless Linux launch can start no GPU process; that is 0 MB, not an unmeasured metric.
export function withGpu(run) {
  return createRun({
    rounds: run.rounds.map(round => {
      const memory = round.measurement?.memory;
      if (!memory || memory.processes.some(entry => entry.type === 'gpu')) return round;
      const gpu = { pid: 0, type: 'gpu', mb: 0, workingSetMb: 0 };
      return {
        ...round,
        measurement: {
          ...round.measurement,
          memory: { ...memory, processes: [...memory.processes, gpu] },
        },
      };
    }),
    ...(run.electron_version ? { electronVersion: run.electron_version } : {}),
  });
}

/** The verdict for a run (null when no launch measured); a majority of launches must count. */
export function judgeRun(run, budget, { rounds, requireMeasurement }) {
  const measured = run ? withGpu(run) : createRun({ rounds: [] });
  const report = checkRun(measured, budget, {
    requireMeasurement,
    minSamples: minSamples(rounds),
  });
  const enough = measured.rounds.length >= minSamples(rounds);
  return {
    report,
    passed: report.passed && (!requireMeasurement || enough),
    enough,
    measuredLaunches: measured.rounds.length,
    unmeasured: !enough || report.summary.unmeasured > 0,
  };
}

/**
 * Warn-first passes an over-budget verdict; strict fails it, and
 * --require-measurement fails a missing measurement on its own.
 */
export function gateExitCode(passed, { enforce, requireMeasurement }, unmeasured = false) {
  if (passed) return 0;
  return enforce || (requireMeasurement && unmeasured) ? 1 : 0;
}

// Bounds what the kit's own launch, load and workload timeouts do not: a stuck stop or quit.
const LAUNCH_TIMEOUT_MS = 300_000;

function runChild(spawnImpl, invocation, env, onError, timeoutMs) {
  return new Promise(resolvePromise => {
    // xvfb-run forks node, Electron and Xvfb, so a timeout kills the whole group on Linux.
    const detached = process.platform === 'linux';
    const child = spawnImpl(invocation.command, invocation.args, {
      cwd: REPO_ROOT,
      env,
      stdio: 'inherit',
      detached,
    });
    const timer = setTimeout(() => {
      try {
        if (detached && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        // Already gone.
      }
    }, timeoutMs);
    const settle = value => {
      clearTimeout(timer);
      resolvePromise(value);
    };
    child.once('error', error => {
      onError(error);
      settle(null);
    });
    child.once('exit', code => settle(code ?? 1));
  });
}

/**
 * Writes the generated budget, measures every launch in one kit run (a
 * `beforeRound` module hands each launch fresh state), and checks the run.
 * A workload that measured a failure appends it to PUNTOVIVO_BUDGET_REJECT_FILE.
 */
export async function runBudgetGate({
  check,
  label,
  env,
  workload,
  beforeRound,
  argv = process.argv.slice(2),
  processEnv = process.env,
  spawnImpl = spawn,
  output = console,
}) {
  const mode = resolveGateMode({ argv, env: processEnv, check });
  const budget = buildKitBudget(JSON.parse(readFileSync(BUDGET_PATH, 'utf8')), check);
  const workDir = mkdtempSync(join(tmpdir(), `puntovivo-budget-${check}-`));
  try {
    const budgetPath = join(workDir, 'budget.json');
    const outPath = join(workDir, 'run.json');
    const rejectPath = join(workDir, 'rejected.txt');
    writeFileSync(budgetPath, JSON.stringify(budget, null, 2));
    const invocation = buildMeasureInvocation({
      cli: resolveBudgetCli(),
      budgetPath,
      outPath,
      env,
      rounds: mode.rounds,
      workload,
      beforeRound,
    });
    let startError = null;
    // Read by the workload and the before-round module, which run in the CLI's process.
    const childEnv = {
      ...processEnv,
      PUNTOVIVO_BUDGET_REJECT_FILE: rejectPath,
      PUNTOVIVO_BUDGET_WORK_DIR: workDir,
    };
    const code = await runChild(
      spawnImpl,
      invocation,
      childEnv,
      error => {
        startError = error;
      },
      LAUNCH_TIMEOUT_MS * mode.rounds
    );
    if (startError) {
      output.error(`${label}: could not start the budget CLI: ${startError.message}`);
      return 2;
    }
    const rejected = existsSync(rejectPath)
      ? readFileSync(rejectPath, 'utf8').split('\n').filter(Boolean)
      : [];
    const run = code === 0 && existsSync(outPath) ? await loadRun(outPath) : null;
    if (!run) output.warn(`${label}: no launch produced a measurement (exit ${code})`);
    const verdict = judgeRun(run, budget, mode);
    // Keep the majority rule consistent: one skipped workload round warns when
    // at least minSamples launches still ran full load and passed.
    const validLaunches = Math.min(
      verdict.measuredLaunches,
      Math.max(0, mode.rounds - rejected.length)
    );
    const workloadEnough = validLaunches >= minSamples(mode.rounds);
    for (const reason of rejected) {
      output[workloadEnough ? 'warn' : 'error'](`${label}: a launch failed: ${reason}`);
    }
    output.log(renderCheckReport(verdict.report));
    if (!verdict.enough) {
      output[mode.requireMeasurement ? 'error' : 'warn'](
        `${label}: only ${verdict.measuredLaunches} of ${mode.rounds} launches measured`
      );
    }
    const passed = verdict.passed && (rejected.length === 0 || workloadEnough);
    const exitCode = gateExitCode(passed, mode, verdict.unmeasured);
    if (!passed && exitCode === 0) {
      output.warn(`${label}: WARN over budget or unmeasured; pass --strict to fail.`);
    }
    return exitCode;
  } finally {
    // Windows can hold a fixture copy briefly after the app exits; that must not replace the verdict.
    try {
      rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      output.warn(`${label}: could not remove ${workDir}: ${error.message}`);
    }
  }
}
