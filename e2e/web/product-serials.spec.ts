/** live serialized receipt, explicit POS selection and warranty lookup. */
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  expectSuccessToast,
  login,
} from './support/app.js';
import { seedSaleScenario } from './support/db.js';

async function captureEvidence(page: Page, name: string) {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  await page.screenshot({
    animations: 'disabled',
    fullPage: true,
    path: path.join(auditDir, `${name}.png`),
  });
}

test('admin receives, sells and traces one exact serialized unit', async ({ page }, testInfo) => {
  const tracker = attachClientIssueTracker(page);
  const suffix = `${testInfo.parallelIndex}-${Date.now()}`;
  const scenario = seedSaleScenario(`serial-${suffix}`);
  const productName = `E2E Serialized Laptop ${suffix}`;
  const productSku = `E2E-SERIAL-${suffix}`;
  const serialNumber = `SN-${suffix}-001`;
  const serialInput = `ＳＮ－${suffix}－００１`;

  await login(page, {
    email: scenario.admin.email,
    password: scenario.admin.password,
    defaultPath: '/dashboard',
  });

  await page.goto('/products');
  await page.getByRole('button', { name: 'Add Product' }).click();
  const productDialog = page.getByRole('dialog', { name: 'Create Product' });
  await productDialog.locator('#product-name').fill(productName);
  await productDialog.locator('#product-sku').fill(productSku);
  await productDialog.getByRole('checkbox', { name: 'Track serial numbers' }).check();
  await expect(productDialog.locator('#product-stock')).toHaveAttribute('readonly', '');
  await productDialog.getByRole('tab', { name: 'Units' }).click();
  await productDialog
    .getByRole('tabpanel', { name: 'Units' })
    .locator('select')
    .selectOption({ index: 1 });
  await productDialog.getByRole('button', { name: 'Create Product' }).click();
  await expect(productDialog).toBeHidden({ timeout: 15_000 });

  await page.goto('/inventory');
  await page.getByRole('button', { name: 'New Entry' }).click();
  const searchDialog = page.getByRole('dialog', {
    name: /Select Product for Initial Inventory/,
  });
  await searchDialog.getByPlaceholder('Search by SKU, name, or barcode').fill(productSku);
  const searchRow = searchDialog.getByTestId(`product-search-row-${productSku}`);
  await expect(searchRow).toBeVisible({ timeout: 15_000 });
  await searchRow.click();
  await searchDialog.getByRole('button', { name: 'Record Entry' }).click();

  const receiptDialog = page.getByRole('dialog', { name: 'Receive Serialized Units' });
  await expect(receiptDialog).toBeVisible();
  await receiptDialog.getByLabel('Serial numbers').fill(serialInput);
  await receiptDialog.getByLabel('Warranty expiry (optional)').fill('2028-12-31');
  await expect(receiptDialog.getByLabel('Serialized units')).toHaveValue('1');
  await captureEvidence(page, 'eng-110c-serial-receipt-en');
  await receiptDialog.getByRole('button', { name: 'Save Entry' }).click();
  await expect(receiptDialog).toBeHidden({ timeout: 15_000 });
  await expectSuccessToast(page, 'Serial units received');

  await page.getByLabel('Serial number').fill(serialNumber.toLowerCase());
  await page.getByRole('button', { name: 'Look up' }).click();
  const receivedCard = page.locator('dl').filter({ hasText: productName });
  await expect(receivedCard).toContainText('In stock');

  // Navigate inside the SPA so the pre-sale warranty result stays in the
  // QueryClient. The post-sale checks below then prove lifecycle mutations
  // invalidate both serial read surfaces instead of relying on a page reload.
  await page.getByRole('link', { name: 'Sell', exact: true }).click();
  await expect(page).toHaveURL(/\/sales$/);
  const salesSearch = page.locator('#sales-product-search-input');
  await salesSearch.fill(productSku);
  await salesSearch.press('Enter');
  const salesDialog = page.getByRole('dialog', { name: /Add product/ });
  const salesRow = salesDialog.getByTestId(`product-search-row-${productSku}`);
  await expect(salesRow).toBeVisible({ timeout: 15_000 });
  await salesRow.click();
  await salesDialog.getByRole('button', { name: 'Add to cart' }).click();
  await expect(salesDialog).toBeHidden();

  const cartLine = page.getByTestId(`sale-cart-item-${productSku}`);
  await expect(cartLine).toBeVisible();
  await expect(cartLine).toContainText('Stock 1');
  await cartLine.getByRole('checkbox', { name: serialNumber }).check();
  await expect(cartLine.getByText('1 / 1 selected')).toBeVisible();
  await expect(cartLine.getByText(/Select one exact serial/)).toHaveCount(0);
  await captureEvidence(page, 'eng-110c-pos-serial-selection-en');

  const chargeButton = page.getByRole('button', { name: 'Charge sale' }).first();
  await expect(chargeButton).toBeEnabled();
  await chargeButton.click();
  const paymentDialog = page.getByRole('dialog', { name: 'Charge Sale' });
  await expect(paymentDialog).toBeVisible();
  await paymentDialog.getByRole('button', { name: 'Confirm Sale' }).click();
  await expect(paymentDialog).toBeHidden({ timeout: 15_000 });
  await expectSuccessToast(page, 'Sale completed');

  // The same SPA session must not offer the sold identity to a fresh cart.
  await salesSearch.fill(productSku);
  await salesSearch.press('Enter');
  await expect(salesRow).toBeVisible({ timeout: 15_000 });
  await salesRow.click();
  await salesDialog.getByRole('button', { name: 'Add to cart' }).click();
  await expect(salesDialog).toBeHidden();
  await expect(
    cartLine.getByText('No sellable serial numbers are available at this site.')
  ).toBeVisible({ timeout: 15_000 });
  await cartLine.getByRole('button', { name: `Remove ${productName}` }).click();

  await page.getByRole('link', { name: 'Inventory', exact: true }).first().click();
  await expect(page).toHaveURL(/\/inventory$/);
  await page.getByLabel('Serial number').fill(serialNumber.toLowerCase());
  await page.getByRole('button', { name: 'Look up' }).click();
  const soldCard = page.locator('dl').filter({ hasText: productName });
  await expect(soldCard).toContainText('Sold');
  await expect(soldCard).toContainText('2028-12-31');
  await expect(soldCard).toContainText(/VTA-/);
  const saleNumber = (await soldCard.textContent())?.match(/VTA-\d+/)?.[0];
  expect(saleNumber).toBeTruthy();

  await page.goto('/sales');
  await page.getByTestId('sales-open-history').click();
  const historyDrawer = page.getByTestId('sales-history-drawer');
  await historyDrawer.getByPlaceholder('Search by invoice...').fill(saleNumber!);
  await historyDrawer.getByRole('button', { name: `View ${saleNumber}` }).click();
  const saleDetails = page.getByRole('dialog', { name: `Sale ${saleNumber}` });
  await expect(saleDetails).toBeVisible();
  await expect(saleDetails).toContainText('Serial numbers');
  await expect(saleDetails).toContainText(serialNumber);
  await captureEvidence(page, 'eng-110c-sale-provenance-en');

  await ensureLanguage(page, 'es');
  await page.goto('/inventory');
  await page.getByLabel('Número de serie').fill(serialNumber.toLowerCase());
  await page.getByRole('button', { name: 'Consultar' }).click();
  const spanishSoldCard = page.locator('dl').filter({ hasText: productName });
  await expect(spanishSoldCard).toContainText('Vendida');
  await expect(spanishSoldCard).toContainText(saleNumber!);
  await expect(spanishSoldCard).toContainText('2028-12-31');
  await captureEvidence(page, 'eng-110c-warranty-lookup-es');

  await expectNoClientIssues(tracker);
});
