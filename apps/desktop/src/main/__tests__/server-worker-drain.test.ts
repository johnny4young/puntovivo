import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { Worker } from 'node:worker_threads';
import { startWorkerServerHost, type WorkerLike } from '../server-host/worker-host.ts';
import { createWorkerCallDrain } from '../server-host/worker-call-drain.ts';

describe('server worker direct-call drain', () => {
  it('waits for accepted operations and their replies before closing the server', async () => {
    const calls = createWorkerCallDrain();
    const events: string[] = [];
    let release!: () => void;
    const operation = new Promise<void>(resolve => {
      release = resolve;
    });

    assert.equal(
      calls.dispatch(async () => {
        await operation;
        events.push('reply');
      }),
      true
    );
    const stopping = calls.stop().then(() => events.push('close'));
    await Promise.resolve();
    assert.deepEqual(events, []);

    release();
    await stopping;
    assert.deepEqual(events, ['reply', 'close']);
  });

  it('closes admission immediately and never executes a late operation', async () => {
    const calls = createWorkerCallDrain();
    let touched = false;
    const stopping = calls.stop();
    assert.equal(
      calls.dispatch(async () => {
        touched = true;
      }),
      false
    );
    await stopping;
    assert.equal(touched, false);
  });

  it('drains every accepted operation even when another operation rejects', async () => {
    const calls = createWorkerCallDrain();
    let release!: () => void;
    let completed = false;
    calls.dispatch(async () => {
      throw new Error('failed call');
    });
    calls.dispatch(async () => {
      await new Promise<void>(resolve => {
        release = resolve;
      });
      completed = true;
    });
    const stopping = calls.stop();
    await Promise.resolve();
    assert.equal(completed, false);
    release();
    await stopping;
    assert.equal(completed, true);
    await calls.stop();
  });

  it(
    'drains an async direct call through the real worker port before closing its host',
    { timeout: 5000 },
    async t => {
      const workerUrl = new URL('../server-host/server-worker.ts', import.meta.url).href;
      const asModule = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
      // Stub only the heavyweight collaborators. The production worker entry,
      // message protocol, call drain and main-side host all run unchanged.
      const serverModule = asModule(`
      export const captureProcessCrash = () => {};
      export const createModuleLogger = () => ({ error() {} });
      export const flushServerTelemetry = async () => {};
      export const drainPasswordWork = async () => {};
    `);
      const launcherModule = asModule(`
      import { parentPort, workerData } from 'node:worker_threads';
      const closed = new Int32Array(workerData.closed);
      export function createInProcessLauncher() {
        return async () => ({
          url: 'http://127.0.0.1:9',
          close: async () => { Atomics.store(closed, 0, 1); },
          recoverOwner: async () => {
            parentPort.postMessage({ type: 'synthetic-call-started' });
            await new Promise(resolve => {
              const release = message => {
                if (message.type !== 'release-synthetic-call') return;
                parentPort.off('message', release);
                resolve();
              };
              parentPort.on('message', release);
            });
            return { ok: Atomics.load(closed, 0) === 0 };
          },
        });
      }
    `);
      const anchorModule = asModule('export const createAuditAnchorFileStore = () => undefined;');
      const bootstrap = `
      import { registerHooks } from 'node:module';
      registerHooks({
        resolve(specifier, context, nextResolve) {
          let url;
          if (specifier === '@puntovivo/server') url = ${JSON.stringify(serverModule)};
          if (context.parentURL === ${JSON.stringify(workerUrl)}) {
            if (specifier === './in-process.ts') url = ${JSON.stringify(launcherModule)};
            if (specifier === '../audit-anchor-store.ts') url = ${JSON.stringify(anchorModule)};
          }
          return url ? { url, shortCircuit: true } : nextResolve(specifier, context);
        },
      });
      await import(${JSON.stringify(workerUrl)});
    `;
      const closed = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
      const worker = new Worker(new URL(asModule(bootstrap)), {
        workerData: { closed },
        env: { NODE_ENV: 'test' },
      });
      t.after(async () => {
        await worker.terminate();
      });
      const exits: Error[] = [];
      const host = await startWorkerServerHost({
        workerPath: '/synthetic/server-worker.ts',
        start: { serverOptions: { dbPath: ':memory:' } },
        createWorker: () => worker as unknown as WorkerLike,
        onUnexpectedExit: failure => exits.push(failure.error),
        stopGraceMs: 1000,
      });
      const started = new Promise<void>(resolve => {
        const listener = (message: { type: string }) => {
          if (message.type !== 'synthetic-call-started') return;
          worker.off('message', listener);
          resolve();
        };
        worker.on('message', listener);
      });
      const recovery = host.recoverOwner({});
      // Observe a rejection immediately too, so a regression is an assertion
      // failure rather than an unhandled rejection while waiting for close.
      void recovery.catch(() => undefined);
      await started;
      const closing = host.close();
      void closing.catch(() => undefined);
      worker.postMessage({ type: 'release-synthetic-call' });
      assert.deepEqual(await recovery, { ok: true });
      await closing;
      assert.equal(Atomics.load(new Int32Array(closed), 0), 1);
      assert.deepEqual(exits, []);
    }
  );
});
