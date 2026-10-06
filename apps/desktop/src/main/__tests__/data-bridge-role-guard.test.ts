/** Raw data capabilities are absent even for administrators. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDataBridgeHandlers } from '../ipc/data-bridge-handlers.ts';

for (const role of ['admin', 'manager', 'cashier', 'viewer']) {
  test(`${role} has only authenticated sync operations, not raw data access`, async () => {
    const calls: string[] = [];
    const handlers = createDataBridgeHandlers({
      session: {
        requireTenantId: () => {
          calls.push('session');
          return 'tenant-main';
        },
        requireOneOfRoles: allowed => {
          assert.ok(allowed.includes(role));
          return role;
        },
      },
      log: { warn: () => {} },
      operations: {
        getSyncStatus: async tenant => {
          calls.push(tenant);
          return { pendingItems: 0 };
        },
        triggerSync: async tenant => {
          calls.push(tenant);
          return { synced: 0 };
        },
        setSyncConfig: async config => {
          calls.push('config');
          return config;
        },
      },
    });
    assert.deepEqual(Object.keys(handlers).sort(), [
      'getSyncStatus',
      'setSyncConfig',
      'triggerSync',
    ]);
    assert.deepEqual(await handlers.getSyncStatus(), { pendingItems: 0 });
    assert.deepEqual(await handlers.triggerSync(), { synced: 0 });
    const config = { enabled: false };
    assert.equal(await handlers.setSyncConfig(config), config);
    assert.deepEqual(calls, [
      'session',
      'tenant-main',
      'session',
      'tenant-main',
      'session',
      'config',
    ]);
  });
}
