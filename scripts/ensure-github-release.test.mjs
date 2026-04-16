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
        return { status: 1, stdout: '' };
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
            return { status: 1, stdout: '' };
          }

          return { status: 1 };
        },
      }),
    /Failed to create GitHub release for v1.2.3/
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
          return { status: 1, stdout: '' };
        },
      }),
    /GitHub release v1.2.3 does not exist/
  );
});
