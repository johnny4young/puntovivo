import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PuntovivoLogger, ServerOptions } from '@puntovivo/server';
import { PACKAGED_RENDERER_ORIGIN } from '../renderer-protocol.ts';
import { createServerLifecycle } from '../server-lifecycle.ts';
import { setServerHost } from '../runtime.ts';
import { fakeServerWorkerTransport } from './helpers/fake-server-worker.ts';

afterEach(() => {
  setServerHost(null);
});

describe('Electron embedded server lifecycle', () => {
  it('reuses one JWT secret across a restart around an operation', async () => {
    const fake = fakeServerWorkerTransport([
      { url: 'http://127.0.0.1:8090' },
      { url: 'http://127.0.0.1:8090' },
    ]);
    const lifecycle = createServerLifecycle({
      dbPath: join(tmpdir(), 'puntovivo-lifecycle-test.db'),
      migrationsPath: join(tmpdir(), 'puntovivo-migrations'),
      isDev: false,
      appVersion: '1.5.1',
      log: { info: () => {} } as unknown as PuntovivoLogger,
      prepareDatabaseEncryption: async () => 'a'.repeat(64),
      prepareAuditAnchorKey: async () => 'b'.repeat(64),
      getMainWindow: () => null,
      transport: fake.transport,
      generateJwtSecret: () => 'stable-electron-jwt-secret-for-lifecycle-test',
    });

    const initialHost = await lifecycle.start();
    assert.equal(initialHost.url, 'http://127.0.0.1:8090');
    setServerHost(initialHost);
    const result = await lifecycle.restartAround(async () => 'completed');

    assert.equal(result, 'completed');
    assert.equal(fake.workers[0]?.stopped, true);
    const starts = fake.workers.map(
      worker => worker.payload?.serverOptions as unknown as ServerOptions
    );
    assert.equal(starts.length, 2);
    assert.equal(starts[0]?.seedData, false);
    assert.equal(starts[1]?.seedData, false);
    assert.equal(starts[0]?.jwtSecret, 'stable-electron-jwt-secret-for-lifecycle-test');
    assert.equal(starts[1]?.jwtSecret, starts[0]?.jwtSecret);
    assert.deepEqual(starts[0]?.corsOrigins, [PACKAGED_RENDERER_ORIGIN]);
    assert.deepEqual(starts[1]?.corsOrigins, [PACKAGED_RENDERER_ORIGIN]);
    await lifecycle.stop();
  });
});
