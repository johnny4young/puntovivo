import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OPERATIONAL_READINESS_CONTRACT,
  OPERATIONAL_READINESS_SERVICES,
  OPERATIONAL_SERVICE_IDS,
} from './operational-readiness.ts';

test('covers each operational service exactly once', () => {
  assert.deepEqual(
    OPERATIONAL_READINESS_SERVICES.map(service => service.id),
    OPERATIONAL_SERVICE_IDS
  );
  assert.equal(new Set(OPERATIONAL_READINESS_SERVICES.map(service => service.id)).size, 6);
});

test('keeps owners, response targets, recovery targets, and drills explicit', () => {
  for (const service of OPERATIONAL_READINESS_SERVICES) {
    assert.match(service.runbookId, /^[a-z]+(?:-[a-z]+)+$/);
    assert.match(service.actionTarget, /^\//);
    assert.ok(service.responseTargetMinutes > 0);
    assert.equal(service.escalationOwner, 'support');
    assert.ok(service.drills.length > 0);
  }

  assert.equal(OPERATIONAL_READINESS_CONTRACT.sync.threshold.warningCount, 25);
  assert.equal(OPERATIONAL_READINESS_CONTRACT.sync.actionTarget, '/company?tab=data');
  assert.equal(OPERATIONAL_READINESS_CONTRACT.backup.ownerRole, 'administrator');
  assert.equal(OPERATIONAL_READINESS_CONTRACT.updates.ownerRole, 'administrator');
});
