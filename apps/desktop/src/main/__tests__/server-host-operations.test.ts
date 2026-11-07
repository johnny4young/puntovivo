import { after, before, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { createServer, type PuntovivoServer } from '@puntovivo/server';
import type { MainAuditEvent } from '../server-host/contract.ts';
import { createInProcessServerHost } from '../server-host/in-process.ts';
import { createServerOperations } from '../server-host/operations.ts';

type Sqlite = import('better-sqlite3').Database;

let server: PuntovivoServer;
let tenantId = '';
let actorId = '';

function sqlite(): Sqlite {
  return (server.db as typeof server.db & { $client: Sqlite }).$client;
}

before(async () => {
  const previous = process.env.PUNTOVIVO_DEV_ADMIN_PASSWORD;
  process.env.PUNTOVIVO_DEV_ADMIN_PASSWORD = `Aa!${randomUUID()}`;
  try {
    server = await createServer({ dbPath: ':memory:', verbose: false });
  } finally {
    if (previous === undefined) delete process.env.PUNTOVIVO_DEV_ADMIN_PASSWORD;
    else process.env.PUNTOVIVO_DEV_ADMIN_PASSWORD = previous;
  }
  const user = sqlite().prepare('select id, tenant_id from users limit 1').get() as {
    id: string;
    tenant_id: string;
  };
  actorId = user.id;
  tenantId = user.tenant_id;
});

after(async () => {
  await server?.close();
});

describe('server host operations', () => {
  it('reads and overwrites app settings by key', async () => {
    const operations = createServerOperations(server);
    assert.equal(await operations.readAppSetting('host-test'), undefined);
    await operations.writeAppSetting('host-test', { silent: true });
    await operations.writeAppSetting('host-test', { silent: false, printBackground: true });
    assert.deepEqual(await operations.readAppSetting('host-test'), {
      silent: false,
      printBackground: true,
    });
  });

  it('records only the main-owned audit events, each in the hash chain', async () => {
    const operations = createServerOperations(server);
    const event: MainAuditEvent = {
      tenantId,
      actorId,
      action: 'security.db_key_rotation',
      resourceType: 'backup_key',
      resourceId: 'install',
      metadata: { outcome: 'rotated' },
    };
    await operations.recordAudit(event);
    const row = sqlite()
      .prepare('select action, resource_type, chain_hash from audit_logs where action = ?')
      .get('security.db_key_rotation') as
      { action: string; resource_type: string; chain_hash: string | null } | undefined;
    assert.equal(row?.resource_type, 'backup_key');
    assert.ok(row?.chain_hash);

    for (const forged of [
      { ...event, action: 'sales.create' },
      { ...event, resourceType: 'sale' },
      { ...event, tenantId: 42 },
    ]) {
      await assert.rejects(
        operations.recordAudit(forged as unknown as MainAuditEvent),
        /MAIN_AUDIT_EVENT_REJECTED/
      );
    }
  });

  it('writes only the checked audit fields, whatever else the event carries', async () => {
    const operations = createServerOperations(server);
    const smuggled = {
      tenantId,
      actorId,
      action: 'backup.encryption_key_reveal',
      resourceType: 'backup_key',
      resourceId: 'install',
      metadata: { outcome: 'revealed' },
      id: 'forged-id',
      createdAt: '2000-01-01T00:00:00.000Z',
    } as unknown as MainAuditEvent;
    await operations.recordAudit(smuggled);
    const row = sqlite()
      .prepare('select id, created_at from audit_logs where action = ?')
      .get('backup.encryption_key_reveal') as { id: string; created_at: string };
    assert.notEqual(row.id, 'forged-id');
    assert.notEqual(row.created_at, '2000-01-01T00:00:00.000Z');
  });

  it('runs the sync bridge on the server it was created for', async () => {
    const status = await createServerOperations(server).getSyncStatus(tenantId);
    assert.equal(status.isOnline, true);
    assert.equal(typeof status.pendingItems, 'number');
  });

  it('verifies access tokens through the server and rejects garbage', async () => {
    const operations = createServerOperations(server);
    assert.equal(await operations.verifyAccessToken('not-a-token'), null);
  });

  it('answers restore-drill counts for every drill table', async () => {
    const counts = await createServerOperations(server).readRestoreDrillCounts(tenantId);
    assert.deepEqual(Object.keys(counts).sort(), [
      'audit_logs',
      'customers',
      'inventory_movements',
      'products',
      'sales',
    ]);
    assert.ok(Object.values(counts).every(value => Number.isSafeInteger(value)));
  });

  it('returns injected responses as plain status, headers and text', async () => {
    const response = await createServerOperations(server).inject({
      method: 'GET',
      url: '/api/health',
      headers: {},
    });
    assert.equal(response.statusCode, 200);
    assert.equal(typeof response.body, 'string');
    assert.equal(JSON.parse(response.body).status, 'ok');
    assert.ok(Object.values(response.headers).every(value => typeof value !== 'number'));
  });
});

describe('in-process host', () => {
  it('reports the server URL and closes the server', async () => {
    let closed = 0;
    const fake = {
      getUrl: () => 'http://127.0.0.1:1',
      close: async () => {
        closed += 1;
      },
    } as unknown as PuntovivoServer;
    const host = createInProcessServerHost(fake);
    assert.equal(host.url, 'http://127.0.0.1:1');
    await host.close();
    assert.equal(closed, 1);
  });
});
