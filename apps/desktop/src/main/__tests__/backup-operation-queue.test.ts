import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BackupOperationQueueFullError,
  createBackupOperationQueue,
  DEFAULT_MAX_PENDING_BACKUP_OPERATIONS,
} from '../backup/operation-queue.ts';

describe('backup operation queue', () => {
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
    assert.equal(queue.pendingCount(), 2);
    assert.deepEqual(events, ['first:start']);
    releaseFirst?.();
    assert.deepEqual(await Promise.all([first, second]), [1, 2]);
    assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
    assert.equal(queue.pendingCount(), 0);
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

  it('rejects excess work instead of retaining an unbounded lifecycle queue', async () => {
    const queue = createBackupOperationQueue(2);
    let releaseFirst: (() => void) | undefined;
    const gate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });

    const first = queue.run(() => gate);
    const second = queue.run(async () => undefined);
    await assert.rejects(
      queue.run(async () => undefined),
      (error: unknown) => error instanceof BackupOperationQueueFullError
    );
    assert.equal(queue.pendingCount(), 2);

    releaseFirst?.();
    await Promise.all([first, second]);
    assert.equal(queue.pendingCount(), 0);
  });

  it('rejects invalid queue limits before accepting lifecycle work', () => {
    assert.throws(() => createBackupOperationQueue(0), RangeError);
    assert.throws(() => createBackupOperationQueue(1.5), RangeError);
  });

  it('keeps the runtime queue limit aligned with the shared operational budget', () => {
    const budget = JSON.parse(
      readFileSync(join(process.cwd(), '..', '..', 'perf-budget.json'), 'utf8')
    ) as { operationalProfile: { maxPendingBackupOperations: number } };
    assert.equal(
      DEFAULT_MAX_PENDING_BACKUP_OPERATIONS,
      budget.operationalProfile.maxPendingBackupOperations
    );
  });
});
