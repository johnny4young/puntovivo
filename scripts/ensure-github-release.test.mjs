import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureGitHubRelease, publishGitHubRelease } from './ensure-github-release.mjs';

test('ensureGitHubRelease reuses an existing release', () => {
  const calls = [];

  const result = ensureGitHubRelease('v1.2.3', 'Release v1.2.3', false, {
    spawn(command, args) {
      calls.push({ command, args });
      return {
        status: 0,
        stdout: JSON.stringify({ isDraft: true }),
      };
    },
  });

  assert.deepEqual(result, { action: 'reuse' });
  assert.deepEqual(calls, [
    {
      command: 'gh',
      args: ['release', 'view', 'v1.2.3', '--json', 'isDraft'],
    },
  ]);
});

test('ensureGitHubRelease creates a missing prerelease', () => {
  const calls = [];

  const result = ensureGitHubRelease('v1.2.3-beta.1', 'Release v1.2.3-beta.1', true, {
    spawn(command, args) {
      calls.push({ command, args });

      if (args[1] === 'view') {
        return { status: 1, stdout: '', stderr: 'release not found' };
      }

      return { status: 0 };
    },
  });

  assert.deepEqual(result, { action: 'create' });
  assert.deepEqual(calls, [
    {
      command: 'gh',
      args: ['release', 'view', 'v1.2.3-beta.1', '--json', 'isDraft'],
    },
    {
      command: 'gh',
      args: [
        'release',
        'create',
        'v1.2.3-beta.1',
        '--draft',
        '--title',
        'Release v1.2.3-beta.1',
        '--prerelease',
      ],
    },
  ]);
});

test('ensureGitHubRelease rejects an empty release name', () => {
  assert.throws(() => ensureGitHubRelease('v1.2.3', '', false), /Release name is required/);
});

test('ensureGitHubRelease fails when gh create fails', () => {
  assert.throws(
    () =>
      ensureGitHubRelease('v1.2.3', 'Release v1.2.3', false, {
        spawn(_command, args) {
          if (args[1] === 'view') {
            return { status: 1, stdout: '', stderr: 'HTTP 404: release not found' };
          }

          return { status: 1, stderr: 'permission denied' };
        },
      }),
    /Failed to create GitHub release for v1.2.3: permission denied/
  );
});

test('ensureGitHubRelease fails when gh view errors for a non-404 reason', () => {
  assert.throws(
    () =>
      ensureGitHubRelease('v1.2.3', 'Release v1.2.3', false, {
        spawn() {
          return { status: 1, stderr: 'authentication failed' };
        },
      }),
    /Failed to inspect GitHub release v1.2.3: authentication failed/
  );
});

test('publishGitHubRelease publishes a draft release', () => {
  const calls = [];

  const result = publishGitHubRelease('v1.2.3', {
    spawn(command, args) {
      calls.push({ command, args });

      if (args[1] === 'view') {
        return {
          status: 0,
          stdout: JSON.stringify({ isDraft: true }),
        };
      }

      return { status: 0 };
    },
  });

  assert.deepEqual(result, { action: 'publish' });
  assert.deepEqual(calls, [
    {
      command: 'gh',
      args: ['release', 'view', 'v1.2.3', '--json', 'isDraft'],
    },
    {
      command: 'gh',
      args: ['release', 'edit', 'v1.2.3', '--draft=false'],
    },
  ]);
});

test('publishGitHubRelease reuses an already published release', () => {
  const result = publishGitHubRelease('v1.2.3', {
    spawn() {
      return {
        status: 0,
        stdout: JSON.stringify({ isDraft: false }),
      };
    },
  });

  assert.deepEqual(result, { action: 'reuse' });
});

test('publishGitHubRelease fails when the release does not exist', () => {
  assert.throws(
    () =>
      publishGitHubRelease('v1.2.3', {
        spawn() {
          return { status: 1, stdout: '', stderr: 'HTTP 404: release not found' };
        },
      }),
    /GitHub release v1.2.3 does not exist/
  );
});

test('publishGitHubRelease fails when gh view errors for a non-404 reason', () => {
  assert.throws(
    () =>
      publishGitHubRelease('v1.2.3', {
        spawn() {
          return { status: 1, stderr: 'network timeout' };
        },
      }),
    /Failed to inspect GitHub release v1.2.3: network timeout/
  );
});

test('publishGitHubRelease surfaces gh edit failures', () => {
  assert.throws(
    () =>
      publishGitHubRelease('v1.2.3', {
        spawn(_command, args) {
          if (args[1] === 'view') {
            return {
              status: 0,
              stdout: JSON.stringify({ isDraft: true }),
            };
          }

          return { status: 1, stderr: 'validation failed' };
        },
      }),
    /Failed to publish GitHub release for v1.2.3: validation failed/
  );
});
