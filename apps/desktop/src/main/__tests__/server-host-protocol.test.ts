import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import type { PuntovivoServer } from '@puntovivo/server';
import type { EmbeddedServerOperations } from '../server-host/contract.ts';
import { createServerOperations } from '../server-host/operations.ts';
import {
  deserializeError,
  dispatchCall,
  OPERATION_NAMES,
  serializeError,
} from '../server-host/protocol.ts';

describe('server host protocol', () => {
  it('lists exactly the operations the server implements', () => {
    const implemented = Object.keys(createServerOperations({} as PuntovivoServer)).sort();
    assert.deepEqual([...OPERATION_NAMES].sort(), implemented);
  });

  it('keeps a closed error code and drops stacks and object graphs', () => {
    const own = Object.assign(new Error('busy'), { code: 'SQLITE_BUSY', db: { secret: true } });
    assert.deepEqual(serializeError(own), { name: 'Error', message: 'busy', code: 'SQLITE_BUSY' });
    const fromCause = new Error('nope', {
      cause: { errorCode: 'AUTH_LOCAL_RECOVERY_UNAVAILABLE' },
    });
    assert.equal(serializeError(fromCause).code, 'AUTH_LOCAL_RECOVERY_UNAVAILABLE');
    assert.equal(
      'code' in serializeError(Object.assign(new Error('x'), { code: 'lower case' })),
      false
    );
    assert.equal('stack' in serializeError(own), false);
    assert.deepEqual(serializeError('plain'), { name: 'Error', message: 'plain' });
  });

  it('rebuilds an Error with its name and code', () => {
    const error = deserializeError({ name: 'TypeError', message: 'bad', code: 'E_BAD' });
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'TypeError');
    assert.equal((error as Error & { code?: string }).code, 'E_BAD');
  });

  it('rejects calls outside the closed list without touching the operations', async () => {
    let touched = false;
    const operations = new Proxy({} as EmbeddedServerOperations, {
      get() {
        touched = true;
        return async () => undefined;
      },
    });
    for (const op of ['close', 'constructor', '__proto__', 'readAppSetting']) {
      const args = op === 'readAppSetting' ? 'not-an-array' : [];
      const reply = await dispatchCall(operations, { id: 7, op, args });
      assert.deepEqual(reply, {
        type: 'result',
        id: 7,
        ok: false,
        error: { name: 'Error', message: 'SERVER_HOST_OPERATION_REJECTED' },
      });
    }
    assert.equal(touched, false);
  });

  it('replies with the value or the serialized error of the operation', async () => {
    const operations = {
      readAppSetting: async (key: string) => ({ key }),
      writeAppSetting: async () => {
        throw Object.assign(new Error('read-only'), { code: 'SQLITE_READONLY' });
      },
    } as unknown as EmbeddedServerOperations;
    assert.deepEqual(await dispatchCall(operations, { id: 1, op: 'readAppSetting', args: ['a'] }), {
      type: 'result',
      id: 1,
      ok: true,
      value: { key: 'a' },
    });
    assert.deepEqual(
      await dispatchCall(operations, { id: 2, op: 'writeAppSetting', args: ['a', 1] }),
      {
        type: 'result',
        id: 2,
        ok: false,
        error: { name: 'Error', message: 'read-only', code: 'SQLITE_READONLY' },
      }
    );
  });
});
