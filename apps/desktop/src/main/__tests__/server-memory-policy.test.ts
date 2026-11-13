import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  createMemoryWatch,
  DEFAULT_WORKER_MAX_OLD_GENERATION_MB,
  resolveWorkerResourceLimits,
} from '../server-host/memory-policy.ts';
import type { WorkerMemorySample } from '../server-host/protocol.ts';

const sample = (rssMb: number): WorkerMemorySample => ({
  rssMb,
  heapUsedMb: 50,
  heapLimitMb: 400,
  externalMb: 5,
  eventLoopUtilization: 0.1,
});

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

  it('alerts once after two samples in a row over the RSS threshold', () => {
    const alerts: number[] = [];
    const watch = createMemoryWatch({ thresholdMb: 500, onAlert: s => alerts.push(s.rssMb) });
    for (const rss of [600, 400, 600, 650, 700, 300, 610, 620]) watch.observe(sample(rss));
    assert.deepEqual(alerts, [650, 620]);
  });
});
