#!/usr/bin/env node
/**
 * ENG-133b — Electron main + renderer memory CI gate.
 *
 * Launches the built Electron app in measurement mode
 * (`PUNTOVIVO_MEASURE_MEMORY=1`), reads each Electron process'
 * working-set via `app.getAppMetrics()` (printed by the main process as a
 * single `PUNTOVIVO_MEMORY_METRICS=<json>` line), summarises the main +
 * renderer footprint in MB, and compares it against the budget declared in
 * the repo's `perf-budget.json`.
 *
 * Phase 1 is intentionally WARN-FIRST (operator instruction): the report is
 * always printed, but the gate never fails the build unless `--strict`
 * (or `PUNTOVIVO_MEMORY_STRICT=1`) is set. It also SELF-SKIPS — printing a
 * warning and exiting 0 — when Electron cannot be launched (the
 * `.vite/build` main bundle is missing, the electron binary is absent, the
 * launch errors, or no metrics line comes back). That keeps `ci:desktop`
 * green on ubuntu, where launching Electron headlessly needs xvfb + the
 * desktop build step that the CI job does not run today.
 *
 * The pure helpers (`summarizeProcesses`, `compareToMemoryBudget`,
 * `renderReport`, `parseMetricsLine`) are exported and unit-tested by
 * `scripts/check-electron-memory.test.mjs` without launching Electron.
 *
 * Exit codes:
 *   0 — measured within budget+threshold, OR warn-first over-ceiling, OR
 *       self-skipped because Electron could not be launched.
 *   1 — `--strict` and a process overshot budget, OR perf-budget.json is
 *       malformed.
 *
 * @module scripts/check-electron-memory
 */

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_PATH = join(REPO_ROOT, 'perf-budget.json');
const ELECTRON_MAIN_ENTRY = join(REPO_ROOT, 'apps', 'desktop', '.vite', 'build', 'index.cjs');
const DESKTOP_PACKAGE_JSON = join(REPO_ROOT, 'apps', 'desktop', 'package.json');
const ENSURE_NATIVE_RUNTIME_SCRIPT = join(REPO_ROOT, 'scripts', 'ensure-native-runtime.mjs');
/** Throwaway 64-char hex DB key — mirrors the e2e harness. */
const MEASURE_DB_KEY = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
/**
 * Hard ceiling on the launch. The app self-quits ~2 s after the renderer
 * loads, so a real measure returns in well under this. The timeout only bites
 * when the renderer cannot load (e.g. the gate is run without a dev-web server)
 * — the spawn is killed and the gate self-skips warn-first.
 */
const LAUNCH_TIMEOUT_MS = 60_000;

/**
 * Map `app.getAppMetrics()` rows to a `{ mainMb, rendererMb }` summary.
 * `metrics` is the parsed array of `{ type, workingSetKb }`. Electron tags
 * the main process `Browser` and each renderer `Tab`; GPU / Utility / plugin
 * processes are intentionally excluded from the main+renderer ceiling.
 * Multiple renderers (rare here — single window) are summed.
 */
export function summarizeProcesses(metrics) {
  let mainKb = 0;
  let rendererKb = 0;
  for (const m of metrics) {
    if (m.type === 'Browser') mainKb += m.workingSetKb;
    else if (m.type === 'Tab') rendererKb += m.workingSetKb;
  }
  const toMb = kb => Math.round((kb / 1024) * 10) / 10;
  return { main: toMb(mainKb), renderer: toMb(rendererKb) };
}

/**
 * Compare the measured `{ main, renderer }` MB against the budget. Mirrors
 * `check-bundle-size.mjs::compareToBudget`: a process over
 * `budget * (1 + thresholdPercent/100)` is a regression; a budget key with
 * no measurement is `missing`.
 */
export function compareToMemoryBudget({ measured, budget, thresholdPercent }) {
  const result = { regressions: [], ok: [], missing: [] };
  for (const name of Object.keys(budget)) {
    const actual = measured[name];
    if (actual === undefined || actual === null) {
      result.missing.push({ name, budget: budget[name] });
      continue;
    }
    const ceiling = budget[name] * (1 + thresholdPercent / 100);
    const deltaPercent = ((actual - budget[name]) / budget[name]) * 100;
    const row = { name, budget: budget[name], actual, deltaPercent };
    if (actual > ceiling) result.regressions.push(row);
    else result.ok.push(row);
  }
  return result;
}

/** Render the comparison as a markdown table for the CI log. */
export function renderReport({ regressions, ok, missing }, threshold) {
  const lines = [];
  if (regressions.length > 0) {
    lines.push(`Electron memory over ${threshold}% threshold (warn-first unless --strict):`);
    lines.push('| process | budget (MB) | actual (MB) | delta % |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const r of regressions) {
      lines.push(`| ${r.name} | ${r.budget} | ${r.actual.toFixed(1)} | +${r.deltaPercent.toFixed(1)}% |`);
    }
  }
  if (missing.length > 0) {
    if (lines.length) lines.push('');
    lines.push('Budget entries with no measured process (warning):');
    for (const m of missing) lines.push(`  - ${m.name}  (budget ${m.budget} MB)`);
  }
  if (regressions.length === 0 && ok.length > 0) {
    lines.push('Electron memory PASS — main + renderer within budget:');
    lines.push('| process | budget (MB) | actual (MB) | delta % |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const o of ok) {
      const sign = o.deltaPercent >= 0 ? '+' : '';
      lines.push(`| ${o.name} | ${o.budget} | ${o.actual.toFixed(1)} | ${sign}${o.deltaPercent.toFixed(1)}% |`);
    }
  }
  return lines.join('\n');
}

/**
 * Extract the `PUNTOVIVO_MEMORY_METRICS=<json>` line the main process prints.
 * Returns the parsed metrics array, or `null` if the line is absent or the
 * JSON is malformed (so the caller can self-skip warn-first).
 */
export function parseMetricsLine(stdout) {
  const match = /^PUNTOVIVO_MEMORY_METRICS=(.+)$/m.exec(stdout ?? '');
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Prepare better-sqlite3 for the runtime about to load it. The Electron app
 * imports the embedded server in-process, so the measurement launch needs the
 * Electron ABI active; restore Node afterwards so the checkout remains ready
 * for server tests.
 */
function ensureNativeRuntime(runtime, { warnPrefix = 'WARN skipped' } = {}) {
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

  const details = [
    run.error?.message,
    run.stderr?.trim(),
    run.stdout?.trim(),
  ].filter(Boolean).join('\n');
  console.warn(
    `check-electron-memory: ${warnPrefix} — unable to prepare ${runtime} native runtime${details ? `:\n${details}` : ''}`
  );
  return false;
}

/**
 * Launch the built Electron app in measurement mode and return the
 * summarised `{ main, renderer }` MB, or `null` if the launch is infeasible
 * (missing bundle / binary / launch error / no metrics line). On Linux the
 * electron binary is wrapped in `xvfb-run -a` so it can boot headlessly.
 */
export function launchAndMeasure() {
  if (!existsSync(ELECTRON_MAIN_ENTRY)) {
    console.warn(`check-electron-memory: WARN skipped — main bundle not built (${ELECTRON_MAIN_ENTRY}). Run "pnpm --filter @puntovivo/desktop run build:main".`);
    return null;
  }
  let electronBin;
  try {
    electronBin = createRequire(DESKTOP_PACKAGE_JSON)('electron');
  } catch (err) {
    console.warn(`check-electron-memory: WARN skipped — electron binary not resolvable: ${err.message}`);
    return null;
  }
  if (!ensureNativeRuntime('electron')) {
    return null;
  }
  const userDataDir = mkdtempSync(join(tmpdir(), 'puntovivo-mem-'));
  const electronArgs = [ELECTRON_MAIN_ENTRY, `--user-data-dir=${userDataDir}`];
  const isLinux = process.platform === 'linux';
  const command = isLinux ? 'xvfb-run' : electronBin;
  const args = isLinux ? ['-a', electronBin, ...electronArgs] : electronArgs;

  let run;
  try {
    run = spawnSync(command, args, {
      cwd: REPO_ROOT,
      timeout: LAUNCH_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      encoding: 'utf8',
      env: {
        ...process.env,
        PUNTOVIVO_MEASURE_MEMORY: '1',
        PUNTOVIVO_E2E: '1',
        PUNTOVIVO_DB_KEY: MEASURE_DB_KEY,
        ELECTRON_ENABLE_LOGGING: '1',
      },
    });
  } finally {
    ensureNativeRuntime('node', { warnPrefix: 'WARN' });
  }

  // spawnSync is synchronous — the child has exited (or been killed on timeout)
  // by now, so the throwaway profile dir is safe to remove. Best-effort.
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    /* leave the temp dir for the OS to reap if removal races a slow exit */
  }

  const metrics = parseMetricsLine(run.stdout);
  if (metrics) {
    return summarizeProcesses(metrics);
  }
  if (/^PUNTOVIVO_MEMORY_SKIP=/m.test(run.stdout ?? '')) {
    console.warn('check-electron-memory: WARN skipped — the renderer did not load the app (run with dev:web up so the measurement reflects the real renderer, not the Chromium error page).');
    return null;
  }
  if (run.error) {
    console.warn(`check-electron-memory: WARN skipped — launch failed: ${run.error.message}`);
    return null;
  }
  console.warn('check-electron-memory: WARN skipped — no PUNTOVIVO_MEMORY_METRICS line captured (the app did not reach a measurable state).');
  return null;
}

/**
 * CLI entry. Reads `perf-budget.json::electronMemoryMb`, launches + measures,
 * compares, prints the report. Warn-first by default; `--strict` /
 * `PUNTOVIVO_MEMORY_STRICT=1` makes an over-ceiling process exit 1.
 */
export function runCli({ measure = launchAndMeasure, strict } = {}) {
  const enforce = strict ?? (process.argv.includes('--strict') || process.env.PUNTOVIVO_MEMORY_STRICT === '1');
  let budgetFile;
  try {
    budgetFile = JSON.parse(readFileSync(BUDGET_PATH, 'utf8'));
  } catch (err) {
    console.error(`check-electron-memory: cannot read budget file at ${BUDGET_PATH}: ${err.message}`);
    return 1;
  }
  const budget = budgetFile?.electronMemoryMb?.perProcessMb;
  const thresholdPercent = budgetFile?.electronMemoryMb?.thresholdPercent;
  if (!budget || typeof thresholdPercent !== 'number') {
    console.error('check-electron-memory: perf-budget.json is missing electronMemoryMb.perProcessMb or electronMemoryMb.thresholdPercent');
    return 1;
  }

  const measured = measure();
  if (!measured) {
    // Self-skip: the warning was already printed by launchAndMeasure.
    return 0;
  }

  const result = compareToMemoryBudget({ measured, budget, thresholdPercent });
  const report = renderReport(result, thresholdPercent);
  console.log(report);

  if (result.regressions.length > 0 && enforce) {
    console.error('check-electron-memory: FAIL (--strict) — a process overshot its memory budget.');
    return 1;
  }
  if (result.regressions.length > 0) {
    console.warn('check-electron-memory: WARN — over the memory ceiling (warn-first; pass --strict to enforce).');
  }
  return 0;
}

// Direct invocation guard — when imported by the test suite the CLI must NOT
// execute.
const isDirectInvocation =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectInvocation) {
  process.exit(runCli());
}
