import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { isNewerVersion, parseVersion } from '../version-compare.ts';

// Pins the notify-only updater's version logic: a GitHub release tag is
// "newer" than the running app version only when it strictly outranks it.
// Run via `node --test --experimental-strip-types` (the desktop test script);
// the import uses `.ts` because strip-types consumes TypeScript directly.

describe('parseVersion', () => {
  it('parses MAJOR.MINOR.PATCH with an optional leading v', () => {
    assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, pre: null });
    assert.deepEqual(parseVersion('v10.0.4'), { major: 10, minor: 0, patch: 4, pre: null });
  });

  it('captures a pre-release suffix', () => {
    assert.deepEqual(parseVersion('2.0.0-beta.1'), { major: 2, minor: 0, patch: 0, pre: 'beta.1' });
  });

  it('returns null for malformed input (fail closed)', () => {
    assert.equal(parseVersion('latest'), null);
    assert.equal(parseVersion('1.2'), null);
    assert.equal(parseVersion(''), null);
  });
});

describe('isNewerVersion', () => {
  it('detects a newer major / minor / patch', () => {
    assert.equal(isNewerVersion('2.0.0', '1.9.9'), true);
    assert.equal(isNewerVersion('1.3.0', '1.2.9'), true);
    assert.equal(isNewerVersion('1.2.4', '1.2.3'), true);
    assert.equal(isNewerVersion('v1.1.0', '1.0.0'), true);
  });

  it('returns false for equal or older versions', () => {
    assert.equal(isNewerVersion('1.2.3', '1.2.3'), false);
    assert.equal(isNewerVersion('1.0.0', '1.2.0'), false);
    assert.equal(isNewerVersion('0.9.0', '1.0.0'), false);
  });

  it('treats a stable release as newer than a same-core pre-release', () => {
    assert.equal(isNewerVersion('1.2.0', '1.2.0-beta.1'), true);
    assert.equal(isNewerVersion('1.2.0-beta.1', '1.2.0'), false);
  });

  it('does not consider two same-core pre-releases newer (avoids churn)', () => {
    assert.equal(isNewerVersion('1.2.0-beta.2', '1.2.0-beta.1'), false);
  });

  it('treats unparseable input on either side as not newer', () => {
    assert.equal(isNewerVersion('garbage', '1.0.0'), false);
    assert.equal(isNewerVersion('2.0.0', 'garbage'), false);
  });
});
