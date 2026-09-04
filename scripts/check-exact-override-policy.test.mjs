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

// Derived from the checked-in policy on purpose: these tests assert the
// validator's behaviour, not today's review dates. Hard-coding the dates made
// every routine review refresh red the suite for a reason unrelated to the
// rule under test.
const DAY_MS = 24 * 60 * 60 * 1000;
const toIso = ms => new Date(ms).toISOString().slice(0, 10);
const parseDay = iso => Date.parse(`${iso}T00:00:00.000Z`);
const earliestReviewBy = policy.reviews.map(review => review.reviewBy).sort()[0];
const latestReviewedOn = policy.reviews.map(review => review.reviewedOn).sort().at(-1);
const securityFloorReviewedOn = policy.reviews.find(
  ({ category }) => category === 'security-floor'
).reviewedOn;

test('every exact registry override has a current bounded review', () => {
  const result = validateExactOverridePolicy({
    overrides,
    policy,
    now: new Date(`${latestReviewedOn}T12:00:00.000Z`),
  });

  // A literal on purpose: this is the tripwire for a pin added or dropped
  // without a matching policy entry, so it must NOT be derived.
  assert.equal(result.exactOverrideCount, 35);
  assert.equal(result.owner, 'platform-maintainers');
  assert.equal(result.nextReviewBy, earliestReviewBy);
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
        now: new Date(parseDay(earliestReviewBy) + DAY_MS),
      }),
    new RegExp(`expired on ${earliestReviewBy}`)
  );
});

test('review groups cannot stretch their category cadence', () => {
  const changedPolicy = clonePolicy();
  changedPolicy.reviews.find(({ category }) => category === 'security-floor').reviewBy = toIso(
    parseDay(securityFloorReviewedOn) + 31 * DAY_MS
  );
  assert.throws(
    () => validateExactOverridePolicy({ overrides, policy: changedPolicy }),
    /exceeds the 30-day security-floor cadence/
  );
});

test('an inherited object key cannot pose as a review category', () => {
  // A plain index resolves constructor or __proto__ to a truthy non-number,
  // which passes the category guard and then makes every cadence comparison
  // NaN-false, voiding the review-window bound.
  for (const category of ['constructor', '__proto__', 'toString']) {
    const changedPolicy = clonePolicy();
    changedPolicy.reviews[0].category = category;
    assert.throws(
      () => validateExactOverridePolicy({ overrides, policy: changedPolicy }),
      /has unsupported category/,
      `expected ${category} to be rejected`
    );
  }
});

test('review dates must be real calendar dates', () => {
  const changedPolicy = clonePolicy();
  changedPolicy.reviews[0].reviewBy = '2026-02-31';
  assert.throws(
    () => validateExactOverridePolicy({ overrides, policy: changedPolicy }),
    /reviewBy is invalid/
  );
});

test('reviews cannot claim evidence from a future date', () => {
  assert.throws(
    () =>
      validateExactOverridePolicy({
        overrides,
        policy,
        now: new Date('2026-08-11T23:59:59.999Z'),
      }),
    /reviewedOn is in the future/
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
