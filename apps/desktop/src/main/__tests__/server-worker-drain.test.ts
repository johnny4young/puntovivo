import { describe, it, type TestContext } from 'node:test';
import { strict as assert } from 'node:assert';
import { Worker } from 'node:worker_threads';
import type { HostExit } from '@electron-stagewright/host-supervisor';
import { workerThreadTransport } from '@electron-stagewright/host-supervisor/worker';
import {
  connectServerWorker,
  createServerWorkerHost,
  SERVER_WORKER_STOP_GRACE_MS,
} from '../server-host/worker-host.ts';

const asModule = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

/**
 * Runs the production worker entry with only its heavyweight collaborators
 * stubbed: the supervisor, its protocol and the crash handler run unchanged.
 */
function syntheticWorker(t: TestContext, env: Record<string, string> = {}) {
  const workerUrl = new URL('../server-host/server-worker.ts', import.meta.url).href;
  const serverModule = asModule(`
    import { parentPort } from 'node:worker_threads';
    export const captureProcessCrash = () => {};
    export const createModuleLogger = () => ({ error() {} });
    export const flushServerTelemetry = async () => {};
    // Settles when main says so, like an Argon2 hash still running.
    export const drainPasswordWork = () => new Promise(resolve => {
      parentPort.postMessage({ type: 'synthetic-drain-started' });
      const release = message => {
        if (message.type !== 'release-synthetic-drain') return;
        parentPort.off('message', release);
        resolve();
      };
      parentPort.on('message', release);
    });
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
    env: { NODE_ENV: 'test', ...env },
  });
  t.after(async () => {
    await worker.terminate();
  });
  const exits: HostExit[] = [];
  const supervisor = createServerWorkerHost({
    transport: workerThreadTransport({
      entry: '/synthetic/server-worker.ts',
      createWorker: () => worker,
    }),
    payload: async () => ({ serverOptions: { dbPath: ':memory:' } }),
    onExit: exit => {
      exits.push(exit);
      return 'fatal';
    },
    stopGraceMs: 1000,
  });
  const nextMessage = (type: string) =>
    new Promise<void>(resolve => {
      const listener = (message: { type: string }) => {
        if (message.type !== type) return;
        worker.off('message', listener);
        resolve();
      };
      worker.on('message', listener);
    });
  return { worker, supervisor, exits, closed, nextMessage };
}

describe('server worker drain', () => {
  it('waits past the 60 s fiscal adapter timeout before terminating a closing worker', () => {
    assert.equal(SERVER_WORKER_STOP_GRACE_MS, 90_000);
  });

  it(
    'drains an async direct call through the real worker port before closing its host',
    { timeout: 5000 },
    async t => {
      const { worker, supervisor, exits, closed, nextMessage } = syntheticWorker(t);
      const host = await connectServerWorker(supervisor);
      const started = nextMessage('synthetic-call-started');
      const recovery = host.recoverOwner({});
      // Observe a rejection immediately too, so a regression is an assertion
      // failure rather than an unhandled rejection while waiting for close.
      void recovery.catch(() => undefined);
      await started;
      const closing = host.close();
      void closing.catch(() => undefined);
      // The server must still be open while the accepted call runs.
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(Atomics.load(new Int32Array(closed), 0), 0);
      worker.postMessage({ type: 'release-synthetic-call' });
      assert.deepEqual(await recovery, { ok: true });
      await closing;
      assert.equal(Atomics.load(new Int32Array(closed), 0), 1);
      assert.deepEqual(exits, []);
    }
  );

  it(
    'keeps a crashing worker alive until running password hashes settle',
    { timeout: 5000 },
    async t => {
      const { worker, supervisor, exits, nextMessage } = syntheticWorker(t, {
        PUNTOVIVO_E2E: '1',
      });
      const host = await connectServerWorker(supervisor, { allowTestCrash: true });
      const draining = nextMessage('synthetic-drain-started');
      host.simulateCrash?.();
      await draining;
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.deepEqual(exits, [], 'the thread must not exit under a running hash');
      worker.postMessage({ type: 'release-synthetic-drain' });
      while (exits.length === 0) await new Promise(resolve => setTimeout(resolve, 10));
      const [exit] = exits as HostExit[];
      assert.equal(exit?.kind, 'crash');
      assert.equal(exit?.error.message, 'SERVER_WORKER_TEST_CRASH');
    }
  );
});
