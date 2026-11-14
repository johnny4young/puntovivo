/**
 * The Electron budget gates hand measurement to @electron-stagewright/plugin-budget;
 * these tests pin what Puntovivo still owns: the budget translation, the CLI
 * invocation and the warn-first / strict exit codes.
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { parseBudget } from '@electron-stagewright/plugin-budget';
import {
  BUDGET_PATH,
  DEFAULT_ROUNDS,
  ELECTRON_MAIN_ENTRY,
  buildKitBudget,
  buildMeasureInvocation,
  gateExitCode,
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
  const invocation = buildMeasureInvocation({
    cli: '/kit/cli.js',
    budgetPath: '/tmp/budget.json',
    outPath: '/tmp/run.json',
    rounds: 3,
    env: {},
    requireMeasurement: true,
    platform: 'darwin',
    nodePath: '/bin/node',
  });
  assert.ok(!invocation.args.includes('--strict'));
  assert.ok(invocation.args.includes('--require-measurement'));
});

test('the invocation measures three cold rounds and passes the workload and env through', () => {
  const invocation = buildMeasureInvocation({
    cli: '/kit/cli.js',
    budgetPath: '/tmp/budget.json',
    outPath: '/tmp/run.json',
    rounds: 3,
    env: { PUNTOVIVO_E2E: '1' },
    workload: '/repo/workload.mjs',
    windowMs: 2000,
    requireMeasurement: false,
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
    '3',
    '--phases',
    'cold',
    '--out',
    '/tmp/run.json',
    '--check',
    '--workload',
    '/repo/workload.mjs',
    '--window-ms',
    '2000',
    '--env',
    'PUNTOVIVO_E2E=1',
  ]);
});

test('Linux runs under xvfb-run without the SUID sandbox', () => {
  const invocation = buildMeasureInvocation({
    cli: '/kit/cli.js',
    budgetPath: '/b',
    outPath: '/o',
    rounds: 1,
    env: {},
    platform: 'linux',
    nodePath: '/bin/node',
  });
  assert.equal(invocation.command, 'xvfb-run');
  assert.deepEqual(invocation.args.slice(0, 3), ['-a', '/bin/node', '/kit/cli.js']);
  assert.deepEqual(invocation.args.slice(-2), ['--arg', '--no-sandbox']);
});

test('warn-first passes an over-budget run; strict and usage errors fail', () => {
  assert.equal(gateExitCode(0, { enforce: true }), 0);
  assert.equal(gateExitCode(1, { enforce: false }), 0);
  assert.equal(gateExitCode(1, { enforce: true }), 1);
  assert.equal(gateExitCode(2, { enforce: false }), 2);
  assert.equal(gateExitCode(null, { enforce: false }), 1);
});

test('the kit CLI resolves next to its library entry', () => {
  assert.match(resolveBudgetCli(), /plugin-budget[\\/]dist[\\/]cli\.js$/);
});

function fakeSpawn(exitCode, calls) {
  return (command, args) => {
    calls.push({ command, args });
    const child = new EventEmitter();
    setImmediate(() => child.emit('exit', exitCode));
    return child;
  };
}

const quiet = { error() {}, warn() {}, log() {} };

test('a run the kit could not measure fails under --require-measurement', async () => {
  const calls = [];
  const code = await runBudgetGate({
    check: 'memory',
    label: 'test',
    env: {},
    argv: ['--strict', '--require-measurement'],
    processEnv: {},
    spawnImpl: fakeSpawn(1, calls),
    output: quiet,
  });
  assert.equal(code, 1);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes('--require-measurement'));
});

test('a local run reports an over-budget result without failing', async () => {
  const warnings = [];
  const code = await runBudgetGate({
    check: 'main-thread',
    label: 'test',
    env: {},
    argv: [],
    processEnv: {},
    spawnImpl: fakeSpawn(1, []),
    output: { ...quiet, warn: message => warnings.push(message) },
  });
  assert.equal(code, 0);
  assert.match(warnings[0], /WARN over budget or unmeasured/);
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
