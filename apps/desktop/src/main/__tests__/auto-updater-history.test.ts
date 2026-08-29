import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  canAcceptDownloadedArtifact,
  recordDownloadedUpdate,
  recordVersionTransition,
} from '../auto-updater/update-history.ts';

const DOWNLOAD = {
  version: '1.7.0',
  artifactSha512: Buffer.alloc(64, 1).toString('base64'),
  releaseName: 'Puntovivo 1.7.0',
  releaseNotes: 'Hardening',
  releaseDate: '2026-07-15T12:00:00.000Z',
  updateUrl: 'https://github.com/johnny4young/puntovivo/releases/tag/v1.7.0',
};

describe('desktop update history', () => {
  it('requires an exact same-version identity and only allows newer replacement', () => {
    const persisted = { ...DOWNLOAD, downloadedAt: '2026-07-15T13:00:00.000Z' };
    assert.equal(canAcceptDownloadedArtifact(persisted, DOWNLOAD), true);
    assert.equal(
      canAcceptDownloadedArtifact(persisted, {
        ...DOWNLOAD,
        artifactSha512: 'not-a-sha512',
      }),
      false
    );
    assert.equal(
      canAcceptDownloadedArtifact(persisted, {
        ...DOWNLOAD,
        artifactSha512: Buffer.alloc(64, 2).toString('base64'),
      }),
      false
    );
    assert.equal(
      canAcceptDownloadedArtifact(persisted, {
        version: '1.6.9',
        artifactSha512: Buffer.alloc(64, 3).toString('base64'),
      }),
      false
    );
    assert.equal(
      canAcceptDownloadedArtifact(persisted, {
        version: '1.8.0',
        artifactSha512: Buffer.alloc(64, 4).toString('base64'),
      }),
      true
    );
  });

  it('establishes a v2 baseline then records one version transition', () => {
    const root = mkdtempSync(join(tmpdir(), 'puntovivo-update-history-'));
    const file = join(root, 'history.json');
    try {
      assert.deepEqual(recordVersionTransition(file, '1.5.1'), {
        schemaVersion: 2,
        version: '1.5.1',
        updatedAt: null,
        downloaded: null,
        changed: false,
        recovered: false,
        migrated: false,
      });
      assert.deepEqual(
        recordVersionTransition(file, '1.6.0', () => new Date('2026-07-15T13:00:00.000Z')),
        {
          schemaVersion: 2,
          version: '1.6.0',
          updatedAt: '2026-07-15T13:00:00.000Z',
          downloaded: null,
          changed: true,
          recovered: false,
          migrated: false,
        }
      );
      assert.equal(
        recordVersionTransition(file, '1.6.0', () => new Date('2026-07-16T00:00:00.000Z'))
          .updatedAt,
        '2026-07-15T13:00:00.000Z'
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('migrates v1, persists a download, and hydrates it for a later process', () => {
    const root = mkdtempSync(join(tmpdir(), 'puntovivo-update-history-v2-'));
    const file = join(root, 'history.json');
    try {
      writeFileSync(file, JSON.stringify({ schemaVersion: 1, version: '1.6.0', updatedAt: null }));
      assert.equal(recordVersionTransition(file, '1.6.0').migrated, true);
      const downloaded = recordDownloadedUpdate(
        file,
        '1.6.0',
        DOWNLOAD,
        () => new Date('2026-07-15T13:00:00.000Z')
      );
      assert.deepEqual(downloaded.downloaded, {
        ...DOWNLOAD,
        downloadedAt: '2026-07-15T13:00:00.000Z',
      });
      const afterRestart = recordVersionTransition(file, '1.6.0');
      assert.deepEqual(afterRestart.downloaded, downloaded.downloaded);
      assert.equal(afterRestart.changed, false);
      assert.equal(afterRestart.migrated, false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('clears pending metadata after install and rejects stale downloads', () => {
    const root = mkdtempSync(join(tmpdir(), 'puntovivo-update-history-install-'));
    const file = join(root, 'history.json');
    try {
      recordDownloadedUpdate(file, '1.6.0', DOWNLOAD);
      assert.equal(recordVersionTransition(file, '1.7.0').downloaded, null);
      assert.throws(() => recordDownloadedUpdate(file, '1.7.0', DOWNLOAD), /must be newer/);
      assert.throws(
        () =>
          recordDownloadedUpdate(file, '1.6.0', {
            ...DOWNLOAD,
            releaseNotes: 'x'.repeat(32_769),
          }),
        /metadata is invalid/
      );
      assert.throws(
        () =>
          recordDownloadedUpdate(file, '1.6.0', {
            ...DOWNLOAD,
            updateUrl: 'http://updates.invalid/release',
          }),
        /metadata is invalid/
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('recovers corrupt history as a safe timestamp-free baseline', () => {
    const root = mkdtempSync(join(tmpdir(), 'puntovivo-update-history-corrupt-'));
    const file = join(root, 'history.json');
    try {
      writeFileSync(file, '{broken');
      const result = recordVersionTransition(file, '1.5.1');
      assert.equal(result.recovered, true);
      assert.equal(result.updatedAt, null);
      assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
        schemaVersion: 2,
        version: '1.5.1',
        updatedAt: null,
        downloaded: null,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
