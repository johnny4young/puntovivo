import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PuntovivoLogger, ServerOptions } from '@puntovivo/server';
import type { EmbeddedServerHost } from '../server-host/contract.ts';
import type { WorkerCrashEntry } from '../server-host/crash-log.ts';
import type { WorkerExitFailure } from '../server-host/restart-policy.ts';
import {
  createServerLifecycle,
  type EmbeddedServerState,
  type FatalWorkerExit,
} from '../server-lifecycle.ts';
import { awaitServerHost, getServerHost, readThroughRestart, setServerHost } from '../runtime.ts';

afterEach(() => setServerHost(null));

const quietLog = {
  info: () => {},
  error: () => {},
  warn: () => {},
} as unknown as PuntovivoLogger;

function fakeHost(id: number): EmbeddedServerHost {
  return { url: `http://127.0.0.1:${id}`, close: async () => {} } as unknown as EmbeddedServerHost;
}

function failure(error: Error, kind: WorkerExitFailure['kind'] = 'uncaught'): WorkerExitFailure {
  return { error, kind, exitCode: 1, uptimeMs: 1_000, pendingCalls: 2 };
}

function setup(launches: Array<() => Promise<EmbeddedServerHost>>) {
  const states: EmbeddedServerState[] = [];
  const fatals: FatalWorkerExit[] = [];
  const crashes: Array<Omit<WorkerCrashEntry, 'at' | 'appVersion'>> = [];
  const sleeps: number[] = [];
  const starts: ServerOptions[] = [];
  let clock = 0;
  let launchIndex = 0;
  const lifecycle = createServerLifecycle({
    dbPath: join(tmpdir(), 'puntovivo-recovery-test.db'),
    migrationsPath: join(tmpdir(), 'migrations'),
    isDev: false,
    appVersion: '1.0.0',
    log: quietLog,
    prepareDatabaseEncryption: async () => 'a'.repeat(64),
    prepareAuditAnchorKey: async () => 'b'.repeat(64),
    getMainWindow: () => null,
    generateJwtSecret: () => 'stable-secret',
    launchHost: async options => {
      starts.push(options);
      const launch = launches[launchIndex++];
      if (!launch) throw new Error('unexpected launch');
      return launch();
    },
    onStateChange: state => states.push(state),
    onFatalExit: fatal => fatals.push(fatal),
    recordCrash: entry => crashes.push(entry),
    sleep: async ms => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
  });
  return {
    lifecycle,
    states,
    fatals,
    crashes,
    sleeps,
    starts,
    advance: (ms: number) => (clock += ms),
  };
}

describe('embedded server crash recovery', () => {
  it('restarts with the same JWT secret and reports running again', async () => {
    const t = setup([async () => fakeHost(1), async () => fakeHost(2)]);
    setServerHost(await t.lifecycle.start());

    await t.lifecycle.recoverFromUnexpectedExit(failure(new Error('SERVER_WORKER_TEST_CRASH')));

    assert.equal(getServerHost()?.url, 'http://127.0.0.1:2');
    assert.deepEqual(t.states, ['running', 'restarting', 'running']);
    assert.deepEqual(t.sleeps, [500]);
    assert.equal(t.starts[1]?.jwtSecret, t.starts[0]?.jwtSecret);
    assert.deepEqual(t.crashes, [
      {
        kind: 'uncaught',
        exitCode: 1,
        errorCode: 'SERVER_WORKER_TEST_CRASH',
        uptimeMs: 1_000,
        pendingCalls: 2,
        restartAttempt: 1,
        outcome: 'restarted',
        fatalCause: null,
      },
    ]);
    assert.equal(t.fatals.length, 0);
  });

  it('retries a failed restart within the backoff, then gives up after the third', async () => {
    const busy = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
    const t = setup([
      async () => fakeHost(1),
      async () => Promise.reject(busy),
      async () => Promise.reject(busy),
      async () => Promise.reject(busy),
    ]);
    setServerHost(await t.lifecycle.start());

    await t.lifecycle.recoverFromUnexpectedExit(failure(new Error('crash')));

    assert.deepEqual(t.sleeps, [500, 2_000, 8_000]);
    assert.deepEqual(
      t.crashes.map(entry => [entry.outcome, entry.restartAttempt, entry.fatalCause]),
      [
        ['restart-failed', 1, null],
        ['restart-failed', 2, null],
        ['restart-failed', 3, null],
        ['fatal', 3, 'restart-loop'],
      ]
    );
    assert.equal(t.fatals[0]?.cause, 'restart-loop');
    assert.equal(t.states.at(-1), 'fatal');
    assert.equal(getServerHost(), null);
  });

  it('stops a crash loop: the fourth crash in ten minutes is fatal', async () => {
    const t = setup([1, 2, 3, 4].map(id => async () => fakeHost(id)));
    setServerHost(await t.lifecycle.start());
    for (let crash = 0; crash < 3; crash += 1) {
      await t.lifecycle.recoverFromUnexpectedExit(failure(new Error('crash')));
      t.advance(60_000);
    }
    assert.equal(t.fatals.length, 0);

    await t.lifecycle.recoverFromUnexpectedExit(failure(new Error('crash'), 'oom'));

    assert.equal(t.fatals[0]?.cause, 'restart-loop');
    assert.equal(t.crashes.at(-1)?.kind, 'oom');
    assert.equal(t.starts.length, 4);
  });

  it('never restarts on database corruption or a key failure', async () => {
    for (const [error, cause] of [
      [Object.assign(new Error('malformed'), { code: 'SQLITE_CORRUPT' }), 'corruption'],
      [new Error('AUDIT_ANCHOR_DIVERGENCE'), 'key'],
    ] as const) {
      const t = setup([async () => fakeHost(1)]);
      setServerHost(await t.lifecycle.start());

      await t.lifecycle.recoverFromUnexpectedExit(failure(error));

      assert.equal(t.starts.length, 1, `${cause}: no second worker`);
      assert.deepEqual(t.sleeps, []);
      assert.equal(t.fatals[0]?.cause, cause);
      assert.equal(t.crashes[0]?.outcome, 'fatal');
    }
  });

  it('turns a restart that finds a corrupt database into a fatal exit', async () => {
    const corrupt = Object.assign(new Error('file is not a database'), { code: 'SQLITE_NOTADB' });
    const t = setup([async () => fakeHost(1), async () => Promise.reject(corrupt)]);
    setServerHost(await t.lifecycle.start());

    await t.lifecycle.recoverFromUnexpectedExit(failure(new Error('crash')));

    assert.equal(t.starts.length, 2);
    assert.equal(t.fatals[0]?.cause, 'corruption');
  });

  it('does not restart once the app is shutting down', async () => {
    const t = setup([async () => fakeHost(1)]);
    setServerHost(await t.lifecycle.start());
    await t.lifecycle.stop();

    await t.lifecycle.recoverFromUnexpectedExit(failure(new Error('crash')));

    assert.equal(t.starts.length, 1);
    assert.equal(t.fatals.length, 0);
  });

  it('never runs a crash restart and restartAround at the same time', async () => {
    let releaseOperation!: () => void;
    const operationGate = new Promise<void>(resolve => (releaseOperation = resolve));
    const t = setup([1, 2, 3].map(id => async () => fakeHost(id)));
    setServerHost(await t.lifecycle.start());

    const around = t.lifecycle.restartAround(() => operationGate);
    await Promise.resolve();
    const recovery = t.lifecycle.recoverFromUnexpectedExit(failure(new Error('crash')));
    releaseOperation();
    await Promise.all([around, recovery]);

    // restartAround brought the server back; recovery found it running.
    assert.equal(t.starts.length, 2);
    assert.equal(t.states.at(-1), 'running');
  });

  it('lets main-side callers wait through a restart instead of failing', async () => {
    setServerHost(null);
    const waiting = awaitServerHost(1_000);
    setServerHost(fakeHost(7));
    assert.equal((await waiting).url, 'http://127.0.0.1:7');

    setServerHost(null);
    await assert.rejects(awaitServerHost(10), /not available/);
  });

  it('retries a read once on the next worker when the first one died under it', async () => {
    const dead = fakeHost(1);
    setServerHost(dead);
    let calls = 0;
    const result = readThroughRestart(async host => {
      calls += 1;
      if (host === dead) {
        setServerHost(null);
        queueMicrotask(() => setServerHost(fakeHost(2)));
        throw new Error('ERR_WORKER_OUT_OF_MEMORY');
      }
      return host.url;
    });
    assert.equal(await result, 'http://127.0.0.1:2');
    assert.equal(calls, 2);

    setServerHost(fakeHost(3));
    await assert.rejects(
      readThroughRestart(async () => {
        throw new Error('real failure');
      }),
      /real failure/
    );
  });
});
