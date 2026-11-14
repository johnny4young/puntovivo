/**
 * Electron budgets through `@electron-stagewright/plugin-budget`. perf-budget.json
 * stays the source of truth; each gate writes the kit's budget format from it,
 * measures each launch with `electron-stagewright-budget measure` and checks
 * the merged launches under Puntovivo's warn-first and strict modes.
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
} from '@electron-stagewright/plugin-budget';
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

/** The package exports only its library; the CLI sits next to it in dist. */
export function resolveBudgetCli() {
  const entry = fileURLToPath(import.meta.resolve('@electron-stagewright/plugin-budget'));
  return join(dirname(entry), 'cli.js');
}

/** Command and arguments for one measured launch; Linux CI needs a display and no SUID sandbox. */
export function buildMeasureInvocation({
  cli,
  budgetPath,
  outPath,
  env,
  workload,
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
    '1',
    '--phases',
    'cold',
    '--out',
    outPath,
  ];
  if (workload) args.push('--workload', workload);
  for (const [key, value] of Object.entries(env)) args.push('--env', `${key}=${value}`);
  if (platform === 'linux') {
    args.push('--arg', '--no-sandbox');
    return { command: 'xvfb-run', args: ['-a', nodePath, ...args] };
  }
  return { command: nodePath, args };
}

/** One run with every measured launch, numbered in order, so the kit's median spans them. */
export function mergeRuns(runs) {
  return createRun({
    rounds: runs.flatMap((run, index) =>
      run.rounds.map(round => ({ ...withGpu(round), round: index + 1 }))
    ),
    ...(runs[0]?.electron_version ? { electronVersion: runs[0].electron_version } : {}),
  });
}

// A headless Linux launch can start no GPU process; that is 0 MB, not an unmeasured metric.
function withGpu(round) {
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
}

/**
 * The verdict for the merged launches. Under --require-measurement a majority
 * of launches must have measured, or the median rests on one window.
 */
export function judgeRuns(runs, budget, { rounds, requireMeasurement }) {
  const report = checkRun(mergeRuns(runs), budget, { requireMeasurement });
  const enough = runs.length >= Math.floor(rounds / 2) + 1;
  const unmeasured = !enough || report.summary.unmeasured > 0;
  return {
    report,
    passed: report.passed && (!requireMeasurement || enough),
    enough,
    unmeasured,
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

function runChild(spawnImpl, invocation, env, onError, timeoutMs = LAUNCH_TIMEOUT_MS) {
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
 * Writes the generated budget, measures each launch with its own kit run (so
 * `prepareRound` can hand every launch fresh state), and checks the merged run.
 */
export async function runBudgetGate({
  check,
  label,
  env,
  workload,
  prepareRound = async () => ({}),
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
    writeFileSync(budgetPath, JSON.stringify(budget, null, 2));
    const cli = resolveBudgetCli();
    const runs = [];
    const rejected = [];
    for (let round = 1; round <= mode.rounds; round += 1) {
      const outPath = join(workDir, `run-${round}.json`);
      const roundEnv = { ...env, ...(await prepareRound(round, workDir)) };
      const invocation = buildMeasureInvocation({
        cli,
        budgetPath,
        outPath,
        env: roundEnv,
        workload,
      });
      // A workload that measured a failure writes it here; that launch fails, it is not unmeasured.
      const rejectPath = join(workDir, `reject-${round}.txt`);
      let startError = null;
      const childEnv = { ...processEnv, PUNTOVIVO_BUDGET_REJECT_FILE: rejectPath };
      const code = await runChild(spawnImpl, invocation, childEnv, error => {
        startError = error;
      });
      if (startError) {
        output.error(`${label}: could not start the budget CLI: ${startError.message}`);
        return 2;
      }
      if (existsSync(rejectPath)) {
        rejected.push(round);
        output.error(`${label}: launch ${round} failed: ${readFileSync(rejectPath, 'utf8')}`);
      } else if (code === 0 && existsSync(outPath)) runs.push(await loadRun(outPath));
      else output.warn(`${label}: launch ${round} produced no measurement (exit ${code})`);
    }
    const verdict = judgeRuns(runs, budget, mode);
    output.log(renderCheckReport(verdict.report));
    if (!verdict.enough) {
      output[mode.requireMeasurement ? 'error' : 'warn'](
        `${label}: only ${runs.length} of ${mode.rounds} launches measured`
      );
    }
    const passed = verdict.passed && rejected.length === 0;
    const code = gateExitCode(passed, mode, verdict.unmeasured);
    if (!passed && code === 0) {
      output.warn(`${label}: WARN over budget or unmeasured; pass --strict to fail.`);
    }
    return code;
  } finally {
    // Windows can hold a fixture copy briefly after the app exits; that must not replace the verdict.
    try {
      rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      output.warn(`${label}: could not remove ${workDir}: ${error.message}`);
    }
  }
}
