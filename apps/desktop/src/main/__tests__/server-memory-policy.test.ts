import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  DEFAULT_WORKER_MAX_OLD_GENERATION_MB,
  resolveWorkerResourceLimits,
} from '../server-host/memory-policy.ts';

describe('server worker memory policy', () => {
  it('caps the old generation at the provisional default unless the machine overrides it', () => {
    assert.deepEqual(resolveWorkerResourceLimits({}), {
      maxOldGenerationSizeMb: DEFAULT_WORKER_MAX_OLD_GENERATION_MB,
    });
    assert.deepEqual(resolveWorkerResourceLimits({ PUNTOVIVO_SERVER_WORKER_MAX_OLD_MB: '256' }), {
      maxOldGenerationSizeMb: 256,
    });
    assert.equal(
      resolveWorkerResourceLimits({ PUNTOVIVO_SERVER_WORKER_MAX_OLD_MB: 'lots' })
        .maxOldGenerationSizeMb,
      DEFAULT_WORKER_MAX_OLD_GENERATION_MB
    );
  });
});
