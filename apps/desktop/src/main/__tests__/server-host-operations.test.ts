import { after, before, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { createServer, type PuntovivoServer } from '@puntovivo/server';
import type { MainAppSettingKey, MainAuditEvent } from '../server-host/contract.ts';
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
  it('reads and overwrites only the desktop app settings', async () => {
    const operations = createServerOperations(server);
    assert.equal(await operations.readAppSetting('receipt_print_settings'), undefined);
    await operations.writeAppSetting('receipt_print_settings', { silent: true });
    await operations.writeAppSetting('receipt_print_settings', {
      silent: false,
      printBackground: true,
    });
    assert.deepEqual(await operations.readAppSetting('receipt_print_settings'), {
      silent: false,
      printBackground: true,
    });
    for (const key of ['desktop_sync_config', 'sync_last_sync:tenant']) {
      await assert.rejects(
        operations.writeAppSetting(key as never, {}),
        /MAIN_APP_SETTING_REJECTED/
      );
    }
  });

  it('refuses app settings main does not own', async () => {
    const operations = createServerOperations(server);
    const serverOwned = 'sync_last_sync:tenant' as unknown as MainAppSettingKey;
    await assert.rejects(operations.readAppSetting(serverOwned), /MAIN_APP_SETTING_REJECTED/);
    await assert.rejects(
      operations.writeAppSetting(serverOwned, { enabled: false }),
      /MAIN_APP_SETTING_REJECTED/
    );
  });

  it('exposes no sync config writer', () => {
    assert.equal('setSyncConfig' in createServerOperations(server), false);
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
      { ...event, resourceType: 'backup_snapshot' },
      { ...event, tenantId: 42 },
      { ...event, tenantId: '' },
      { ...event, actorId: '' },
      { ...event, metadata: 'note' },
      { ...event, metadata: ['note'] },
      { ...event, metadata: null },
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

  it('runs the sync bridge on the server it was created for, for one tenant', async () => {
    const operations = createServerOperations(server);
    const status = await operations.getSyncStatus(tenantId);
    assert.equal(status.isOnline, true);
    assert.equal(typeof status.pendingItems, 'number');
    await assert.rejects(operations.getSyncStatus(undefined as never), /MAIN_TENANT_REQUIRED/);
    await assert.rejects(operations.triggerSync('' as never), /MAIN_TENANT_REQUIRED/);
    await assert.rejects(operations.readRestoreDrillCounts(''), /MAIN_TENANT_REQUIRED/);
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
      url: '/api/trpc/health.check?batch=1&input=%7B%7D',
      headers: {},
    });
    assert.equal(response.statusCode, 200);
    assert.equal(typeof response.body, 'string');
    assert.ok(Object.values(response.headers).every(value => typeof value !== 'number'));
  });

  it('injects only the fixed routes main owns', async () => {
    const operations = createServerOperations(server);
    for (const request of [
      { method: 'POST' as const, url: '/api/trpc/users.create?batch=1', headers: {} },
      { method: 'GET' as const, url: '/api/health', headers: {} },
      { method: 'PUT' as unknown as 'POST', url: '/api/trpc/auth.login', headers: {} },
    ]) {
      await assert.rejects(operations.inject(request), /MAIN_INJECT_REJECTED/);
    }
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
