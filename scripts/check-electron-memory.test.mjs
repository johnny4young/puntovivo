/**
 * The Electron budget gates hand measurement to @electron-stagewright/plugin-budget;
 * these tests pin what Puntovivo still owns: the budget translation, the CLI
 * invocation and the warn-first / strict exit codes.
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';

import { createRun, parseBudget } from '@electron-stagewright/plugin-budget';
import {
  BUDGET_PATH,
  DEFAULT_ROUNDS,
  ELECTRON_MAIN_ENTRY,
  buildKitBudget,
  buildMeasureInvocation,
  gateExitCode,
  judgeRuns,
  mergeRuns,
  resolveBudgetCli,
  resolveGateMode,
  runBudgetGate,
} from './lib/electron-budget.mjs';

const perfBudget = JSON.parse(readFileSync(BUDGET_PATH, 'utf8'));

test('the memory budget keeps working set, gates GPU and the total, and names its phase', () => {
  const budget = buildKitBudget(perfBudget, 'memory', 'win32');
  const memory = budget.memory.win32;
  const source = perfBudget.electronMemoryMb;
  assert.equal(memory.metric, 'workingSet');
  assert.equal(memory.phase, 'cold');
  assert.equal(memory.thresholdPercent, source.thresholdPercent);
  assert.deepEqual(memory.perTypeMb, {
    main: source.perProcessMb.main,
    renderer: source.perProcessMb.renderer,
    gpu: source.perProcessMb.gpu,
    utility: source.perProcessMb.utility,
  });
  assert.equal(memory.totalMb, source.perProcessMb.total);
  assert.equal(
    budget.startup.maxFirstWindowMs,
    perfBudget.operationalProfile.desktopLaunchElapsedMs
  );
  assert.equal(budget.startup.thresholdPercent, perfBudget.operationalProfile.thresholdPercent);
  assert.doesNotThrow(() => parseBudget(budget));
});

test('the main-thread budget keeps exact limits and the get-app-version IPC probe', () => {
  const budget = buildKitBudget(perfBudget, 'main-thread');
  const source = perfBudget.electronMainThread;
  assert.deepEqual(budget.mainThread, {
    thresholdPercent: 0,
    windowMs: source.windowMs,
    maxBlockedPercent: source.maxBlockedPercent,
    maxStallMs: source.maxStallMs,
  });
  assert.equal(budget.ipc.probe, 'window.electron.getAppVersion()');
  assert.equal(budget.ipc.maxP99Ms, source.maxIpcP99Ms);
  assert.equal(budget.ipc.thresholdPercent, 0);
  assert.doesNotThrow(() => parseBudget(budget));
});

test('a malformed perf-budget.json or an unknown check fails loudly', () => {
  assert.throws(() => buildKitBudget({}, 'memory'), /electronMemoryMb/);
  assert.throws(() => buildKitBudget({}, 'main-thread'), /electronMainThread/);
  assert.throws(() => buildKitBudget(perfBudget, 'gpu'), /unknown budget check/);
  assert.throws(() => buildKitBudget(perfBudget, 'memory', 'aix'), /unsupported platform/);
});

test('strict fails the build but never drops the threshold', () => {
  assert.deepEqual(resolveGateMode({ argv: [], env: {} }), {
    enforce: false,
    requireMeasurement: false,
    rounds: DEFAULT_ROUNDS,
  });
  const strict = resolveGateMode({
    argv: ['--strict', '--require-measurement'],
    env: { PUNTOVIVO_BUDGET_ROUNDS: '5' },
  });
  assert.deepEqual(strict, { enforce: true, requireMeasurement: true, rounds: 5 });
  assert.equal(gateExitCode(true, { enforce: true }), 0);
  assert.equal(gateExitCode(false, { enforce: false }), 0);
  assert.equal(gateExitCode(false, { enforce: true }), 1);
});

test('each launch is its own cold kit run with the workload and env passed through', () => {
  const invocation = buildMeasureInvocation({
    cli: '/kit/cli.js',
    budgetPath: '/tmp/budget.json',
    outPath: '/tmp/run-1.json',
    env: { PUNTOVIVO_E2E: '1' },
    workload: '/repo/workload.mjs',
    windowMs: 2000,
    platform: 'win32',
    nodePath: '/bin/node',
  });
  assert.equal(invocation.command, '/bin/node');
  assert.deepEqual(invocation.args, [
    '/kit/cli.js',
    'measure',
    '--main',
    ELECTRON_MAIN_ENTRY,
    '--budget',
    '/tmp/budget.json',
    '--rounds',
    '1',
    '--phases',
    'cold',
    '--out',
    '/tmp/run-1.json',
    '--workload',
    '/repo/workload.mjs',
    '--window-ms',
    '2000',
    '--env',
    'PUNTOVIVO_E2E=1',
  ]);
  assert.ok(!invocation.args.includes('--strict'));
});

test('Linux runs under xvfb-run without the SUID sandbox', () => {
  const invocation = buildMeasureInvocation({
    cli: '/kit/cli.js',
    budgetPath: '/b',
    outPath: '/o',
    env: {},
    platform: 'linux',
    nodePath: '/bin/node',
  });
  assert.equal(invocation.command, 'xvfb-run');
  assert.deepEqual(invocation.args.slice(0, 3), ['-a', '/bin/node', '/kit/cli.js']);
  assert.deepEqual(invocation.args.slice(-2), ['--arg', '--no-sandbox']);
});

const mainThreadBudget = buildKitBudget(perfBudget, 'main-thread');

function launch(maxStallMs) {
  return createRun({
    rounds: [
      {
        round: 1,
        phase: 'cold',
        measurement: {
          mainThread: {
            windowMs: 15000,
            blockedMs: maxStallMs,
            blockedPercent: 0.2,
            maxStallMs,
            stallsOver50Ms: maxStallMs > 50 ? 1 : 0,
            stallsOver100Ms: maxStallMs > 100 ? 1 : 0,
          },
          ipc: { count: 500, p50: 0.2, p95: 0.4, p99: 0.6, max: 2 },
        },
      },
    ],
  });
}

test('one stalled launch of three passes; a stall in two of three fails', () => {
  const merged = mergeRuns([launch(12), launch(487), launch(14)]);
  assert.deepEqual(
    merged.rounds.map(round => round.round),
    [1, 2, 3]
  );
  const options = { rounds: 3, requireMeasurement: true };
  assert.equal(
    judgeRuns([launch(12), launch(487), launch(14)], mainThreadBudget, options).passed,
    true
  );
  assert.equal(
    judgeRuns([launch(12), launch(487), launch(108.7)], mainThreadBudget, options).passed,
    false
  );
});

test('a majority of launches must measure under --require-measurement', () => {
  const options = { rounds: 3, requireMeasurement: true };
  const one = judgeRuns([launch(12)], mainThreadBudget, options);
  assert.equal(one.enough, false);
  assert.equal(one.passed, false);
  assert.equal(judgeRuns([launch(12), launch(13)], mainThreadBudget, options).passed, true);
  assert.equal(judgeRuns([], mainThreadBudget, options).report.reason, 'NO_MEASUREMENTS');
});

test('the kit CLI resolves next to its library entry', () => {
  assert.match(resolveBudgetCli(), /plugin-budget[\\/]dist[\\/]cli\.js$/);
});

/** A spawn that writes `run` to the --out path (or nothing) and exits with `exitCode`. */
function fakeSpawn(exitCode, run, calls) {
  return (command, args) => {
    calls.push({ command, args });
    const out = args[args.indexOf('--out') + 1];
    if (run) writeFileSync(out, JSON.stringify(run));
    const child = new EventEmitter();
    setImmediate(() => child.emit('exit', exitCode));
    return child;
  };
}

const quiet = { error() {}, warn() {}, log() {} };

test('launches that measure nothing fail under --require-measurement', async () => {
  const calls = [];
  const code = await runBudgetGate({
    check: 'memory',
    label: 'test',
    env: {},
    argv: ['--strict', '--require-measurement'],
    processEnv: {},
    spawnImpl: fakeSpawn(1, null, calls),
    output: quiet,
  });
  assert.equal(code, 1);
  assert.equal(calls.length, DEFAULT_ROUNDS);
});

test('every launch gets the state prepareRound hands it', async () => {
  const calls = [];
  await runBudgetGate({
    check: 'main-thread',
    label: 'test',
    env: { A: '1' },
    argv: [],
    processEnv: {},
    prepareRound: async round => ({ DATABASE_URL: `/tmp/fixture-${round}.db` }),
    spawnImpl: fakeSpawn(0, launch(12), calls),
    output: quiet,
  });
  assert.deepEqual(
    calls.map(call => call.args.filter(arg => arg.startsWith('DATABASE_URL='))),
    [
      ['DATABASE_URL=/tmp/fixture-1.db'],
      ['DATABASE_URL=/tmp/fixture-2.db'],
      ['DATABASE_URL=/tmp/fixture-3.db'],
    ]
  );
});

test('three good launches pass strict; a local over-budget run only warns', async () => {
  const strict = await runBudgetGate({
    check: 'main-thread',
    label: 'test',
    env: {},
    argv: ['--strict', '--require-measurement'],
    processEnv: {},
    spawnImpl: fakeSpawn(0, launch(12), []),
    output: quiet,
  });
  assert.equal(strict, 0);
  const warnings = [];
  const local = await runBudgetGate({
    check: 'main-thread',
    label: 'test',
    env: {},
    argv: [],
    processEnv: {},
    spawnImpl: fakeSpawn(0, launch(300), []),
    output: { ...quiet, warn: message => warnings.push(message) },
  });
  assert.equal(local, 0);
  assert.match(warnings.at(-1), /WARN over budget or unmeasured/);
});

test('a CLI that cannot start is a usage error, not a pass', async () => {
  const code = await runBudgetGate({
    check: 'memory',
    label: 'test',
    env: {},
    argv: [],
    processEnv: {},
    spawnImpl: () => {
      const child = new EventEmitter();
      setImmediate(() => child.emit('error', new Error('ENOENT')));
      return child;
    },
    output: quiet,
  });
  assert.equal(code, 2);
});
