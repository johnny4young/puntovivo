/**
 * A snapshot built by the backup worker in the real desktop build: proves the
 * bundled worker entry loads its chunks and the native addon (ADR 0035).
 *
 * @module e2e/electron/backup-worker
 */

import { existsSync, statSync } from 'node:fs';
import { electronTest as test, expect } from './fixtures.js';
import { FIRST_SALE_E2E_EMAIL } from '../shared/baseline.js';
import { signIn } from './support/journey.js';

test.describe('backup worker on the desktop app', () => {
  test('creates an encrypted snapshot off the main thread', async ({ page }) => {
    await signIn(page, FIRST_SALE_E2E_EMAIL);

    const result = await page.evaluate(() => window.electron?.runBackupSnapshotNow?.());

    expect(result?.success).toBe(true);
    const zipPath = result?.status?.lastPath ?? '';
    expect(existsSync(zipPath)).toBe(true);
    expect(statSync(zipPath).size).toBeGreaterThan(1_000);
    expect(result?.status?.lastError).toBeNull();
  });
});
