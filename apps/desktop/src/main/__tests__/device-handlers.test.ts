import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { createDeviceHandlers } from '../ipc/device-handlers.ts';

function buildHandlers(
  options: {
    requireTenantId?: () => string;
    readDeviceId?: (directory: string) => Promise<string | null>;
    writeDeviceId?: (directory: string, deviceId: string) => Promise<void>;
    warn?: (bindings: Record<string, unknown>, message: string) => void;
  } = {}
) {
  return createDeviceHandlers({
    session: {
      requireTenantId:
        options.requireTenantId ??
        (() => {
          throw new Error('SESSION_NOT_REGISTERED');
        }),
    },
    getUserDataPath: () => '/tmp/puntovivo-device-test',
    readDeviceId: options.readDeviceId ?? (async () => 'device-1'),
    writeDeviceId: options.writeDeviceId ?? (async () => {}),
    log: { warn: options.warn ?? (() => {}) },
  });
}

describe('persistent device IPC handler core', () => {
  it('keeps device:get-id available before login because login consumes it', async () => {
    let sessionChecked = false;
    const handlers = buildHandlers({
      requireTenantId: () => {
        sessionChecked = true;
        throw new Error('SESSION_NOT_REGISTERED');
      },
    });

    assert.equal(await handlers.getId(), 'device-1');
    assert.equal(sessionChecked, false);
  });

  it('gates device:set-id before validation or persistence', async () => {
    let writes = 0;
    const handlers = buildHandlers({
      writeDeviceId: async () => {
        writes++;
      },
    });

    assert.throws(() => handlers.setId('device-1'), {
      message: 'SESSION_NOT_REGISTERED',
    });
    assert.equal(writes, 0);
  });

  it('validates and persists a server-issued id only after authorization', async () => {
    const writes: Array<[string, string]> = [];
    const handlers = buildHandlers({
      requireTenantId: () => 'tenant-main',
      writeDeviceId: async (directory, deviceId) => {
        writes.push([directory, deviceId]);
      },
    });

    await assert.rejects(() => handlers.setId(''), { message: 'DEVICE_SET_ID_REJECTED' });
    await assert.rejects(() => handlers.setId('x'.repeat(257)), {
      message: 'DEVICE_SET_ID_REJECTED',
    });
    await handlers.setId('device-issued-by-server');
    assert.deepEqual(writes, [['/tmp/puntovivo-device-test', 'device-issued-by-server']]);
  });

  it('returns null and logs a bounded read failure', async () => {
    const warnings: Array<Record<string, unknown>> = [];
    const failure = new Error('disk unavailable');
    const handlers = buildHandlers({
      readDeviceId: async () => {
        throw failure;
      },
      warn: bindings => warnings.push(bindings),
    });

    assert.equal(await handlers.getId(), null);
    assert.deepEqual(warnings, [{ err: failure, dir: '/tmp/puntovivo-device-test' }]);
  });
});
