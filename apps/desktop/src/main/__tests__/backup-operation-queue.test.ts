import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { createBackupOperationQueue } from '../backup/operation-queue.ts';

describe('backup operation queue (ENG-136a)', () => {
  it('serializes database lifecycle operations in FIFO order', async () => {
    const queue = createBackupOperationQueue();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });

    const first = queue.run(async () => {
      events.push('first:start');
      await firstGate;
      events.push('first:end');
      return 1;
    });
    const second = queue.run(async () => {
      events.push('second:start');
      events.push('second:end');
      return 2;
    });

    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, ['first:start']);
    releaseFirst?.();
    assert.deepEqual(await Promise.all([first, second]), [1, 2]);
    assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('continues after a rejected operation and drain waits for the tail', async () => {
    const queue = createBackupOperationQueue();
    const failed = queue.run(async () => {
      throw new Error('expected');
    });
    const recovered = queue.run(async () => 'ok');

    await assert.rejects(failed, /expected/);
    assert.equal(await recovered, 'ok');
    await assert.doesNotReject(queue.drain());
  });
});
