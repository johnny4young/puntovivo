import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { BackupCreateCancellation } from '../ipc/backup/create-cancellation.ts';

describe('manual backup cancellation state', () => {
  it('admits one operation and rejects concurrent creation', () => {
    const state = new BackupCreateCancellation();
    const active = state.begin();
    assert.ok(active);
    assert.equal(state.begin(), null);
    state.finish(active);
    assert.ok(state.begin());
  });

  it('aborts the active signal exactly once and resets after completion', () => {
    const state = new BackupCreateCancellation();
    const active = state.begin()!;
    assert.equal(state.cancel(), true);
    assert.equal(active.signal.aborted, true);
    assert.equal(state.cancel(), false);
    state.finish(active);
    assert.equal(state.cancel(), false);
  });
});
