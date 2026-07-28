'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { boolean, isBooleanable } = require('./index.cjs');

test('matches the global-agent boolean contract', () => {
  for (const value of [
    'true',
    'T',
    ' yes ',
    'y',
    'on',
    '1',
    1,
    true,
    new String('true'),
    new Number(1),
    new Boolean(true)
  ]) {
    assert.equal(boolean(value), true);
  }
  for (const value of ['false', 'f', 'no', 'off', '0', 0, 2, null, undefined, {}]) {
    assert.equal(boolean(value), false);
  }
});

test('recognizes only explicit true and false representations', () => {
  for (const value of [
    'true',
    'false',
    'yes',
    'no',
    '1',
    '0',
    1,
    0,
    true,
    false,
    new String('off'),
    new Number(0),
    new Boolean(false)
  ]) {
    assert.equal(isBooleanable(value), true);
  }
  for (const value of ['maybe', 2, null, undefined, {}]) {
    assert.equal(isBooleanable(value), false);
  }
});
