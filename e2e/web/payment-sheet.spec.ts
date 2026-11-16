import { expect, test } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues, login } from './support/app';
import { findLatestSaleForProduct, getSalePaymentReferences, seedSaleScenario } from './support/db';
import { addProductToCartViaKeyboard } from './support/sales-keyboard';

test.describe('payment sheet', () => {
  test('cash shows the change before confirming and hands back to the scanner', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedSaleScenario(`sheet-cash-${testInfo.parallelIndex}-${Date.now()}`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, { ...scenario.cashier, defaultPath: '/sales' });

    await addProductToCartViaKeyboard(page, scenario.product.sku);
    await page.keyboard.press('F1');
    const sheet = page.getByRole('dialog', { name: /Charge Sale · 1 item/ });
    await expect(sheet.getByTestId('sale-payment-tab-cash')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    // Exact by default: nothing to give back, so no way to give it either.
    await expect(sheet.getByTestId('change-breakdown')).toHaveCount(0);

    // The on-screen keys replace the preset total with what the customer hands over.
    for (const key of ['9', '0', '000', '000']) {
      await sheet.getByTestId(`sale-payment-key-${key}`).click();
    }
    await expect(sheet.locator('#sale-payment-amount')).toHaveValue('90000000');
    await expect(sheet.getByTestId('payment-settlement')).toContainText('Change to give back');
    await expect(sheet.getByTestId('change-breakdown')).toContainText('One way to give it:');

    await sheet.locator('#sale-payment-confirm').click();
    await expect(sheet).toBeHidden({ timeout: 15_000 });
    const strip = page.getByTestId('sale-complete-strip');
    await expect(strip).toContainText('the till is back on the scanner');
    await expect(page.locator('#sales-product-search-input')).toBeFocused();
    await expect(strip.getByTestId('sale-complete-print')).toBeVisible();

    await strip.getByTestId('sale-complete-whatsapp').click();
    await expect(page.getByTestId('receipt-share-panel')).toBeVisible();
    await strip.getByTestId('sale-complete-dismiss').click();
    await expect(strip).toBeHidden();

    await expectNoClientIssues(tracker);
  });

  test('a transfer needs its receipt reference, and the sale keeps it', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const scenario = seedSaleScenario(`sheet-transfer-${testInfo.parallelIndex}-${Date.now()}`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, { ...scenario.cashier, defaultPath: '/sales' });

    await addProductToCartViaKeyboard(page, scenario.product.sku);
    await page.keyboard.press('F1');
    const sheet = page.getByRole('dialog', { name: /Charge Sale/ });
    await sheet.getByRole('button', { name: 'Transfer', exact: true }).click();

    const confirm = sheet.locator('#sale-payment-confirm');
    await expect(confirm).toHaveText(/It arrived · confirm sale/);
    await expect(confirm).toBeDisabled();
    await sheet.getByLabel('Last digits or reference of the receipt').fill('M482190');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(sheet).toBeHidden({ timeout: 15_000 });

    await expect
      .poll(() => findLatestSaleForProduct(scenario.product.id, scenario.cashier.id)?.status)
      .toBe('completed');
    const sale = findLatestSaleForProduct(scenario.product.id, scenario.cashier.id)!;
    expect(sale.paymentStatus).toBe('paid');
    expect(getSalePaymentReferences(scenario.tenantId, sale.id)).toEqual([
      { method: 'transfer', amount: sale.total, reference: 'M482190' },
    ]);

    await expectNoClientIssues(tracker);
  });

  test('an administrator sets the transfer key and the till shows its QR', async ({
    browser,
  }, testInfo) => {
    const scenario = seedSaleScenario(`sheet-handles-${testInfo.parallelIndex}-${Date.now()}`);
    const adminContext = await browser.newContext();
    const cashierContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const cashierPage = await cashierContext.newPage();
    await adminPage.setViewportSize({ width: 1440, height: 900 });
    await cashierPage.setViewportSize({ width: 1440, height: 900 });
    const key = `@e2e-${testInfo.parallelIndex}-${Date.now()}`;

    try {
      await login(adminPage, { ...scenario.admin, defaultPath: '/dashboard' });
      await adminPage.goto('/company?tab=payments');
      const card = adminPage.getByTestId('transfer-handles-card');
      await expect(card).toBeVisible();
      // Start from nothing so the QR below can only come from this save.
      while ((await card.getByRole('button', { name: /^Remove entry/ }).count()) > 0) {
        await card
          .getByRole('button', { name: /^Remove entry/ })
          .first()
          .click();
      }
      await card.getByTestId('transfer-handle-add').click();
      await card.getByLabel('Key or number 1').fill(key);
      await card.getByTestId('transfer-handles-save').click();
      await expect(adminPage.getByText('Transfer details saved')).toBeVisible();

      await login(cashierPage, { ...scenario.cashier, defaultPath: '/sales' });
      await addProductToCartViaKeyboard(cashierPage, scenario.product.sku);
      await cashierPage.keyboard.press('F1');
      const sheet = cashierPage.getByRole('dialog', { name: /Charge Sale/ });
      await sheet.getByRole('button', { name: 'Transfer', exact: true }).click();
      await expect(sheet.getByTestId('sale-transfer-qr')).toBeVisible();
      await expect(sheet.getByTestId('sale-transfer-handle')).toHaveText(`Key ${key}`);

      // Leave the shared tenant without a handle for the specs that follow.
      await card.getByRole('button', { name: 'Remove entry 1' }).click();
      await card.getByTestId('transfer-handles-save').click();
      await expect(card.getByLabel('Key or number 1')).toHaveCount(0);
    } finally {
      await adminContext.close();
      await cashierContext.close();
    }
  });
});
