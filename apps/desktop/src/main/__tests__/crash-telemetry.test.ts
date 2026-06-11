import { beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import {
  installProcessCrashHandlers,
  __resetCrashTelemetryForTests,
  type CrashTelemetryDeps,
} from '../crash-telemetry.ts';

// ENG-135b regression pins. The crash path has three invariants:
//   1. uncaughtException → structured log + telemetry capture + exit(1)
//      after the flush settles (resolve OR reject), with a hard exit
//      deadline when the flush hangs.
//   2. unhandledRejection → log + capture, NEVER exit.
//   3. install is idempotent per process.
//
// Run via `pnpm --filter @puntovivo/desktop run test` — the script
// invokes `node --test --experimental-strip-types` so the import path
// uses `.ts` and consumes the source directly.

interface RecordedCall {
  err: unknown;
  attrs: Record<string, unknown>;
}

function buildHarness(overrides: Partial<CrashTelemetryDeps> = {}) {
  const proc = new EventEmitter();
  const logged: unknown[] = [];
  const captured: RecordedCall[] = [];
  const exits: number[] = [];
  const deps: CrashTelemetryDeps = {
    log: {
      error(obj: unknown) {
        logged.push(obj);
      },
    },
    captureCrash(err: unknown, attrs: Record<string, unknown>) {
      captured.push({ err, attrs });
    },
    flushTelemetry: () => Promise.resolve(),
    exit(code: number) {
      exits.push(code);
    },
    proc: proc as unknown as Pick<NodeJS.Process, 'on'>,
    ...overrides,
  };
  return { proc, logged, captured, exits, deps };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('installProcessCrashHandlers (ENG-135b)', () => {
  beforeEach(() => {
    __resetCrashTelemetryForTests();
  });

  it('installs both handlers and reports success', () => {
    const { proc, deps } = buildHarness();
    assert.equal(installProcessCrashHandlers(deps), true);
    assert.equal(proc.listenerCount('uncaughtException'), 1);
    assert.equal(proc.listenerCount('unhandledRejection'), 1);
  });

  it('is idempotent — a second install adds nothing', () => {
    const { proc, deps } = buildHarness();
    assert.equal(installProcessCrashHandlers(deps), true);
    assert.equal(installProcessCrashHandlers(deps), false);
    assert.equal(proc.listenerCount('uncaughtException'), 1);
    assert.equal(proc.listenerCount('unhandledRejection'), 1);
  });

  it('uncaughtException: logs, captures with crash attrs, exits 1 after flush resolves', async () => {
    const { proc, logged, captured, exits, deps } = buildHarness();
    installProcessCrashHandlers(deps);

    const boom = new Error('boom');
    proc.emit('uncaughtException', boom);
    await settle();

    assert.equal(logged.length, 1);
    assert.equal(captured.length, 1);
    assert.equal(captured[0]!.err, boom);
    assert.equal(captured[0]!.attrs.source, 'electron-main');
    assert.equal(captured[0]!.attrs.kind, 'uncaughtException');
    assert.deepEqual(exits, [1]);
  });

  it('uncaughtException: still exits 1 when the flush rejects', async () => {
    const { proc, exits, deps } = buildHarness({
      flushTelemetry: () => Promise.reject(new Error('transport down')),
    });
    installProcessCrashHandlers(deps);

    proc.emit('uncaughtException', new Error('boom'));
    await settle();

    assert.deepEqual(exits, [1]);
  });

  it('uncaughtException: the exit deadline fires when the flush hangs', async () => {
    const { proc, exits, deps } = buildHarness({
      // Never settles — only the deadline can exit.
      flushTelemetry: () => new Promise(() => {}),
      exitDeadlineMs: 10,
    });
    installProcessCrashHandlers(deps);

    proc.emit('uncaughtException', new Error('boom'));
    await sleep(30);

    assert.deepEqual(exits, [1]);
  });

  it('uncaughtException: exits exactly once even when flush and deadline race', async () => {
    const { proc, exits, deps } = buildHarness({
      flushTelemetry: () => Promise.resolve(),
      exitDeadlineMs: 5,
    });
    installProcessCrashHandlers(deps);

    proc.emit('uncaughtException', new Error('boom'));
    await sleep(30);

    assert.deepEqual(exits, [1]);
  });

  it('unhandledRejection: logs and captures without exiting', async () => {
    const { proc, logged, captured, exits, deps } = buildHarness();
    installProcessCrashHandlers(deps);

    const reason = new Error('lost promise');
    proc.emit('unhandledRejection', reason);
    await settle();

    assert.equal(logged.length, 1);
    assert.equal(captured.length, 1);
    assert.equal(captured[0]!.err, reason);
    assert.equal(captured[0]!.attrs.kind, 'unhandledRejection');
    assert.deepEqual(exits, []);
  });

  it('uncaughtException: exits 1 immediately when flushTelemetry throws synchronously', async () => {
    const { proc, exits, deps } = buildHarness({
      flushTelemetry: () => {
        throw new Error('sync transport explosion');
      },
    });
    installProcessCrashHandlers(deps);

    // Must not re-throw inside the uncaughtException handler.
    proc.emit('uncaughtException', new Error('boom'));
    await settle();

    assert.deepEqual(exits, [1]);
  });

  it('handlers survive a throwing logger and a throwing capture', async () => {
    const { proc, exits, deps } = buildHarness({
      log: {
        error() {
          throw new Error('logger gone');
        },
      },
      captureCrash() {
        throw new Error('capture gone');
      },
    });
    installProcessCrashHandlers(deps);

    // Must not throw synchronously out of the handler.
    proc.emit('uncaughtException', new Error('boom'));
    proc.emit('unhandledRejection', new Error('lost'));
    await settle();

    assert.deepEqual(exits, [1]);
  });
});
