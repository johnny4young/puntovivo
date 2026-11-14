/**
 * Electron budgets through `@electron-stagewright/plugin-budget`. perf-budget.json
 * stays the source of truth; each gate writes the kit's budget format from it,
 * runs `electron-stagewright-budget measure --check` and maps the verdict onto
 * Puntovivo's warn-first and strict modes.
 *
 * @module scripts/lib/electron-budget
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    if (typeof launch?.desktopLaunchElapsedMs !== 'number') {
      throw new Error('perf-budget.json is missing operationalProfile.desktopLaunchElapsedMs');
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
export function resolveGateMode({ argv = process.argv.slice(2), env = process.env } = {}) {
  const rounds = Number.parseInt(env.PUNTOVIVO_BUDGET_ROUNDS ?? '', 10);
  return {
    enforce: argv.includes('--strict') || env.PUNTOVIVO_MEMORY_STRICT === '1',
    requireMeasurement:
      argv.includes('--require-measurement') || env.PUNTOVIVO_MEMORY_REQUIRE_MEASUREMENT === '1',
    rounds: Number.isInteger(rounds) && rounds > 0 ? rounds : DEFAULT_ROUNDS,
  };
}

/** The package exports only its library; the CLI sits next to it in dist. */
export function resolveBudgetCli() {
  const entry = fileURLToPath(import.meta.resolve('@electron-stagewright/plugin-budget'));
  return join(dirname(entry), 'cli.js');
}

/** Command and arguments for one `measure --check` run; Linux CI needs a display and no SUID sandbox. */
export function buildMeasureInvocation({
  cli,
  budgetPath,
  outPath,
  rounds,
  env,
  workload,
  windowMs,
  requireMeasurement,
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
    '--out',
    outPath,
    '--check',
  ];
  if (requireMeasurement) args.push('--require-measurement');
  if (workload) args.push('--workload', workload);
  if (windowMs) args.push('--window-ms', String(windowMs));
  for (const [key, value] of Object.entries(env)) args.push('--env', `${key}=${value}`);
  if (platform === 'linux') {
    args.push('--arg', '--no-sandbox');
    return { command: 'xvfb-run', args: ['-a', nodePath, ...args] };
  }
  return { command: nodePath, args };
}

/** The kit exits 1 when over budget or unmeasured; warn-first mode reports and passes. */
export function gateExitCode(kitExitCode, { enforce }) {
  if (kitExitCode === 0) return 0;
  if (kitExitCode === 1 && !enforce) return 0;
  return kitExitCode ?? 1;
}

/** Writes the generated budget, runs the kit and returns Puntovivo's exit code. */
export async function runBudgetGate({
  check,
  label,
  env,
  workload,
  windowMs,
  argv = process.argv.slice(2),
  processEnv = process.env,
  spawnImpl = spawn,
  output = console,
}) {
  const mode = resolveGateMode({ argv, env: processEnv });
  const perfBudget = JSON.parse(readFileSync(BUDGET_PATH, 'utf8'));
  const workDir = mkdtempSync(join(tmpdir(), `puntovivo-budget-${check}-`));
  try {
    const budgetPath = join(workDir, 'budget.json');
    writeFileSync(budgetPath, JSON.stringify(buildKitBudget(perfBudget, check), null, 2));
    const invocation = buildMeasureInvocation({
      cli: resolveBudgetCli(),
      budgetPath,
      outPath: join(workDir, 'run.json'),
      rounds: mode.rounds,
      env,
      workload,
      windowMs,
      requireMeasurement: mode.requireMeasurement,
    });
    const code = await new Promise(resolvePromise => {
      const child = spawnImpl(invocation.command, invocation.args, {
        cwd: REPO_ROOT,
        env: processEnv,
        stdio: 'inherit',
      });
      child.once('error', error => {
        output.error(`${label}: could not start the budget CLI: ${error.message}`);
        resolvePromise(2);
      });
      child.once('exit', exitCode => resolvePromise(exitCode ?? 1));
    });
    const result = gateExitCode(code, mode);
    if (code === 1 && result === 0) {
      output.warn(`${label}: WARN over budget or unmeasured; pass --strict to fail.`);
    }
    return result;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
