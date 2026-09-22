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
const operations: DataBridgeOperations = {
  getSyncStatus: unexpectedAsyncOperation,
  triggerSync: unexpectedAsyncOperation,
  setSyncConfig: unexpectedAsyncOperation,
};

describe('authenticated data-bridge handler core', () => {
  it('rejects every retained sync channel before domain code when the session is absent', async () => {
    const handlers = createDataBridgeHandlers({
      session: {
        requireTenantId: () => {
          throw new Error('SESSION_NOT_REGISTERED');
        },
        requireOneOfRoles: () => 'admin',
      },
      log: silentLog,
      operations,
    });

    const invocations: Array<[string, () => unknown]> = [
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
    assert.equal(invocations.length, 3);
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

  for (const method of ['getSyncStatus', 'triggerSync'] as const) {
    it(`${method} passes only the verified tenant and preserves its result`, async () => {
      const calls: string[] = [];
      const result = { pendingItems: 2 };
      const handlers = createDataBridgeHandlers({
        session: { requireTenantId: () => 'tenant-main', requireOneOfRoles: () => 'admin' },
        log: silentLog,
        operations: {
          ...operations,
          [method]: async (tenantId: string) => {
            calls.push(tenantId);
            return result;
          },
        },
      });
      assert.equal(await handlers[method]('tenant-renderer'), result);
      assert.deepEqual(calls, ['tenant-main']);
    });
  }

  it('does not warn for absent or matching compatibility hints', () => {
    let warnings = 0;
    const log = { warn: () => warnings++ };

    assert.equal(resolveActiveTenantId('tenant-main', undefined, log), 'tenant-main');
    assert.equal(resolveActiveTenantId('tenant-main', 'tenant-main', log), 'tenant-main');
    assert.equal(warnings, 0);
  });
});
