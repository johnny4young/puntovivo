import { describe, expect, it } from 'vitest';
import { WorkerActivityTracker } from './worker-activity.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('WorkerActivityTracker', () => {
  it('closes admission and waits for every previously admitted operation', async () => {
    const activity = new WorkerActivityTracker();
    const first = deferred();
    const second = deferred();
    const firstRun = activity.tryRun(() => first.promise);
    const secondRun = activity.tryRun(() => second.promise);
    expect(firstRun).not.toBeNull();
    expect(secondRun).not.toBeNull();

    let stopped = false;
    const stop = activity.stop().then(() => {
      stopped = true;
    });
    expect(activity.tryRun(async () => {})).toBeNull();

    first.resolve();
    await firstRun;
    await Promise.resolve();
    expect(stopped).toBe(false);

    second.resolve();
    await secondRun;
    await stop;
    expect(stopped).toBe(true);
  });

  it('aborts the shared lifecycle signal before waiting for admitted work', async () => {
    const activity = new WorkerActivityTracker();
    let observedSignal!: AbortSignal;
    const gate = deferred();
    const run = activity.tryRun(async signal => {
      observedSignal = signal;
      await gate.promise;
    });
    await Promise.resolve();
    expect(observedSignal.aborted).toBe(false);

    const stop = activity.stop();
    expect(observedSignal.aborted).toBe(true);
    gate.resolve();
    await run;
    await stop;
  });

  it('drains rejected work without turning worker cleanup into another failure', async () => {
    const activity = new WorkerActivityTracker();
    const run = activity.tryRun(async () => {
      throw new Error('background failure');
    });

    await expect(activity.stop()).resolves.toBeUndefined();
    await expect(run).rejects.toThrow('background failure');
  });

  it('deduplicates concurrent stop and supports an explicit restart after drain', async () => {
    const activity = new WorkerActivityTracker();
    const gate = deferred();
    const run = activity.tryRun(() => gate.promise);

    const firstStop = activity.stop();
    const secondStop = activity.stop();
    expect(secondStop).toBe(firstStop);
    expect(() => activity.reopen()).toThrow(/before.*drained/i);

    gate.resolve();
    await run;
    await firstStop;
    activity.reopen();
    await expect(activity.tryRun(async () => 'restarted')).resolves.toBe('restarted');
  });
});
