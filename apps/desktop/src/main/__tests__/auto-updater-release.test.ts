import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  fetchLatestRelease,
  isNewerRelease,
  REPO_SLUG,
} from '../auto-updater/release-notification.ts';

function asFetch(implementation: (input: string, init?: RequestInit) => Promise<Response>) {
  return implementation as typeof fetch;
}

describe('fetchLatestRelease', () => {
  it('maps the latest GitHub release and scopes credentials to the fixed endpoint', async () => {
    const fetchImpl = asFetch(async (input, init) => {
      assert.equal(input, `https://api.github.com/repos/${REPO_SLUG}/releases/latest`);
      assert.deepEqual(init?.headers, {
        'User-Agent': 'puntovivo-desktop',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: 'Bearer read-only-token',
      });

      return Response.json({
        tag_name: 'v2.0.0',
        name: 'Puntovivo 2.0',
        body: 'Release notes',
        published_at: '2026-07-13T12:00:00.000Z',
        html_url: 'https://github.com/johnny4young/puntovivo/releases/tag/v2.0.0',
      });
    });

    assert.deepEqual(await fetchLatestRelease({ fetchImpl, token: 'read-only-token' }), {
      kind: 'ok',
      version: 'v2.0.0',
      name: 'Puntovivo 2.0',
      notes: 'Release notes',
      date: '2026-07-13T12:00:00.000Z',
      url: 'https://github.com/johnny4young/puntovivo/releases/tag/v2.0.0',
    });
  });

  it('classifies a hidden private repository as inaccessible', async () => {
    const fetchImpl = asFetch(async () => new Response(null, { status: 404 }));

    assert.deepEqual(await fetchLatestRelease({ fetchImpl }), { kind: 'inaccessible' });
  });

  it('rejects a malformed successful response without throwing', async () => {
    const fetchImpl = asFetch(async () => Response.json({ name: 'Missing tag' }));

    assert.deepEqual(await fetchLatestRelease({ fetchImpl }), {
      kind: 'error',
      message: 'malformed release payload (no tag_name)',
    });
  });

  it('normalizes transport failures into an error result', async () => {
    const fetchImpl = asFetch(async () => {
      throw new Error('network unavailable');
    });

    assert.deepEqual(await fetchLatestRelease({ fetchImpl }), {
      kind: 'error',
      message: 'network unavailable',
    });
  });
});

describe('isNewerRelease', () => {
  const release = {
    kind: 'ok' as const,
    version: 'v2.0.0',
    name: 'Puntovivo 2.0',
    notes: null,
    date: null,
    url: 'https://example.test/release',
  };

  it('keeps semantic version policy outside the Electron lifecycle', () => {
    assert.equal(isNewerRelease(release, '1.9.9'), true);
    assert.equal(isNewerRelease(release, '2.0.0'), false);
  });
});
