import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_GS1_PREFIX_CONFIG,
  hasInvalidGs1CheckDigit,
  isGs1PrefixConfig,
  resolveGs1PrefixRole,
} from './gs1.ts';

test('check digit validates EAN-13, EAN-8 and UPC-A and leaves internal codes alone', () => {
  for (const valid of ['7701234567897', '96385074', '036000291452', '10001', 'ABC12345', '']) {
    assert.equal(hasInvalidGs1CheckDigit(valid), false, valid);
  }
  for (const invalid of ['7701234567890', '96385071', '036000291453', ' 7701234567891 ']) {
    assert.equal(hasInvalidGs1CheckDigit(invalid), true, invalid);
  }
});

test('the compatibility map keeps even prefixes as weight and odd prefixes as price', () => {
  assert.equal(resolveGs1PrefixRole('20'), 'weight');
  assert.equal(resolveGs1PrefixRole('29'), 'price');
  assert.equal(DEFAULT_GS1_PREFIX_CONFIG.weight.length, 5);
  assert.equal(DEFAULT_GS1_PREFIX_CONFIG.price.length, 5);
});

test('a site can reverse a prefix role and ignore an unused prefix', () => {
  const config = { weight: ['21'] as const, price: ['20'] as const };
  assert.equal(resolveGs1PrefixRole('21', config), 'weight');
  assert.equal(resolveGs1PrefixRole('20', config), 'price');
  assert.equal(resolveGs1PrefixRole('22', config), null);
});

test('an ambiguous unvalidated map fails closed', () => {
  assert.equal(resolveGs1PrefixRole('20', { weight: ['20'], price: ['20'] }), null);
});

test('the shared config guard rejects empty, duplicate, out-of-range, and misspelled maps', () => {
  assert.equal(isGs1PrefixConfig({ weight: ['21'], price: ['20'] }), true);
  assert.equal(isGs1PrefixConfig({ weight: [], price: [] }), false);
  assert.equal(isGs1PrefixConfig({ weight: ['20'], price: ['20'] }), false);
  assert.equal(isGs1PrefixConfig({ weight: ['30'], price: ['21'] }), false);
  assert.equal(isGs1PrefixConfig({ weight: '20', price: [] }), false);
  assert.equal(isGs1PrefixConfig({ weight: ['20'], price: ['21'], prices: [] }), false);
});
