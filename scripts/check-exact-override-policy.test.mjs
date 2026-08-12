import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  isExactRegistryOverride,
  parseWorkspaceOverrides,
  validateExactOverridePolicy,
} from './lib/exact-override-policy.mjs';

const workspaceSource = await readFile(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8');
const policy = JSON.parse(
  await readFile(new URL('../config/exact-overrides-policy.json', import.meta.url), 'utf8')
);
const overrides = parseWorkspaceOverrides(workspaceSource);

const clonePolicy = () => structuredClone(policy);

test('every exact registry override has a current bounded review', () => {
  const result = validateExactOverridePolicy({
    overrides,
    policy,
    now: new Date('2026-08-09T12:00:00.000Z'),
  });

  assert.equal(result.exactOverrideCount, 31);
  assert.equal(result.owner, 'platform-maintainers');
  assert.equal(result.nextReviewBy, '2026-09-08');
});

test('local workspace replacements do not create false pin debt', () => {
  assert.equal(isExactRegistryOverride('file:packages/boolean-compat'), false);
  assert.equal(isExactRegistryOverride('npm:tsx@4.21.0'), true);
  assert.equal(isExactRegistryOverride('4.21.0'), true);
  assert.equal(isExactRegistryOverride('^4.21.0'), false);
});

test('a newly added exact override fails until it has review metadata', () => {
  const changedOverrides = new Map(overrides).set('new-transitive', '1.2.3');
  assert.throws(
    () => validateExactOverridePolicy({ overrides: changedOverrides, policy }),
    /lack review metadata: new-transitive/
  );
});

test('changing a pin target requires a fresh bound review', () => {
  const changedOverrides = new Map(overrides).set('postcss', '8.5.26');
  assert.throws(
    () => validateExactOverridePolicy({ overrides: changedOverrides, policy }),
    /postcss changed from reviewed target 8\.5\.25 to 8\.5\.26/
  );
});

test('removed overrides cannot leave stale policy entries', () => {
  const changedOverrides = new Map(overrides);
  changedOverrides.delete('postcss');
  assert.throws(
    () => validateExactOverridePolicy({ overrides: changedOverrides, policy }),
    /stale or non-registry selector postcss/
  );
});

test('expired reviews fail closed', () => {
  assert.throws(
    () =>
      validateExactOverridePolicy({
        overrides,
        policy,
        now: new Date('2026-09-09T00:00:00.000Z'),
      }),
    /expired on 2026-09-08/
  );
});

test('review groups cannot stretch their category cadence', () => {
  const changedPolicy = clonePolicy();
  changedPolicy.reviews.find(({ category }) => category === 'security-floor').reviewBy =
    '2026-10-01';
  assert.throws(
    () => validateExactOverridePolicy({ overrides, policy: changedPolicy }),
    /exceeds the 30-day security-floor cadence/
  );
});

test('review dates must be real calendar dates', () => {
  const changedPolicy = clonePolicy();
  changedPolicy.reviews[0].reviewBy = '2026-02-31';
  assert.throws(
    () => validateExactOverridePolicy({ overrides, policy: changedPolicy }),
    /reviewBy is invalid/
  );
});

test('the parser rejects nested or otherwise unsupported override syntax', () => {
  assert.throws(
    () => parseWorkspaceOverrides('packages:\n  - apps/*\noverrides:\n  foo:\n    bar: 1.2.3\n'),
    /Unsupported overrides syntax: foo:/
  );
});

test('the parser rejects duplicate override selectors', () => {
  assert.throws(
    () => parseWorkspaceOverrides('overrides:\n  foo: 1.2.3\n  foo: 1.2.4\n'),
    /Duplicate override selector foo/
  );
});
