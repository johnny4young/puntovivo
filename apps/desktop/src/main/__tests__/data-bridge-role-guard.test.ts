/**
 * The data bridge authorizes identity AND role.
 *
 * `withAuthenticatedDesktopSession` used to call `requireTenantId()` and
 * nothing else, so every `db:*` channel accepted any signed-in role. The bridge
 * reaches `products`, `customers`, `sales`, `sale_items`, `categories`,
 * `inventory_movements` and `sync_outbox` directly, which means an unguarded
 * write there is a strict bypass of the tRPC role guard, the audit row, the
 * fiscal reversal and the cash-session invariant. A cashier could zero every
 * price or delete the tenant's sales.
 *
 * The session singleton has carried `requireOneOfRoles` all along and all
 * twelve backup channels use it; the data bridge was the one surface that did
 * not. These tests pin the policy per operation, and pin that the role check
 * runs BEFORE any operation, so a rejected call cannot have touched the DB.
 *
 * @module main/__tests__/data-bridge-role-guard.test
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  createDataBridgeHandlers,
  type DataBridgeOperations,
} from '../ipc/data-bridge-handlers.ts';

const silentLog = { warn: () => {} };

/** Every operation records that it ran, so an unguarded call is observable. */
function trackingOperations(reached: string[]): DataBridgeOperations {
  const track = (name: string) => async (): Promise<unknown> => {
    reached.push(name);
    if (name === 'countByTenant') return 0;
    if (name === 'delete') return true;
    return [];
  };
  return {
    getAllowedTable: (table: string) => table as never,
    assertRowBelongsToTenant: async () => {},
    assertSaleItemWriteBelongsToTenant: async () => {},
    getAll: track('getAll'),
    getById: track('getById'),
    insert: track('insert'),
    update: track('update'),
    delete: track('delete'),
    getByField: track('getByField'),
    deleteByTenant: track('deleteByTenant'),
    countByTenant: track('countByTenant'),
    assertSyncOperation: (operation: unknown) => operation as never,
    addToSyncQueue: track('addToSyncQueue'),
    getPendingSyncItems: track('getPendingSyncItems'),
    getSyncStatus: track('getSyncStatus'),
    triggerSync: track('triggerSync'),
    setSyncConfig: track('setSyncConfig'),
  } as unknown as DataBridgeOperations;
}

function handlersForRole(role: string, reached: string[]) {
  return createDataBridgeHandlers({
    session: {
      requireTenantId: () => 'tenant-main',
      requireOneOfRoles: (allowedRoles: readonly string[]) => {
        if (!allowedRoles.includes(role)) throw new Error('SESSION_ROLE_FORBIDDEN');
        return role;
      },
    },
    log: silentLog,
    operations: trackingOperations(reached),
  });
}

/** Drive one channel and report whether it was refused. */
async function attempt(
  role: string,
  channel: string,
  reached: string[],
  table = 'products'
): Promise<'allowed' | 'forbidden'> {
  const handlers = handlersForRole(role, reached) as unknown as Record<
    string,
    (...args: unknown[]) => Promise<unknown>
  >;
  const args: Record<string, unknown[]> = {
    getAll: [table],
    getById: [table, 'row-1'],
    getByField: [table, 'id', 'row-1'],
    countByTenant: [table],
    getPendingSyncItems: [],
    getSyncStatus: [],
    insert: [table, { id: 'row-1' }],
    update: [table, 'row-1', { price: 0 }],
    delete: ['products', 'row-1'],
    deleteByTenant: ['sales'],
  };
  try {
    await handlers[channel]!(...args[channel]!);
    return 'allowed';
  } catch (error) {
    if (error instanceof Error && error.message === 'SESSION_ROLE_FORBIDDEN') return 'forbidden';
    throw error;
  }
}

const READS = ['getAll', 'getById', 'getByField', 'countByTenant'];
const WRITES = ['insert', 'update'];
const DELETES = ['delete', 'deleteByTenant'];
const RAW_OUTBOX_CHANNELS = [
  'getAll',
  'getById',
  'getByField',
  'getPendingSyncItems',
  // Mutations return the raw row, so even an empty update is a read alias.
  'insert',
  'update',
];

describe('data bridge role guard', () => {
  it('lets every role read ordinary catalog rows', async () => {
    for (const role of ['admin', 'manager', 'cashier', 'viewer']) {
      for (const channel of READS) {
        assert.equal(await attempt(role, channel, []), 'allowed', `${role} ${channel}`);
      }
    }
  });

  it('refuses raw outbox payloads to every non-admin before any database read', async () => {
    for (const role of ['manager', 'cashier', 'viewer']) {
      for (const channel of RAW_OUTBOX_CHANNELS) {
        const reached: string[] = [];
        assert.equal(
          await attempt(role, channel, reached, 'sync_outbox'),
          'forbidden',
          `${role} ${channel}`
        );
        assert.deepEqual(reached, [], `${role} ${channel} queried protected data`);
      }
    }
  });

  it('preserves administrator diagnostics and non-sensitive queue counts for other roles', async () => {
    for (const channel of RAW_OUTBOX_CHANNELS) {
      const reached: string[] = [];
      assert.equal(await attempt('admin', channel, reached, 'sync_outbox'), 'allowed', channel);
      assert.deepEqual(reached, [channel]);
    }
    for (const role of ['admin', 'manager', 'cashier', 'viewer']) {
      for (const channel of ['countByTenant', 'getSyncStatus']) {
        assert.equal(
          await attempt(role, channel, [], 'sync_outbox'),
          'allowed',
          `${role} ${channel}`
        );
      }
    }
  });

  it('refuses a cashier and a viewer on every write', async () => {
    for (const role of ['cashier', 'viewer']) {
      for (const channel of WRITES) {
        assert.equal(await attempt(role, channel, []), 'forbidden', `${role} ${channel}`);
      }
    }
  });

  it('refuses everyone below admin on every delete', async () => {
    // products.delete and customers.delete are admin on the tRPC side, and
    // sales has no delete procedure at all — the bridge is the only way to
    // remove one, so it must be the strictest gate here.
    for (const role of ['manager', 'cashier', 'viewer']) {
      for (const channel of DELETES) {
        assert.equal(await attempt(role, channel, []), 'forbidden', `${role} ${channel}`);
      }
    }
    for (const channel of DELETES) {
      assert.equal(await attempt('admin', channel, []), 'allowed', `admin ${channel}`);
    }
  });

  it('lets a manager write but not delete', async () => {
    for (const channel of WRITES) {
      assert.equal(await attempt('manager', channel, []), 'allowed', `manager ${channel}`);
    }
    for (const channel of DELETES) {
      assert.equal(await attempt('manager', channel, []), 'forbidden', `manager ${channel}`);
    }
  });

  it('refuses before the operation runs, so a rejected call touches nothing', async () => {
    // The whole point of the guard is that the DB is never reached. If the
    // check ran after the operation, the damage would already be committed.
    const reached: string[] = [];
    assert.equal(await attempt('viewer', 'deleteByTenant', reached), 'forbidden');
    assert.equal(await attempt('cashier', 'update', reached), 'forbidden');
    assert.deepEqual(reached, []);
  });

  it('still refuses an absent session before it ever looks at the role', () => {
    const handlers = createDataBridgeHandlers({
      session: {
        requireTenantId: () => {
          throw new Error('SESSION_NOT_REGISTERED');
        },
        requireOneOfRoles: () => {
          throw new Error('ROLE_CHECKED_BEFORE_SESSION');
        },
      },
      log: silentLog,
      operations: trackingOperations([]),
    });
    // The wrapper authorizes synchronously, before it ever builds a promise,
    // which is itself the proof that no operation can have started.
    assert.throws(() => handlers.getAll('products'), /SESSION_NOT_REGISTERED/);
  });
});
