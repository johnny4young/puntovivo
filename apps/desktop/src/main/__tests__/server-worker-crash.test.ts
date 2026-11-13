import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { WorkerExitFailure } from '../server-host/restart-policy.ts';
import { startWorkerServerHost } from '../server-host/worker-host.ts';

const WORKER_PATH = fileURLToPath(new URL('../server-host/server-worker.ts', import.meta.url));

/** Starts a real server worker; the worker copies the environment at creation. */
async function startRealWorker(env: Record<string, string>) {
  const saved = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env, { PUNTOVIVO_DEV_ADMIN_PASSWORD: `Aa!${randomUUID()}` });
  let resolveExit!: (failure: WorkerExitFailure) => void;
  const exited = new Promise<WorkerExitFailure>(resolve => (resolveExit = resolve));
  try {
    const host = await startWorkerServerHost({
      workerPath: WORKER_PATH,
      start: {
        serverOptions: {
          dbPath: ':memory:',
          host: '127.0.0.1',
          port: 0,
          verbose: false,
          encryptionKey: 'd'.repeat(64),
          jwtSecret: 'worker-crash-test-secret-worker-crash-test-secret',
        },
      },
      onUnexpectedExit: resolveExit,
      allowTestCrash: true,
    });
    return { host, exited };
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete process.env.PUNTOVIVO_DEV_ADMIN_PASSWORD;
  }
}

describe('a real server worker that crashes', () => {
  it('reports an uncaught exception with its code and frees its port', async () => {
    const { host, exited } = await startRealWorker({ PUNTOVIVO_E2E: '1' });
    const port = Number(new URL(host.url).port);
    host.simulateCrash?.();
    const failure = await exited;
    assert.equal(failure.kind, 'uncaught');
    assert.equal(failure.error.message, 'SERVER_WORKER_TEST_CRASH');
    assert.ok(failure.uptimeMs >= 0);

    // The listener died with the thread, so a new worker can bind it.
    const next = await startRealWorker({ PUNTOVIVO_E2E: '1' });
    const server = (await import('node:net')).createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve());
    });
    server.close();
    await next.host.close();
  });

  it('ignores a test crash outside E2E and soak runs', async () => {
    const { host } = await startRealWorker({ PUNTOVIVO_E2E: '0' });
    try {
      host.simulateCrash?.();
      await new Promise(resolve => setTimeout(resolve, 200));
      const response = await fetch(`${host.url}/api/health`);
      assert.equal(response.status, 200);
    } finally {
      await host.close();
    }
  });
});
