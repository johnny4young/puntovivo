import { expect, test } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues, login } from './support/app';
import { seedSaleScenario } from './support/db';
import { addProductToCartViaKeyboard } from './support/sales-keyboard';

test('keeps the finished sale and its receipt in reach until the next one starts', async ({
  page,
}, testInfo) => {
  const tracker = attachClientIssueTracker(page);
  const scenario = seedSaleScenario(`sale-complete-${testInfo.parallelIndex}-${Date.now()}`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, { ...scenario.cashier, defaultPath: '/sales' });

  await addProductToCartViaKeyboard(page, scenario.product.sku);
  await page.getByTestId('checkout-primary-action').click();
  const payment = page.getByRole('dialog', { name: /charge sale/i });
  // The first key replaces the preset total; the rest extend the keyed amount.
  for (const key of ['9', '9', '9', '9', '9', '9', '9']) {
    await payment.getByTestId(`sale-payment-key-${key}`).click();
  }
  await expect(payment.locator('#sale-payment-amount')).toHaveValue('9999999');
  const settlement = payment.getByTestId('payment-settlement');
  await expect(settlement).toContainText('Change due');
  await expect(payment.getByTestId('payment-change-breakdown')).toBeVisible();
  await payment.locator('#sale-payment-confirm').click();
  await expect(payment).toBeHidden({ timeout: 15_000 });

  const strip = page.getByTestId('sale-complete-strip');
  await expect(strip).toBeVisible();
  await expect(strip).toContainText(/ready, the till is back on the scanner/);
  await expect(strip.getByTestId('sale-complete-change')).toBeVisible();
  // Cashiers scan the next product straight away, so focus stays on the scanner.
  await expect(page.locator('#sales-product-search-input')).toBeFocused();

  await strip.getByTestId('sale-complete-receipt').click();
  const receipt = page.getByRole('dialog', { name: /^Sale / });
  await expect(receipt).toBeVisible();
  await expect(receipt.getByTestId('receipt-share-panel')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(receipt).toBeHidden();
  await expect(strip).toBeVisible();

  await strip.getByTestId('sale-complete-whatsapp').click();
  await expect(receipt).toBeVisible();
  await expect(receipt.getByTestId('receipt-share-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(receipt).toBeHidden();

  await strip.getByTestId('sale-complete-dismiss').click();
  await expect(strip).toBeHidden();
  await expect(page.locator('#sales-product-search-input')).toBeFocused();

  await addProductToCartViaKeyboard(page, scenario.product.sku);
  await expect(strip).toBeHidden();
  await page
    .getByTestId(`sale-cart-item-${scenario.product.sku}`)
    .getByRole('button', { name: /^Remove E2E/ })
    .click();
  await expect(strip).toBeHidden();

  await expectNoClientIssues(tracker);
});
