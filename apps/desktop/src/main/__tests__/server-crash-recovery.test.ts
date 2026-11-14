import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PuntovivoLogger, ServerOptions } from '@puntovivo/server';
import type { EmbeddedServerHost } from '../server-host/contract.ts';
import type { WorkerCrashEntry } from '../server-host/crash-log.ts';
import {
  createServerLifecycle,
  type EmbeddedServerState,
  type FatalWorkerExit,
} from '../server-lifecycle.ts';
import { awaitServerHost, getServerHost, readThroughRestart, setServerHost } from '../runtime.ts';
import { fakeServerWorkerTransport, until, type FakeStart } from './helpers/fake-server-worker.ts';

afterEach(() => setServerHost(null));

const quietLog = {
  info: () => {},
  error: () => {},
  warn: () => {},
} as unknown as PuntovivoLogger;

const ok = (id: number): FakeStart => ({ url: `http://127.0.0.1:${id}` });

function fakeHost(id: number): EmbeddedServerHost {
  return { url: `http://127.0.0.1:${id}`, close: async () => {} } as unknown as EmbeddedServerHost;
}

function setup(plan: FakeStart[], options: { quitting?: () => boolean } = {}) {
  const states: EmbeddedServerState[] = [];
  const fatals: FatalWorkerExit[] = [];
  const crashes: Array<Omit<WorkerCrashEntry, 'at' | 'appVersion'>> = [];
  const fake = fakeServerWorkerTransport(plan);
  let clock = 0;
  let prepares = 0;
  const lifecycle = createServerLifecycle({
    dbPath: join(tmpdir(), 'puntovivo-recovery-test.db'),
    migrationsPath: join(tmpdir(), 'migrations'),
    isDev: false,
    appVersion: '1.0.0',
    log: quietLog,
    prepareDatabaseEncryption: async () => {
      prepares += 1;
      return 'a'.repeat(64);
    },
    prepareAuditAnchorKey: async () => 'b'.repeat(64),
    getMainWindow: () => null,
    generateJwtSecret: () => 'stable-secret',
    transport: fake.transport,
    ...(options.quitting ? { isQuitting: options.quitting } : {}),
    onStateChange: state => states.push(state),
    onFatalExit: fatal => fatals.push(fatal),
    recordCrash: entry => crashes.push(entry),
    // ADR 0034's 0.5/2/8 s backoff is pinned in server-fatal-cause.test.ts.
    restartPolicy: { backoffMs: [1, 2, 3], now: () => clock },
  });
  const serverOptions = (index: number) =>
    fake.workers[index]?.payload?.serverOptions as unknown as ServerOptions | undefined;
  return {
    lifecycle,
    states,
    fatals,
    crashes,
    workers: fake.workers,
    serverOptions,
    prepares: () => prepares,
    advance: (ms: number) => (clock += ms),
  };
}

const crash = new Error('SERVER_WORKER_TEST_CRASH');

describe('embedded server crash recovery', () => {
  it('restarts with the same JWT secret and reports running again', async () => {
    const t = setup([ok(1), ok(2)]);
    setServerHost(await t.lifecycle.start());

    t.workers[0]?.crash(crash);
    await until(() => getServerHost()?.url === 'http://127.0.0.1:2');

    assert.deepEqual(t.states, ['running', 'restarting', 'running']);
    assert.equal(t.serverOptions(1)?.jwtSecret, t.serverOptions(0)?.jwtSecret);
    assert.equal(t.crashes.length, 1);
    const { uptimeMs, ...entry } = t.crashes[0]!;
    assert.ok(uptimeMs >= 0);
    assert.deepEqual(entry, {
      kind: 'uncaught',
      exitCode: 1,
      errorCode: 'SERVER_WORKER_TEST_CRASH',
      pendingCalls: 0,
      memory: null,
      restartAttempt: 1,
      outcome: 'restarted',
      fatalCause: null,
    });
    assert.equal(t.fatals.length, 0);
    await t.lifecycle.stop();
  });

  it('retries a failed restart within the backoff, then gives up after the third', async () => {
    const busy = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
    const t = setup([ok(1), { fail: busy }, { fail: busy }, { fail: busy }]);
    setServerHost(await t.lifecycle.start());

    t.workers[0]?.crash(new Error('crash'));
    await until(() => t.fatals.length > 0);

    assert.deepEqual(
      t.crashes.map(entry => [entry.outcome, entry.restartAttempt, entry.fatalCause]),
      [
        ['restart-failed', 1, null],
        ['restart-failed', 2, null],
        ['restart-failed', 3, null],
        ['fatal', 3, 'restart-loop'],
      ]
    );
    assert.equal(t.crashes[0]?.errorCode, 'EADDRINUSE');
    assert.equal(t.fatals[0]?.cause, 'restart-loop');
    assert.equal(t.states.at(-1), 'fatal');
    assert.equal(getServerHost(), null);
  });

  it('stops a crash loop: the fourth crash in ten minutes is fatal', async () => {
    const t = setup([ok(1), ok(2), ok(3), ok(4)]);
    setServerHost(await t.lifecycle.start());
    for (let index = 0; index < 3; index += 1) {
      t.workers[index]?.crash(new Error('crash'));
      await until(() => t.crashes.length === index + 1 && t.states.at(-1) === 'running');
      t.advance(60_000);
    }
    assert.equal(t.fatals.length, 0);

    t.workers[3]?.outOfMemory();
    await until(() => t.fatals.length > 0);

    assert.equal(t.fatals[0]?.cause, 'restart-loop');
    assert.equal(t.crashes.at(-1)?.kind, 'oom');
    assert.equal(t.crashes.at(-1)?.errorCode, 'ERR_WORKER_OUT_OF_MEMORY');
    assert.equal(t.workers.length, 4);
  });

  it('never restarts on database corruption or a key failure', async () => {
    for (const [error, cause] of [
      [Object.assign(new Error('malformed'), { code: 'SQLITE_CORRUPT' }), 'corruption'],
      [new Error('AUDIT_ANCHOR_DIVERGENCE'), 'key'],
    ] as const) {
      const t = setup([ok(1)]);
      setServerHost(await t.lifecycle.start());

      t.workers[0]?.crash(error);
      await until(() => t.fatals.length > 0);

      assert.equal(t.workers.length, 1, `${cause}: no second worker`);
      assert.equal(t.fatals[0]?.cause, cause);
      assert.deepEqual(
        t.crashes.map(entry => [entry.outcome, entry.restartAttempt, entry.fatalCause]),
        [['fatal', 0, cause]]
      );
    }
  });

  it('turns a restart that finds a corrupt database into a fatal exit', async () => {
    const corrupt = Object.assign(new Error('file is not a database'), { code: 'SQLITE_NOTADB' });
    const t = setup([ok(1), { fail: corrupt }]);
    setServerHost(await t.lifecycle.start());

    t.workers[0]?.crash(new Error('crash'));
    await until(() => t.fatals.length > 0);

    assert.equal(t.workers.length, 2);
    assert.equal(t.fatals[0]?.cause, 'corruption');
    assert.deepEqual(
      t.crashes.map(entry => [entry.outcome, entry.fatalCause]),
      [['restart-failed', 'corruption']]
    );
  });

  it('does not restart a worker that dies while the app quits', async () => {
    let quitting = false;
    const t = setup([ok(1), ok(2)], { quitting: () => quitting });
    setServerHost(await t.lifecycle.start());
    quitting = true;

    t.workers[0]?.crash(new Error('crash'));
    await until(() => getServerHost() === null);
    await new Promise(resolve => setTimeout(resolve, 20));

    assert.equal(t.workers.length, 1);
    assert.equal(t.fatals.length, 0);
    await t.lifecycle.stop();
  });

  it('stops a worker that a restart in flight brings up after shutdown began', async () => {
    let releaseStart!: () => void;
    const gate = new Promise<void>(resolve => (releaseStart = resolve));
    const t = setup([ok(1), { url: 'http://127.0.0.1:2', gate }]);
    setServerHost(await t.lifecycle.start());

    t.workers[0]?.crash(new Error('crash'));
    await until(() => t.workers[1]?.payload != null);
    const stopping = t.lifecycle.stop();
    releaseStart();
    await stopping;

    assert.equal(t.workers[1]?.stopped, true);
    assert.equal(getServerHost(), null);
  });

  it('counts a crash that restartAround recovers before the backoff ends', async () => {
    const t = setup([ok(1), ok(2)]);
    setServerHost(await t.lifecycle.start());

    t.workers[0]?.crash(new Error('crash'));
    await until(() => t.states.at(-1) === 'restarting');
    const result = await t.lifecycle.restartAround(async () => 'done');

    assert.equal(result, 'done');
    assert.equal(t.workers.length, 2);
    assert.equal(t.states.at(-1), 'running');
    assert.deepEqual(
      t.crashes.map(entry => entry.outcome),
      ['restarted']
    );
    await t.lifecycle.stop();
  });

  it('lets a call made during a restart wait for the next worker', async () => {
    let releaseStart!: () => void;
    const gate = new Promise<void>(resolve => (releaseStart = resolve));
    const t = setup([ok(1), { url: 'http://127.0.0.1:2', gate }]);
    const captured = await t.lifecycle.start();

    t.workers[0]?.crash(new Error('crash'));
    await until(() => t.workers[1]?.payload != null);
    const setting = captured.readAppSetting('tray_settings');
    releaseStart();

    assert.equal(await setting, null);
    await t.lifecycle.stop();
  });

  it('never starts a worker for a captured handle while restartAround holds the database', async () => {
    const t = setup([ok(1), ok(2)]);
    const captured = await t.lifecycle.start();

    let duringOperation: unknown = null;
    await t.lifecycle.restartAround(async () => {
      duringOperation = await captured.readAppSetting('tray_settings').catch(error => error);
      assert.equal(t.workers.length, 1, 'no worker may open the database mid-operation');
      assert.equal(t.prepares(), 1, 'no start payload may touch the database mid-operation');
    });

    assert.match(String((duringOperation as Error).cause), /SERVER_WORKER_HELD/);
    assert.equal(t.workers.length, 2);
    assert.equal(await captured.readAppSetting('tray_settings'), null);
    await t.lifecycle.stop();
  });

  it('keeps a recovered worker unpublished when restartAround began during its getUrl', async () => {
    let releaseUrl!: () => void;
    const urlGate = new Promise<void>(resolve => (releaseUrl = resolve));
    const t = setup([ok(1), { url: 'http://127.0.0.1:2', urlGate }, ok(3)]);
    setServerHost(await t.lifecycle.start());

    t.workers[0]?.crash(crash);
    await until(() => t.workers[1]?.calls.includes('getUrl') ?? false);
    let hostDuringOperation: unknown = 'unset';
    const operation = t.lifecycle.restartAround(async () => {
      hostDuringOperation = getServerHost();
    });
    // The stop drains the gated getUrl, so it has begun before the reply.
    await new Promise(resolve => setTimeout(resolve, 10));
    releaseUrl();
    await operation;

    assert.equal(hostDuringOperation, null);
    assert.deepEqual(t.states.slice(0, 2), ['running', 'restarting']);
    assert.ok(!t.states.slice(2, -1).includes('running'));
    await t.lifecycle.stop();
  });

  it('reports the first start failure with its own cause', async () => {
    const t = setup([{ fail: new Error('AUDIT_ANCHOR_SECRET_MISSING') }]);
    await assert.rejects(t.lifecycle.start(), /^Error: AUDIT_ANCHOR_SECRET_MISSING$/);
    assert.deepEqual(t.crashes, []);
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
