import { expect, test, type Page } from '@playwright/test';
import {
  attachClientIssueTracker,
  expectNoClientIssues,
  expectSuccessToast,
  login,
} from './support/app';
import { findLatestSaleForProduct, getAuditLog, getSaleById, seedSaleScenario } from './support/db';
import { E2E_MANAGER_APPROVAL_PIN, setScenarioManagerPin } from './support/manager-approvals';

async function sellOne(page: Page, sku: string) {
  const bar = page.locator('#sales-product-search-input');
  await bar.fill(sku);
  await bar.press('Enter');
  const productRow = page.locator('tr', { has: page.getByText(sku) }).first();
  await expect(productRow).toBeVisible();
  await productRow.click();
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByTestId(`sale-cart-item-${sku}`)).toBeVisible();
  await page.getByRole('button', { name: 'Charge sale' }).first().click();
  const chargeDialog = page
    .locator('[role="dialog"]')
    .filter({ has: page.getByRole('heading', { name: 'Charge Sale' }) })
    .last();
  await chargeDialog.getByRole('button', { name: 'Confirm Sale' }).click();
  await expect(chargeDialog).toBeHidden({ timeout: 15_000 });
}

test.describe('Till return', () => {
  test('cashier scans a receipt, a manager approves with a PIN at the till and the exchange opens', async ({
    page,
  }, info) => {
    const scenario = seedSaleScenario(`till-return-${info.parallelIndex}-${Date.now()}`);
    await setScenarioManagerPin(scenario.manager.id);
    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page, {
      email: scenario.cashier.email,
      password: scenario.cashier.password,
      defaultPath: '/sales',
    });
    await sellOne(page, scenario.product.sku);
    let sale: ReturnType<typeof findLatestSaleForProduct> = null;
    await expect
      .poll(() => (sale = findLatestSaleForProduct(scenario.product.id, scenario.cashier.id)))
      .not.toBeNull();
    const { id: saleId, saleNumber } = sale!;

    await page.getByTestId('checkout-returns').click();
    const sheet = page.getByTestId('till-return-sheet');
    await expect(sheet.getByTestId(`till-return-sale-${saleNumber}`)).toBeVisible();
    await sheet.getByTestId('till-return-code').fill(saleNumber);
    await sheet.getByTestId('till-return-code').press('Enter');
    await expect(sheet.getByTestId('till-return-read')).toHaveText('receipt read');
    await expect(sheet.locator('[data-testid^="till-return-check-"]').first()).toBeChecked();

    await sheet.getByText('Exchange', { exact: true }).click();
    await expect(sheet.getByTestId('till-return-approval')).toContainText('A manager approves it');
    const submit = sheet.getByTestId('till-return-submit');
    await expect(submit).toHaveText(/Ask for approval/);
    await submit.click();
    await expect(submit).toHaveText('Waiting for approval');

    await sheet.getByTestId('till-return-pin').click();
    const pinForm = sheet.getByTestId('inline-approval-sale_refund');
    await pinForm.getByLabel('Their staff PIN').fill(E2E_MANAGER_APPROVAL_PIN);
    await pinForm.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(sheet.getByTestId('till-return-approval')).toContainText('Approved');

    await expect(submit).toHaveText(/Refund \D*\d/);
    await submit.click();
    await expect(sheet).toBeHidden({ timeout: 15_000 });
    await expectSuccessToast(page, /Return recorded/);
    await expect(page.getByTestId('cart-workspace-switcher')).toContainText(
      `Exchange ${saleNumber}`
    );
    await expect(page.getByTestId('exchange-cart-banner')).toBeVisible();

    await expect.poll(() => getSaleById(saleId)?.returnState).toBe('refunded');
    await expect
      .poll(() => getAuditLog('sale.return', saleId)?.metadata?.reason)
      .toBe('wrong_item');
    await expectNoClientIssues(tracker);
  });
});
