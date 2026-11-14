import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { restartPolicy, type HostExit } from '@electron-stagewright/host-supervisor';
import { classifyFatalCause } from '../server-host/fatal-cause.ts';

const withCode = (message: string, code?: string) =>
  Object.assign(new Error(message), code ? { code } : {});

const crash: HostExit = {
  kind: 'crash',
  error: new Error('SERVER_WORKER_TEST_CRASH'),
  code: 1,
  uptimeMs: 1_000,
  pendingCalls: 0,
  lastStats: null,
};

describe('server worker restart policy', () => {
  // ADR 0034 relies on the package defaults; pin them so an upgrade cannot move them.
  it('backs off 0.5 s, 2 s and 8 s, then gives up inside ten minutes', () => {
    let clock = 0;
    const decide = restartPolicy({ now: () => clock });
    const decisions = [0, 1_000, 5_000, 20_000].map(at => {
      clock = at;
      return decide(crash);
    });
    assert.deepEqual(decisions, [
      { action: 'restart', delayMs: 500 },
      { action: 'restart', delayMs: 2_000 },
      { action: 'restart', delayMs: 8_000 },
      'fatal',
    ]);
  });

  it('forgets restarts after ten stable minutes', () => {
    let clock = 0;
    const decide = restartPolicy({ now: () => clock });
    for (const at of [0, 60_000, 120_000]) {
      clock = at;
      decide(crash);
    }
    clock = 10 * 60_000 + 120_001;
    assert.deepEqual(decide(crash), { action: 'restart', delayMs: 500 });
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
