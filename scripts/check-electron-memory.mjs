#!/usr/bin/env node
/**
 * Electron memory and launch gate: budget config for
 * `@electron-stagewright/plugin-budget`.
 *
 * Launches the built app three times on empty profiles, waits for the React
 * root to mount, and gates the median app.getAppMetrics() working set per
 * process type (GPU included) and the total against
 * `perf-budget.json::electronMemoryMb`, plus process start to first window
 * against `operationalProfile.desktopLaunchElapsedMs`. Run it through
 * `run-electron-memory-gate.mjs`, which serves the renderer.
 *
 * Warn-first locally; `--strict` fails an over-budget value and
 * `--require-measurement` fails a missing one.
 *
 * @module scripts/check-electron-memory
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ELECTRON_MAIN_ENTRY, REPO_ROOT, runBudgetGate } from './lib/electron-budget.mjs';

const ENSURE_NATIVE_RUNTIME_SCRIPT = join(REPO_ROOT, 'scripts', 'ensure-native-runtime.mjs');
const MOUNTED_WORKLOAD = join(REPO_ROOT, 'scripts', 'electron-budget-mounted-workload.mjs');
// The ceilings were captured a moment after mount, not under load.
const IDLE_WINDOW_MS = 2_000;
const MEASURE_DB_KEY = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

/**
 * Verify that the bundled Node-API SQLite addon loads in the runtime about to
 * execute it.
 */
export function ensureNativeRuntime(
  runtime,
  { warnPrefix = 'WARN skipped', label = 'check-electron-memory' } = {}
) {
  const run = spawnSync(process.execPath, [ENSURE_NATIVE_RUNTIME_SCRIPT, runtime], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: process.env,
    timeout: 120_000,
    killSignal: 'SIGKILL',
  });

  if (run.status === 0) {
    return true;
  }

  const details = [run.error?.message, run.stderr?.trim(), run.stdout?.trim()]
    .filter(Boolean)
    .join('\n');
  console.warn(
    `${label}: ${warnPrefix} — unable to prepare ${runtime} native runtime${details ? `:\n${details}` : ''}`
  );
  return false;
}

export async function runCli({ argv = process.argv.slice(2), env = process.env } = {}) {
  if (!existsSync(ELECTRON_MAIN_ENTRY)) {
    console.error(
      `check-electron-memory: main bundle not built (${ELECTRON_MAIN_ENTRY}). Run "pnpm --filter @puntovivo/desktop run build:main".`
    );
    return 1;
  }
  if (!ensureNativeRuntime('electron')) return 1;
  return runBudgetGate({
    check: 'memory',
    label: 'check-electron-memory',
    argv,
    processEnv: env,
    workload: MOUNTED_WORKLOAD,
    windowMs: IDLE_WINDOW_MS,
    env: { PUNTOVIVO_E2E: '1', PUNTOVIVO_DB_KEY: MEASURE_DB_KEY, PUNTOVIVO_LOG_LEVEL: 'warn' },
  });
}

const isDirectInvocation =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectInvocation) {
  process.exit(await runCli());
}
