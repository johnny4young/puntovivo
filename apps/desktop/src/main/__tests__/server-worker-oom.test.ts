import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { PuntovivoLogger } from '@puntovivo/server';
import type { WorkerCrashEntry } from '../server-host/crash-log.ts';
import { createWorkerLauncher } from '../server-host/worker-host.ts';
import { createServerLifecycle, type EmbeddedServerState } from '../server-lifecycle.ts';
import { getServerHost, setServerHost } from '../runtime.ts';

const WORKER_PATH = fileURLToPath(new URL('../server-host/server-worker.ts', import.meta.url));
const MIGRATIONS = fileURLToPath(
  new URL('../../../../../packages/server/src/db/migrations', import.meta.url)
);
const quietLog = { info: () => {}, warn: () => {}, error: () => {} } as unknown as PuntovivoLogger;

describe('server worker heap limit', { timeout: 60_000 }, () => {
  it('ends a worker that exhausts its heap and restarts a healthy one', async () => {
    const saved = { ...process.env };
    // The worker copies the environment when it is created.
    Object.assign(process.env, {
      PUNTOVIVO_E2E: '1',
      PUNTOVIVO_DEV_ADMIN_PASSWORD: `Aa!${randomUUID()}`,
    });
    const crashes: Array<Omit<WorkerCrashEntry, 'at' | 'appVersion'>> = [];
    const states: EmbeddedServerState[] = [];
    let recovery: Promise<void> | null = null;
    const lifecycle = createServerLifecycle({
      dbPath: ':memory:',
      migrationsPath: MIGRATIONS,
      isDev: true,
      appVersion: 'test',
      log: quietLog,
      prepareDatabaseEncryption: async () => 'f'.repeat(64),
      prepareAuditAnchorKey: async () => 'b'.repeat(64),
      getMainWindow: () => null,
      env: { PUNTOVIVO_BIND_PORT: '18690' },
      launchHost: createWorkerLauncher({
        workerPath: WORKER_PATH,
        resolveAuditAnchorStoreLocation: async () => undefined,
        onUnexpectedExit: failure => {
          recovery = lifecycle.recoverFromUnexpectedExit(failure);
        },
        allowTestCrash: true,
        resourceLimits: { maxOldGenerationSizeMb: 96 },
      }),
      onStateChange: state => states.push(state),
      recordCrash: entry => crashes.push(entry),
      sleep: async () => {},
    });
    try {
      setServerHost(await lifecycle.start());
      getServerHost()?.simulateOutOfMemory?.();
      while (!recovery) await new Promise(resolve => setTimeout(resolve, 20));
      await recovery;

      assert.equal(crashes[0]?.kind, 'oom');
      assert.equal(crashes[0]?.errorCode, 'ERR_WORKER_OUT_OF_MEMORY');
      assert.equal(crashes[0]?.outcome, 'restarted');
      const heapLimitMb = crashes[0]?.memory?.heapLimitMb ?? 0;
      assert.ok(heapLimitMb > 0, 'the last stats sample is kept');
      assert.ok(heapLimitMb < 200, `the 96 MB cap reached the worker, got ${heapLimitMb} MB`);
      assert.deepEqual(states, ['running', 'restarting', 'running']);
      const response = await fetch(`${getServerHost()?.url}/api/health`);
      assert.equal(response.status, 200);
    } finally {
      await lifecycle.stop();
      process.env = saved;
    }
  });
});
