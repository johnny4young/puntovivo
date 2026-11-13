import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import type { MainToWorkerMessage, WorkerToMainMessage } from '../server-host/protocol.ts';
import type { WorkerExitFailure } from '../server-host/restart-policy.ts';
import { startWorkerServerHost, type WorkerLike } from '../server-host/worker-host.ts';

/** Scriptable stand-in for a worker thread. */
class FakeWorker extends EventEmitter {
  readonly sent: MainToWorkerMessage[] = [];
  terminated = 0;
  private readonly reply: (message: MainToWorkerMessage, worker: FakeWorker) => void;
  constructor(reply: (message: MainToWorkerMessage, worker: FakeWorker) => void) {
    super();
    this.reply = reply;
  }
  postMessage(message: MainToWorkerMessage): void {
    this.sent.push(message);
    queueMicrotask(() => this.reply(message, this));
  }
  send(message: WorkerToMainMessage): void {
    this.emit('message', message);
  }
  exit(code: number): void {
    this.emit('exit', code);
  }
  async terminate(): Promise<number> {
    this.terminated += 1;
    queueMicrotask(() => this.exit(1));
    return 1;
  }
}

function healthyWorker(message: MainToWorkerMessage, worker: FakeWorker): void {
  if (message.type === 'start') worker.send({ type: 'started', url: 'http://127.0.0.1:9' });
  if (message.type === 'call') {
    if (message.op === 'readAppSetting') {
      worker.send({ type: 'result', id: message.id, ok: true, value: { echo: message.args[0] } });
    } else {
      worker.send({
        type: 'result',
        id: message.id,
        ok: false,
        error: { name: 'Error', message: 'denied', code: 'MAIN_AUDIT_EVENT_REJECTED' },
      });
    }
  }
  if (message.type === 'stop') {
    worker.send({ type: 'stopped' });
    queueMicrotask(() => worker.exit(0));
  }
}

function start(worker: FakeWorker, overrides: { stopGraceMs?: number } = {}) {
  const exits: Error[] = [];
  const host = startWorkerServerHost({
    workerPath: '/virtual/server-worker.cjs',
    start: { serverOptions: { dbPath: ':memory:' } },
    onUnexpectedExit: failure => exits.push(failure.error),
    createWorker: () => worker as unknown as WorkerLike,
    ...overrides,
  });
  return { host, exits };
}

describe('server worker host', () => {
  it('starts, forwards calls by id and keeps error codes', async () => {
    const worker = new FakeWorker(healthyWorker);
    const { host: pending, exits } = start(worker);
    const host = await pending;
    assert.equal(host.url, 'http://127.0.0.1:9');
    assert.deepEqual(worker.sent[0], {
      type: 'start',
      options: { serverOptions: { dbPath: ':memory:' } },
    });

    const [first, second] = await Promise.all([
      host.readAppSetting('theme_preference'),
      host.readAppSetting('tray_settings'),
    ]);
    assert.deepEqual([first, second], [{ echo: 'theme_preference' }, { echo: 'tray_settings' }]);
    await assert.rejects(
      host.recordAudit({} as never),
      (error: Error & { code?: string }) => error.code === 'MAIN_AUDIT_EVENT_REJECTED'
    );

    await host.close();
    assert.equal(worker.sent.at(-1)?.type, 'stop');
    assert.equal(worker.terminated, 0);
    assert.deepEqual(exits, []);
  });

  it('turns a failed start into a rejection and stops the worker', async () => {
    const worker = new FakeWorker((message, self) => {
      if (message.type === 'start') {
        self.send({ type: 'start-failed', error: { name: 'Error', message: 'SQLITE_NOTADB' } });
      }
      if (message.type === 'stop') queueMicrotask(() => self.exit(0));
    });
    const { host, exits } = start(worker);
    await assert.rejects(host, /SQLITE_NOTADB/);
    assert.equal(worker.sent.at(-1)?.type, 'stop');
    assert.deepEqual(exits, []);
  });

  it('treats a worker that dies before listening as a failed start, not a crash', async () => {
    const worker = new FakeWorker((message, self) => {
      if (message.type === 'start') {
        self.emit('error', new Error('native addon failed to load'));
        self.exit(1);
      }
    });
    const { host, exits } = start(worker);
    await assert.rejects(host, /native addon failed to load/);
    assert.deepEqual(exits, []);
  });

  it('reports an exit outside close once and rejects calls in flight', async () => {
    const worker = new FakeWorker((message, self) => {
      if (message.type === 'start') self.send({ type: 'started', url: 'http://127.0.0.1:9' });
      // Calls never answer: the worker crashes first.
    });
    const { host: pending, exits } = start(worker);
    const host = await pending;
    const inFlight = host.readAppSetting('theme_preference');
    worker.emit('error', new Error('uncaught in worker'));
    worker.exit(1);
    await assert.rejects(inFlight, /uncaught in worker/);
    assert.equal(exits.length, 1);
    assert.match(exits[0]!.message, /uncaught in worker/);
    await assert.rejects(host.readAppSetting('tray_settings'), /not available/);
    await host.close();
    assert.equal(exits.length, 1);
  });

  it('fails close when the server could not close, after the thread exits', async () => {
    const worker = new FakeWorker((message, self) => {
      if (message.type === 'start') self.send({ type: 'started', url: 'http://127.0.0.1:9' });
      if (message.type === 'stop') {
        self.send({ type: 'stopped', error: { name: 'Error', message: 'SQLITE_BUSY on close' } });
        queueMicrotask(() => self.exit(0));
      }
    });
    const { host: pending, exits } = start(worker);
    const host = await pending;
    await assert.rejects(host.close(), /SQLITE_BUSY on close/);
    assert.deepEqual(exits, []);
  });

  it('rejects a call whose arguments cannot be cloned and keeps serving others', async () => {
    const worker = new FakeWorker(healthyWorker);
    const { host: pending } = start(worker);
    const host = await pending;
    const original = worker.postMessage.bind(worker);
    worker.postMessage = message => {
      if (message.type === 'call' && message.op === 'writeAppSetting') {
        throw new DOMException('could not be cloned', 'DataCloneError');
      }
      original(message);
    };
    await assert.rejects(
      host.writeAppSetting('tray_settings', () => {}),
      /could not be cloned/
    );
    assert.deepEqual(await host.readAppSetting('tray_settings'), { echo: 'tray_settings' });
    await host.close();
  });

  it('terminates a worker that does not exit within the grace period and fails the stop', async () => {
    const worker = new FakeWorker((message, self) => {
      if (message.type === 'start') self.send({ type: 'started', url: 'http://127.0.0.1:9' });
      // Ignores stop.
    });
    const { host: pending, exits } = start(worker, { stopGraceMs: 10 });
    const host = await pending;
    await assert.rejects(host.close(), /SERVER_WORKER_STOP_TIMEOUT/);
    assert.equal(worker.terminated, 1);
    assert.deepEqual(exits, []);
  });

  it('fails the stop when the worker exits without reporting a closed server', async () => {
    const worker = new FakeWorker((message, self) => {
      if (message.type === 'start') self.send({ type: 'started', url: 'http://127.0.0.1:9' });
      // Crashes while closing: no stopped reply.
      if (message.type === 'stop') queueMicrotask(() => self.exit(1));
    });
    const { host: pending, exits } = start(worker);
    const host = await pending;
    await assert.rejects(host.close(), /SERVER_WORKER_STOP_INCOMPLETE/);
    await assert.rejects(host.close(), /SERVER_WORKER_STOP_INCOMPLETE/);
    assert.deepEqual(exits, []);
  });

  it('treats a worker that exits right after it started as a failed start', async () => {
    const worker = new FakeWorker((message, self) => {
      if (message.type === 'start') {
        self.send({ type: 'started', url: 'http://127.0.0.1:9' });
        self.exit(1);
      }
    });
    const { host, exits } = start(worker);
    await assert.rejects(host, /SERVER_WORKER_EXITED/);
    assert.deepEqual(exits, []);
  });

  it('rejects new calls as soon as close starts without sending them to the worker', async () => {
    const worker = new FakeWorker((message, self) => {
      if (message.type === 'start') self.send({ type: 'started', url: 'http://127.0.0.1:9' });
    });
    const { host: pending } = start(worker);
    const host = await pending;
    const closing = host.close();
    await assert.rejects(host.readAppSetting('tray_settings'), /not available/);
    assert.equal(worker.sent.filter(message => message.type === 'call').length, 0);
    worker.send({ type: 'stopped' });
    worker.exit(0);
    await closing;
  });

  it('sends one stop when close is called twice', async () => {
    const worker = new FakeWorker(healthyWorker);
    const { host: pending } = start(worker);
    const host = await pending;
    await Promise.all([host.close(), host.close()]);
    assert.equal(worker.sent.filter(message => message.type === 'stop').length, 1);
  });

  it('reports an uncaught crash with its code, uptime and the calls it dropped', async () => {
    let clock = 1_000;
    const worker = new FakeWorker((message, self) => {
      if (message.type === 'start') self.send({ type: 'started', url: 'http://127.0.0.1:9' });
    });
    const failures: WorkerExitFailure[] = [];
    const host = await startWorkerServerHost({
      workerPath: '/virtual/server-worker.cjs',
      start: { serverOptions: {} },
      onUnexpectedExit: failure => failures.push(failure),
      createWorker: () => worker as unknown as WorkerLike,
      now: () => clock,
    });
    const dropped = host.readAppSetting('tray_settings');
    clock = 4_000;
    worker.send({ type: 'crashed', error: { name: 'Error', message: 'SERVER_WORKER_TEST_CRASH' } });
    worker.exit(1);
    await assert.rejects(dropped, /SERVER_WORKER_TEST_CRASH/);
    assert.equal(failures.length, 1);
    assert.equal(failures[0]?.kind, 'uncaught');
    assert.equal(failures[0]?.uptimeMs, 3_000);
    assert.equal(failures[0]?.pendingCalls, 1);
    assert.equal(failures[0]?.exitCode, 1);
  });

  it('classifies a worker heap limit exit as out of memory', async () => {
    const worker = new FakeWorker((message, self) => {
      if (message.type === 'start') self.send({ type: 'started', url: 'http://127.0.0.1:9' });
    });
    const failures: WorkerExitFailure[] = [];
    await startWorkerServerHost({
      workerPath: '/virtual/server-worker.cjs',
      start: { serverOptions: {} },
      onUnexpectedExit: failure => failures.push(failure),
      createWorker: () => worker as unknown as WorkerLike,
    });
    const oom = Object.assign(new Error('Worker terminated due to reaching memory limit'), {
      code: 'ERR_WORKER_OUT_OF_MEMORY',
    });
    worker.emit('error', oom);
    worker.exit(1);
    assert.equal(failures[0]?.kind, 'oom');
    assert.equal(
      (failures[0]?.error as { code?: string } | undefined)?.code,
      'ERR_WORKER_OUT_OF_MEMORY'
    );
  });

  it('exposes the test crash only when allowed', async () => {
    const worker = new FakeWorker(healthyWorker);
    const plain = await start(worker).host;
    assert.equal(plain.simulateCrash, undefined);
    const crashable = await startWorkerServerHost({
      workerPath: '/virtual/server-worker.cjs',
      start: { serverOptions: {} },
      onUnexpectedExit: () => {},
      createWorker: () => new FakeWorker(healthyWorker) as unknown as WorkerLike,
      allowTestCrash: true,
    });
    assert.equal(typeof crashable.simulateCrash, 'function');
  });
});
