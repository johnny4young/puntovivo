import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  createDataBridgeHandlers,
  resolveActiveTenantId,
  type DataBridgeOperations,
} from '../ipc/data-bridge-handlers.ts';

const silentLog = { warn: () => {} };
const unexpectedAsyncOperation = async (): Promise<never> => {
  throw new Error('UNEXPECTED_OPERATION');
};
const unexpectedSyncOperation = (): never => {
  throw new Error('UNEXPECTED_OPERATION');
};
const operations: DataBridgeOperations = {
  getAllowedTable: unexpectedSyncOperation,
  assertRowBelongsToTenant: unexpectedAsyncOperation,
  assertSaleItemWriteBelongsToTenant: unexpectedAsyncOperation,
  getAll: unexpectedAsyncOperation,
  getById: unexpectedAsyncOperation,
  insert: unexpectedAsyncOperation,
  update: unexpectedAsyncOperation,
  delete: unexpectedAsyncOperation,
  getByField: unexpectedAsyncOperation,
  deleteByTenant: unexpectedAsyncOperation,
  countByTenant: unexpectedAsyncOperation,
  assertSyncOperation: unexpectedSyncOperation,
  addToSyncQueue: unexpectedAsyncOperation,
  getPendingSyncItems: unexpectedAsyncOperation,
  getSyncStatus: unexpectedAsyncOperation,
  triggerSync: unexpectedAsyncOperation,
  setSyncConfig: unexpectedAsyncOperation,
};

describe('authenticated data-bridge handler core', () => {
  it('rejects every db and sync channel before domain code when the session is absent', async () => {
    const handlers = createDataBridgeHandlers({
      session: {
        requireTenantId: () => {
          throw new Error('SESSION_NOT_REGISTERED');
        },
      },
      log: silentLog,
      operations,
    });

    const invocations: Array<[string, () => unknown]> = [
      ['db:getAll', () => handlers.getAll('products', 'tenant-renderer')],
      ['db:getById', () => handlers.getById('products', 'row-1')],
      ['db:insert', () => handlers.insert('products', { id: 'row-1' })],
      ['db:update', () => handlers.update('products', 'row-1', {})],
      ['db:delete', () => handlers.delete('products', 'row-1')],
      ['db:getByField', () => handlers.getByField('products', 'sku', 'SKU-1')],
      ['db:deleteByTenant', () => handlers.deleteByTenant('products', 'tenant-renderer')],
      ['db:countByTenant', () => handlers.countByTenant('products', 'tenant-renderer')],
      [
        'db:addToSyncQueue',
        () =>
          handlers.addToSyncQueue({
            entityType: 'products',
            entityId: 'row-1',
            operation: 'create',
            tenantId: 'tenant-renderer',
          }),
      ],
      ['db:getPendingSyncItems', () => handlers.getPendingSyncItems('tenant-renderer')],
      ['sync:getStatus', () => handlers.getSyncStatus('tenant-renderer')],
      ['sync:triggerSync', () => handlers.triggerSync('tenant-renderer')],
      ['sync:setConfig', () => handlers.setSyncConfig({ enabled: true })],
    ];

    for (const [channel, invoke] of invocations) {
      await assert.rejects(
        async () => invoke(),
        {
          message: 'SESSION_NOT_REGISTERED',
        },
        channel
      );
    }
    assert.equal(invocations.length, 13);
  });

  it('ignores a renderer tenant mismatch and records it without exposing control', () => {
    const warnings: Array<{ bindings: Record<string, unknown>; message: string }> = [];
    const log = {
      warn: (bindings: Record<string, unknown>, message: string) => {
        warnings.push({ bindings, message });
      },
    };

    assert.equal(resolveActiveTenantId('tenant-main', 'tenant-renderer', log), 'tenant-main');
    assert.deepEqual(warnings, [
      {
        bindings: {
          sessionTenantId: 'tenant-main',
          rendererTenantId: 'tenant-renderer',
        },
        message: 'ignored renderer-supplied tenantId — desktop session wins',
      },
    ]);
  });

  it('passes only the verified tenant into a data operation', async () => {
    const calls: Array<{ table: string; tenantId: string }> = [];
    const handlers = createDataBridgeHandlers({
      session: { requireTenantId: () => 'tenant-main' },
      log: silentLog,
      operations: {
        ...operations,
        getAll: async (table, tenantId) => {
          calls.push({ table, tenantId });
          return [];
        },
      },
    });

    await handlers.getAll('products', 'tenant-renderer');
    assert.deepEqual(calls, [{ table: 'products', tenantId: 'tenant-main' }]);
  });

  it('does not warn for absent or matching compatibility hints', () => {
    let warnings = 0;
    const log = { warn: () => warnings++ };

    assert.equal(resolveActiveTenantId('tenant-main', undefined, log), 'tenant-main');
    assert.equal(resolveActiveTenantId('tenant-main', 'tenant-main', log), 'tenant-main');
    assert.equal(warnings, 0);
  });
});
