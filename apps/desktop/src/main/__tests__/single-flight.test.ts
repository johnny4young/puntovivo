import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSingleFlight } from '../single-flight.ts';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('single-flight operations', () => {
  it('makes every concurrent caller await one owned operation', async () => {
    const deferred = createDeferred<string>();
    const run = createSingleFlight<string>();
    let calls = 0;

    const first = run(() => {
      calls += 1;
      return deferred.promise;
    });
    const second = run(() => {
      calls += 1;
      return Promise.resolve('wrong operation');
    });

    await Promise.resolve();
    assert.equal(calls, 1);
    assert.equal(first, second);
    deferred.resolve('loaded');
    assert.deepEqual(await Promise.all([first, second]), ['loaded', 'loaded']);
  });

  it('propagates one shared failure to every concurrent caller', async () => {
    const deferred = createDeferred<void>();
    const run = createSingleFlight<void>();
    const first = run(() => deferred.promise);
    const second = run(() => Promise.resolve());

    deferred.reject(new Error('load failed'));
    await assert.rejects(first, /load failed/);
    await assert.rejects(second, /load failed/);
  });

  it('allows a new attempt after the prior operation settles', async () => {
    const run = createSingleFlight<number>();
    let calls = 0;

    assert.equal(await run(async () => ++calls), 1);
    assert.equal(await run(async () => ++calls), 2);
  });
});
