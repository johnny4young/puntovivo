import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { recordVersionTransition } from '../auto-updater/update-history.ts';

describe('recordVersionTransition', () => {
  it('establishes a timestamp-free baseline then records one version transition', () => {
    const root = mkdtempSync(join(tmpdir(), 'puntovivo-update-history-'));
    const file = join(root, 'history.json');
    try {
      assert.deepEqual(recordVersionTransition(file, '1.5.1'), {
        schemaVersion: 1,
        version: '1.5.1',
        updatedAt: null,
        changed: false,
        recovered: false,
      });
      assert.deepEqual(
        recordVersionTransition(file, '1.6.0', () => new Date('2026-07-15T13:00:00.000Z')),
        {
          schemaVersion: 1,
          version: '1.6.0',
          updatedAt: '2026-07-15T13:00:00.000Z',
          changed: true,
          recovered: false,
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

  it('recovers corrupt history as a safe timestamp-free baseline', () => {
    const root = mkdtempSync(join(tmpdir(), 'puntovivo-update-history-corrupt-'));
    const file = join(root, 'history.json');
    try {
      writeFileSync(file, '{broken');
      const result = recordVersionTransition(file, '1.5.1');
      assert.equal(result.recovered, true);
      assert.equal(result.updatedAt, null);
      assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
        schemaVersion: 1,
        version: '1.5.1',
        updatedAt: null,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
