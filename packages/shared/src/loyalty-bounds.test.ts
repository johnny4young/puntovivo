import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isValidValuePerPoint,
  MAX_VALUE_PER_POINT,
  MIN_VALUE_PER_POINT,
} from './loyalty-bounds.ts';

/**
 * The redemption-rate bounds are shared precisely so the settings form, the
 * tRPC input schema and the settings normalizer cannot disagree. These cases
 * pin the edges; each consumer's own suite pins that it calls this.
 */

test('accepts both inclusive edges and an ordinary value between them', () => {
  assert.equal(isValidValuePerPoint(MIN_VALUE_PER_POINT), true);
  assert.equal(isValidValuePerPoint(MAX_VALUE_PER_POINT), true);
  assert.equal(isValidValuePerPoint(1000), true);
});

test('rejects a sub-cent rate, which is the case the form used to allow', () => {
  // 0.001 rendered a preview and enabled Save, then the mutation refused it.
  assert.equal(isValidValuePerPoint(0.001), false);
  assert.equal(isValidValuePerPoint(0), false);
  assert.equal(isValidValuePerPoint(-1), false);
});

test('rejects an oversized rate and every non-finite input', () => {
  assert.equal(isValidValuePerPoint(MAX_VALUE_PER_POINT + 1), false);
  assert.equal(isValidValuePerPoint(Number.POSITIVE_INFINITY), false);
  assert.equal(isValidValuePerPoint(Number.NaN), false);
});

test('keeps the floor at a cent, because the value is money', () => {
  // Below a cent the stored amount rounds to zero and a point silently
  // becomes worth nothing. If this constant moves, that has to be a choice.
  assert.equal(MIN_VALUE_PER_POINT, 0.01);
});
