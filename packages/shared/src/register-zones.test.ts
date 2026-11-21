import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_REGISTER_ZONES,
  REGISTER_ZONE_IDS,
  SWITCHABLE_REGISTER_ZONE_IDS,
  resolveRegisterZone,
  resolveRegisterZones,
  sanitizeRegisterZoneOverrides,
} from './register-zones.ts';
import { VERTICAL_PRESET_IDS } from './vertical-presets.ts';

const zonesOn = (businessType: string) =>
  REGISTER_ZONE_IDS.filter(id => DEFAULT_REGISTER_ZONES[businessType as 'retail'][id]);

test('every profile has a full matrix and keeps the selling engine on', () => {
  for (const profile of VERTICAL_PRESET_IDS) {
    const zones = DEFAULT_REGISTER_ZONES[profile];
    assert.deepEqual(Object.keys(zones).sort(), [...REGISTER_ZONE_IDS].sort());
    assert.equal(zones['command-bar'], true);
    assert.equal(zones.checkout, true);
  }
});

test('the drawn profiles match the matrix', () => {
  assert.deepEqual(zonesOn('pharmacy'), [
    'command-bar',
    'promos-parked',
    'pharmacy-lot',
    'checkout',
  ]);
  assert.deepEqual(zonesOn('hardware'), [
    'command-bar',
    'credit',
    'promos-parked',
    'units-cut',
    'quote-delivery',
    'checkout',
  ]);
  assert.deepEqual(zonesOn('restaurant'), [
    'command-bar',
    'quick-keys',
    'tables',
    'tip-split',
    'checkout',
  ]);
  assert.deepEqual(zonesOn('retail'), [
    'command-bar',
    'quick-keys',
    'weight-value',
    'credit',
    'promos-parked',
    'checkout',
  ]);
});

test('a tenant without a profile keeps every zone', () => {
  const zones = resolveRegisterZones(undefined, undefined);
  assert.ok(REGISTER_ZONE_IDS.every(id => zones[id]));
});

test('overrides switch editable zones and never the engine', () => {
  const zones = resolveRegisterZones('pharmacy', {
    'quick-keys': true,
    'promos-parked': false,
    checkout: false,
    'command-bar': false,
    'pharmacy-lot': false,
    'units-cut': true,
  });
  assert.equal(zones['quick-keys'], true);
  assert.equal(zones['promos-parked'], false);
  assert.equal(zones.checkout, true);
  assert.equal(zones['command-bar'], true);
  assert.equal(zones['pharmacy-lot'], false);
  assert.equal(zones['units-cut'], true);
});

test('malformed overrides are dropped', () => {
  assert.deepEqual(sanitizeRegisterZoneOverrides(['credit']), {});
  assert.deepEqual(sanitizeRegisterZoneOverrides({ credit: 'yes', bogus: true, tables: false }), {
    tables: false,
  });
});

test('one zone resolves like the full map', () => {
  const overrides = { credit: true };
  const zones = resolveRegisterZones('pharmacy', overrides);
  for (const id of REGISTER_ZONE_IDS) {
    assert.equal(resolveRegisterZone('pharmacy', overrides, id), zones[id]);
  }
});

test('every zone outside the engine is switchable', () => {
  assert.deepEqual(SWITCHABLE_REGISTER_ZONE_IDS, [
    'quick-keys',
    'weight-value',
    'credit',
    'promos-parked',
    'pharmacy-lot',
    'units-cut',
    'quote-delivery',
    'tables',
    'tip-split',
  ]);
});
