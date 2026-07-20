/** new-tenant journey from an empty catalog to the first sale. */

import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  FIRST_SALE_E2E_USER,
  login,
  openUserMenu,
} from './support/app.js';
import { resetFirstSaleScenario } from './support/db.js';

async function captureEvidence(page: import('@playwright/test').Page, name: string) {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  await page.screenshot({ path: path.join(auditDir, `${name}.png`), fullPage: true });
}

async function dismissVisibleToasts(page: import('@playwright/test').Page) {
  const dismissButtons = page.locator('[role="status"] button[aria-label]');
  while ((await dismissButtons.count()) > 0) {
    await dismissButtons.first().click();
  }
}

test.describe('first sale onboarding', () => {
  test('walks a fresh admin through product, drawer, sale, celebration, and Help reopen', async ({
    page,
  }) => {
    const tracker = attachClientIssueTracker(page);
    const productName = 'E2E First Sale Product';
    const productSku = 'E2E-FIRST-SALE';

    await resetFirstSaleScenario();
    await page.goto('/login');
    await page.evaluate(() => {
      window.localStorage.setItem('puntovivo-language-preference', 'en');
    });
    await login(page, FIRST_SALE_E2E_USER);
    const guide = page.getByTestId('first-sale-guide');
    await expect(guide.getByText('Your first sale in 5 minutes')).toBeVisible();
    await expect(guide.getByText('0 of 3 steps completed')).toBeVisible();
    await expect(page.getByText("Today's sales").first()).toBeVisible({ timeout: 15_000 });
    await captureEvidence(page, 'first-sale-0-fresh-en');

    await guide.getByRole('link', { name: 'Create product' }).click();
    await expect(page).toHaveURL(/\/products$/);
    await page.getByRole('button', { name: 'Add Product' }).click();
    const productDialog = page.getByRole('dialog', { name: 'Create Product' });
    await expect(productDialog).toBeVisible();
    await productDialog.locator('#product-name').fill(productName);
    await productDialog.locator('#product-sku').fill(productSku);
    await productDialog.locator('#product-stock').fill('10');
    await productDialog.getByRole('tab', { name: 'Units' }).click();
    const unitPanel = productDialog.getByRole('tabpanel', { name: 'Units' });
    await unitPanel.locator('select').first().selectOption({ label: 'Unit' });
    await unitPanel.locator('input[type="number"]').last().fill('1000');
    await productDialog.getByRole('button', { name: 'Create Product' }).click();
    await expect(productDialog).toBeHidden({ timeout: 15_000 });
    await expect(guide.getByText('1 of 3 steps completed')).toBeVisible({
      timeout: 15_000,
    });

    await guide.getByRole('link', { name: 'Go to sales' }).click();
    await expect(page).toHaveURL(/\/sales$/);
    await page.getByRole('button', { name: 'Open cash session' }).first().click();
    const cashDialog = page
      .locator('[role="dialog"]')
      .filter({ has: page.getByRole('heading', { name: 'Open cash session' }) })
      .last();
    await expect(cashDialog).toBeVisible({ timeout: 15_000 });
    await cashDialog.locator('#cash-session-register').fill('E2E First Sale Register');
    await cashDialog.locator('#cash-session-opening-float').fill('0');
    const openSession = cashDialog.getByRole('button', { name: 'Open session' });
    await expect(openSession).toBeEnabled();
    await openSession.click();
    await expect(cashDialog).toBeHidden({ timeout: 15_000 });
    await expect(guide.getByText('2 of 3 steps completed')).toBeVisible({
      timeout: 15_000,
    });
    await dismissVisibleToasts(page);
    await captureEvidence(page, 'first-sale-2-register-open-en');

    await page.getByRole('button', { name: 'Search products' }).first().click();
    const searchDialog = page.getByRole('dialog', { name: 'Add product' });
    await expect(searchDialog).toBeVisible();
    await searchDialog.getByRole('textbox', { name: 'Search' }).fill(productSku);
    const productRow = searchDialog.getByTestId(`product-search-row-${productSku}`);
    await expect(productRow).toBeVisible({ timeout: 15_000 });
    await productRow.click();
    await searchDialog.getByRole('button', { name: 'Add to cart' }).click();
    await expect(searchDialog).toBeHidden();
    await expect(page.getByTestId(`sale-cart-item-${productSku}`)).toBeVisible();

    await page.keyboard.press('F2');
    const paymentDialog = page.getByRole('dialog', { name: 'Charge sale' });
    await expect(paymentDialog).toBeVisible({ timeout: 15_000 });
    const confirmSale = paymentDialog.locator('#sale-payment-confirm');
    await expect(confirmSale).toBeEnabled();
    await confirmSale.click();
    await expect(paymentDialog).toBeHidden({ timeout: 15_000 });

    const celebration = page.getByTestId('first-sale-celebration');
    await expect(celebration.getByText('Your first sale is complete!')).toBeVisible({
      timeout: 15_000,
    });
    await dismissVisibleToasts(page);
    await captureEvidence(page, 'first-sale-3-celebration-en');
    await expect(celebration).toBeHidden({ timeout: 7_000 });

    await ensureLanguage(page, 'es');
    await expect(page.getByTestId('first-sale-guide')).toBeHidden();
    await openUserMenu(page);
    await page.getByRole('button', { name: 'Guía de primera venta' }).click();
    await expect(page.getByText('Tu primera venta en 5 minutos')).toBeVisible();
    await expect(page.getByText('3 de 3 pasos completados')).toBeVisible();
    await captureEvidence(page, 'first-sale-help-reopen-es');

    await expectNoClientIssues(tracker);
  });
});
