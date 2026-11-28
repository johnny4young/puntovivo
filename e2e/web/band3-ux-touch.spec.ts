import { expect, test } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues, login, loginAs } from './support/app';
import { seedCashSessionScenario } from './support/db';

test.describe('Band 3 — Simplified POS, Complete Touch POS, Purchases & Reports UX', () => {
  test('keeps /sales dock focused and houses shift actions in the header menu', async ({
    page,
  }, info) => {
    const scenario = seedCashSessionScenario(`band3-sales-${info.parallelIndex}-${Date.now()}`);
    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, { ...scenario.cashier, defaultPath: '/sales' });

    await expect(page.getByTestId('checkout-primary-action')).toBeVisible();
    const shiftMenu = page.getByTestId('sales-shift-menu');
    await expect(shiftMenu).toBeVisible({ timeout: 15_000 });

    // Open register shift controls live in the header popover, not stacked in the checkout dock.
    await expect(page.getByTestId('checkout-register')).toHaveCount(0);
    await expect(page.getByTestId('checkout-last-sale')).toHaveCount(0);
    await expect(page.getByTestId('checkout-parked')).toHaveCount(0);

    await shiftMenu.click();
    const popover = page.getByTestId('sales-shift-popover');
    await expect(popover).toBeVisible();
    expect(await popover.getByRole('menuitem').count()).toBeGreaterThanOrEqual(2);
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();

    await expectNoClientIssues(tracker);
  });

  test('supports touch cart steppers and full payment modal (card tender) on /touch', async ({
    page,
  }, info) => {
    const scenario = seedCashSessionScenario(`band3-touch-${info.parallelIndex}-${Date.now()}`);
    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await login(page, { ...scenario.cashier, defaultPath: '/sales' });
    await page.goto('/touch');

    await page.getByTestId('pos-touch-category-all').click();
    const productTile = page.getByTestId(`pos-touch-tile-${scenario.product.id}`);
    await expect(productTile).toBeVisible({ timeout: 15_000 });
    await productTile.click();

    const firstLine = page
      .getByTestId('pos-touch-cart')
      .locator('li[data-testid^="pos-touch-cart-line-"]')
      .first();
    await expect(firstLine).toBeVisible();

    const incBtn = firstLine.locator('[data-testid$="-increment"]');
    const decBtn = firstLine.locator('[data-testid$="-decrement"]');
    await expect(decBtn).toBeDisabled();
    await incBtn.click();
    await expect(decBtn).toBeEnabled();
    await decBtn.click();
    await expect(decBtn).toBeDisabled();

    await page.getByTestId('pos-touch-cart-charge').click();
    const drawer = page.getByTestId('sale-payment-drawer');
    await expect(drawer).toBeVisible({ timeout: 15_000 });
    await drawer.getByRole('button', { name: /card|tarjeta/i }).click();
    await drawer.locator('#sale-payment-confirm').click();
    await expect(drawer).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId('pos-touch-cart-empty')).toBeVisible();

    await expectNoClientIssues(tracker);
  });

  test('splits /purchases into History and New Purchase tabs with dark-mode-safe cart surface', async ({
    page,
  }) => {
    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, 'admin');
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    });
    await page.goto('/purchases');

    const tabs = page.getByTestId('purchases-tabs');
    await expect(tabs).toHaveAttribute('role', 'tablist');
    await expect(page.getByTestId('purchases-tab-history')).toHaveAttribute(
      'aria-selected',
      'true'
    );

    await page.getByTestId('purchases-tab-new').click();
    await expect(page.getByTestId('purchases-tab-new')).toHaveAttribute('aria-selected', 'true');

    await page.goto('/inventory');
    await expect(page.getByTestId('inventory-tabs')).toHaveAttribute('role', 'tablist');
    await expect(page.getByTestId('inventory-group-stock')).toBeVisible();
    await expect(page.getByTestId('inventory-group-movements')).toBeVisible();

    await page.goto('/accounting-export');
    await expect(page.getByTestId('accounting-preset-today')).toBeVisible();
    await expect(page.getByTestId('accounting-preset-thisMonth')).toBeVisible();

    await expectNoClientIssues(tracker);
  });
});
