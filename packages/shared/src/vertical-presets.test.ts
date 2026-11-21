import assert from 'node:assert/strict';
import test from 'node:test';
import { VERTICAL_PRESET_IDS, isTouchRegisterVerticalId } from './vertical-presets.ts';

test('only food service profiles sell on the touch register', () => {
  assert.deepEqual(VERTICAL_PRESET_IDS.filter(isTouchRegisterVerticalId), [
    'restaurant',
    'quickservice',
  ]);
  assert.equal(isTouchRegisterVerticalId(undefined), false);
});
