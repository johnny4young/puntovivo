import { after, before, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { EmbeddedServerHost } from '../server-host/contract.ts';
import { startWorkerServerHost } from '../server-host/worker-host.ts';

// Runs the real worker entry, so SQLCipher and Argon2 load inside a thread.
const WORKER_PATH = fileURLToPath(new URL('../server-host/server-worker.ts', import.meta.url));

let host: EmbeddedServerHost;
const unexpectedExits: Error[] = [];

before(async () => {
  const previous = process.env.PUNTOVIVO_DEV_ADMIN_PASSWORD;
  // The worker copies the environment when it is created.
  process.env.PUNTOVIVO_DEV_ADMIN_PASSWORD = `Aa!${randomUUID()}`;
  try {
    host = await startWorkerServerHost({
      workerPath: WORKER_PATH,
      start: {
        serverOptions: {
          dbPath: ':memory:',
          host: '127.0.0.1',
          port: 0,
          verbose: false,
          encryptionKey: 'c'.repeat(64),
          jwtSecret: 'worker-thread-test-secret-worker-thread-test-secret',
        },
      },
      onUnexpectedExit: error => unexpectedExits.push(error),
    });
  } finally {
    if (previous === undefined) delete process.env.PUNTOVIVO_DEV_ADMIN_PASSWORD;
    else process.env.PUNTOVIVO_DEV_ADMIN_PASSWORD = previous;
  }
});

after(async () => {
  await host?.close();
});

describe('embedded server in a worker thread', () => {
  it('listens on loopback and answers HTTP from its own thread', async () => {
    assert.match(host.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const response = await fetch(`${host.url}/api/health`);
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as { status: string }).status, 'ok');
  });

  it('serves the host contract over messages', async () => {
    await host.writeAppSetting('tray_settings', { enabled: true });
    assert.deepEqual(await host.readAppSetting('tray_settings'), { enabled: true });
    const injected = await host.inject({ method: 'GET', url: '/api/health', headers: {} });
    assert.equal(injected.statusCode, 200);
    assert.equal(await host.verifyAccessToken('not-a-token'), null);
  });

  it('rejects a forged audit event with its closed message', async () => {
    await assert.rejects(
      host.recordAudit({ action: 'sales.create' } as never),
      /MAIN_AUDIT_EVENT_REJECTED/
    );
  });

  it('stops cleanly without reporting a crash', async () => {
    await host.close();
    await assert.rejects(host.readAppSetting('tray_settings'), /not available/);
    assert.deepEqual(unexpectedExits, []);
  });
});
