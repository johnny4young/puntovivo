import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { scheduleE2eShutdown } from '../e2e-shutdown.ts';

describe('packaged E2E shutdown', () => {
  it('acknowledges IPC before app.quit and keeps an unrefed force-exit fallback', () => {
    let deferred: (() => void) | undefined;
    let quitCalls = 0;
    let exitCode: number | undefined;
    let scheduledDelay: number | undefined;
    let fallback: (() => void) | undefined;
    let unrefCalls = 0;

    scheduleE2eShutdown({
      app: {
        quit: () => {
          quitCalls += 1;
        },
        exit: code => {
          exitCode = code;
        },
      },
      schedule: (callback, delayMs) => {
        fallback = callback;
        scheduledDelay = delayMs;
        return {
          unref: () => {
            unrefCalls += 1;
          },
        };
      },
      defer: callback => {
        deferred = callback;
      },
    });

    assert.equal(quitCalls, 0);
    deferred?.();
    assert.equal(quitCalls, 1);
    assert.equal(scheduledDelay, 2_000);
    assert.equal(unrefCalls, 1);
    assert.equal(exitCode, undefined);

    fallback?.();
    assert.equal(exitCode, 0);
  });
});
