import { expect, test } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues, login, loginAs } from './support/app';
import { seedSaleScenario } from './support/db';

test.describe('Band 5 — Retail & Supermarket Promotions v2, Shelf Labels & GS1 Scale', () => {
  test('creates and activates a 2x1 recurring promotion in /promotions', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAs(page, 'admin');
    await page.goto('/promotions');

    await expect(page.getByTestId('promotions-page')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /create promotion|crear promoción/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const promoName = `Promo 2x1 E2E ${Date.now()}`;
    await dialog.locator('input[maxlength="120"]').fill(promoName);
    await dialog.getByTestId('promotion-rule-kind').selectOption('nxm');
    await expect(dialog.getByTestId('promotion-buy-qty')).toHaveValue('2');
    await expect(dialog.getByTestId('promotion-pay-qty')).toHaveValue('1');

    // Toggle Monday + Wednesday recurring schedule
    await dialog.getByTestId('promotion-day-1').click();
    await dialog.getByTestId('promotion-day-3').click();
    await dialog.getByTestId('promotion-schedule-start').fill('09:00');
    await dialog.getByTestId('promotion-schedule-end').fill('18:00');

    await dialog.getByRole('button', { name: /^save$|^guardar$/i }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    const card = page.locator('article', { hasText: promoName });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText(/2.*1/);
    await expect(card).toContainText('09:00');

    await expectNoClientIssues(tracker);
  });

  test('opens shelf labels modal from /products bulk selection with SVG, ZPL and TSPL', async ({
    page,
  }, info) => {
    const scenario = seedSaleScenario(`band5-labels-${info.parallelIndex}-${Date.now()}`);
    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await login(page, { ...scenario.admin, defaultPath: '/dashboard' });
    await page.goto('/products');

    const firstRowCheckbox = page.locator('tbody input[type="checkbox"]').first();
    await expect(firstRowCheckbox).toBeVisible({ timeout: 15_000 });
    await firstRowCheckbox.check();

    const labelsBtn = page.getByTestId('products-bulk-labels');
    await expect(labelsBtn).toBeVisible();
    await labelsBtn.click();

    const modal = page.getByTestId('shelf-labels-modal');
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await expect(modal.getByTestId('shelf-label-card').first()).toBeVisible();
    await expect(modal.locator('svg').first()).toBeVisible();

    await modal.getByTestId('shelf-labels-tab-zpl').click();
    await expect(modal.getByTestId('shelf-labels-code-zpl')).toContainText('^XA');
    await expect(modal.getByTestId('shelf-labels-code-zpl')).toContainText('^XZ');

    await modal.getByTestId('shelf-labels-tab-tspl').click();
    await expect(modal.getByTestId('shelf-labels-code-tspl')).toContainText('SIZE 50 mm, 30 mm');
    await expect(modal.getByTestId('shelf-labels-code-tspl')).toContainText('BARCODE');

    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expectNoClientIssues(tracker);
  });

  test('exposes whole-peso GS1 price divisor (÷1 vs ÷100) in /peripherals scanner form', async ({
    page,
  }) => {
    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAs(page, 'admin');
    await page.goto('/peripherals');

    await page
      .getByRole('button', { name: /add device|agregar dispositivo/i })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.locator('#peripheral-kind').selectOption('scanner');

    const divisorSelect = dialog.getByTestId('peripheral-gs1-price-divisor');
    await expect(divisorSelect).toBeVisible();
    await expect(divisorSelect).toHaveValue('100');
    await divisorSelect.selectOption('1');
    await expect(divisorSelect).toHaveValue('1');
    await expect(dialog.locator('#peripheral-config')).toContainText('"gs1PriceDivisor": 1');

    await page.keyboard.press('Escape');
    await expectNoClientIssues(tracker);
  });
});
