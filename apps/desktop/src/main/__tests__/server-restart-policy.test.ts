import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { classifyFatalCause, createRestartBudget } from '../server-host/restart-policy.ts';

const withCode = (message: string, code?: string) =>
  Object.assign(new Error(message), code ? { code } : {});

describe('server worker restart policy', () => {
  it('backs off 0.5 s, 2 s and 8 s, then gives up inside ten minutes', () => {
    const budget = createRestartBudget();
    const decisions = [0, 1_000, 5_000, 20_000].map(at => budget.next(at));
    assert.deepEqual(decisions, [
      { action: 'restart', attempt: 1, delayMs: 500 },
      { action: 'restart', attempt: 2, delayMs: 2_000 },
      { action: 'restart', attempt: 3, delayMs: 8_000 },
      { action: 'give-up', restartsInWindow: 3 },
    ]);
  });

  it('forgets restarts after ten stable minutes', () => {
    const budget = createRestartBudget();
    budget.next(0);
    budget.next(60_000);
    budget.next(120_000);
    assert.deepEqual(budget.next(10 * 60_000 + 120_001), {
      action: 'restart',
      attempt: 1,
      delayMs: 500,
    });
  });

  it('treats corruption and key failures as fatal, everything else as restartable', () => {
    assert.equal(classifyFatalCause(withCode('boom', 'SQLITE_CORRUPT')), 'corruption');
    assert.equal(classifyFatalCause(withCode('x', 'SQLITE_NOTADB')), 'corruption');
    assert.equal(classifyFatalCause(new Error('database disk image is malformed')), 'corruption');
    assert.equal(classifyFatalCause(new Error('AUDIT_ANCHOR_DIVERGENCE')), 'key');
    assert.equal(classifyFatalCause(withCode('no', 'AUDIT_ANCHOR_STATE_DECRYPT_FAILED')), 'key');
    assert.equal(classifyFatalCause(withCode('oom', 'ERR_WORKER_OUT_OF_MEMORY')), null);
    assert.equal(classifyFatalCause(new Error('SERVER_WORKER_TEST_CRASH')), null);
    assert.equal(classifyFatalCause(withCode('busy', 'SQLITE_BUSY')), null);
  });
});
