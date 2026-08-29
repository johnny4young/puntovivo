import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  captureDesktopIpcSessionResult,
  unwrapDesktopIpcSessionResult,
  withAuthenticatedDesktopSession,
} from '../ipc/session-authorization.ts';

describe('IPC session authorization core', () => {
  it('derives identity before running the handler', () => {
    const order: string[] = [];
    const handler = withAuthenticatedDesktopSession(
      {
        requireTenantId: () => {
          order.push('authorize');
          return 'tenant-main';
        },
      },
      ({ tenantId }, rendererTenantId: string) => {
        order.push('handler');
        return { tenantId, rendererTenantId };
      }
    );

    assert.deepEqual(handler('tenant-renderer'), {
      tenantId: 'tenant-main',
      rendererTenantId: 'tenant-renderer',
    });
    assert.deepEqual(order, ['authorize', 'handler']);
  });

  it('never reaches the handler when no desktop session is registered', () => {
    let reachedHandler = false;
    const handler = withAuthenticatedDesktopSession(
      {
        requireTenantId: () => {
          throw new Error('SESSION_NOT_REGISTERED');
        },
      },
      () => {
        reachedHandler = true;
      }
    );

    assert.throws(() => handler(), { message: 'SESSION_NOT_REGISTERED' });
    assert.equal(reachedHandler, false);
  });

  it('carries expected stale-session failures over IPC without rejecting main', async () => {
    const result = await captureDesktopIpcSessionResult(() => {
      throw new Error('SESSION_NOT_REGISTERED');
    });

    assert.deepEqual(result, {
      ok: false,
      errorCode: 'SESSION_NOT_REGISTERED',
    });
    assert.throws(() => unwrapDesktopIpcSessionResult(result), {
      message: 'SESSION_NOT_REGISTERED',
    });
  });

  it('unwraps successful values and never hides unrelated handler failures', async () => {
    const success = await captureDesktopIpcSessionResult(async () => ({ tenantId: 'tenant-main' }));
    assert.deepEqual(unwrapDesktopIpcSessionResult(success), { tenantId: 'tenant-main' });

    await assert.rejects(
      captureDesktopIpcSessionResult(() => {
        throw new Error('SQLITE_WRITE_FAILED');
      }),
      { message: 'SQLITE_WRITE_FAILED' }
    );
  });
});
