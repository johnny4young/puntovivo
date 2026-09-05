/**
 * Customer Display desktop journey.
 *
 * The web journey proves privacy, offline behavior and logout cleanup. This
 * complementary smoke owns the Electron-only contract: an admin can enable
 * the optional module from the UI, the sales action crosses the sandboxed
 * preload IPC boundary, and the main process creates and reuses one dedicated
 * BrowserWindow instead of opening duplicate customer screens.
 *
 * @module e2e/electron/customer-display
 */

import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';

import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';
import { FIRST_SALE_E2E_EMAIL } from '../shared/baseline.js';
import { electronTest as test, expect, IS_PACKAGED_RUN } from './fixtures.js';
import {
  addProductToCart,
  createProduct,
  dismissVisibleToasts,
  goToRoute,
  openCashSession,
  signIn,
} from './support/journey.js';

const PRODUCT_NAME = 'E2E Customer Display Product';
const PRODUCT_SKU = 'E2E-CUSTOMER-DISPLAY';
const REGISTER_NAME = 'E2E Customer Display Register';

async function captureEvidence(page: Page): Promise<void> {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  await page.screenshot({
    path: path.join(
      auditDir,
      `electron-customer-display-${IS_PACKAGED_RUN ? 'packaged' : 'dev'}.png`
    ),
    fullPage: true,
  });
}

test.describe('Customer Display on the desktop app', () => {
  test('opens one sandboxed display window and reuses it for the live cart', async ({ page }) => {
    const mainTracker = attachClientIssueTracker(page);
    await signIn(page, FIRST_SALE_E2E_EMAIL);

    // Enable the optional surface through the real admin UI so the journey
    // also proves that a merchant can configure the feature without editing
    // SQLite or an environment file.
    await goToRoute(page, '/company?tab=modules');
    const moduleToggle = page.getByTestId('modules-toggle-customer-display');
    await expect(moduleToggle).toBeVisible({ timeout: 30_000 });
    await expect(moduleToggle).toHaveAttribute('aria-checked', 'false');
    await moduleToggle.click();
    await expect(moduleToggle).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });
    await dismissVisibleToasts(page);

    await goToRoute(page, '/products');
    await createProduct(page, {
      name: PRODUCT_NAME,
      sku: PRODUCT_SKU,
      stock: '5',
      price: '12500',
    });

    await goToRoute(page, '/sales');
    await openCashSession(page, REGISTER_NAME);
    await dismissVisibleToasts(page);
    await addProductToCart(page, PRODUCT_SKU);

    const openDisplay = page.getByTestId('sales-open-customer-display');
    await expect(openDisplay).toBeVisible();

    const displayPage = page.context().waitForEvent('page', {
      predicate: candidate => candidate !== page,
      timeout: 30_000,
    });
    await openDisplay.click();
    const display = await displayPage;
    const displayTracker = attachClientIssueTracker(display);
    await display.waitForLoadState('domcontentloaded');
    await expect(display).toHaveURL(
      /(?:\/customer-display|#\/customer-display)\?access=[0-9a-f-]+$/
    );
    await expect(display.getByTestId('customer-display-shell')).toBeVisible({ timeout: 30_000 });
    expect(
      await display.evaluate(() => ({
        hasElectron: window.electron !== undefined,
        hasSession: window.session !== undefined,
        hasApi: window.api !== undefined,
        hasDatabase: window.db !== undefined,
        hasSync: window.sync !== undefined,
      }))
    ).toEqual({
      hasElectron: false,
      hasSession: false,
      hasApi: false,
      hasDatabase: false,
      hasSync: false,
    });
    expect(display.url()).not.toContain(PRODUCT_SKU);
    expect(
      await display.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .map(entry => entry.name)
          .filter(name => name.includes('/api/'))
      )
    ).toEqual([]);
    await expect(display.getByTestId('customer-display-register')).toHaveValue(/.+/);
    await expect(display.getByTestId('customer-display-items')).toContainText(PRODUCT_NAME, {
      timeout: 30_000,
    });
    await expect(display.getByTestId('customer-display-total')).toContainText('12,500');
    await expect(display.getByTestId('customer-display-shell')).not.toContainText(
      FIRST_SALE_E2E_EMAIL
    );
    await captureEvidence(display);

    // Focusing the sales window and pressing the action again must restore the
    // same display, not create a second public-facing window with stale state.
    const windowsBeforeReuse = page.context().pages();
    expect(windowsBeforeReuse).toHaveLength(2);
    await page.bringToFront();
    await openDisplay.click();
    await expect
      .poll(() => page.context().pages().length, { timeout: 5_000 })
      .toBe(windowsBeforeReuse.length);
    await expect.poll(() => display.evaluate(() => document.hasFocus())).toBe(true);

    await expectNoClientIssues(mainTracker);
    await expectNoClientIssues(displayTracker);

    await display.getByTestId('customer-display-close').click();
    await expect.poll(() => display.isClosed()).toBe(true);
    await expect(page).toHaveURL(/(?:\/sales|#\/sales)$/);
    await expect(openDisplay).toBeVisible();

    // Reopen it once more and then close the owning POS window. The auxiliary
    // projection must not keep Electron alive with an ownerless, stale screen.
    const reopenedPage = page.context().waitForEvent('page', {
      predicate: candidate => candidate !== page,
      timeout: 30_000,
    });
    await openDisplay.click();
    const reopenedDisplay = await reopenedPage;
    await expect(reopenedDisplay.getByTestId('customer-display-shell')).toBeVisible({
      timeout: 30_000,
    });
    await page.close();
    await expect.poll(() => reopenedDisplay.isClosed()).toBe(true);
  });
});
