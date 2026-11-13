/**
 * The server worker dies mid-shift: main restarts it on the same port and the
 * cashier completes the next sale without signing in again (ADR 0034).
 *
 * @module e2e/electron/worker-restart
 */

import { electronTest as test, expect } from './fixtures.js';
import { FIRST_SALE_E2E_EMAIL } from '../shared/baseline.js';
import {
  addProductToCart,
  chargeExactCash,
  createProduct,
  dismissVisibleToasts,
  goToRoute,
  openCashSession,
  signIn,
} from './support/journey.js';

const PRODUCT_SKU = 'E2E-RESTART';

test.describe('server worker restart on the desktop app', () => {
  test.use({ expectWorkerTestCrash: true });

  test('completes the next sale after the worker crashes', async ({ page }, testInfo) => {
    await signIn(page, FIRST_SALE_E2E_EMAIL);
    await page
      .getByTestId('first-sale-guide')
      .getByRole('link', { name: /create product/i })
      .click();
    await expect(page).toHaveURL(/\/products$/, { timeout: 30_000 });
    await createProduct(page, { name: 'E2E Restart Product', sku: PRODUCT_SKU, stock: '5' });

    await goToRoute(page, '/sales');
    await openCashSession(page, 'E2E Restart Register');
    await dismissVisibleToasts(page);
    await addProductToCart(page, PRODUCT_SKU);
    await chargeExactCash(page);
    await expect(page.getByTestId(`sale-cart-item-${PRODUCT_SKU}`)).toBeHidden({
      timeout: 15_000,
    });

    const crash = await page.evaluate(() => window.electron?.crashServerWorkerForE2e?.());
    expect(crash).toEqual({ ok: true });
    await expect(
      page.getByText(/reconnecting to the server|reconectando con el servidor/i).first()
    ).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: testInfo.outputPath('reconnecting.png') });

    await expect(
      page.getByText(/the system recovered|el sistema se recuperó/i).first()
    ).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/sales/);
    await dismissVisibleToasts(page);

    await addProductToCart(page, PRODUCT_SKU);
    await chargeExactCash(page);
    await expect(page.getByTestId(`sale-cart-item-${PRODUCT_SKU}`)).toBeHidden({
      timeout: 15_000,
    });

    await goToRoute(page, '/operations?tab=support');
    await expect(page.getByText(/1 in 7 days|1 en 7 días/i)).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: testInfo.outputPath('restarts-tile.png'), fullPage: true });

    const stats = await page.evaluate(() => window.electron?.getServerRestartStats?.());
    expect(stats?.restartsLast7Days).toBe(1);
    expect(stats?.entries.at(-1)).toMatchObject({
      kind: 'uncaught',
      errorCode: 'SERVER_WORKER_TEST_CRASH',
      outcome: 'restarted',
    });
  });
});
