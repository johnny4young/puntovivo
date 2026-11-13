/**
 * The server worker runs under a V8 heap cap: exhausting it ends only the
 * worker, and main restarts it (ADR 0034). Run packaged, this proves the cap
 * holds in the shipped Electron on each platform.
 *
 * @module e2e/electron/worker-oom
 */

import { electronTest as test, expect } from './fixtures.js';
import { FIRST_SALE_E2E_EMAIL } from '../shared/baseline.js';
import { goToRoute, signIn } from './support/journey.js';

test.describe('server worker heap limit on the desktop app', () => {
  test.use({ expectWorkerTestCrash: true });

  test('restarts the worker after it exhausts its heap', async ({ page }) => {
    await signIn(page, FIRST_SALE_E2E_EMAIL);
    await goToRoute(page, '/sales');

    const oom = await page.evaluate(() => window.electron?.exhaustServerWorkerHeapForE2e?.());
    expect(oom).toEqual({ ok: true });

    await expect(
      page.getByText(/the system recovered|el sistema se recuperó/i).first()
    ).toBeVisible({ timeout: 60_000 });
    const stats = await page.evaluate(() => window.electron?.getServerRestartStats?.());
    expect(stats?.entries.at(-1)).toMatchObject({
      kind: 'oom',
      errorCode: 'ERR_WORKER_OUT_OF_MEMORY',
      outcome: 'restarted',
    });
    await expect(page).toHaveURL(/\/sales/);
  });
});
