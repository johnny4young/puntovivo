import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareReleaseTag, resolveReleaseTagAction } from './prepare-release-tag.mjs';

test('normalizes a bare semantic version into a v-prefixed tag', () => {
  assert.deepEqual(prepareReleaseTag('1.2.3'), {
    input: '1.2.3',
    version: '1.2.3',
    tag: 'v1.2.3',
    releaseName: 'Release v1.2.3',
    prerelease: false,
  });
});

test('preserves an already-prefixed tag and marks prereleases', () => {
  assert.deepEqual(prepareReleaseTag('v1.2.3-beta.1'), {
    input: 'v1.2.3-beta.1',
    version: '1.2.3-beta.1',
    tag: 'v1.2.3-beta.1',
    releaseName: 'Release v1.2.3-beta.1',
    prerelease: true,
  });
});

test('trims surrounding whitespace before normalization', () => {
  assert.equal(prepareReleaseTag('  v2.0.0  ').tag, 'v2.0.0');
});

test('supports build metadata without forcing prerelease mode', () => {
  const preparedRelease = prepareReleaseTag('1.2.3+build.5');

  assert.equal(preparedRelease.tag, 'v1.2.3+build.5');
  assert.equal(preparedRelease.prerelease, false);
});

test('rejects malformed versions', () => {
  assert.throws(
    () => prepareReleaseTag('release-1.2.3'),
    /must look like 1\.2\.3, 1\.2\.3-beta\.1, or 1\.2\.3\+build\.5/
  );
});

test('rejects versions with internal whitespace', () => {
  assert.throws(() => prepareReleaseTag('1.2. 3'), /must not contain whitespace/);
});

test('rejects an empty input', () => {
  assert.throws(() => prepareReleaseTag(''), /Release version is required/);
});

test('creates a new tag when neither local nor remote tag exists', () => {
  assert.equal(
    resolveReleaseTagAction({
      targetCommit: 'abc123',
      localTagCommit: null,
      remoteTagCommit: null,
    }),
    'create'
  );
});

test('pushes when the tag exists locally at the target commit but not on origin', () => {
  assert.equal(
    resolveReleaseTagAction({
      targetCommit: 'abc123',
      localTagCommit: 'abc123',
      remoteTagCommit: null,
    }),
    'push'
  );
});

test('reuses an existing remote tag when it already points to the target commit', () => {
  assert.equal(
    resolveReleaseTagAction({
      targetCommit: 'abc123',
      localTagCommit: 'abc123',
      remoteTagCommit: 'abc123',
    }),
    'reuse'
  );
});

test('fails when an existing remote tag points to a different commit', () => {
  assert.throws(
    () =>
      resolveReleaseTagAction({
        targetCommit: 'abc123',
        localTagCommit: null,
        remoteTagCommit: 'def456',
      }),
    /Remote tag already points to def456, but main is at abc123/
  );
});

test('fails when an existing local tag points to a different commit', () => {
  assert.throws(
    () =>
      resolveReleaseTagAction({
        targetCommit: 'abc123',
        localTagCommit: 'def456',
        remoteTagCommit: null,
      }),
    /Local tag already points to def456, but main is at abc123/
  );
});
