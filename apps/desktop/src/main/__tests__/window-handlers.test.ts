import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createWindowHandlers } from '../ipc/window-handlers.ts';

const ACCESS_ID = '11111111-1111-4111-8111-111111111111';

function isAccessId(value: unknown): value is string {
  return value === ACCESS_ID;
}

describe('auxiliary-window IPC handler core', () => {
  it('requires a registered session before validation or window creation', () => {
    let validated = false;
    let opened = false;
    const handlers = createWindowHandlers({
      session: {
        requireTenantId: () => {
          throw new Error('SESSION_NOT_REGISTERED');
        },
      },
      isCustomerDisplayAccessId: value => {
        validated = true;
        return isAccessId(value);
      },
      openCustomerDisplay: async () => {
        opened = true;
      },
    });

    assert.throws(() => handlers.openCustomerDisplay(ACCESS_ID), {
      message: 'SESSION_NOT_REGISTERED',
    });
    assert.equal(validated, false);
    assert.equal(opened, false);
  });

  it('rejects an invalid pairing id without opening a window', async () => {
    let opened = false;
    const handlers = createWindowHandlers({
      session: { requireTenantId: () => 'tenant-main' },
      isCustomerDisplayAccessId: isAccessId,
      openCustomerDisplay: async () => {
        opened = true;
      },
    });

    await assert.rejects(() => handlers.openCustomerDisplay('tenant-main'), {
      message: 'Customer Display pairing is invalid',
    });
    assert.equal(opened, false);
  });

  it('opens a valid display only after authorization', async () => {
    const order: string[] = [];
    const handlers = createWindowHandlers({
      session: {
        requireTenantId: () => {
          order.push('authorize');
          return 'tenant-main';
        },
      },
      isCustomerDisplayAccessId: value => {
        order.push('validate');
        return isAccessId(value);
      },
      openCustomerDisplay: async accessId => {
        order.push(`open:${accessId}`);
      },
    });

    assert.deepEqual(await handlers.openCustomerDisplay(ACCESS_ID), { ok: true });
    assert.deepEqual(order, ['authorize', 'validate', `open:${ACCESS_ID}`]);
  });
});
