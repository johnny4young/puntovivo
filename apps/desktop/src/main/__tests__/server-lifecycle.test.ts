import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PuntovivoLogger, PuntovivoServer, ServerOptions } from '@puntovivo/server';
import { createServerLifecycle } from '../server-lifecycle.ts';
import { setServer } from '../runtime.ts';

afterEach(() => {
  setServer(null);
});

describe('Electron embedded server lifecycle', () => {
  it('reuses one JWT secret across an in-process restart', async () => {
    const starts: ServerOptions[] = [];
    let closeCalls = 0;
    const createEmbeddedServer = async (options: ServerOptions): Promise<PuntovivoServer> => {
      starts.push(options);
      return {
        listen: async () => {},
        close: async () => {
          closeCalls += 1;
        },
        getUrl: () => 'http://127.0.0.1:8090',
      } as unknown as PuntovivoServer;
    };
    const lifecycle = createServerLifecycle({
      dbPath: join(tmpdir(), 'puntovivo-lifecycle-test.db'),
      migrationsPath: join(tmpdir(), 'puntovivo-migrations'),
      isDev: false,
      appVersion: '1.5.1',
      log: { info: () => {} } as unknown as PuntovivoLogger,
      prepareDatabaseEncryption: async () => 'a'.repeat(64),
      getMainWindow: () => null,
      createEmbeddedServer,
      generateJwtSecret: () => 'stable-electron-jwt-secret-for-lifecycle-test',
    });

    const initialServer = await lifecycle.start();
    setServer(initialServer);
    const result = await lifecycle.restartAround(async () => 'completed');

    assert.equal(result, 'completed');
    assert.equal(closeCalls, 1);
    assert.equal(starts.length, 2);
    assert.equal(starts[0]?.jwtSecret, 'stable-electron-jwt-secret-for-lifecycle-test');
    assert.equal(starts[1]?.jwtSecret, starts[0]?.jwtSecret);
  });
});
