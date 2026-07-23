import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  auditOperatorDeckAdoption,
  renderOperatorDeckAdoptionReport,
  scanOperatorDeckSource,
} from './check-operator-deck-adoption.mjs';

test('detects retired action and badge recipes', () => {
  const violations = scanOperatorDeckSource(`
    <button className="pv-btn primary">Save</button>
    <span className="badge-warning">Review</span>
  `);

  assert.deepEqual(
    violations.map(violation => violation.recipe),
    ['pv-btn', 'raw-operational-badge']
  );
});

test('accepts typed Button and Badge primitives', () => {
  const violations = scanOperatorDeckSource(`
    <Button variant="primary">Save</Button>
    <Badge variant="warning">Review</Badge>
  `);

  assert.deepEqual(violations, []);
});

test('the current runtime source has completed Operator Deck adoption', () => {
  const violations = auditOperatorDeckAdoption();
  assert.equal(violations.length, 0, renderOperatorDeckAdoptionReport(violations));
});
