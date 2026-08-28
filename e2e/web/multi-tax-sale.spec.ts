/** Live product, sale, and receipt round-trip for normalized line taxes. */

import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  attachClientIssueTracker,
  expectNoClientIssues,
  login,
} from './support/app.js';
import {
  findProductBySku,
  getInventoryBalance,
  seedSaleScenario,
} from './support/db.js';

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function switchToSite(
  page: Page,
  target: { id: string; name: string },
  tenantId: string
) {
  const header = page.locator('header');
  const activeSite = header.getByRole('button', {
    name: new RegExp(`^${escapeRegExp(target.name)}$`),
  });
  if ((await activeSite.count()) === 0) {
    await header.locator('button[name="site"]').click();
    await page.getByRole('option', { name: target.name, exact: true }).click();
    await expect(activeSite).toBeVisible();
  }
  await expect
    .poll(() =>
      page.evaluate(key => window.localStorage.getItem(key), `active_site_id:${tenantId}`)
    )
    .toBe(target.id);
}

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

test('CO product freezes IVA + INC through sale and receipt', async ({ page }, testInfo) => {
  const tracker = attachClientIssueTracker(page);
  const suffix = `${testInfo.parallelIndex}-${Date.now()}`;
  const scenario = seedSaleScenario(`multi-tax-${suffix}`);
  const productName = `E2E IVA + INC ${suffix}`;
  const productSku = `E2E-TAX-${suffix}`;

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
  await productDialog.locator('#product-price').fill('127');
  await productDialog.getByRole('button', { name: 'Add opening stock' }).click();
  await productDialog.locator('#product-stock').fill('10');
  await productDialog.getByRole('button', { name: 'Advanced settings' }).click();
  await productDialog.locator('#product-vat-rate').selectOption({ label: 'IVA 19% (19%)' });
  await productDialog.getByRole('checkbox', { name: /INC 8%/ }).check();
  await expect(productDialog.getByText('2 of 4 components · combined rate 27%')).toBeVisible();
  await productDialog.getByRole('button', { name: 'Create Product' }).click();
  await expect(productDialog).toBeHidden({ timeout: 15_000 });

  // Reopen the persisted product instead of trusting the create-form state.
  await page.getByPlaceholder('Search products...').fill(productSku);
  const productRow = page.locator('tbody tr').filter({ hasText: productSku }).first();
  await expect(productRow).toBeVisible({ timeout: 15_000 });
  await productRow.getByRole('button', { name: 'View details' }).click();
  const details = page.getByTestId('product-details-drawer');
  await details.getByRole('button', { name: 'Edit product' }).click();
  const editDialog = page.getByRole('dialog', { name: 'Edit Product' });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.locator('#product-vat-rate')).toHaveValue(/.+/);
  await expect(editDialog.getByRole('checkbox', { name: /INC 8%/ })).toBeChecked();
  await expect(editDialog.getByText('2 of 4 components · combined rate 27%')).toBeVisible();
  await editDialog.getByRole('button', { name: 'Cancel' }).click();

  const persistedProduct = findProductBySku(productSku);
  expect(persistedProduct).not.toBeNull();
  const stockedSite = scenario.sites.find(
    site => (getInventoryBalance(site.id, persistedProduct!.id)?.onHand ?? 0) > 0
  );
  expect(stockedSite).toBeDefined();
  await switchToSite(page, stockedSite!, scenario.tenantId);

  // Keep the authenticated SPA mounted after the explicit site switch. A
  // document navigation would restart auth/site bootstrap instead of testing
  // the active operator session that owns the sale.
  await page.getByTestId('sidebar-primary-task-sell').click();
  await expect(page).toHaveURL(/\/sales(?:$|\?)/);
  await page.locator('#sales-product-search-input').fill(productSku);
  await page.locator('#sales-product-search-input').press('Enter');
  const searchRow = page.locator('tr', { has: page.getByText(productSku) }).first();
  await expect(searchRow).toBeVisible();
  await searchRow.click();
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByTestId(`sale-cart-item-${productSku}`)).toBeVisible();

  const settlement = page.locator('.sales-settlement-dock');
  await expect(settlement).toContainText('$127.00');
  await expect(settlement).toContainText('$100.00');
  await expect(settlement).toContainText('$27.00');

  await page.getByRole('button', { name: 'Charge sale' }).first().click();
  const chargeDialog = page
    .locator('[role="dialog"]')
    .filter({ has: page.getByRole('heading', { name: 'Charge Sale' }) })
    .last();
  await chargeDialog.getByRole('button', { name: 'Confirm Sale' }).click();
  await expect(chargeDialog).toBeHidden({ timeout: 15_000 });

  await page.getByTestId('sales-open-last-receipt').click();
  const saleDialog = page.locator('[role="dialog"]:visible').last();
  await expect(saleDialog).toContainText(productName);
  await expect(saleDialog).toContainText('$100.00');
  await expect(saleDialog).toContainText('$27.00');
  await expect(saleDialog).toContainText('$127.00');
  await captureEvidence(page, 'band-9-multi-tax-sale-details');

  const popupPromise = page.waitForEvent('popup');
  await saleDialog.getByRole('button', { name: 'Print', exact: true }).click();
  const receipt = await popupPromise;
  await receipt.waitForLoadState('domcontentloaded');
  await expect(receipt.locator('body')).toContainText('IVA');
  await expect(receipt.locator('body')).toContainText('INC');
  await expect(receipt.locator('body')).toContainText('$19.00');
  await expect(receipt.locator('body')).toContainText('$8.00');
  await captureEvidence(receipt, 'band-9-multi-tax-receipt');

  await expectNoClientIssues(tracker);
});
