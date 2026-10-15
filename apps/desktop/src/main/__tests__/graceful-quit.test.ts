import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { createGracefulQuitHandler } from '../graceful-quit.ts';

describe('graceful native quit', () => {
  it('drains once and defers the second native quit until cleanup has completed', async () => {
    let finish!: () => void;
    const writes = new Promise<void>(resolve => {
      finish = resolve;
    });
    const deferred: Array<() => void> = [];
    let shutdownCalls = 0;
    let quitCalls = 0;
    let prevented = 0;
    const handler = createGracefulQuitHandler({
      shutdown: async () => {
        shutdownCalls++;
        await writes;
      },
      quit: () => {
        quitCalls++;
      },
      onError: () => assert.fail('unexpected cleanup failure'),
      defer: callback => {
        deferred.push(callback);
      },
    });
    const event = {
      preventDefault: () => {
        prevented++;
      },
    };
    handler(event);
    handler(event);
    await Promise.resolve();
    assert.equal(shutdownCalls, 1);
    assert.equal(prevented, 2);
    assert.equal(quitCalls, 0);
    assert.equal(deferred.length, 0);
    finish();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(quitCalls, 0);
    assert.equal(deferred.length, 1);
    deferred[0]!();
    handler(event);
    assert.equal(quitCalls, 1);
    assert.equal(prevented, 2);
  });
  it('reports a failed cleanup and still schedules one normal quit cycle', async () => {
    const failure = new Error('fixture shutdown error');
    const errors: unknown[] = [];
    const deferred: Array<() => void> = [];
    const handler = createGracefulQuitHandler({
      shutdown: async () => {
        throw failure;
      },
      quit: () => {},
      onError: error => {
        errors.push(error);
      },
      defer: callback => {
        deferred.push(callback);
      },
    });
    handler({ preventDefault() {} });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(errors, [failure]);
    assert.equal(deferred.length, 1);
  });
});
