import { expect, test, type Page } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues, login } from './support/app';
import { seedCashRoundingScenario } from './support/db';
import { addProductToCartViaKeyboard } from './support/sales-keyboard';

async function clearBrowserSession(page: Page) {
  await page.context().clearCookies();
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

test.describe('configurable COP cash rounding and accounting export', () => {
  test('enables 50-peso cash rounding, rounds cash-only checkout, and exposes PUC 429581', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedCashRoundingScenario(
      `cash-rounding-${testInfo.parallelIndex}-${Date.now()}`
    );
    await page.setViewportSize({ width: 1280, height: 800 });

    // 1. Admin enables cash-only rounding to multiples of $ 50 COP.
    await login(page, { ...scenario.admin, defaultPath: '/dashboard' });
    await page.goto('/company?tab=general');
    const roundingToggle = page.getByTestId('cash-close-rounding-toggle');
    await expect(roundingToggle).toBeVisible();
    await expect(roundingToggle).not.toBeChecked();
    await roundingToggle.click();
    await expect(roundingToggle).toBeChecked();
    await page.reload();
    await expect(page.getByTestId('cash-close-rounding-toggle')).toBeChecked();

    // 2. Manager signs in with a fresh session and sells a $ 5,544 COP item.
    await clearBrowserSession(page);
    await login(page, { ...scenario.cashier, defaultPath: '/dashboard' });
    await page.goto('/sales');
    await addProductToCartViaKeyboard(page, scenario.product.sku);

    await page.getByRole('button', { name: /Cobrar venta|Charge sale/i }).click();
    const summary = page.getByTestId('sale-payment-summary');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText(/5[.,]550/);
    await expect(page.getByTestId('sale-payment-total-detail')).toContainText(/6[.,]00/);

    // Switching to Card removes cash coin rounding back to exact $ 5,544.
    await page.getByRole('button', { name: /Card|Tarjeta/i }).click();
    await expect(summary).toContainText(/5[.,]544/);
    await expect(page.getByTestId('sale-payment-total-detail')).toBeHidden();

    // Back to Cash: pay with $ 6,000 and confirm.
    const drawer = page.getByTestId('sale-payment-drawer');
    await drawer.getByRole('button', { name: /Cash|Efectivo/i }).click();
    await expect(summary).toContainText(/5[.,]550/);
    await drawer.getByLabel(/Recibido|Amount received/i).fill('6000');
    await page.locator('#sale-payment-confirm').click();
    await expect(drawer).toBeHidden({ timeout: 15_000 });

    // 3. Admin verifies the rounding PUC account (429581) on Accounting Export.
    await clearBrowserSession(page);
    await login(page, { ...scenario.admin, defaultPath: '/dashboard' });
    await page.goto('/accounting-export');
    await page.locator('summary').filter({ hasText: /PUC/i }).click();
    await expect(page.locator('input[value="429581"]')).toBeVisible();

    await expectNoClientIssues(tracker);
  });
});
