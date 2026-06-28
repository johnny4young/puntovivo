import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import type { UpdateInfo } from 'electron-updater';
// .ts extension because node --test consumes the source through strip-types.
import { coerceReleaseNotes, mapReleaseFields, releasePageUrl } from '../auto-update-status.ts';

const REPO = 'johnny4young/puntovivo';

/** Minimal UpdateInfo for tests; only the fields mapReleaseFields reads matter. */
function info(overrides: Partial<UpdateInfo>): UpdateInfo {
  return {
    version: '1.2.3',
    files: [],
    path: '',
    sha512: '',
    releaseDate: '',
    releaseName: null,
    releaseNotes: null,
    ...overrides,
  } as UpdateInfo;
}

describe('coerceReleaseNotes', () => {
  it('returns null for null/empty notes', () => {
    assert.equal(coerceReleaseNotes(null), null);
    assert.equal(coerceReleaseNotes(''), null);
  });

  it('passes a string through unchanged', () => {
    assert.equal(coerceReleaseNotes('Fixed the thing'), 'Fixed the thing');
  });

  it('joins an array of release-note entries with blank lines', () => {
    assert.equal(
      coerceReleaseNotes([
        { version: '1.2.2', note: 'first' },
        { version: '1.2.3', note: 'second' },
      ]),
      'first\n\nsecond'
    );
  });

  it('drops empty/null entry notes and returns null when nothing remains', () => {
    assert.equal(coerceReleaseNotes([{ version: '1.2.3', note: null }]), null);
    assert.equal(coerceReleaseNotes([]), null);
    assert.equal(
      coerceReleaseNotes([
        { version: '1.2.2', note: null },
        { version: '1.2.3', note: 'kept' },
      ]),
      'kept'
    );
  });
});

describe('releasePageUrl', () => {
  it('builds the v-prefixed GitHub release tag URL', () => {
    assert.equal(
      releasePageUrl(REPO, '1.2.3'),
      'https://github.com/johnny4young/puntovivo/releases/tag/v1.2.3'
    );
  });
});

describe('mapReleaseFields', () => {
  it('maps a full UpdateInfo to the status fields', () => {
    const fields = mapReleaseFields(
      info({
        version: '2.0.0',
        releaseName: 'Big Update',
        releaseNotes: 'notes here',
        releaseDate: '2026-06-28T12:00:00.000Z',
      }),
      REPO
    );
    assert.deepEqual(fields, {
      releaseName: 'Big Update',
      releaseNotes: 'notes here',
      releaseDate: '2026-06-28T12:00:00.000Z',
      updateUrl: 'https://github.com/johnny4young/puntovivo/releases/tag/v2.0.0',
    });
  });

  it('falls back to the version when releaseName is missing', () => {
    assert.equal(
      mapReleaseFields(info({ version: '3.1.4', releaseName: null }), REPO).releaseName,
      '3.1.4'
    );
  });

  it('normalizes a missing release date to null', () => {
    assert.equal(mapReleaseFields(info({ releaseDate: '' }), REPO).releaseDate, null);
  });
});
